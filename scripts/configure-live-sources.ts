import { openDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { seedKnownApplications } from '../src/db/seeds/known-applications.js';
import { log } from '../src/logging/logger.js';
import { providerRegistry } from '../src/providers/providerRegistry.js';
import { SourceRepository } from '../src/repositories/source-repository.js';
import { unavailableCredentialResolver } from '../src/discovery/credentialResolver.js';
import { DiscoveryCoordinator } from '../src/discovery/discoveryCoordinator.js';
import type { SourceInput } from '../src/models/source-management.js';
import type { ConfiguredSource } from '../src/models/source-management.js';

interface SourceSpec {
  input: SourceInput;
}

const specs: SourceSpec[] = [
  {
    input: {
      displayName: 'Costco',
      employer: 'Costco',
      providerId: 'icims',
      careersUrl: 'https://careers.costco.com',
      configuration: {
        portalUrl: 'https://careers.costco.com',
        company: 'Costco',
      },
      searchCriteria: {
        query: '',
        location: null,
        remoteOnly: false,
        limit: 50,
        maxAgeDays: null,
      },
      enabled: true,
      schedule: {
        enabled: false,
        cadence: 'manual',
        dailyLocalTime: null,
      },
    },
  },
  {
    input: {
      displayName: 'Continental',
      employer: 'Continental',
      providerId: 'smartrecruiters',
      careersUrl: 'https://jobs.smartrecruiters.com/continental',
      configuration: {
        companyIdentifier: 'continental',
        company: 'Continental',
      },
      searchCriteria: {
        query: '',
        location: null,
        remoteOnly: false,
        limit: 50,
        maxAgeDays: null,
      },
      enabled: true,
      schedule: {
        enabled: false,
        cadence: 'manual',
        dailyLocalTime: null,
      },
    },
  },
];

const database = openDatabase();

function existingSource(
  sources: SourceRepository,
  input: SourceInput,
): ConfiguredSource | null {
  const careersUrl = input.careersUrl?.toLowerCase();
  return (
    sources
      .list()
      .find(
        (source) =>
          source.displayName.toLowerCase() ===
            input.displayName.toLowerCase() ||
          (careersUrl !== undefined &&
            source.careersUrl?.toLowerCase() === careersUrl),
      ) ?? null
  );
}

try {
  runMigrations(database);
  seedKnownApplications(database);
  await providerRegistry.loadProviders();
  const sources = new SourceRepository(database);
  sources.reconcileProviders(providerRegistry.list());
  const coordinator = new DiscoveryCoordinator(database, providerRegistry, {
    credentialResolver: unavailableCredentialResolver,
  });

  const created: ConfiguredSource[] = [];
  for (const spec of specs) {
    const existing = existingSource(sources, spec.input);
    if (existing !== null) {
      log('info', 'Source already present, skipping creation', {
        displayName: spec.input.displayName,
        sourceId: existing.id,
      });
      created.push(existing);
      continue;
    }
    const validation = await coordinator.validateSource(
      spec.input.providerId,
      spec.input.configuration,
    );
    const status = validation.valid === true ? 'valid' : 'invalid';
    if (status !== 'valid') {
      log('error', 'Source configuration failed validation', {
        displayName: spec.input.displayName,
        validation,
      });
      throw new Error(
        `Configuration for ${spec.input.displayName} is not valid: ${JSON.stringify(validation)}`,
      );
    }
    const source = sources.create(spec.input, status);
    log('info', 'Source created', {
      displayName: spec.input.displayName,
      sourceId: source.id,
      providerId: source.providerId,
    });
    created.push(source);
  }

  for (const source of created) {
    log('info', 'Running discovery', { sourceId: source.id });
    const summaries = await coordinator.runSource(source.id, 'manual-source');
    log('info', 'Discovery finished', { summaries });
  }

  const enabled = sources.listEnabled();
  log('info', 'Enabled sources after configuration', {
    count: enabled.length,
    sources: enabled.map((source) => ({
      displayName: source.displayName,
      providerId: source.providerId,
      configurationStatus: source.configurationStatus,
      healthStatus: source.healthStatus,
    })),
  });
  await coordinator.stop();
} catch (error) {
  log('error', 'Source configuration failed', {
    error: error instanceof Error ? error.message : String(error),
    stackTrace: error instanceof Error ? (error.stack ?? null) : null,
  });
  process.exitCode = 1;
} finally {
  database.close();
}
