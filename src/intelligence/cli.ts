import { loadCandidateProfile } from '../config/candidate-profile.js';
import { loadScoringConfig } from '../config/scoring-config.js';
import { openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migration-runner.js';
import { seedKnownApplications } from '../db/seeds/known-applications.js';
import { DiscoveryEngine } from '../discovery/discoveryEngine.js';
import { log } from '../logging/logger.js';
import { providerRegistry } from '../providers/providerRegistry.js';
import { IntelligenceEngine } from './intelligenceEngine.js';

const fixtureOnly = process.argv.includes('--fixture');
const database = openDatabase();

try {
  runMigrations(database);
  seedKnownApplications(database);
  if (fixtureOnly) {
    await providerRegistry.loadProviders();
    await new DiscoveryEngine(database, providerRegistry).run(
      'builtin',
      { query: 'software', location: null, remoteOnly: true, limit: 50 },
      { fixtureOnly: true },
    );
  }
  const summary = new IntelligenceEngine(database).analyze(
    loadCandidateProfile(),
    loadScoringConfig(),
  );
  log('info', 'Analysis command finished', { ...summary, fixtureOnly });
} catch (error) {
  log('error', 'Analysis command failed', {
    error: error instanceof Error ? error.message : String(error),
    stackTrace: error instanceof Error ? (error.stack ?? null) : null,
  });
  process.exitCode = 1;
} finally {
  database.close();
}
