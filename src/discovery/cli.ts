import { openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migration-runner.js';
import { seedKnownApplications } from '../db/seeds/known-applications.js';
import { log } from '../logging/logger.js';
import { providerRegistry } from '../providers/providerRegistry.js';
import { SourceRepository } from '../repositories/source-repository.js';
import { unavailableCredentialResolver } from './credentialResolver.js';
import { DiscoveryCoordinator } from './discoveryCoordinator.js';

const fixtureOnly = process.argv.includes('--fixture');
const allSources = process.argv.includes('--all');
const selectedSourceIds = process.argv.flatMap(
  (argument, index, arguments_) => {
    if (argument !== '--source') return [];
    const sourceId = arguments_[index + 1];
    if (sourceId === undefined || sourceId.startsWith('--'))
      throw new Error('--source requires a source ID');
    return [sourceId];
  },
);
const database = openDatabase();

try {
  runMigrations(database);
  seedKnownApplications(database);
  await providerRegistry.loadProviders();
  const sources = new SourceRepository(database);
  sources.reconcileProviders(providerRegistry.list());
  const coordinator = new DiscoveryCoordinator(database, providerRegistry, {
    credentialResolver: unavailableCredentialResolver,
  });
  if (allSources && selectedSourceIds.length > 0)
    throw new Error('Use either --all or --source, not both');
  const sourceIds =
    selectedSourceIds.length > 0
      ? selectedSourceIds
      : sources.listEnabled().map((source) => source.id);
  const summaries = fixtureOnly
    ? await coordinator.runFixtures(sourceIds)
    : await Promise.all(
        sourceIds.map((sourceId) => coordinator.runSource(sourceId, 'cli')),
      ).then((results) => results.flat());
  log('info', 'Discovery command finished', { summaries, fixtureOnly });
  await coordinator.stop();
} catch (error) {
  log('error', 'Discovery command failed', {
    error: error instanceof Error ? error.message : String(error),
    stackTrace: error instanceof Error ? (error.stack ?? null) : null,
  });
  process.exitCode = 1;
} finally {
  database.close();
}
