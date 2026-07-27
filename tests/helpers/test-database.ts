import { randomUUID } from 'node:crypto';

import type { JobDatabase } from '../../src/db/database.js';
import { openDatabase } from '../../src/db/database.js';
import { runMigrations } from '../../src/db/migration-runner.js';
import { nowUtc } from '../../src/utilities/timestamps.js';

export function createTestDatabase(): JobDatabase {
  const database = openDatabase(':memory:');
  runMigrations(database);
  return database;
}

export function insertTestSource(
  database: JobDatabase,
  overrides: { id?: string; employer?: string; sourceType?: string } = {},
): string {
  const id = overrides.id ?? randomUUID();
  const timestamp = nowUtc();
  database
    .prepare(
      `INSERT INTO sources (
        id, employer, source_type, careers_url, enabled, connector,
        last_successful_run, last_failure, failure_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      overrides.employer ?? 'Example Employer',
      overrides.sourceType ?? 'fixture',
      null,
      1,
      null,
      null,
      null,
      0,
      timestamp,
      timestamp,
    );
  return id;
}
