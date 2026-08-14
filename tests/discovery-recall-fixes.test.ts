import { describe, expect, it } from 'vitest';

import { classifyCommute } from '../src/intelligence/locationEligibility.js';
import { scoreJob } from '../src/intelligence/scoringEngine.js';
import type { JobForScoring } from '../src/domain/job.js';
import type { CandidateProfile } from '../src/schemas/candidate-profile.js';
import type { ScoringConfig } from '../src/schemas/scoring-config.js';
import type { VerificationResult } from '../src/intelligence/verificationService.js';
import type { IllinoisEligibility } from '../src/domain/verification.js';
import { generateJobFingerprint } from '../src/utils/fingerprint.js';

const REMOTE_JOB: JobForScoring = {
  id: 'test-1',
  fingerprint: 'a'.repeat(64),
  externalId: 'ext-1',
  title: 'Software Engineer',
  normalizedTitle: 'software engineer',
  company: 'Test Corp',
  normalizedCompany: 'test corp',
  location: 'Remote',
  city: null,
  state: null,
  remoteType: 'remote',
  employmentType: 'full-time',
  salaryMinimum: null,
  salaryMaximum: null,
  salaryText: null,
  description: null,
  requirements: null,
  preferredQualifications: null,
  postingUrl: 'https://example.com/job/1',
  sourceName: 'Test',
  sourceType: 'test',
  datePosted: null,
  agency: null,
  department: null,
  gradeLow: null,
  gradeHigh: null,
  payPlan: null,
  appointmentType: null,
  workSchedule: null,
  teleworkEligible: null,
  openingDate: null,
  closingDate: null,
  applicationUrls: [],
  firstSeenAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  active: true,
  clearanceRequirement: null,
  sponsorshipAvailable: null,
  estimatedExperienceYears: null,
  seniorityLevel: 'mid',
  score: null,
  recommendation: null,
  scoreExplanation: null,
  status: 'new',
  discoveryCount: 1,
  providerConfidence: null,
  matchedFamilies: null,
};

const PROFILE: CandidateProfile = {
  id: 'test-profile',
  name: 'Test Profile',
  preferredLocations: [
    { city: 'Highland', state: 'IL' },
    { city: 'St Louis', state: 'MO' },
  ],
  remotePreference: 'preferred',
  searchRadiusMiles: 50,
  secondarySearchRadiusMiles: 100,
  desiredSalary: { minimum: 80_000, target: 100_000, currency: 'USD' },
  desiredJobTitles: ['Software Engineer'],
  excludedJobTitles: [],
  yearsOfExperience: 5,
  desiredEmploymentTypes: ['full-time'],
  skills: [],
  certifications: [],
  degrees: [],
  clearanceEligibility: 'unknown',
  degreeRequired: false,
  degreeInProgressOk: true,
  maxTravelPercent: null,
  noWeekends: false,
  noOnCall: false,
  noRotatingShifts: true,
  noOvernightShifts: true,
};

const SCORING_CONFIG: ScoringConfig = {
  weights: {
    title: 20,
    skills: 15,
    certifications: 10,
    location: 15,
    remotePreference: 10,
    salary: 10,
    experience: 10,
    employmentType: 5,
    recency: 5,
  },
  recommendationThresholds: {
    applyImmediately: 80,
    strongMatch: 60,
    possibleMatch: 40,
  },
  recency: {
    freshDays: 7,
    recentDays: 30,
  },
  skills: [],
  certifications: [],
  verification: {
    enabled: true,
    eligibilityGate: true,
    scoreContribution: 100,
  },
};

describe('discovery recall fixes', () => {
  describe('location eligibility', () => {
    it('fully remote jobs bypass commute evaluation', () => {
      const result = classifyCommute(REMOTE_JOB, PROFILE);
      expect(result.status).toBe('unknown');
      expect(result.locationStatus).toBe('unknown');
      expect(result.commuteStatus).toBe('not_applicable');
    });

    it('unknown on-site cities in the same state are not hard-blocked by default', () => {
      const onsiteJob: JobForScoring = {
        ...REMOTE_JOB,
        remoteType: 'onsite',
        city: 'Springfield',
        state: 'IL',
        location: 'Springfield, IL',
      };
      const result = classifyCommute(onsiteJob, PROFILE);
      expect(result.locationStatus).toBe('likely_eligible');
      expect(result.status).toBe('unknown');
      expect(result.commuteStatus).toBe('likely_eligible');
    });

    it('remote United States job is not commute-blocked', () => {
      const remoteJob: JobForScoring = {
        ...REMOTE_JOB,
        remoteType: 'remote',
        city: null,
        state: null,
        location: 'Remote, United States',
      };
      const commuteResult = classifyCommute(remoteJob, PROFILE);
      expect(commuteResult.status).toBe('unknown');
      expect(commuteResult.commuteStatus).toBe('not_applicable');
    });

    it('out-of-state on-site jobs are correctly marked ineligible', () => {
      const nycJob: JobForScoring = {
        ...REMOTE_JOB,
        remoteType: 'onsite',
        city: 'New York',
        state: 'NY',
        location: 'New York, NY',
      };
      const result = classifyCommute(nycJob, PROFILE);
      expect(result.locationStatus).toBe('ineligible');
      expect(result.status).toBe('outside');
      expect(result.commuteStatus).toBe('outside');
    });
  });

  describe('scoring engine verification gate', () => {
    it('unknown commute status is not a hard block with default config', () => {
      const onsiteUnknown: JobForScoring = {
        ...REMOTE_JOB,
        remoteType: 'onsite',
        city: 'Springfield',
        state: 'IL',
        location: 'Springfield, IL',
      };
      const verification: VerificationResult = {
        evidence: {
          status: 'verified',
          verifiedAt: new Date().toISOString(),
          verificationSource: 'https://example.com',
          httpStatus: 200,
          applicationStatus: null,
          evidence: [],
          closedIndicators: [],
        },
        workArrangement: 'onsite',
        workArrangementEvidence: ['On-site detected'],
        illinoisEligibility: 'unknown',
        illinoisEvidence: [],
        schedule: {
          classification: 'unknown',
          evidence: [],
          riskIndicators: [],
          positiveIndicators: [],
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
          degreeInProgressOk: false,
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
      const result = scoreJob(
        onsiteUnknown,
        PROFILE,
        SCORING_CONFIG,
        new Date().toISOString(),
        verification,
      );
      expect(result.eligibilityPassed).toBe(true);
      expect(result.recommendationStatus).not.toBe('Hard No');
    });

    it('verified remote job does not trigger location hard block', () => {
      const remoteJob: JobForScoring = {
        ...REMOTE_JOB,
        remoteType: 'remote',
        city: null,
        state: null,
        location: 'Remote',
      };
      const verification: VerificationResult = {
        evidence: {
          status: 'verified',
          verifiedAt: new Date().toISOString(),
          verificationSource: 'https://example.com',
          httpStatus: 200,
          applicationStatus: null,
          evidence: [],
          closedIndicators: [],
        },
        workArrangement: 'remote',
        workArrangementEvidence: ['Remote position'],
        illinoisEligibility: 'unrestricted',
        illinoisEvidence: [],
        schedule: {
          classification: 'unknown',
          evidence: [],
          riskIndicators: [],
          positiveIndicators: [],
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
          degreeInProgressOk: false,
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
      const result = scoreJob(
        remoteJob,
        PROFILE,
        SCORING_CONFIG,
        new Date().toISOString(),
        verification,
      );
      expect(result.eligibilityPassed).toBe(true);
    });
  });

  describe('Illinois eligibility gate', () => {
    it('"Remote except Illinois" is blocked by the verification gate', () => {
      const job: JobForScoring = {
        ...REMOTE_JOB,
        remoteType: 'remote',
        location: 'Remote',
      };
      const verification: VerificationResult = {
        evidence: {
          status: 'verified',
          verifiedAt: new Date().toISOString(),
          verificationSource: 'https://example.com',
          httpStatus: 200,
          applicationStatus: null,
          evidence: ['Remote position'],
          closedIndicators: [],
        },
        workArrangement: 'remote',
        workArrangementEvidence: ['Remote position'],
        illinoisEligibility: 'excluded' as IllinoisEligibility,
        illinoisEvidence: ['Explicitly excludes Illinois'],
        schedule: {
          classification: 'unknown',
          evidence: [],
          riskIndicators: [],
          positiveIndicators: [],
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
          degreeInProgressOk: false,
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
      const result = scoreJob(
        job,
        PROFILE,
        SCORING_CONFIG,
        new Date().toISOString(),
        verification,
      );
      expect(result.eligibilityPassed).toBe(false);
      expect(result.eligibilityRejection).toBe('illinois_excluded');
    });

    it('Remote in approved states including Illinois passes the gate', () => {
      const job: JobForScoring = {
        ...REMOTE_JOB,
        remoteType: 'remote',
        location: 'Remote',
      };
      const verification: VerificationResult = {
        evidence: {
          status: 'verified',
          verifiedAt: new Date().toISOString(),
          verificationSource: 'https://example.com',
          httpStatus: 200,
          applicationStatus: null,
          evidence: ['Remote position'],
          closedIndicators: [],
        },
        workArrangement: 'remote',
        workArrangementEvidence: ['Remote position'],
        illinoisEligibility: 'eligible' as IllinoisEligibility,
        illinoisEvidence: ['Illinois eligible'],
        schedule: {
          classification: 'unknown',
          evidence: [],
          riskIndicators: [],
          positiveIndicators: [],
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
          degreeInProgressOk: false,
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
      const result = scoreJob(
        job,
        PROFILE,
        SCORING_CONFIG,
        new Date().toISOString(),
        verification,
      );
      expect(result.eligibilityPassed).toBe(true);
    });
  });

  describe('unknown date handling', () => {
    it('jobs with null datePosted are retained and scored without error', () => {
      const result = scoreJob(
        REMOTE_JOB,
        PROFILE,
        SCORING_CONFIG,
        new Date().toISOString(),
        null,
      );
      expect(result.eligibilityPassed).toBe(true);
      expect(result.overallScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('fingerprint identity', () => {
    it('two jobs with same company/title/location but different requisition IDs remain distinct', () => {
      const first = generateJobFingerprint({
        company: 'Example Corp',
        title: 'Systems Administrator',
        location: 'St Louis, MO',
        postingUrl: 'https://example.com/job/1',
        externalId: 'req-001',
        employmentType: 'full-time',
      });
      const second = generateJobFingerprint({
        company: 'Example Corp',
        title: 'Systems Administrator',
        location: 'St Louis, MO',
        postingUrl: 'https://example.com/job/2',
        externalId: 'req-002',
        employmentType: 'full-time',
      });
      expect(first).not.toBe(second);
    });

    it('tracking variants of the same posting URL deduplicate via canonicalization', () => {
      const withUtm = generateJobFingerprint({
        company: 'Example',
        title: 'Engineer',
        location: 'Remote',
        postingUrl:
          'https://example.com/job/123?utm_source=test&utm_medium=email',
        externalId: 'req-42',
      });
      const withoutUtm = generateJobFingerprint({
        company: 'Example',
        title: 'Engineer',
        location: 'Remote',
        postingUrl: 'https://example.com/job/123',
        externalId: 'req-42',
      });
      expect(withUtm).toBe(withoutUtm);
    });

    it('different employment types produce different fingerprints', () => {
      const fullTime = generateJobFingerprint({
        company: 'Example',
        title: 'Engineer',
        location: 'St Louis, MO',
        postingUrl: 'https://example.com/job/1',
        externalId: 'req-42',
        employmentType: 'full-time',
      });
      const contract = generateJobFingerprint({
        company: 'Example',
        title: 'Engineer',
        location: 'St Louis, MO',
        postingUrl: 'https://example.com/job/1',
        externalId: 'req-42',
        employmentType: 'contract',
      });
      expect(fullTime).not.toBe(contract);
    });

    it('different locations produce different fingerprints', () => {
      const stl = generateJobFingerprint({
        company: 'Example',
        title: 'Engineer',
        location: 'St Louis, MO',
        postingUrl: 'https://example.com/job/1',
        externalId: 'req-42',
        employmentType: 'full-time',
      });
      const remote = generateJobFingerprint({
        company: 'Example',
        title: 'Engineer',
        location: 'Remote',
        postingUrl: 'https://example.com/job/1',
        externalId: 'req-42',
        employmentType: 'full-time',
      });
      expect(stl).not.toBe(remote);
    });

    it('missing posting URL produces a stable fallback fingerprint', () => {
      const fingerprint = generateJobFingerprint({
        company: 'Example',
        title: 'Engineer',
        location: 'Remote',
        postingUrl: null,
        externalId: null,
        employmentType: null,
      });
      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
      const same = generateJobFingerprint({
        company: 'Example',
        title: 'Engineer',
        location: 'Remote',
        postingUrl: null,
        externalId: null,
        employmentType: null,
      });
      expect(fingerprint).toBe(same);
    });

    it('old-style (company+title+location-only) fingerprint differs from new-style full fingerprint', () => {
      const oldStyle = generateJobFingerprint(
        {
          company: 'Example Corp',
          title: 'Systems Administrator',
          location: 'St Louis, MO',
          postingUrl: null,
          externalId: null,
          employmentType: null,
        },
        { includePostingUrl: false },
      );
      const newStyle = generateJobFingerprint({
        company: 'Example Corp',
        title: 'Systems Administrator',
        location: 'St Louis, MO',
        postingUrl: 'https://example.com/job/123',
        externalId: 'req-001',
        employmentType: 'full-time',
      });
      expect(oldStyle).not.toBe(newStyle);
    });
  });
});
