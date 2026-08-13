import { describe, expect, it } from 'vitest';

import {
  FINGERPRINT_VERSION,
  fingerprintCareerSiteUrl,
} from '../src/domain/atsFingerprint.js';

describe('ATS career site fingerprinting', () => {
  it('recognizes a Greenhouse board token URL', () => {
    const fingerprint = fingerprintCareerSiteUrl(
      'https://boards.greenhouse.io/acme',
    );

    expect(fingerprint.atsPlatform).toBe('Greenhouse');
    expect(fingerprint.atsDetectedProvider).toBe('greenhouse');
    expect(fingerprint.supportState).toBe('supported');
    expect(fingerprint.confidenceLabel).toBe('high');
    expect(fingerprint.confidence).toBeGreaterThanOrEqual(0.85);
    expect(fingerprint.detectionVersion).toBe(FINGERPRINT_VERSION);
    expect(fingerprint.evidence.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['hostname', 'board_token']),
    );
    expect(fingerprint.failureCategory).toBeNull();
  });

  it('recognizes Greenhouse widgets and embed variants', () => {
    for (const url of [
      'https://boards.greenhouse.io/widgets/acme/jobs',
      'https://boards.greenhouse.io/embed/job_board?for=acme',
    ]) {
      const fingerprint = fingerprintCareerSiteUrl(url);
      expect(fingerprint.atsPlatform).toBe('Greenhouse');
      expect(fingerprint.atsDetectedProvider).toBe('greenhouse');
    }
  });

  it.each([
    ['https://jobs.lever.co/globex', 'Lever', 'lever'],
    ['https://jobs.ashbyhq.com/initech', 'Ashby', 'ashby'],
    [
      'https://acme.wd1.myworkdayjobs.com/en-US/AcmeCareers',
      'Workday',
      'workday',
    ],
    [
      'https://careers.smartrecruiters.com/hooli',
      'SmartRecruiters',
      'smartrecruiters',
    ],
    ['https://acme.bamboohr.com/careers', 'BambooHR', 'bamboohr'],
    ['https://acme.recruitee.com', 'Recruitee', 'recruitee'],
    [
      'https://wayne-enterprises.teamtailor.com/jobs',
      'Teamtailor',
      'teamtailor',
    ],
    ['https://apply.workable.com/starkindustries', 'Workable', 'workable'],
    ['https://www.workable.com/starkindustries', 'Workable', 'workable'],
    ['https://careers-acme.icims.com/jobs', 'iCIMS', 'icims'],
  ])('maps %s to platform %s', (url, platform, provider) => {
    const fingerprint = fingerprintCareerSiteUrl(url);

    expect(fingerprint.atsPlatform).toBe(platform);
    expect(fingerprint.atsDetectedProvider).toBe(provider);
    expect(fingerprint.supportState).toBe('supported');
    expect(fingerprint.confidenceLabel).toBe('high');
    expect(fingerprint.evidence.length).toBeGreaterThan(0);
  });

  it('marks known-but-unsupported hosts as detected only', () => {
    const fingerprint = fingerprintCareerSiteUrl('https://acme.taleo.net/careers');

    expect(fingerprint.atsPlatform).toBe('Taleo');
    expect(fingerprint.atsDetectedProvider).toBeNull();
    expect(fingerprint.supportState).toBe('detected-but-unsupported');
    expect(fingerprint.failureCategory).toBe('unsupported');
  });

  it('returns no-signals for an unknown careers URL', () => {
    const fingerprint = fingerprintCareerSiteUrl(
      'https://www.umbrellacorp.com/careers',
    );

    expect(fingerprint.atsPlatform).toBeNull();
    expect(fingerprint.atsDetectedProvider).toBeNull();
    expect(fingerprint.supportState).toBe('unsupported');
    expect(fingerprint.confidence).toBe(0);
    expect(fingerprint.confidenceLabel).toBe('low');
    expect(fingerprint.evidence).toEqual([]);
    expect(fingerprint.failureCategory).toBe('no_signals');
  });

  it('returns invalid-url for a malformed URL', () => {
    const fingerprint = fingerprintCareerSiteUrl('not a url');

    expect(fingerprint.atsPlatform).toBeNull();
    expect(fingerprint.supportState).toBe('unsupported');
    expect(fingerprint.failureCategory).toBe('invalid_url');
    expect(fingerprint.evidence).toEqual([]);
  });

  it('is deterministic for the same careers URL', () => {
    const url = 'https://boards.greenhouse.io/acme';
    const first = fingerprintCareerSiteUrl(url);
    const second = fingerprintCareerSiteUrl(url);

    expect(second.atsPlatform).toBe(first.atsPlatform);
    expect(second.atsDetectedProvider).toBe(first.atsDetectedProvider);
    expect(second.confidence).toBe(first.confidence);
    expect(second.confidenceLabel).toBe(first.confidenceLabel);
    expect(second.supportState).toBe(first.supportState);
    expect(second.explanation).toBe(first.explanation);
    expect(second.evidence.map((item) => item.kind)).toEqual(
      first.evidence.map((item) => item.kind),
    );
  });

  it('records an observedAt timestamp on every evidence row', () => {
    const fingerprint = fingerprintCareerSiteUrl(
      'https://boards.greenhouse.io/acme',
    );

    for (const evidence of fingerprint.evidence) {
      expect(evidence.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
