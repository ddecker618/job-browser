import { describe, expect, it } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import { scoreJob } from '../src/intelligence/scoringEngine.js';
import type { ScoringConfig } from '../src/schemas/scoring-config.js';
import { createJobFixture } from './helpers/job-fixture.js';

const analyzedAt = '2026-07-18T12:00:00.000Z';

describe('scoring engine', () => {
  it('calculates category and overall weighted scores with explanations', () => {
    const job = createJobFixture({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
      remoteType: 'remote',
      description: 'Monitor Splunk SIEM alerts on Linux systems.',
      requirements: 'CompTIA Security+ required.',
      datePosted: '2026-07-17T12:00:00.000Z',
    });
    const result = scoreJob(
      job,
      loadCandidateProfile(),
      loadScoringConfig(),
      analyzedAt,
    );

    expect(result.categoryScores.title).toBe(100);
    expect(result.categoryScores.skills).toBe(100);
    expect(result.categoryScores.certifications).toBe(100);
    expect(result.overallScore).toBeGreaterThanOrEqual(80);
    expect(result.explanations).toContain('Excellent title match.');
    expect(result.explanations).toContain(
      'Requires CompTIA Security+, which the candidate possesses.',
    );
    expect(result.missingQualifications).toEqual([]);
  });

  it('honors configured category weights', () => {
    const baseConfig = loadScoringConfig();
    const titleOnlyConfig: ScoringConfig = {
      ...baseConfig,
      weights: {
        title: 100,
        skills: 0,
        certifications: 0,
        location: 0,
        remotePreference: 0,
        salary: 0,
        experience: 0,
        employmentType: 0,
        recency: 0,
      },
    };
    const result = scoreJob(
      createJobFixture({
        title: 'Cybersecurity Analyst',
        normalizedTitle: 'cybersecurity analyst',
      }),
      loadCandidateProfile(),
      titleOnlyConfig,
      analyzedAt,
    );

    expect(result.categoryScores.title).toBe(100);
    expect(result.overallScore).toBe(100);
  });

  it('generates configurable recommendations and status overrides', () => {
    const profile = loadCandidateProfile();
    const config = loadScoringConfig();
    const matchingJob = createJobFixture({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
      status: 'new',
    });
    const permissiveConfig: ScoringConfig = {
      ...config,
      recommendationThresholds: {
        applyImmediately: 70,
        strongMatch: 60,
        possibleMatch: 40,
      },
    };

    expect(
      scoreJob(matchingJob, profile, permissiveConfig, analyzedAt)
        .recommendationStatus,
    ).toBe('Apply Immediately');
    expect(
      scoreJob(
        { ...matchingJob, status: 'applied' },
        profile,
        config,
        analyzedAt,
      ).recommendationStatus,
    ).toBe('Already Applied');
    expect(
      scoreJob(
        { ...matchingJob, status: 'expired', active: false },
        profile,
        config,
        analyzedAt,
      ).recommendationStatus,
    ).toBe('Expired');
    expect(
      scoreJob(
        {
          ...matchingJob,
          title: 'Security Director',
          normalizedTitle: 'security director',
        },
        profile,
        config,
        analyzedAt,
      ).recommendationStatus,
    ).toBe('Hidden');
  });

  it('identifies missing requested qualifications and unknown salary', () => {
    const job = createJobFixture({
      description: 'Build Python services on AWS and Kubernetes.',
      requirements: 'CISSP required.',
      salaryMinimum: null,
      salaryMaximum: null,
      salaryText: null,
    });
    const result = scoreJob(
      job,
      loadCandidateProfile(),
      loadScoringConfig(),
      analyzedAt,
    );

    expect(result.missingQualifications).toEqual(
      expect.arrayContaining([
        'Missing requested skill: Python.',
        'Missing requested skill: AWS.',
        'Missing requested skill: Kubernetes.',
        'Missing requested certification: CISSP.',
      ]),
    );
    expect(result.explanations).toContain('Salary not listed.');
  });
});
