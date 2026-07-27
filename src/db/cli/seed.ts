import { openDatabase } from '../database.js';
import { runMigrations } from '../migration-runner.js';
import { seedKnownApplications } from '../seeds/known-applications.js';
import { log } from '../../logging/logger.js';

const database = openDatabase();
try {
  runMigrations(database);
  seedKnownApplications(database);
  log('info', 'Known application seed complete');
} catch (error) {
  log('error', 'Database seed failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  database.close();
}
