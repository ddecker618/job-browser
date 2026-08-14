import { loadScoringConfig } from '../../config/scoring-config.js';
import { openDatabase } from '../database.js';
import { runMigrations } from '../migration-runner.js';
import { log } from '../../logging/logger.js';
import { backfillRoleDetails } from '../backfill-role-details.js';

const database = openDatabase();
try {
  runMigrations(database);
  const config = loadScoringConfig();
  const result = backfillRoleDetails(database, config);

  log('info', 'Role details backfill complete', {
    processed: result.processed,
    updated: result.updated,
    skippedCurrentVersion: result.skippedCurrentVersion,
    version: result.version,
  });
} catch (error) {
  log('error', 'Role details backfill failed', {
    error: error instanceof Error ? error.message : String(error),
    stackTrace: error instanceof Error ? (error.stack ?? null) : null,
  });
  process.exitCode = 1;
} finally {
  database.close();
}
