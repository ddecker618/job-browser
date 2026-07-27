import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type JobDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import {
  DiscoveryCoordinator,
  translateError,
} from '../src/discovery/discoveryCoordinator.js';
import { unavailableCredentialResolver } from '../src/discovery/credentialResolver.js';
import type {
  DiscoveryOptions,
  ProviderFetchResult,
  ProviderSearch,
  SearchRequest,
} from '../src/models/discovery.js';
import type {
  ProviderCapabilities,
  ValidationResult,
} from '../src/models/source-management.js';
import type { NormalizedJob } from '../src/schemas/normalized-job.js';
import { BaseProvider } from '../src/providers/baseProvider.js';
import { ProviderRegistry } from '../src/providers/providerRegistry.js';
import { RemoteOkProvider } from '../src/providers/remoteOk.provider.js';
import { SourceRepository } from '../src/repositories/source-repository.js';

const databases: JobDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('discovery coordinator', () => {
  it('runs fixture discovery through a configured source and records immutable observations', async () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database);
    const registry = new ProviderRegistry();
    registry.register(new RemoteOkProvider());
    const sources = new SourceRepository(database);
    sources.reconcileProviders(registry.list());
    sources.ensureRemoteOkSource();
    const coordinator = new DiscoveryCoordinator(database, registry, {
      credentialResolver: unavailableCredentialResolver,
    });
    const summaries = await coordinator.runFixture('provider:remote-ok');
    expect(summaries[0]).toMatchObject({
      jobsInserted: 2,
      duplicatesMerged: 0,
    });
    expect(
      database
        .prepare<
          [],
          { count: number }
        >('SELECT COUNT(*) AS count FROM job_observations')
        .get()?.count,
    ).toBe(2);
    await coordinator.stop();
  });

  it('queues concurrent runs instead of overlapping them', async () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database);
    const registry = new ProviderRegistry();
    registry.register(new RemoteOkProvider());
    const sources = new SourceRepository(database);
    sources.reconcileProviders(registry.list());
    sources.ensureRemoteOkSource();
    const coordinator = new DiscoveryCoordinator(database, registry, {
      credentialResolver: unavailableCredentialResolver,
    });
    const [first, second] = await Promise.all([
      coordinator.runFixture('provider:remote-ok'),
      coordinator.runFixture('provider:remote-ok'),
    ]);
    expect(first[0]?.jobsInserted).toBe(2);
    expect(second[0]).toMatchObject({
      duplicatesMerged: 0,
      rediscoveries: 2,
    });
    await coordinator.stop();
  });

  it('tracks aggregate progress across overlapping enqueues without overlap', async () => {
    const database = createDatabase();
    const registry = new ProviderRegistry();
    const provider = new ControlledRemoteOkProvider();
    registry.register(provider);
    prepareRemoteOkSource(database, registry);
    const coordinator = createCoordinator(database, registry);

    const first = coordinator.runFixture('provider:remote-ok');
    const second = coordinator.runFixture('provider:remote-ok');
    await provider.waitForSearch(1);
    expect(coordinator.status()).toMatchObject({
      running: true,
      activeSourceId: 'provider:remote-ok',
      queuedSourceIds: ['provider:remote-ok'],
      completedSources: 0,
      totalSources: 2,
    });

    provider.release(0);
    await provider.waitForSearch(2);
    expect(coordinator.status()).toMatchObject({
      running: true,
      activeSourceId: 'provider:remote-ok',
      queuedSourceIds: [],
      completedSources: 1,
      totalSources: 2,
    });
    provider.release(1);
    await Promise.all([first, second]);
    expect(provider.maximumActiveSearches).toBe(1);
    expect(coordinator.status()).toMatchObject({
      running: false,
      activeSourceId: null,
      completedSources: 2,
      totalSources: 2,
    });
    await coordinator.stop();
  });

  it('records one failed run for each coordinator preflight failure', async () => {
    const database = createDatabase();
    const registry = new ProviderRegistry();
    const invalid = new PreflightProvider('invalid', false, false);
    const credentials = new PreflightProvider('credentials', true, true);
    const resolverFailure = new PreflightProvider(
      'resolver-failure',
      true,
      false,
    );
    registry.register(invalid);
    registry.register(credentials);
    registry.register(resolverFailure);
    const sources = new SourceRepository(database);
    sources.reconcileProviders(registry.list());
    createSource(sources, 'Invalid', invalid.id, true);
    createSource(sources, 'Credentials', credentials.id, true);
    createSource(sources, 'Disabled', resolverFailure.id, false);
    createSource(sources, 'Unknown', 'unknown-provider', true);
    createSource(sources, 'Resolver', resolverFailure.id, true);
    const coordinator = new DiscoveryCoordinator(database, registry, {
      credentialResolver: {
        status: (providerId) =>
          unavailableCredentialResolver.status(providerId),
        resolve: (providerId) => {
          if (providerId === resolverFailure.id)
            return Promise.reject(new Error('Credential storage unavailable'));
          return Promise.resolve(null);
        },
      },
    });

    for (const source of sources.list())
      await coordinator.runSource(source.id, 'manual-source');

    const rows = database
      .prepare<
        [],
        { status: string; error_message: string }
      >('SELECT status, error_message FROM runs ORDER BY started_at, rowid')
      .all();
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.status === 'failed')).toBe(true);
    expect(rows.map((row) => row.error_message)).toEqual(
      expect.arrayContaining([
        'Invalid configuration',
        'credentials credentials are required',
        'Source is disabled: Disabled',
        'Provider is not registered: unknown-provider',
        'Credential storage unavailable',
      ]),
    );
    await coordinator.stop();
  });

  it('only advances cadence after a successful scheduled run', async () => {
    const database = createDatabase();
    const registry = new ProviderRegistry();
    registry.register(new FixtureRemoteOkProvider());
    const sources = prepareRemoteOkSource(database, registry);
    const dueAt = '2026-07-19T00:00:00.000Z';
    database
      .prepare(
        `UPDATE source_schedules SET enabled = 1, cadence = 'every-6-hours',
          next_run_at = ? WHERE source_id = 'provider:remote-ok'`,
      )
      .run(dueAt);
    const coordinator = createCoordinator(database, registry);

    await coordinator.runFixture('provider:remote-ok');
    expect(sources.get('provider:remote-ok')?.schedule.nextRunAt).toBe(dueAt);
    sources.setEnabled('provider:remote-ok', false);
    await coordinator.runSource('provider:remote-ok', 'scheduled');
    expect(sources.get('provider:remote-ok')?.schedule.nextRunAt).toBe(dueAt);
    sources.setEnabled('provider:remote-ok', true);
    await coordinator.runSource('provider:remote-ok', 'scheduled');
    expect(sources.get('provider:remote-ok')?.schedule.nextRunAt).not.toBe(
      dueAt,
    );
    await coordinator.stop();
  });

  it('aborts active provider work during graceful stop', async () => {
    const database = createDatabase();
    const registry = new ProviderRegistry();
    const provider = new AbortableRemoteOkProvider();
    registry.register(provider);
    prepareRemoteOkSource(database, registry);
    const coordinator = createCoordinator(database, registry);
    const running = coordinator.runFixture('provider:remote-ok');
    await provider.started;

    await coordinator.stop();
    expect(provider.aborted).toBe(true);
    await expect(running).resolves.toEqual([]);
    expect(coordinator.status().running).toBe(false);
  });
});

function createDatabase(): JobDatabase {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database);
  return database;
}

function prepareRemoteOkSource(
  database: JobDatabase,
  registry: ProviderRegistry,
): SourceRepository {
  const sources = new SourceRepository(database);
  sources.reconcileProviders(registry.list());
  sources.ensureRemoteOkSource();
  return sources;
}

function createCoordinator(
  database: JobDatabase,
  registry: ProviderRegistry,
): DiscoveryCoordinator {
  return new DiscoveryCoordinator(database, registry, {
    credentialResolver: unavailableCredentialResolver,
  });
}

function createSource(
  sources: SourceRepository,
  name: string,
  providerId: string,
  enabled: boolean,
): void {
  sources.create(
    {
      displayName: name,
      employer: name,
      providerId,
      careersUrl: null,
      configuration: {},
      searchCriteria: {
        query: 'security',
        location: null,
        remoteOnly: true,
        limit: 10,
      },
      enabled,
      schedule: { enabled: false, cadence: 'manual', dailyLocalTime: null },
    },
    'valid',
  );
}

class FixtureRemoteOkProvider extends RemoteOkProvider {
  public override search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    return super.search(request, { ...options, fixtureOnly: true });
  }
}

class ControlledRemoteOkProvider extends FixtureRemoteOkProvider {
  private readonly releases: (() => void)[] = [];
  private searches = 0;
  private activeSearches = 0;
  public maximumActiveSearches = 0;

  public override async search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    this.searches += 1;
    this.activeSearches += 1;
    this.maximumActiveSearches = Math.max(
      this.maximumActiveSearches,
      this.activeSearches,
    );
    await new Promise<void>((resolve) => this.releases.push(resolve));
    this.activeSearches -= 1;
    return super.search(request, options);
  }

  public async waitForSearch(count: number): Promise<void> {
    while (this.searches < count)
      await new Promise((resolve) => setTimeout(resolve));
  }

  public release(index: number): void {
    this.releases[index]?.();
  }
}

class AbortableRemoteOkProvider extends RemoteOkProvider {
  public aborted = false;
  private resolveStarted!: () => void;
  public readonly started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });

  public override search(
    _request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    this.resolveStarted();
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        'abort',
        () => {
          this.aborted = true;
          reject(
            options.signal?.reason instanceof Error
              ? options.signal.reason
              : new Error('Discovery aborted'),
          );
        },
        { once: true },
      );
    });
  }
}

class PreflightProvider extends BaseProvider {
  private readonly delegate = new RemoteOkProvider();

  public constructor(
    public readonly id: string,
    private readonly valid: boolean,
    requiresCredentials: boolean,
  ) {
    super();
    this.name = id;
    this.capabilities = {
      ...new RemoteOkProvider().capabilities,
      requiresCredentials,
    };
  }

  public readonly name: string;
  public readonly type = 'job-board' as const;
  public readonly capabilities: ProviderCapabilities;

  public override validateConfiguration(): Promise<ValidationResult> {
    return Promise.resolve({
      valid: this.valid,
      message: this.valid ? 'Configuration is valid' : 'Invalid configuration',
      normalizedConfiguration: this.valid ? {} : null,
      preview: null,
    });
  }

  public search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    return this.delegate.search(request, options);
  }

  public fetch(search: ProviderSearch): Promise<ProviderFetchResult> {
    return this.delegate.fetch(search);
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    return this.delegate.normalize(rawJob, discoveredAt);
  }
}

describe('translateError', () => {
  it('translates Greenhouse no positions found error to the specific user-friendly message', () => {
    const error = new Error(
      'Discovery failed for provider greenhouse: No open positions found',
    );
    expect(translateError(error)).toBe(
      'Greenhouse board responded successfully but currently has no open positions.',
    );
  });

  it('translates generic no positions found error without Provider unavailable prefix', () => {
    const error = new Error(
      'Discovery failed for provider lever: No open positions found',
    );
    expect(translateError(error)).toBe('No open positions found');
  });

  it('does not classify filter-mismatch as Provider unavailable', () => {
    const error = new Error(
      'Discovery failed for provider greenhouse: No jobs matched current filters',
    );
    expect(translateError(error)).toBe('No jobs matched current filters');
  });

  it('translates Lever no positions found error to the specific user-friendly message', () => {
    const error = new Error(
      'Discovery failed for provider lever: Lever board responded successfully but currently has no open positions.',
    );
    expect(translateError(error)).toBe(
      'Lever board responded successfully but currently has no open positions.',
    );
  });

  it('translates Lever configured filters mismatch error to the specific user-friendly message', () => {
    const error = new Error(
      'Discovery failed for provider lever: No jobs matched the configured filters.',
    );
    expect(translateError(error)).toBe(
      'No jobs matched the configured filters.',
    );
  });
});
