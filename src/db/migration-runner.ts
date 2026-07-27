import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { JobDatabase } from './database.js';
import { nowUtc } from '../utilities/timestamps.js';

const colocatedMigrationsDirectory = fileURLToPath(
  new URL('./migrations/', import.meta.url),
);
export const DEFAULT_MIGRATIONS_DIRECTORY = existsSync(
  colocatedMigrationsDirectory,
)
  ? colocatedMigrationsDirectory
  : resolve(process.cwd(), 'src', 'db', 'migrations');

interface AppliedMigrationRow {
  filename: string;
  checksum: string;
}

export function listPendingMigrations(
  database: JobDatabase,
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
): string[] {
  const hasTable = database
    .prepare<
      [],
      { count: number }
    >("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get()?.count;
  const applied =
    hasTable === 1
      ? new Set(
          database
            .prepare<[], { filename: string }>(
              'SELECT filename FROM schema_migrations',
            )
            .all()
            .map((row) => row.filename),
        )
      : new Set<string>();
  return readdirSync(migrationsDirectory)
    .filter(
      (filename) => /^\d+_.+\.sql$/.test(filename) && !applied.has(filename),
    )
    .sort();
}

export interface MigrationResult {
  applied: string[];
}

function checksum(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

export function runMigrations(
  database: JobDatabase,
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
): MigrationResult {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const filenames = readdirSync(migrationsDirectory)
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .sort((left, right) => left.localeCompare(right));
  const appliedRows = database
    .prepare<
      [],
      AppliedMigrationRow
    >('SELECT filename, checksum FROM schema_migrations')
    .all();
  const appliedByFilename = new Map(
    appliedRows.map((row) => [row.filename, row.checksum]),
  );
  const insertMigration = database.prepare(
    'INSERT INTO schema_migrations (version, filename, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );
  const applied: string[] = [];

  for (const filename of filenames) {
    const versionText = /^(\d+)_/.exec(filename)?.[1];
    if (versionText === undefined) {
      throw new Error(`Invalid migration filename: ${filename}`);
    }

    const version = Number(versionText);
    const contents = readFileSync(join(migrationsDirectory, filename), 'utf8');
    const migrationChecksum = checksum(contents);
    const previousChecksum = appliedByFilename.get(filename);

    if (previousChecksum !== undefined) {
      if (previousChecksum !== migrationChecksum) {
        throw new Error(`Applied migration has changed: ${filename}`);
      }
      continue;
    }

    try {
      database.transaction(() => {
        database.exec(contents);
        insertMigration.run(version, filename, migrationChecksum, nowUtc());
      })();
      applied.push(filename);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to apply migration ${filename}: ${message}`, {
        cause: error,
      });
    }
  }

  return { applied };
}
