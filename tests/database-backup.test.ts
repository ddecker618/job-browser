import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDatabaseBackup } from '../src/db/backup.js';
import { openDatabase } from '../src/db/database.js';

let directory = '';
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('database backup', () => {
  it('creates unique SQLite-safe backups without changing the source', async () => {
    directory = mkdtempSync(join(tmpdir(), 'job-browser-backup-'));
    const database = openDatabase(join(directory, 'source.sqlite'));
    database.exec(
      "CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES ('safe')",
    );
    const first = await createDatabaseBackup(
      database,
      join(directory, 'backups'),
    );
    const second = await createDatabaseBackup(
      database,
      join(directory, 'backups'),
    );
    database.close();

    expect(first).not.toBe(second);
    expect(existsSync(first)).toBe(true);
    const backup = openDatabase(first);
    expect(
      backup.prepare<[], { value: string }>('SELECT value FROM marker').get()
        ?.value,
    ).toBe('safe');
    backup.close();
  });
});
