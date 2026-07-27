import { mkdirSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { JobDatabase } from './database.js';

export async function createDatabaseBackup(
  database: JobDatabase,
  backupDirectory: string,
  prefix = 'job-browser',
): Promise<string> {
  mkdirSync(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let destination = join(backupDirectory, `${prefix}-${timestamp}.sqlite`);
  let suffix = 1;
  const existing = new Set(readdirSync(backupDirectory));
  while (existing.has(basename(destination))) {
    destination = join(
      backupDirectory,
      `${prefix}-${timestamp}-${String(suffix)}.sqlite`,
    );
    suffix += 1;
  }
  await database.backup(destination);
  return destination;
}
