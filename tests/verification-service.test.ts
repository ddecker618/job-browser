import { describe, expect, it } from 'vitest';

import { verifyPosting } from '../src/intelligence/verificationService.js';

describe('verificationService', () => {
  describe('work arrangement classification', () => {
    it('classifies remote positions', () => {
      const result = verifyPosting(
        'This is a fully remote position. Work from home anywhere in the US.',
        'https://example.com/job/1',
        200,
      );
      expect(result.workArrangement).toBe('remote');
    });

    it('classifies hybrid positions', () => {
      const result = verifyPosting(
        'Hybrid role with three days per week in the office.',
        'https://example.com/job/2',
        200,
      );
      expect(result.workArrangement).toBe('hybrid');
    });

    it('classifies onsite positions', () => {
      const result = verifyPosting(
        'This is not a remote position. Must report to the office. Local candidates only.',
        'https://example.com/job/3',
        200,
      );
      expect(result.workArrangement).toBe('onsite');
    });

    it('does not treat technical remote terminology as a remote arrangement', () => {
      const result = verifyPosting(
        'This is an onsite role in Columbia, Missouri. The team supports on-premises and remote infrastructure.',
        'https://example.com/job/technical-remote-language',
        200,
      );
      expect(result.workArrangement).toBe('onsite');
    });

    it('defaults to unknown when no arrangement is stated', () => {
      const result = verifyPosting(
        'Join our team. Great benefits.',
        'https://example.com/job/4',
        200,
      );
      expect(result.workArrangement).toBe('unknown');
    });
  });

  describe('Illinois eligibility', () => {
    it('marks remote posts without exclusions as eligible', () => {
      const result = verifyPosting(
        'Remote position - work from anywhere in the United States.',
        'https://example.com/job/5',
        200,
      );
      expect(result.illinoisEligibility).toBe('eligible');
      expect(result.eligibility.passed).toBe(true);
    });

    it('marks remote posts with Illinois exclusion as ineligible', () => {
      const result = verifyPosting(
        'Remote position. Not available in Illinois. Excludes Illinois.',
        'https://example.com/job/6',
        200,
      );
      expect(result.illinoisEligibility).toBe('excluded');
      expect(result.eligibility.passed).toBe(false);
      expect(result.eligibility.rejectionReason).toBe('illinois_excluded');
    });
  });

  describe('schedule classification', () => {
    it('flags overnight shifts', () => {
      const result = verifyPosting(
        'Night shift position. Must work overnight shift.',
        'https://example.com/job/7',
        200,
      );
      expect(result.schedule.classification).toBe('overnight');
      expect(result.eligibility.passed).toBe(false);
      expect(result.eligibility.rejectionReason).toBe('overnight_schedule');
    });

    it('flags rotating shifts', () => {
      const result = verifyPosting(
        'Rotating shifts required including nights and weekends.',
        'https://example.com/job/8',
        200,
      );
      expect(result.schedule.classification).toBe('rotating');
      expect(result.eligibility.passed).toBe(false);
    });

    it('approves standard business hours', () => {
      const result = verifyPosting(
        'Monday through Friday, standard business hours. No nights, no weekends.',
        'https://example.com/job/9',
        200,
      );
      expect(result.schedule.classification).toBe('daytime');
      expect(result.eligibility.passed).toBe(true);
    });
  });

  describe('hard eligibility gates', () => {
    it('blocks commission-based sales positions', () => {
      const result = verifyPosting(
        'Commission-only compensation structure. Uncapped commission.',
        'https://example.com/job/10',
        200,
      );
      expect(result.eligibility.passed).toBe(false);
      expect(result.eligibility.rejectionReason).toBe('sales_position');
    });

    it('classifies explicit active-clearance requirements without hard-blocking at verification time', () => {
      const result = verifyPosting(
        'Active security clearance required. Must have current TS/SCI clearance.',
        'https://example.com/job/11',
        200,
      );
      expect(result.extractedRequirements.clearanceMode).toBe('active');
      expect(result.extractedRequirements.clearanceLevel).toMatch(/ts\/sci/i);
      expect(result.eligibility.passed).toBe(true);
    });

    it('classifies clearances that can be obtained as non-blocking', () => {
      const result = verifyPosting(
        'Must be able to obtain a Secret clearance. Sponsorship is available.',
        'https://example.com/job/11b',
        200,
      );
      expect(result.extractedRequirements.clearanceMode).toBe('obtainable');
      expect(result.eligibility.passed).toBe(true);
    });

    it('classifies eligible-for clearance wording as non-blocking', () => {
      const result = verifyPosting(
        'Must be eligible for a security clearance.',
        'https://example.com/job/11c',
        200,
      );
      expect(result.extractedRequirements.clearanceMode).toBe('eligible');
      expect(result.eligibility.passed).toBe(true);
    });
  });

  describe('federal professional engineering basic qualification', () => {
    it('detects the 0854 series and ABET language as explicit', () => {
      const result = verifyPosting(
        'Job family (Series): 0854 Computer Engineering. Degree must be from an ABET-accredited engineering program.',
        'https://usa.example/job/0854',
        200,
      );
      expect(result.extractedRequirements.occupationalSeries).toBe('0854');
      expect(result.extractedRequirements.professionalEngineering).toBe(true);
      expect(result.extractedRequirements.professionalEngineeringEvidence.length).toBeGreaterThan(0);
    });

    it('does not treat a software engineer title as professional engineering', () => {
      const result = verifyPosting(
        'Software Engineer - Systems Development. Requires 5 years of experience.',
        'https://example.com/job/sw',
        200,
      );
      expect(result.extractedRequirements.professionalEngineering).toBe(false);
      expect(result.extractedRequirements.occupationalSeries).toBeNull();
    });

    it('ignores engineering language softened by preference', () => {
      const result = verifyPosting(
        'Basic requirement: engineering background preferred but not required for this analyst role.',
        'https://example.com/job/pref',
        200,
      );
      expect(result.extractedRequirements.professionalEngineering).toBe(false);
    });
  });

  describe('detects closed postings', () => {
    it('marks closed postings', () => {
      const result = verifyPosting(
        'Sorry, this position has been filled.',
        'https://example.com/job/12',
        null,
      );
      expect(result.evidence.status).toBe('closed');
    });
  });

  describe('extracted requirements', () => {
    it('extracts required experience years', () => {
      const result = verifyPosting(
        'Requires at least 5 years of experience in network security.',
        'https://example.com/job/13',
        200,
      );
      expect(result.extractedRequirements.requiredYears).toBe(5);
    });

    it('extracts preferred experience years', () => {
      const result = verifyPosting(
        '5+ years of experience preferred in a related field.',
        'https://example.com/job/14',
        200,
      );
      expect(result.extractedRequirements.preferredYears).toBe(5);
    });

    it('detects degree requirements', () => {
      const result = verifyPosting(
        'Bachelor degree or equivalent required for this position.',
        'https://example.com/job/15',
        200,
      );
      expect(result.extractedRequirements.degreeRequired).toBe(true);
    });
  });
});
