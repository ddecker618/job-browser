import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';

import Database from 'better-sqlite3';

import {
  DatabaseRecoveryError,
  inspectDatabaseSet,
  isCorruptionError,
  quarantineDatabaseSet,
  sqliteErrorCode,
  verifyDatabaseIntegrity,
} from './database-recovery.js';
import {
  deserializeDatabaseVerificationError,
  isDatabaseVerificationWorkerMessage,
  verifyDatabaseSet,
} from './database-verification.js';

export type JobDatabase = Database.Database;

export interface OpenDatabaseOptions {
  quarantineDirectory?: string;
}

export function defaultDatabasePath(): string {
  return (
    process.env['JOB_BROWSER_DB_PATH'] ??
    resolve(process.cwd(), 'data', 'job-browser.sqlite')
  );
}

export function openDatabase(
  filename = defaultDatabasePath(),
  options: OpenDatabaseOptions = {},
): JobDatabase {
  if (filename === ':memory:') return openRuntimeDatabase(filename, false);

  const { resolvedFilename, databaseExists } = prepareDatabaseOpen(
    filename,
    options,
  );

  if (databaseExists) {
    try {
      verifyExistingDatabase(resolvedFilename);
    } catch (error) {
      return failRecovery(
        resolvedFilename,
        options,
        asRecoveryError(error, resolvedFilename, 'integrity'),
      );
    }
  }

  try {
    return openRuntimeDatabase(resolvedFilename, databaseExists);
  } catch (error) {
    return failRecovery(
      resolvedFilename,
      options,
      asRecoveryError(error, resolvedFilename, 'configure'),
    );
  }
}

export async function openDatabaseAsync(
  filename = defaultDatabasePath(),
  options: OpenDatabaseOptions = {},
): Promise<JobDatabase> {
  if (filename === ':memory:') return openRuntimeDatabase(filename, false);

  const { resolvedFilename, databaseExists } = prepareDatabaseOpen(
    filename,
    options,
  );

  if (databaseExists) {
    try {
      await verifyExistingDatabaseAsync(resolvedFilename);
    } catch (error) {
      return failRecovery(
        resolvedFilename,
        options,
        asRecoveryError(error, resolvedFilename, 'integrity'),
      );
    }
  }

  try {
    return openRuntimeDatabase(resolvedFilename, databaseExists);
  } catch (error) {
    return failRecovery(
      resolvedFilename,
      options,
      asRecoveryError(error, resolvedFilename, 'configure'),
    );
  }
}

function prepareDatabaseOpen(
  filename: string,
  options: OpenDatabaseOptions,
): { resolvedFilename: string; databaseExists: boolean } {
  const resolvedFilename = resolve(filename);
  mkdirSync(dirname(resolvedFilename), { recursive: true });
  const snapshot = inspectDatabaseSet(resolvedFilename);
  const databaseExists = snapshot.members.some(
    (member) => member.kind === 'database' && member.exists,
  );
  const sidecarExists = snapshot.members.some(
    (member) => member.kind !== 'database' && member.exists,
  );

  if (!databaseExists && sidecarExists) {
    return failRecovery(
      resolvedFilename,
      options,
      new DatabaseRecoveryError(
        'database-set-incomplete',
        'open',
        `SQLite sidecars exist without their database at ${resolvedFilename}`,
        true,
      ),
    );
  }
  return { resolvedFilename, databaseExists };
}

function verifyExistingDatabase(filename: string): void {
  try {
    verifyDatabaseSet(filename);
  } catch (error) {
    throw asRecoveryError(error, filename, 'integrity');
  }
}

function verifyExistingDatabaseAsync(filename: string): Promise<void> {
  return new Promise((resolveVerification, rejectVerification) => {
    const sourceModule = import.meta.url.endsWith('.ts');
    const worker = new Worker(
      new URL(
        `./database-verification-worker.${sourceModule ? 'ts' : 'js'}`,
        import.meta.url,
      ),
      {
        workerData: { filename },
        ...(sourceModule ? { execArgv: ['--import', 'tsx'] } : {}),
      },
    );
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      action();
    };
    const terminate = (): void => {
      void worker.terminate();
    };

    worker.once('message', (message: unknown) => {
      if (!isDatabaseVerificationWorkerMessage(message)) {
        finish(() =>
          rejectVerification(
            new Error(
              'Database verification worker returned an invalid result',
            ),
          ),
        );
        terminate();
        return;
      }
      if (message.ok) {
        finish(resolveVerification);
      } else {
        finish(() =>
          rejectVerification(
            deserializeDatabaseVerificationError(message.error),
          ),
        );
      }
      terminate();
    });
    worker.once('error', (error) => {
      finish(() => rejectVerification(error));
    });
    worker.once('exit', (code) => {
      if (!settled) {
        finish(() =>
          rejectVerification(
            new Error(
              `Database verification worker exited with code ${String(code)}`,
            ),
          ),
        );
      }
    });
  });
}

function openRuntimeDatabase(
  filename: string,
  fileMustExist: boolean,
): JobDatabase {
  let database: JobDatabase;
  try {
    database = new Database(filename, { fileMustExist });
  } catch (error) {
    throw asRecoveryError(error, filename, 'open');
  }
  try {
    database.pragma('busy_timeout = 5000');
    if (!fileMustExist) verifyDatabaseIntegrity(database, filename);
    database.pragma('foreign_keys = ON');
    if (filename !== ':memory:') {
      database.pragma('journal_mode = WAL');
    }
    return database;
  } catch (error) {
    database.close();
    throw asRecoveryError(error, filename, 'configure');
  }
}

function asRecoveryError(
  error: unknown,
  filename: string,
  phase: 'open' | 'integrity' | 'configure',
): DatabaseRecoveryError {
  if (error instanceof DatabaseRecoveryError) return error;
  const code = sqliteErrorCode(error);
  return new DatabaseRecoveryError(
    'database-open-failed',
    phase,
    `Unable to open SQLite database at ${filename}: ${error instanceof Error ? error.message : String(error)}`,
    isCorruptionError(error),
    {
      cause: error,
      ...(code === undefined ? {} : { sqliteCode: code }),
    },
  );
}

function failRecovery(
  filename: string,
  options: OpenDatabaseOptions,
  error: DatabaseRecoveryError,
): never {
  if (!error.quarantineEligible || options.quarantineDirectory === undefined) {
    throw error;
  }

  try {
    const quarantine = quarantineDatabaseSet(
      filename,
      options.quarantineDirectory,
      error,
    );
    throw new DatabaseRecoveryError(
      error.reason,
      error.phase,
      `${error.message}. A recovery copy was preserved at ${quarantine.directory}`,
      true,
      {
        cause: error,
        ...(error.sqliteCode === undefined
          ? {}
          : { sqliteCode: error.sqliteCode }),
        integrityMessages: error.integrityMessages,
        quarantine,
      },
    );
  } catch (quarantineError) {
    if (
      quarantineError instanceof DatabaseRecoveryError &&
      quarantineError.quarantine !== undefined
    ) {
      throw quarantineError;
    }
    throw new DatabaseRecoveryError(
      error.reason,
      'quarantine',
      `${error.message}. Job Browser could not complete the recovery copy`,
      true,
      {
        cause: new AggregateError([error, quarantineError]),
        ...(error.sqliteCode === undefined
          ? {}
          : { sqliteCode: error.sqliteCode }),
        integrityMessages: error.integrityMessages,
        quarantineFailed: true,
      },
    );
  }
}

export {
  DatabaseRecoveryError,
  verifyDatabaseIntegrity,
} from './database-recovery.js';
