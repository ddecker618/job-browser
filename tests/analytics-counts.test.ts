import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import { DashboardRepository } from '../src/database/dashboardRepository.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { createJobFixture } from './helpers/job-fixture.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';

describe('Dashboard analytics employer/skill totals', () => {
  let database: JobDatabase;

  afterEach(() => database.close());

  it('reports true tracked-employer and skill-signal counts beyond the top-10 charts', () => {
    database = createTestDatabase();
    const source = insertTestSource(database, {
      id: 'source-analytics-a',
      employer: 'Analytics Source',
    });
    const repository = new JobRepository(database);
    const dashboard = new DashboardRepository(database);

    for (let index = 1; index <= 12; index += 1) {
      const job = createJobFixture({
        id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        externalId: `analytics-${String(index)}`,
        title: `Analytics Engineer ${String(index)}`,
        normalizedTitle: `analytics engineer ${String(index)}`,
        company: `Distinct Employer ${String(index)}`,
        normalizedCompany: `distinct employer ${String(index)}`,
        postingUrl: `https://jobs.example.com/analytics-${String(index)}`,
        score: 70,
        status: 'new',
      });
      const result = repository.upsertObservation({
        job,
        sourceId: source,
        providerId: 'analytics-provider',
        rawData: job,
      });
      const skillId = randomUUID();
      database
        .prepare(
          'INSERT INTO skills (id, name, normalized_name) VALUES (?, ?, ?)',
        )
        .run(skillId, `signal-skill-${String(index)}`, `signal-skill-${String(index)}`);
      database
        .prepare(
          'INSERT INTO job_skills (job_id, skill_id, frequency) VALUES (?, ?, ?)',
        )
        .run(result.jobId, skillId, 1);
    }

    const analytics = dashboard.getAnalytics();
    expect(analytics.trackedEmployers).toBe(12);
    expect(analytics.skillSignals).toBe(12);
    expect(analytics.topEmployers.length).toBe(10);
    expect(analytics.topSkills.length).toBe(10);
  });
});