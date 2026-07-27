import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import { JobSearchRepository } from '../src/repositories/job-search-repository.js';
import { jobSearchQuerySchema } from '../src/schemas/job-search.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';

describe('job search performance', () => {
  let database: JobDatabase;

  beforeAll(() => {
    database = createTestDatabase();
    const sourceId = insertTestSource(database, { id: 'performance-source' });
    const insertJob = database.prepare(
      `INSERT INTO jobs (
        id, external_id, title, normalized_title, company, normalized_company,
        location, normalized_location, remote_type, employment_type, source_name,
        source_type, first_seen_at, last_seen_at, active, seniority_level, score,
        score_explanation, recommendation, status, created_at, updated_at,
        last_verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMembership = database.prepare(
      `INSERT INTO job_sources (
        id, job_id, source_id, first_seen_at, last_seen_at, provider_id,
        last_verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    database.transaction(() => {
      for (let index = 0; index < 20_500; index += 1) {
        const suffix = String(index).padStart(8, '0');
        const id = `perf-job-${suffix}`;
        const timestamp = new Date(
          Date.UTC(2026, 0, 1) + index * 1000,
        ).toISOString();
        const score = index % 101;
        insertJob.run(
          id,
          `external-${suffix}`,
          index % 5 === 0
            ? `Security Engineer ${suffix}`
            : `Other Role ${suffix}`,
          index % 5 === 0
            ? `security engineer ${suffix}`
            : `other role ${suffix}`,
          `Employer ${String(index % 200)}`,
          `employer ${String(index % 200)}`,
          index % 2 === 0 ? 'Remote' : 'Denver',
          index % 2 === 0 ? 'remote' : 'denver',
          index % 2 === 0 ? 'remote' : 'onsite',
          'full-time',
          'Performance Source',
          'fixture',
          timestamp,
          timestamp,
          1,
          'mid',
          score,
          'Performance fixture score',
          score >= 80 ? 'Strong Match' : 'Possible Match',
          score >= 80 ? 'recommended' : 'new',
          timestamp,
          timestamp,
          timestamp,
        );
        insertMembership.run(
          `membership-${suffix}`,
          id,
          sourceId,
          timestamp,
          timestamp,
          'fixture',
          timestamp,
        );
      }
    })();
  }, 30_000);

  afterAll(() => database.close());

  it('searches 20k rows within a robust CI bound and uses lifecycle indexes', () => {
    const repository = new JobSearchRepository(database, {
      forceFallback: true,
    });
    const query = jobSearchQuerySchema.parse({
      minScore: '80',
      status: 'recommended',
      active: 'active',
      sort: 'score',
      pageSize: '100',
    });
    const started = performance.now();
    const response = repository.search(query);
    const elapsed = performance.now() - started;
    console.info(`20.5k indexed job search: ${elapsed.toFixed(1)}ms`);

    expect(response.items).toHaveLength(100);
    expect(response.total).toBeGreaterThan(4_000);
    expect(elapsed).toBeLessThan(3_000);

    const scorePlan = database
      .prepare<[], { detail: string }>(
        'EXPLAIN QUERY PLAN SELECT id FROM jobs WHERE score >= 80 ORDER BY score DESC, first_seen_at DESC, id LIMIT 100',
      )
      .all()
      .map((row) => row.detail)
      .join(' ');
    const lifecyclePlan = database
      .prepare<[], { detail: string }>(
        "EXPLAIN QUERY PLAN SELECT id FROM jobs WHERE active = 1 AND status = 'recommended'",
      )
      .all()
      .map((row) => row.detail)
      .join(' ');
    expect(scorePlan).toContain('jobs_score_first_seen_id_idx');
    expect(lifecyclePlan).toContain('jobs_active_status_idx');
  });
});
