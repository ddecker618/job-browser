import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import {
  SEED_JOB_ID,
  SEED_SOURCE_ID,
} from '../src/db/seeds/known-applications.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { createJobFixture } from './helpers/job-fixture.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';
import { DEFAULT_MIGRATIONS_DIRECTORY } from '../src/db/migration-runner.js';

describe('known application and migration cleanup', () => {
  let database: JobDatabase;

  beforeEach(() => {
    database = createTestDatabase();
  });

  afterEach(() => database.close());

  it('preserves applied status when the same role is later observed as new', () => {
    // Manually insert an initial job with 'applied' status
    const repository = new JobRepository(database);
    const timestamp = '2026-07-20T00:00:00Z';

    database
      .prepare(
        `
      INSERT INTO sources (id, employer, source_type, careers_url, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        SEED_SOURCE_ID,
        'Employer Name',
        'manual',
        null,
        1,
        timestamp,
        timestamp,
      );

    const initialJob = createJobFixture({
      id: SEED_JOB_ID,
      title: 'Cybersecurity and Network Admin I',
      normalizedTitle: 'cybersecurity and network admin i',
      company: 'Employer Name',
      normalizedCompany: 'employer name',
      location: null,
      city: null,
      state: null,
      sourceName: 'Known application history',
      postingUrl: null,
      status: 'applied',
    });

    repository.upsertObservation({
      job: initialJob,
      sourceId: SEED_SOURCE_ID,
      rawData: { provenance: 'test' },
    });

    const sourceId = insertTestSource(database, {
      employer: 'Employer Name',
    });

    const observed = createJobFixture({
      id: '20000000-0000-4000-8000-000000000001',
      title: 'Cybersecurity and Network Admin I',
      normalizedTitle: 'cybersecurity and network admin i',
      company: 'Employer Name',
      normalizedCompany: 'employer name',
      location: 'Centreville, Illinois',
      city: 'Centreville',
      state: 'Illinois',
      sourceName: 'Known application history',
      postingUrl:
        'https://jobs.example.com/careers/cybersecurity-network-admin',
      status: 'new',
    });

    const result = repository.upsertObservation({
      job: observed,
      sourceId,
      rawData: observed,
    });

    expect(result).toMatchObject({
      jobId: SEED_JOB_ID,
      inserted: false,
    });
    expect(repository.getStatus(SEED_JOB_ID)).toBe('applied');
    expect(repository.countJobs()).toBe(1);
  });

  it('runs the cleanup migration idempotently and deletes only the exact fixed demo source and job', () => {
    const timestamp = '2026-07-20T00:00:00Z';

    // 1. Insert fixed demo source & job and dependent records
    database
      .prepare(
        `
      INSERT INTO sources (id, employer, source_type, careers_url, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        SEED_SOURCE_ID,
        'Employer Name',
        'manual',
        null,
        1,
        timestamp,
        timestamp,
      );

    database
      .prepare(
        `
      INSERT INTO jobs (
        id, title, normalized_title, company, normalized_company, status,
        source_name, source_type, created_at, updated_at, fingerprint, favorite,
        remote_type, employment_type, seniority_level, application_urls_json,
        first_seen_at, last_seen_at, active, discovery_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'unknown', 'unknown', 'unknown', '[]', ?, ?, 0, 1)
    `,
      )
      .run(
        SEED_JOB_ID,
        'Cybersecurity and Network Admin I',
        'cybersecurity and network admin i',
        'Employer Name',
        'employer name',
        'applied',
        'Known application history',
        'manual',
        timestamp,
        timestamp,
        'some-fingerprint',
        timestamp,
        timestamp,
      );

    database
      .prepare(
        `
      INSERT INTO job_sources (id, job_id, source_id, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run('js-demo-1', SEED_JOB_ID, SEED_SOURCE_ID, timestamp, timestamp);

    database
      .prepare(
        `
      INSERT INTO applications (id, job_id, status, applied_at, last_event_at, created_at, updated_at)
      VALUES (?, ?, 'applied', ?, ?, ?, ?)
    `,
      )
      .run(
        'app-demo-1',
        SEED_JOB_ID,
        timestamp,
        timestamp,
        timestamp,
        timestamp,
      );

    database
      .prepare(
        `
      INSERT INTO application_history (id, job_id, event_type, occurred_at, source, created_at)
      VALUES (?, ?, 'applied', ?, 'ingestion', ?)
    `,
      )
      .run('ah-demo-1', SEED_JOB_ID, timestamp, timestamp);

    database
      .prepare(
        `
      INSERT INTO source_schedules (id, source_id, enabled, cadence, created_at, updated_at)
      VALUES (?, ?, 0, 'manual', ?, ?)
    `,
      )
      .run('sched-demo-1', SEED_SOURCE_ID, timestamp, timestamp);

    // 2. Insert a USER-created Touchette entry with a different ID
    const userSourceId = '99999999-9999-4000-8000-999999999999';
    const userJobId = '88888888-8888-4000-8000-888888888888';

    database
      .prepare(
        `
      INSERT INTO sources (id, employer, source_type, careers_url, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        userSourceId,
        'Touchette Regional Hospital',
        'manual',
        'https://example.com/touchette',
        1,
        timestamp,
        timestamp,
      );

    database
      .prepare(
        `
      INSERT INTO jobs (
        id, title, normalized_title, company, normalized_company, status,
        source_name, source_type, created_at, updated_at, fingerprint, favorite,
        remote_type, employment_type, seniority_level, application_urls_json,
        first_seen_at, last_seen_at, active, discovery_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'unknown', 'unknown', 'unknown', '[]', ?, ?, 0, 1)
    `,
      )
      .run(
        userJobId,
        'Another Job',
        'another job',
        'Touchette Regional Hospital',
        'touchette regional hospital',
        'applied',
        'Some Other Source',
        'manual',
        timestamp,
        timestamp,
        'user-fingerprint',
        timestamp,
        timestamp,
      );

    database
      .prepare(
        `
      INSERT INTO job_sources (id, job_id, source_id, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run('js-user-1', userJobId, userSourceId, timestamp, timestamp);

    // Verify all rows exist before migration
    expect(
      (
        database.prepare('SELECT COUNT(*) AS c FROM sources').get() as {
          c: number;
        }
      ).c,
    ).toBe(2);
    expect(
      (
        database.prepare('SELECT COUNT(*) AS c FROM jobs').get() as {
          c: number;
        }
      ).c,
    ).toBe(2);
    expect(
      (
        database.prepare('SELECT COUNT(*) AS c FROM job_sources').get() as {
          c: number;
        }
      ).c,
    ).toBe(2);
    expect(
      (
        database.prepare('SELECT COUNT(*) AS c FROM applications').get() as {
          c: number;
        }
      ).c,
    ).toBe(1);

    // Read and run the cleanup migration
    const migrationSql = readFileSync(
      join(DEFAULT_MIGRATIONS_DIRECTORY, '009_clean_touchette_demo_source.sql'),
      'utf8',
    );
    database.exec(migrationSql);

    // Verify demo rows are deleted
    expect(
      (
        database
          .prepare('SELECT COUNT(*) AS c FROM sources WHERE id = ?')
          .get(SEED_SOURCE_ID) as { c: number }
      ).c,
    ).toBe(0);
    expect(
      (
        database
          .prepare('SELECT COUNT(*) AS c FROM jobs WHERE id = ?')
          .get(SEED_JOB_ID) as { c: number }
      ).c,
    ).toBe(0);
    expect(
      (
        database
          .prepare('SELECT COUNT(*) AS c FROM job_sources WHERE source_id = ?')
          .get(SEED_SOURCE_ID) as { c: number }
      ).c,
    ).toBe(0);
    expect(
      (
        database
          .prepare('SELECT COUNT(*) AS c FROM applications WHERE job_id = ?')
          .get(SEED_JOB_ID) as { c: number }
      ).c,
    ).toBe(0);
    expect(
      (
        database
          .prepare(
            'SELECT COUNT(*) AS c FROM application_history WHERE job_id = ?',
          )
          .get(SEED_JOB_ID) as { c: number }
      ).c,
    ).toBe(0);
    expect(
      (
        database
          .prepare(
            'SELECT COUNT(*) AS c FROM source_schedules WHERE source_id = ?',
          )
          .get(SEED_SOURCE_ID) as { c: number }
      ).c,
    ).toBe(0);

    // Verify user-created rows remain
    expect(
      (
        database
          .prepare('SELECT COUNT(*) AS c FROM sources WHERE id = ?')
          .get(userSourceId) as { c: number }
      ).c,
    ).toBe(1);
    expect(
      (
        database
          .prepare('SELECT COUNT(*) AS c FROM jobs WHERE id = ?')
          .get(userJobId) as { c: number }
      ).c,
    ).toBe(1);
    expect(
      (
        database
          .prepare('SELECT COUNT(*) AS c FROM job_sources WHERE source_id = ?')
          .get(userSourceId) as { c: number }
      ).c,
    ).toBe(1);

    // Run again to verify idempotency (should run with no errors)
    expect(() => database.exec(migrationSql)).not.toThrow();
  });
});
