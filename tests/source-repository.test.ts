import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type JobDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { RemoteOkProvider } from '../src/providers/remoteOk.provider.js';
import { DiscoveryStore } from '../src/database/discoveryStore.js';
import {
  SourceRepository,
  calculateNextRun,
} from '../src/repositories/source-repository.js';

const databases: JobDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('source repository', () => {
  it('reconciles providers and preserves user enablement', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database);
    const repository = new SourceRepository(database);
    repository.reconcileProviders([new RemoteOkProvider()]);
    repository.ensureRemoteOkSource();
    repository.setEnabled('provider:remote-ok', false);
    repository.reconcileProviders([new RemoteOkProvider()]);
    expect(repository.get('provider:remote-ok')?.enabled).toBe(false);
    expect(repository.list()).toHaveLength(1);
  });

  it('stores source configuration, schedules, and control metrics', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database);
    const repository = new SourceRepository(database);
    const source = repository.create(
      {
        displayName: 'Example Ashby',
        employer: 'Example',
        providerId: 'ashby',
        careersUrl: 'https://jobs.ashbyhq.com/example',
        configuration: { boardName: 'example' },
        searchCriteria: {
          query: 'security',
          location: null,
          remoteOnly: false,
          limit: 25,
        },
        enabled: true,
        schedule: {
          enabled: true,
          cadence: 'every-6-hours',
          dailyLocalTime: null,
        },
      },
      'valid',
    );
    expect(source.enabled).toBe(true);
    expect(source.schedule.nextRunAt).not.toBeNull();
    expect(repository.summary().enabledSources).toBe(1);
  });

  it('calculates daily local and interval schedules in the future', () => {
    const after = new Date('2026-07-19T12:00:00.000Z');
    expect(
      calculateNextRun(
        {
          enabled: true,
          cadence: 'every-6-hours',
          dailyLocalTime: null,
          nextRunAt: null,
          lastDueAt: null,
        },
        after,
      ),
    ).toBe('2026-07-19T18:00:00.000Z');
  });

  it('recovers stale running discovery rows', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database);
    const repository = new SourceRepository(database);
    const provider = new RemoteOkProvider();
    repository.reconcileProviders([provider]);
    repository.ensureRemoteOkSource();
    const run = new DiscoveryStore(database).startRun(
      provider,
      { query: 'security', location: null, remoteOnly: true, limit: 10 },
      { fixtureOnly: true, sourceId: 'provider:remote-ok' },
    );

    expect(repository.recoverInterruptedRuns()).toBe(1);
    expect(repository.recentRuns()[0]).toMatchObject({
      id: run.runId,
      status: 'failed',
      error: 'Discovery was interrupted when Job Browser stopped',
    });
  });
});
