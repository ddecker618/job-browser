import { describe, expect, it } from 'vitest';

import { generateJobFingerprint } from '../src/utils/fingerprint.js';

describe('job fingerprinting', () => {
  it('is stable across case, whitespace, and provider URLs', () => {
    const first = generateJobFingerprint({
      company: ' Example Employer ',
      title: 'Security   Analyst',
      location: 'Remote',
      postingUrl: 'https://board-one.example/jobs/123',
    });
    const second = generateJobFingerprint({
      company: 'example employer',
      title: 'security analyst',
      location: 'remote',
      postingUrl: 'https://board-two.example/listing/456',
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('can include a canonical URL when a source requires URL identity', () => {
    const fields = {
      company: 'Example Employer',
      title: 'Security Analyst',
      location: null,
      postingUrl: 'https://jobs.example/job/123?utm_source=test#apply',
    };

    expect(
      generateJobFingerprint(fields, { includePostingUrl: true }),
    ).not.toBe(generateJobFingerprint(fields));
  });
});
