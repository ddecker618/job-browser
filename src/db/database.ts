import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import Database from 'better-sqlite3';

import {
  DatabaseRecoveryError,
  inspectDatabaseSet,
  isCorruptionError,
  quarantineDatabaseSet,
  sqliteErrorCode,
  verifyDatabaseIntegrity,
} from './database-recovery.js';

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

function verifyExistingDatabase(filename: string): void {
  // Verifying against a shadow copy keeps SQLite's own WAL-index rebuilds from
  // mutating (or destroying evidence within) the live set before quarantine.
  const shadow = mkdtempSync(join(tmpdir(), 'job-browser-verify-'));
  let database: JobDatabase | undefined;
  try {
    for (const candidate of [filename, `${filename}-wal`, `${filename}-shm`]) {
      if (existsSync(candidate)) {
        copyFileSync(candidate, join(shadow, basename(candidate)));
      }
    }
    const shadowPath = join(shadow, basename(filename));
    database = new Database(shadowPath, {
      fileMustExist: true,
      readonly: true,
    });
    database.pragma('busy_timeout = 5000');
    verifyDatabaseIntegrity(database, filename);
  } catch (error) {
    throw asRecoveryError(error, filename, 'integrity');
  } finally {
    if (database?.open === true) database.close();
    rmSync(shadow, { recursive: true, force: true });
  }
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
