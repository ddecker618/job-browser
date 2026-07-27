import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import type { JobDatabase } from '../src/db/database.js';
import { IntelligenceEngine } from '../src/intelligence/intelligenceEngine.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { createJobFixture } from './helpers/job-fixture.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';

interface CountRow {
  count: number;
}

interface RecommendationRow {
  recommendation_status: string;
  overall_score: number;
}

interface MetricRow {
  metric_key: string;
  metric_value: number;
  details_json: string | null;
}

describe('IntelligenceEngine', () => {
  let database: JobDatabase;
  let repository: JobRepository;

  beforeEach(() => {
    database = createTestDatabase();
    repository = new JobRepository(database);
    const sourceId = insertTestSource(database);
    const matchingJob = createJobFixture({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
      company: 'Security Employer',
      normalizedCompany: 'security employer',
      description: 'Monitor Splunk SIEM alerts on Linux.',
      requirements: 'CompTIA Security+ required.',
    });
    repository.upsertObservation({
      job: matchingJob,
      sourceId,
      rawData: matchingJob,
    });
    repository.changeStatus(matchingJob.id, {
      status: 'applied',
      changedBy: 'test',
      reason: 'Regression coverage',
    });
    const secondJob = createJobFixture({
      id: '30000000-0000-4000-8000-000000000001',
      externalId: 'analysis-second-job',
      title: 'Cloud Platform Engineer',
      normalizedTitle: 'cloud platform engineer',
      company: 'Cloud Employer',
      normalizedCompany: 'cloud employer',
      location: 'Seattle, Washington',
      city: 'Seattle',
      state: 'Washington',
      description: 'Build Python services on AWS and Kubernetes with Docker.',
      requirements: 'CISSP preferred.',
      postingUrl: 'https://jobs.example.com/cloud-platform/456',
    });
    repository.upsertObservation({
      job: secondJob,
      sourceId,
      rawData: secondJob,
    });
  });

  afterEach(() => database.close());

  it('persists recommendations, skills, analytics, and application overrides', () => {
    const summary = createEngine().analyze(
      loadCandidateProfile(),
      loadScoringConfig(),
    );

    expect(summary.jobsAnalyzed).toBe(2);
    expect(count('recommendations')).toBe(2);
    expect(count('skills')).toBeGreaterThan(0);
    expect(count('job_skills')).toBeGreaterThan(0);
    expect(count('certifications')).toBeGreaterThan(0);
    expect(count('analytics')).toBeGreaterThan(0);

    const applied = database
      .prepare<[], RecommendationRow>(
        `SELECT recommendations.recommendation_status, recommendations.overall_score
         FROM recommendations JOIN jobs ON jobs.id = recommendations.job_id
         WHERE jobs.normalized_title = 'cybersecurity analyst'`,
      )
      .get();
    expect(applied?.recommendation_status).toBe('Already Applied');
    expect(applied?.overall_score).toBeGreaterThan(0);
    expect(
      database
        .prepare<[], CountRow>(
          `SELECT COUNT(*) AS count FROM jobs
           WHERE normalized_title = 'cybersecurity analyst' AND status = 'applied'`,
        )
        .get()?.count,
    ).toBe(1);

    const skillMetric = database
      .prepare<[], MetricRow>(
        `SELECT metric_key, metric_value, details_json FROM analytics
         WHERE metric_name = 'top_skill' AND metric_key = 'Splunk'`,
      )
      .get();
    expect(skillMetric?.metric_value).toBe(1);
    expect(skillMetric?.details_json).toContain('employerCount');
  });

  it('does not create score-history noise when analysis is unchanged', () => {
    const engine = createEngine();
    engine.analyze(loadCandidateProfile(), loadScoringConfig());
    expect(count('score_history')).toBe(2);

    engine.analyze(loadCandidateProfile(), loadScoringConfig());

    expect(count('score_history')).toBe(2);
    expect(count('analysis_runs')).toBe(2);
    expect(count('recommendations')).toBe(2);
  });

  function createEngine(): IntelligenceEngine {
    return new IntelligenceEngine(database, () => undefined);
  }

  function count(table: string): number {
    const allowedTables = new Set([
      'analysis_runs',
      'analytics',
      'certifications',
      'job_skills',
      'recommendations',
      'score_history',
      'skills',
    ]);
    if (!allowedTables.has(table))
      throw new Error(`Unexpected table: ${table}`);
    return (
      database
        .prepare<[], CountRow>(`SELECT COUNT(*) AS count FROM ${table}`)
        .get()?.count ?? 0
    );
  }
});
