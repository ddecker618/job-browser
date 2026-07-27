import { openDatabase } from '../database.js';
import { runMigrations } from '../migration-runner.js';
import { seedKnownApplications } from '../seeds/known-applications.js';
import { log } from '../../logging/logger.js';

const database = openDatabase();
try {
  const result = runMigrations(database);
  seedKnownApplications(database);
  log('info', 'Database setup complete', { appliedMigrations: result.applied });
} catch (error) {
  log('error', 'Database setup failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  database.close();
}
