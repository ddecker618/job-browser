import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import { openDatabase } from '../../db/database.js';
import { runMigrations } from '../../db/migration-runner.js';
import { seedEmployerRegistry } from '../../db/seeds/employerRegistry.js';
import { log } from '../../logging/logger.js';
import { EmployerRepository } from '../../repositories/employerRepository.js';
import { SourceRepository } from '../../repositories/source-repository.js';
import { parseEmployerManifest } from '../../schemas/employer-manifest.js';
import { EmployerSeedImporter } from '../employerSeedImporter.js';

const arguments_ = process.argv.slice(2);
const dryRun = arguments_.includes('--dry-run');
const manifestArgument = arguments_.find(
  (argument) => !argument.startsWith('--'),
);
if (manifestArgument === undefined) {
  throw new Error('Usage: import-employers <manifest.json|csv> [--dry-run]');
}
const manifestPath = resolve(process.cwd(), manifestArgument);
const format = extname(manifestPath).toLowerCase() === '.csv' ? 'csv' : 'json';

const database = openDatabase();
try {
  runMigrations(database);
  seedEmployerRegistry(database);
  const contents = readFileSync(manifestPath, 'utf8');
  const parsed = parseEmployerManifest({ format, contents });
  const importer = new EmployerSeedImporter(
    database,
    new EmployerRepository(database),
    new SourceRepository(database),
  );
  const result = importer.importManifest(parsed, { dryRun });
  const { rows, ...summary } = result;
  const rowsByStatus: Record<string, number> = {};
  for (const row of rows) {
    rowsByStatus[row.status] = (rowsByStatus[row.status] ?? 0) + 1;
  }
  console.log(JSON.stringify({ ...summary, rowsByStatus }, null, 2));
} catch (error) {
  log('error', 'Employer manifest import failed', {
    error: error instanceof Error ? error.message : String(error),
    stackTrace: error instanceof Error ? (error.stack ?? null) : null,
  });
  process.exitCode = 1;
} finally {
  database.close();
}
