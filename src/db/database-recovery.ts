import { randomUUID } from 'node:crypto';
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

import type { JobDatabase } from './database.js';

export type DatabaseSetFileKind = 'database' | 'wal' | 'shm';
export type DatabaseRecoveryReason =
  | 'database-set-incomplete'
  | 'database-open-failed'
  | 'database-integrity-failed';
export type DatabaseRecoveryPhase =
  | 'open'
  | 'integrity'
  | 'configure'
  | 'quarantine';

export interface DatabaseSetMember {
  kind: DatabaseSetFileKind;
  path: string;
  filename: string;
  exists: boolean;
  sizeBytes: number | null;
  modifiedAtMs: number | null;
}

export interface DatabaseSetSnapshot {
  databasePath: string;
  members: readonly DatabaseSetMember[];
}

export interface DatabaseQuarantineResult {
  directory: string;
  metadataPath: string;
  files: readonly {
    kind: DatabaseSetFileKind;
    path: string;
    sizeBytes: number;
  }[];
}

interface DatabaseRecoveryErrorOptions {
  cause?: unknown;
  sqliteCode?: string;
  integrityMessages?: readonly string[];
  quarantine?: DatabaseQuarantineResult;
  quarantineFailed?: boolean;
}

export class DatabaseRecoveryError extends Error {
  public readonly sqliteCode: string | undefined;
  public readonly integrityMessages: readonly string[];
  public readonly quarantine: DatabaseQuarantineResult | undefined;
  public readonly quarantineFailed: boolean;

  public constructor(
    public readonly reason: DatabaseRecoveryReason,
    public readonly phase: DatabaseRecoveryPhase,
    message: string,
    public readonly quarantineEligible: boolean,
    options: DatabaseRecoveryErrorOptions = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'DatabaseRecoveryError';
    this.sqliteCode = options.sqliteCode;
    this.integrityMessages = options.integrityMessages ?? [];
    this.quarantine = options.quarantine;
    this.quarantineFailed = options.quarantineFailed ?? false;
  }
}

export function inspectDatabaseSet(databasePath: string): DatabaseSetSnapshot {
  const resolved = resolve(databasePath);
  const candidates: readonly [DatabaseSetFileKind, string][] = [
    ['database', resolved],
    ['wal', `${resolved}-wal`],
    ['shm', `${resolved}-shm`],
  ];
  return {
    databasePath: resolved,
    members: candidates.map(([kind, path]) => {
      if (!existsSync(path)) {
        return {
          kind,
          path,
          filename: basename(path),
          exists: false,
          sizeBytes: null,
          modifiedAtMs: null,
        };
      }
      const stats = statSync(path);
      return {
        kind,
        path,
        filename: basename(path),
        exists: true,
        sizeBytes: stats.size,
        modifiedAtMs: stats.mtimeMs,
      };
    }),
  };
}

export function verifyDatabaseIntegrity(
  database: JobDatabase,
  databasePath = database.name,
): void {
  let rows: Record<string, unknown>[];
  try {
    rows = database.pragma('quick_check(10)') as Record<string, unknown>[];
  } catch (error) {
    const sqliteCode = sqliteErrorCode(error);
    throw new DatabaseRecoveryError(
      'database-integrity-failed',
      'integrity',
      `Unable to verify SQLite database integrity at ${databasePath}: ${errorMessage(error)}`,
      isCorruptionError(error),
      {
        cause: error,
        ...(sqliteCode === undefined ? {} : { sqliteCode }),
      },
    );
  }

  const messages = rows
    .map((row) => Object.values(row)[0])
    .map((value) => {
      if (typeof value !== 'string') {
        return 'No integrity result returned';
      }
      return value.slice(0, 512);
    })
    .slice(0, 10);
  if (messages.length === 1 && messages[0]?.toLowerCase() === 'ok') return;

  throw new DatabaseRecoveryError(
    'database-integrity-failed',
    'integrity',
    `SQLite integrity check failed at ${databasePath}: ${messages.join('; ')}`,
    true,
    { integrityMessages: messages },
  );
}

export function quarantineDatabaseSet(
  databasePath: string,
  quarantineRoot: string,
  failure: Pick<DatabaseRecoveryError, 'reason' | 'phase' | 'sqliteCode'>,
): DatabaseQuarantineResult {
  const snapshot = inspectDatabaseSet(databasePath);
  const existing = snapshot.members.filter((member) => member.exists);
  if (existing.length === 0) {
    throw new Error('No database-set files exist to quarantine');
  }

  mkdirSync(quarantineRoot, { recursive: true });
  const createdAt = new Date();
  const incidentId = randomUUID();
  const directoryName = `${createdAt.toISOString().replace(/[:.]/g, '-')}-${incidentId}`;
  const finalDirectory = join(quarantineRoot, directoryName);
  const pendingDirectory = `${finalDirectory}.pending`;
  mkdirSync(pendingDirectory);

  try {
    const copied = existing.map((member) => {
      const before = statSync(member.path);
      const destination = join(pendingDirectory, member.filename);
      // Copying keeps the original recovery set intact if a copy fails or spans volumes.
      copyFileSync(member.path, destination, constants.COPYFILE_EXCL);
      const destinationStats = statSync(destination);
      const after = statSync(member.path);
      if (
        destinationStats.size !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs
      ) {
        throw new Error(
          `Database-set member changed while copying: ${member.filename}`,
        );
      }
      return {
        kind: member.kind,
        filename: member.filename,
        sizeBytes: before.size,
        modifiedAtMs: before.mtimeMs,
      };
    });

    const metadata = {
      version: 1,
      incidentId,
      createdAt: createdAt.toISOString(),
      reason: failure.reason,
      phase: failure.phase,
      sqliteCode: boundSqliteCode(failure.sqliteCode),
      databasePath: snapshot.databasePath.slice(0, 1000),
      files: copied,
    };
    writeFileSync(
      join(pendingDirectory, 'metadata.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    renameSync(pendingDirectory, finalDirectory);
    return {
      directory: finalDirectory,
      metadataPath: join(finalDirectory, 'metadata.json'),
      files: copied.map((file) => ({
        kind: file.kind,
        path: join(finalDirectory, file.filename),
        sizeBytes: file.sizeBytes,
      })),
    };
  } catch (error) {
    rmSync(pendingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function sqliteErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code.slice(0, 64) : undefined;
}

export function isCorruptionError(error: unknown): boolean {
  const code = sqliteErrorCode(error);
  if (code?.startsWith('SQLITE_CORRUPT') === true || code === 'SQLITE_NOTADB') {
    return true;
  }
  return /malformed|corrupt|not a database|file is not a database/i.test(
    errorMessage(error),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boundSqliteCode(code: string | undefined): string | null {
  return code?.replace(/[^A-Z0-9_]/gi, '').slice(0, 64) ?? null;
}
