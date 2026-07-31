import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type JobDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { AshbyProvider } from '../src/providers/ashby.provider.js';
import { DiscoveryStore } from '../src/database/discoveryStore.js';
import {
  SourceRepository,
  calculateNextRun,
} from '../src/repositories/source-repository.js';

const databases: JobDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createAshbySource(
  repository: SourceRepository,
  database: JobDatabase,
): string {
  const timestamp = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO sources (
        id, employer, source_type, careers_url, enabled, connector,
        last_successful_run, last_failure, failure_count, created_at, updated_at,
        display_name, provider_id, configuration_json, search_criteria_json,
        configuration_status, health_status
      ) VALUES (?, ?, 'provider', ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, ?, 'never-run')`,
    )
    .run(
      'provider:ashby',
      'Ashby',
      'https://jobs.ashbyhq.com',
      1,
      'ashby',
      timestamp,
      timestamp,
      'Ashby',
      'ashby',
      JSON.stringify({ boardName: 'fixture' }),
      JSON.stringify({
        query: 'security',
        location: null,
        remoteOnly: true,
        limit: 10,
      }),
      'valid',
    );
  database
    .prepare(
      `INSERT INTO source_schedules (
        id, source_id, enabled, cadence, daily_local_time, next_run_at,
        last_due_at, created_at, updated_at
      ) VALUES (?, 'provider:ashby', ?, 'manual', ?, ?, NULL, ?, ?)`,
    )
    .run(randomUUID(), 0, null, null, timestamp, timestamp);
  return 'provider:ashby';
}

describe('source repository', () => {
  it('reconciles providers and preserves user enablement', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database);
    const repository = new SourceRepository(database);
    repository.reconcileProviders([new AshbyProvider()]);
    createAshbySource(repository, database);
    repository.setEnabled('provider:ashby', false);
    repository.reconcileProviders([new AshbyProvider()]);
    expect(repository.get('provider:ashby')?.enabled).toBe(false);
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
    const provider = new AshbyProvider();
    repository.reconcileProviders([provider]);
    createAshbySource(repository, database);
    const run = new DiscoveryStore(database).startRun(
      provider,
      { query: 'security', location: null, remoteOnly: true, limit: 10 },
      { fixtureOnly: true, sourceId: 'provider:ashby' },
    );

    expect(repository.recoverInterruptedRuns()).toBe(1);
    expect(repository.recentRuns()[0]).toMatchObject({
      id: run.runId,
      status: 'failed',
      error: 'Discovery was interrupted when Job Browser stopped',
    });
  });
});
