import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import Database from 'better-sqlite3';

import {
  DatabaseRecoveryError,
  verifyDatabaseIntegrity,
  type DatabaseRecoveryPhase,
  type DatabaseRecoveryReason,
} from './database-recovery.js';

export interface DatabaseVerificationErrorPayload {
  kind: 'database-recovery' | 'generic';
  message: string;
  reason: DatabaseRecoveryReason | null;
  phase: DatabaseRecoveryPhase | null;
  quarantineEligible: boolean;
  sqliteCode: string | null;
  integrityMessages: string[];
}

export type DatabaseVerificationWorkerMessage =
  | { ok: true }
  | { ok: false; error: DatabaseVerificationErrorPayload };

export function verifyDatabaseSet(filename: string): void {
  // Check a shadow copy so SQLite recovery cannot mutate the live set.
  const shadow = mkdtempSync(join(tmpdir(), 'job-browser-verify-'));
  let database: Database.Database | undefined;
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
  } finally {
    if (database?.open === true) database.close();
    rmSync(shadow, { recursive: true, force: true });
  }
}

export function serializeDatabaseVerificationError(
  error: unknown,
): DatabaseVerificationErrorPayload {
  if (error instanceof DatabaseRecoveryError) {
    return {
      kind: 'database-recovery',
      message: error.message,
      reason: error.reason,
      phase: error.phase,
      quarantineEligible: error.quarantineEligible,
      sqliteCode: error.sqliteCode ?? null,
      integrityMessages: [...error.integrityMessages],
    };
  }
  return {
    kind: 'generic',
    message: error instanceof Error ? error.message : String(error),
    reason: null,
    phase: null,
    quarantineEligible: false,
    sqliteCode: null,
    integrityMessages: [],
  };
}

export function deserializeDatabaseVerificationError(
  payload: DatabaseVerificationErrorPayload,
): Error {
  if (
    payload.kind === 'database-recovery' &&
    payload.reason !== null &&
    payload.phase !== null
  ) {
    return new DatabaseRecoveryError(
      payload.reason,
      payload.phase,
      payload.message,
      payload.quarantineEligible,
      {
        ...(payload.sqliteCode === null
          ? {}
          : { sqliteCode: payload.sqliteCode }),
        integrityMessages: payload.integrityMessages,
      },
    );
  }
  return new Error(payload.message);
}

export function isDatabaseVerificationWorkerMessage(
  value: unknown,
): value is DatabaseVerificationWorkerMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as { ok?: unknown; error?: unknown };
  if (message.ok === true) return true;
  if (message.ok !== false || typeof message.error !== 'object') return false;
  if (message.error === null) return false;
  const error = message.error as Partial<DatabaseVerificationErrorPayload>;
  return (
    (error.kind === 'database-recovery' || error.kind === 'generic') &&
    typeof error.message === 'string' &&
    (error.reason === null || typeof error.reason === 'string') &&
    (error.phase === null || typeof error.phase === 'string') &&
    typeof error.quarantineEligible === 'boolean' &&
    (error.sqliteCode === null || typeof error.sqliteCode === 'string') &&
    Array.isArray(error.integrityMessages) &&
    error.integrityMessages.every((item) => typeof item === 'string')
  );
}
