import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { openDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { runNlpRealDataValidation } from '../src/intelligence/nlp/realDataValidation.js';

const databasePath = process.argv[2];
if (!databasePath) {
  throw new Error('Usage: tsx scripts/validate-local-nlp.ts <database-copy> [limit]');
}
const resolved = resolve(databasePath);
const protectedDatabase = resolve(
  process.env['APPDATA'] ?? '',
  'Job Browser',
  'data',
  'jobs.sqlite',
);
if (resolved.toLowerCase() === protectedDatabase.toLowerCase()) {
  throw new Error('Refusing to validate against the live Job Browser database; provide a copy.');
}
const limit = process.argv[3] === undefined ? 500 : Number(process.argv[3]);
if (!existsSync(resolved)) throw new Error('Database copy does not exist.');
const database = openDatabase(resolved);
try {
  runMigrations(database);
  const report = await runNlpRealDataValidation(database, { limit });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.productionInvariance.unchanged) process.exitCode = 2;
} finally {
  database.close();
}
