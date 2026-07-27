import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';

export type JobDatabase = Database.Database;

export function defaultDatabasePath(): string {
  return (
    process.env['JOB_BROWSER_DB_PATH'] ??
    resolve(process.cwd(), 'data', 'job-browser.sqlite')
  );
}

export function openDatabase(filename = defaultDatabasePath()): JobDatabase {
  if (filename !== ':memory:') {
    mkdirSync(dirname(resolve(filename)), { recursive: true });
  }

  const walFile = `${filename}-wal`;
  const shmFile = `${filename}-shm`;

  for (const sidecar of [walFile, shmFile]) {
    if (existsSync(sidecar)) {
      try {
        unlinkSync(sidecar);
      } catch {
        // Best-effort: if we can't remove it, the open below will fail with a clear error
      }
    }
  }

  let database: JobDatabase | undefined;
  try {
    database = new Database(filename);
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    if (filename !== ':memory:') {
      database.pragma('journal_mode = WAL');
    }
    return database;
  } catch (error) {
    database?.close();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to open SQLite database at ${filename}: ${message}`,
      {
        cause: error,
      },
    );
  }
}
