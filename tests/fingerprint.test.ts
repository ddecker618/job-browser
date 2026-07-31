import { describe, expect, it } from 'vitest';

import { generateJobFingerprint } from '../src/utils/fingerprint.js';

describe('job fingerprinting', () => {
  it('is stable across case, whitespace, and canonical URL normalization', () => {
    const first = generateJobFingerprint({
      company: ' Example Employer ',
      title: 'Security   Analyst',
      location: 'Remote',
      postingUrl: 'https://board-one.example/jobs/123?utm_source=test',
      externalId: 'req-42',
    });
    const second = generateJobFingerprint({
      company: 'example employer',
      title: 'security analyst',
      location: 'remote',
      postingUrl: 'https://board-one.example/jobs/123',
      externalId: 'req-42',
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('differentiates jobs with different external IDs', () => {
    const first = generateJobFingerprint({
      company: 'Example',
      title: 'Engineer',
      location: 'Remote',
      postingUrl: 'https://example.com/job/1',
      externalId: 'req-1',
    });
    const second = generateJobFingerprint({
      company: 'Example',
      title: 'Engineer',
      location: 'Remote',
      postingUrl: 'https://example.com/job/2',
      externalId: 'req-2',
    });

    expect(first).not.toBe(second);
  });

  it('differentiates jobs with same title/company/location but different posting URLs', () => {
    const fields = {
      company: 'Example Employer',
      title: 'Security Analyst',
      location: null,
      postingUrl: 'https://jobs.example/job/123?utm_source=test#apply',
    };

    const withUrl = generateJobFingerprint(fields, { includePostingUrl: true });
    const withoutUrl = generateJobFingerprint(fields, {
      includePostingUrl: false,
    });
    expect(withUrl).not.toBe(withoutUrl);
  });

  it('includes employment type in the fingerprint when provided', () => {
    const fullTime = generateJobFingerprint({
      company: 'Example',
      title: 'Engineer',
      location: 'Remote',
      postingUrl: 'https://example.com/job/1',
      employmentType: 'full-time',
    });
    const contract = generateJobFingerprint({
      company: 'Example',
      title: 'Engineer',
      location: 'Remote',
      postingUrl: 'https://example.com/job/1',
      employmentType: 'contract',
    });

    expect(fullTime).not.toBe(contract);
  });
});
