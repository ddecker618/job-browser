import { openDatabase } from '../database.js';
import { runMigrations } from '../migration-runner.js';
import { log } from '../../logging/logger.js';

const database = openDatabase();
try {
  const result = runMigrations(database);
  log('info', 'Database migrations complete', { applied: result.applied });
} catch (error) {
  log('error', 'Database migration failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  database.close();
}
