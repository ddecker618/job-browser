import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import { DiscoveryEngine } from '../src/discovery/discoveryEngine.js';
import type { LogLevel } from '../src/logging/logger.js';
import { ProviderRegistry } from '../src/providers/providerRegistry.js';
import { BuiltInProvider } from '../src/providers/builtin.provider.js';
import type {
  DiscoveryOptions,
  ProviderFetchResult,
  ProviderSearch,
  SearchRequest,
} from '../src/models/discovery.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { createTestDatabase } from './helpers/test-database.js';

interface IdRow {
  id: string;
}

interface RunRow {
  status: string;
  jobs_discovered: number;
  jobs_inserted: number;
  jobs_updated: number;
  duplicates_found: number;
  jobs_failed: number;
  records_rejected: number;
  rediscoveries: number;
  cross_source_merges: number;
  material_updates: number;
  identity_conflicts: number;
  fetch_truncated: number;
  complete_snapshot: number;
}

interface CountRow {
  count: number;
}

describe('DiscoveryEngine', () => {
  let database: JobDatabase;
  let registry: ProviderRegistry;
  const logs: {
    level: LogLevel;
    message: string;
    context: Readonly<Record<string, unknown>>;
  }[] = [];

  beforeEach(() => {
    database = createTestDatabase();
    registry = new ProviderRegistry();
    registry.register(new BuiltInProvider());
    logs.length = 0;
  });

  afterEach(() => database.close());

  it('inserts fixture jobs and records provider/run metadata and metrics', async () => {
    const summary = await createEngine().run(
      'builtin',
      request(),
      fixtureOptions(),
    );

    expect(summary).toMatchObject({
      providerId: 'builtin',
      jobsFound: 1,
      jobsInserted: 1,
      jobsUpdated: 0,
      duplicatesDetected: 0,
      jobsFailed: 0,
    });
    expect(new JobRepository(database).countJobs()).toBe(1);
    expect(
      database
        .prepare<
          [],
          CountRow
        >('SELECT COUNT(*) AS count FROM provider_metadata')
        .get()?.count,
    ).toBe(1);
    expect(
      database
        .prepare<[string], RunRow>(
          `SELECT status, jobs_discovered, jobs_inserted, jobs_updated,
             duplicates_found, jobs_failed, records_rejected, rediscoveries,
             cross_source_merges, material_updates, identity_conflicts,
             fetch_truncated, complete_snapshot FROM runs WHERE id = ?`,
        )
        .get(summary.runId),
    ).toEqual({
      status: 'succeeded',
      jobs_discovered: 1,
      jobs_inserted: 1,
      jobs_updated: 0,
      duplicates_found: 0,
      jobs_failed: 0,
      records_rejected: 0,
      rediscoveries: 0,
      cross_source_merges: 0,
      material_updates: 0,
      identity_conflicts: 0,
      fetch_truncated: 0,
      complete_snapshot: 1,
    });
    const completionLog = logs.at(-1);
    expect(completionLog?.level).toBe('info');
    expect(completionLog?.message).toBe('Discovery run completed');
    expect(completionLog?.context).toMatchObject({
      jobsFound: 1,
      provider: 'builtin',
    });
  });

  it('merges rediscovered jobs and preserves applications and applied status', async () => {
    const engine = createEngine();
    await engine.run('builtin', request(), fixtureOptions());
    const jobRow = database
      .prepare<
        [],
        IdRow
      >("SELECT id FROM jobs WHERE normalized_title = 'senior software engineer'")
      .get();
    if (jobRow === undefined) throw new Error('Expected fixture job');

    const repository = new JobRepository(database);
    repository.changeStatus(jobRow.id, {
      status: 'applied',
      changedBy: 'test',
      reason: 'Applied manually',
    });
    const secondRun = await engine.run('builtin', request(), fixtureOptions());

    expect(secondRun).toMatchObject({
      jobsInserted: 0,
      jobsUpdated: 0,
      duplicatesDetected: 1,
      rediscoveries: 1,
      materialUpdates: 0,
    });
    expect(repository.countJobs()).toBe(1);
    expect(repository.getStatus(jobRow.id)).toBe('applied');
    expect(
      database
        .prepare<
          [string],
          CountRow
        >('SELECT COUNT(*) AS count FROM applications WHERE job_id = ?')
        .get(jobRow.id)?.count,
    ).toBe(1);
    expect(repository.countJobSources(jobRow.id)).toBe(1);
  });

  it('does not replace a configured source employer when starting a run', async () => {
    database
      .prepare(
        `INSERT INTO sources (
          id, employer, source_type, enabled, created_at, updated_at
        ) VALUES ('configured', 'Configured Employer', 'provider', 1, datetime('now'), datetime('now'))`,
      )
      .run();

    await createEngine().run(
      'builtin',
      request(),
      fixtureOptions('configured'),
    );

    expect(
      database
        .prepare<
          [],
          { employer: string }
        >("SELECT employer FROM sources WHERE id = 'configured'")
        .get()?.employer,
    ).toBe('Configured Employer');
  });

  it('reconciles only complete snapshots, removes after two misses, and recovers', async () => {
    const provider = new SnapshotBuiltInProvider();
    registry = new ProviderRegistry();
    registry.register(provider);
    const engine = createEngine();
    const first = await engine.run('builtin', request(), fixtureOptions());

    provider.empty = true;
    provider.complete = false;
    await engine.run('builtin', request(), fixtureOptions());
    await engine.run('builtin', request(), fixtureOptions());
    expect(lifecycle(database, first.sourceId)).toEqual({
      active: 1,
      consecutive_snapshot_misses: 0,
    });

    provider.complete = true;
    await engine.run('builtin', request(), fixtureOptions());
    expect(lifecycle(database, first.sourceId)).toEqual({
      active: 1,
      consecutive_snapshot_misses: 1,
    });
    await engine.run('builtin', request(), fixtureOptions());
    expect(lifecycle(database, first.sourceId)).toEqual({
      active: 0,
      consecutive_snapshot_misses: 2,
    });
    expect(
      database
        .prepare<[], { active: number }>('SELECT active FROM jobs LIMIT 1')
        .get()?.active,
    ).toBe(0);

    provider.empty = false;
    await engine.run('builtin', request(), fixtureOptions());
    expect(lifecycle(database, first.sourceId)).toEqual({
      active: 1,
      consecutive_snapshot_misses: 0,
    });
    expect(
      database
        .prepare<
          [string],
          { last_complete_snapshot_at: string | null }
        >('SELECT last_complete_snapshot_at FROM sources WHERE id = ?')
        .get(first.sourceId)?.last_complete_snapshot_at,
    ).not.toBeNull();
  });

  it('keeps a canonical job active while another source remains active', async () => {
    const provider = new SnapshotBuiltInProvider();
    registry = new ProviderRegistry();
    registry.register(provider);
    const engine = createEngine();
    await engine.run('builtin', request(), fixtureOptions('source:primary'));
    const attached = await engine.run(
      'builtin',
      request(),
      fixtureOptions('source:secondary'),
    );
    expect(attached.crossSourceMerges).toBe(1);

    provider.empty = true;
    await engine.run('builtin', request(), fixtureOptions('source:primary'));
    await engine.run('builtin', request(), fixtureOptions('source:primary'));

    expect(lifecycle(database, 'source:primary')?.active).toBe(0);
    expect(lifecycle(database, 'source:secondary')?.active).toBe(1);
    expect(
      database
        .prepare<
          [],
          { inactive: number }
        >('SELECT COUNT(*) AS inactive FROM jobs WHERE active = 0')
        .get()?.inactive,
    ).toBe(0);
  });

  it('records an empty live discovery run as succeeded instead of failed', async () => {
    const provider = new EmptyLiveProvider();
    registry = new ProviderRegistry();
    registry.register(provider);
    const summary = await createEngine().run('builtin', request(), {
      fixtureOnly: false,
    });

    expect(summary).toMatchObject({
      providerId: 'builtin',
      jobsFound: 0,
      jobsInserted: 0,
      jobsFailed: 0,
      emptyNotice: 'No open positions found',
      completeSnapshot: true,
    });
    const runRow = database
      .prepare<
        [string],
        Pick<RunRow, 'status' | 'jobs_discovered' | 'complete_snapshot'>
      >('SELECT status, jobs_discovered, complete_snapshot FROM runs WHERE id = ?')
      .get(summary.runId);
    expect(runRow).toEqual({
      status: 'succeeded',
      jobs_discovered: 0,
      complete_snapshot: 1,
    });
    expect(
      database
        .prepare<
          [],
          { failure_count: number; last_failure: string | null }
        >("SELECT failure_count, last_failure FROM provider_metadata WHERE provider_id = 'builtin'")
        .get(),
    ).toEqual({ failure_count: 0, last_failure: null });
    expect(
      database
        .prepare<
          [],
          { failure_count: number; last_failure: string | null }
        >("SELECT failure_count, last_failure FROM sources WHERE id = 'provider:builtin'")
        .get(),
    ).toEqual({ failure_count: 0, last_failure: null });
  });

  it('records a filter-mismatch live run as succeeded without completing a snapshot', async () => {
    const provider = new EmptyLiveProvider();
    provider.unfilteredCount = 5;
    registry = new ProviderRegistry();
    registry.register(provider);
    const summary = await createEngine().run('builtin', request(), {
      fixtureOnly: false,
    });

    expect(summary).toMatchObject({
      emptyNotice: 'No jobs matched current filters',
      completeSnapshot: false,
    });
    const runRow = database
      .prepare<
        [string],
        { status: string; complete_snapshot: number }
      >('SELECT status, complete_snapshot FROM runs WHERE id = ?')
      .get(summary.runId);
    expect(runRow).toEqual({ status: 'succeeded', complete_snapshot: 0 });
  });

  it('prefers the provider-supplied empty notice', async () => {
    const provider = new EmptyLiveProvider();
    provider.notice = 'Board responded but has no matching roles';
    registry = new ProviderRegistry();
    registry.register(provider);
    const summary = await createEngine().run('builtin', request(), {
      fixtureOnly: false,
    });

    expect(summary.emptyNotice).toBe(
      'Board responded but has no matching roles',
    );
  });

  it('records an aborted live run as interrupted without counting a failure', async () => {
    const controller = new AbortController();
    const provider = new AbortableProvider();
    registry = new ProviderRegistry();
    registry.register(provider);
    const runPromise = createEngine().run('builtin', request(), {
      fixtureOnly: false,
      signal: controller.signal,
    });
    await provider.started;
    controller.abort();

    await expect(runPromise).rejects.toThrow(
      'Discovery was interrupted when Job Browser stopped',
    );
    const runRow = database
      .prepare<
        [],
        { status: string; error_message: string | null }
      >('SELECT status, error_message FROM runs ORDER BY started_at DESC LIMIT 1')
      .get();
    expect(runRow).toEqual({
      status: 'interrupted',
      error_message: 'Discovery was interrupted when Job Browser stopped',
    });
    expect(
      database
        .prepare<
          [],
          { failure_count: number; last_failure: string | null }
        >("SELECT failure_count, last_failure FROM provider_metadata WHERE provider_id = 'builtin'")
        .get(),
    ).toEqual({ failure_count: 0, last_failure: null });
    expect(
      database
        .prepare<
          [],
          { failure_count: number; last_failure: string | null }
        >("SELECT failure_count, last_failure FROM sources WHERE id = 'provider:builtin'")
        .get(),
    ).toEqual({ failure_count: 0, last_failure: null });
  });

  function createEngine(): DiscoveryEngine {
    return new DiscoveryEngine(
      database,
      registry,
      (level, message, context = {}) => {
        logs.push({ level, message, context });
      },
    );
  }
});

function request() {
  return {
    query: 'software',
    location: null,
    remoteOnly: true,
    limit: 10,
  };
}

function fixtureOptions(sourceId?: string) {
  return {
    fixtureOnly: true,
    ...(sourceId === undefined ? {} : { sourceId }),
  };
}

class SnapshotBuiltInProvider extends BuiltInProvider {
  public complete = true;
  public empty = false;

  public override async fetch(
    search: ProviderSearch,
  ): Promise<ProviderFetchResult> {
    const result = await super.fetch(search);
    return {
      ...result,
      records: this.empty ? [] : result.records,
      complete: this.complete,
      truncated: !this.complete,
    };
  }
}

class EmptyLiveProvider extends BuiltInProvider {
  public unfilteredCount = 0;
  public notice: string | null = null;

  public override search(request: SearchRequest): Promise<ProviderSearch> {
    return Promise.resolve({
      request,
      target: 'https://builtin.com/jobs',
      fixturePath: null,
    });
  }

  public override fetch(): Promise<ProviderFetchResult> {
    return Promise.resolve({
      records: [],
      rejected: 0,
      truncated: false,
      complete: true,
      unfilteredCount: this.unfilteredCount,
      emptyNotice: this.notice,
    });
  }
}

class AbortableProvider extends BuiltInProvider {
  private resolveStarted!: () => void;
  public readonly started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });

  public override search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    this.resolveStarted();
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        'abort',
        () => {
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

function lifecycle(database: JobDatabase, sourceId: string) {
  return database
    .prepare<
      [string],
      { active: number; consecutive_snapshot_misses: number }
    >(`SELECT active, consecutive_snapshot_misses FROM job_sources WHERE source_id = ? LIMIT 1`)
    .get(sourceId);
}
