import { describe, expect, it } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import { scoreJob } from '../src/intelligence/scoringEngine.js';
import type { ScoringConfig } from '../src/schemas/scoring-config.js';
import { createJobFixture } from './helpers/job-fixture.js';
import type { VerificationResult } from '../src/intelligence/verificationService.js';
import { verifyPosting } from '../src/intelligence/verificationService.js';

const analyzedAt = '2026-07-18T12:00:00.000Z';

const defaultVerificationConfig = {
  enabled: true,
  eligibilityGate: true,
  scoreContribution: 100,
};

function baseVerification(): VerificationResult {
  return {
    evidence: {
      status: 'verified',
      verifiedAt: analyzedAt,
      verificationSource: 'test',
      httpStatus: 200,
      applicationStatus: null,
      evidence: [],
      closedIndicators: [],
    },
    workArrangement: 'remote',
    workArrangementEvidence: [],
    illinoisEligibility: 'eligible',
    illinoisEvidence: [],
    schedule: {
      classification: 'daytime',
      evidence: [],
      riskIndicators: [],
      positiveIndicators: ['Monday through Friday'],
    },
    eligibility: {
      passed: true,
      rejectionReason: 'none',
      rejectionDetail: null,
    },
    extractedRequirements: {
      requiredYears: null,
      preferredYears: null,
      degreeRequired: false,
      degreeInProgressOk: true,
      clearancesRequired: [],
      clearancesSponsorable: false,
      clearanceMode: 'none',
      clearanceLevel: null,
      clearanceEvidence: [],
      occupationalSeries: null,
      professionalEngineering: false,
      professionalEngineeringEvidence: [],
      travelRequired: false,
      travelPercent: null,
      physicalRequirements: [],
      commissionBased: false,
      developmentFocused: false,
      fieldInstallation: false,
      weekendsRequired: false,
      onCallRequired: false,
      rotatingShifts: false,
      overnightRequired: false,
    },
  };
}

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
      baseVerification(),
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
    expect(result.verifiedStatus).toBe('verified');
    expect(result.eligibilityPassed).toBe(true);
  });

  it('honors configured category weights', () => {
    const baseConfig = loadScoringConfig();
    const titleOnlyConfig: ScoringConfig = {
      ...baseConfig,
      verification: defaultVerificationConfig,
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
      baseVerification(),
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
      verification: defaultVerificationConfig,
      recommendationThresholds: {
        applyImmediately: 70,
        strongMatch: 60,
        possibleMatch: 40,
      },
    };

    expect(
      scoreJob(
        matchingJob,
        profile,
        permissiveConfig,
        analyzedAt,
        baseVerification(),
      ).recommendationStatus,
    ).toBe('Verified Match');
    expect(
      scoreJob(
        { ...matchingJob, status: 'applied' },
        profile,
        config,
        analyzedAt,
        baseVerification(),
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

  it('hard-blocks when eligibility gate fails', () => {
    const job = createJobFixture({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
    });
    const failedVerification: VerificationResult = {
      ...baseVerification(),
      eligibility: {
        passed: false,
        rejectionReason: 'overnight_schedule',
        rejectionDetail: 'Position requires permanent overnight shift',
      },
    };
    const result = scoreJob(
      job,
      loadCandidateProfile(),
      loadScoringConfig(),
      analyzedAt,
      failedVerification,
    );

    expect(result.recommendationStatus).toBe('Hard No');
    expect(result.eligibilityPassed).toBe(false);
    expect(result.eligibilityRejection).toBe('overnight_schedule');
    expect(result.overallScore).toBe(0);
  });

  it('flips Verified Match for high-scoring verified jobs', () => {
    const job = createJobFixture({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
      status: 'new',
    });
    const lowThresholdConfig: ScoringConfig = {
      ...loadScoringConfig(),
      verification: defaultVerificationConfig,
      recommendationThresholds: {
        applyImmediately: 50,
        strongMatch: 40,
        possibleMatch: 20,
      },
    };
    const result = scoreJob(
      job,
      loadCandidateProfile(),
      lowThresholdConfig,
      analyzedAt,
      baseVerification(),
    );

    expect(result.recommendationStatus).toBe('Verified Match');
    expect(result.verifiedStatus).toBe('verified');
  });

  it('hard-blocks an onsite job outside the commuting radius before skill scoring', () => {
    const job = createJobFixture({
      title: 'Solaris / Linux Systems Administrator',
      normalizedTitle: 'solaris linux systems administrator',
      company: 'Example Employer',
      location: 'Columbia, MO',
      city: 'Columbia',
      state: 'MO',
      remoteType: 'remote',
      description:
        'This is an onsite role located in Columbia, Missouri. Administer Linux systems and remote infrastructure.',
      requirements: 'Linux required.',
    });
    const verification = verifyPosting(
      `${job.title} at ${job.company}\nLocation: ${job.location ?? ''}\n${job.description ?? ''}`,
      job.postingUrl,
      200,
    );
    const result = scoreJob(
      job,
      loadCandidateProfile(),
      loadScoringConfig(),
      analyzedAt,
      verification,
    );

    expect(verification.workArrangement).toBe('onsite');
    expect(result.recommendationStatus).toBe('Hard No');
    expect(result.eligibilityPassed).toBe(false);
    expect(result.eligibilityRejection).toBe('location_outside_radius');
    expect(result.overallScore).toBe(0);
    expect(result.skills).toEqual([]);
  });

  it('hard-blocks an out-of-state job when the arrangement is ambiguous', () => {
    const job = createJobFixture({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
      remoteType: 'remote',
      location: 'Houston, TX',
      city: 'Houston',
      state: 'TX',
      description:
        'Monitor Splunk SIEM alerts and investigate incidents. Full-time.',
      status: 'new',
    });
    const verification = verifyPosting(
      `${job.title} at ${job.company}\nLocation: ${job.location ?? ''}\n${job.description ?? ''}`,
      job.postingUrl,
      200,
    );

    expect(verification.workArrangement).toBe('unknown');

    const result = scoreJob(
      job,
      loadCandidateProfile(),
      loadScoringConfig(),
      analyzedAt,
      verification,
    );

    expect(result.recommendationStatus).toBe('Hard No');
    expect(result.eligibilityPassed).toBe(false);
    expect(result.eligibilityRejection).toBe('location_outside_radius');
    expect(result.overallScore).toBe(0);
  });

  it('hard-blocks an out-of-state job when provider arrangement is unknown', () => {
    const job = createJobFixture({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
      remoteType: 'unknown',
      location: 'Houston, TX',
      city: 'Houston',
      state: 'TX',
      description:
        'Monitor Splunk SIEM alerts and investigate incidents. Full-time.',
      status: 'new',
    });
    const verification = verifyPosting(
      `${job.title} at ${job.company}\nLocation: ${job.location ?? ''}\n${job.description ?? ''}`,
      job.postingUrl,
      200,
    );

    const result = scoreJob(
      job,
      loadCandidateProfile(),
      loadScoringConfig(),
      analyzedAt,
      verification,
    );

    expect(verification.workArrangement).toBe('unknown');
    expect(result.recommendationStatus).toBe('Hard No');
    expect(result.eligibilityPassed).toBe(false);
    expect(result.eligibilityRejection).toBe('location_outside_radius');
    expect(result.overallScore).toBe(0);
  });

  it('does not hard-block a genuine remote job with no physical location', () => {
    const job = createJobFixture({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
      remoteType: 'remote',
      location: 'Remote - United States',
      city: null,
      state: null,
      description:
        'Monitor Splunk SIEM alerts and investigate incidents. Full-time remote.',
      status: 'new',
    });
    const verification = verifyPosting(
      `${job.title} at ${job.company}\nLocation: ${job.location ?? ''}\n${job.description ?? ''}`,
      job.postingUrl,
      200,
    );

    const result = scoreJob(
      job,
      loadCandidateProfile(),
      loadScoringConfig(),
      analyzedAt,
      verification,
    );

    expect(result.eligibilityPassed).toBe(true);
    expect(result.recommendationStatus).not.toBe('Hard No');
    expect(result.overallScore).toBeGreaterThan(0);
  });

  describe('profile-aware federal eligibility gates', () => {
    it('hard-blocks active-clearance postings when the profile does not evidence a clearance', () => {
      const verification = verifyPosting(
        'Must currently possess an active Top Secret clearance.',
        'https://example.com/clearance/ts1',
        200,
      );
      const job = createJobFixture({
        title: 'IT Security Specialist',
        normalizedTitle: 'it security specialist',
        remoteType: 'onsite',
      });
      const result = scoreJob(
        job,
        loadCandidateProfile(),
        loadScoringConfig(),
        analyzedAt,
        verification,
      );
      expect(result.eligibilityPassed).toBe(false);
      expect(result.eligibilityRejection).toBe('clearance_required');
      expect(result.recommendationStatus).toBe('Hard No');
    });

    it('passes active-clearance postings when the profile affirms clearance eligibility', () => {
      const verification = verifyPosting(
        'Must currently possess an active Top Secret clearance.',
        'https://example.com/clearance/ts2',
        200,
      );
      const profile = {
        ...loadCandidateProfile(),
        clearanceEligibility: 'eligible' as const,
      };
      const job = createJobFixture({
        title: 'IT Security Specialist',
        normalizedTitle: 'it security specialist',
        remoteType: 'onsite',
      });
      const result = scoreJob(
        job,
        profile,
        loadScoringConfig(),
        analyzedAt,
        verification,
      );
      expect(result.eligibilityPassed).toBe(true);
      expect(result.eligibilityRejection).toBe('none');
    });

    it('does not hard-block sponsorable clearance postings', () => {
      const verification = verifyPosting(
        'Must be able to obtain a Secret clearance. Sponsorship is available.',
        'https://example.com/clearance/secret1',
        200,
      );
      const job = createJobFixture({
        title: 'IT Security Specialist',
        normalizedTitle: 'it security specialist',
        remoteType: 'onsite',
      });
      const result = scoreJob(
        job,
        loadCandidateProfile(),
        loadScoringConfig(),
        analyzedAt,
        verification,
      );
      expect(result.eligibilityPassed).toBe(true);
      expect(result.eligibilityRejection).toBe('none');
    });

    it('hard-blocks 0854 postings when the profile has no engineering credential', () => {
      const verification = verifyPosting(
        'Job family (Series): 0854 Computer Engineering. Degree must be from an ABET-accredited engineering program.',
        'https://usa.example/job/0854/block',
        200,
      );
      const job = createJobFixture({
        title: 'IT Specialist (Computer Engineering)',
        normalizedTitle: 'it specialist computer engineering',
        remoteType: 'onsite',
      });
      const result = scoreJob(
        job,
        loadCandidateProfile(),
        loadScoringConfig(),
        analyzedAt,
        verification,
      );
      expect(result.eligibilityPassed).toBe(false);
      expect(result.eligibilityRejection).toBe('professional_engineering_required');
      expect(result.recommendationStatus).toBe('Hard No');
    });

    it('passes 0854 postings when the profile holds an engineering degree', () => {
      const verification = verifyPosting(
        'Job family (Series): 0854 Computer Engineering. Degree must be from an ABET-accredited engineering program.',
        'https://usa.example/job/0854/pass',
        200,
      );
      const profile = {
        ...loadCandidateProfile(),
        degrees: [
          {
            name: 'Bachelor of Science in Computer Engineering',
            institution: 'Test University',
            status: 'Completed',
            expectedCompletion: null,
          },
        ],
      };
      const job = createJobFixture({
        title: 'IT Specialist (Computer Engineering)',
        normalizedTitle: 'it specialist computer engineering',
        remoteType: 'onsite',
      });
      const result = scoreJob(
        job,
        profile,
        loadScoringConfig(),
        analyzedAt,
        verification,
      );
      expect(result.eligibilityPassed).toBe(true);
      expect(result.eligibilityRejection).toBe('none');
    });
  });
});
