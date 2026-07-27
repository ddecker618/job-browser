import { describe, expect, it } from 'vitest';

import { normalizedJobSchema } from '../src/schemas/normalized-job.js';
import { createJobFixture } from './helpers/job-fixture.js';

describe('normalizedJobSchema', () => {
  it('accepts a complete normalized job', () => {
    expect(normalizedJobSchema.parse(createJobFixture()).title).toBe(
      'Security Analyst',
    );
  });

  it('accepts explicit nulls for unavailable source values', () => {
    const result = normalizedJobSchema.safeParse(
      createJobFixture({
        externalId: null,
        location: null,
        salaryMinimum: null,
        salaryMaximum: null,
        postingUrl: null,
        score: null,
        scoreExplanation: null,
      }),
    );
    expect(result.success).toBe(true);
  });

  it.each([
    ['invalid status', { status: 'pending' }],
    ['invalid URL', { postingUrl: 'not-a-url' }],
    ['non-UTC timestamp', { firstSeenAt: '2026-07-18T12:00:00+01:00' }],
    ['reversed salary range', { salaryMinimum: 90_000, salaryMaximum: 80_000 }],
    ['score without explanation', { score: 70, scoreExplanation: null }],
  ])('rejects %s', (_description, overrides) => {
    expect(
      normalizedJobSchema.safeParse({ ...createJobFixture(), ...overrides })
        .success,
    ).toBe(false);
  });

  it('rejects unknown properties', () => {
    expect(
      normalizedJobSchema.safeParse({ ...createJobFixture(), unexpected: true })
        .success,
    ).toBe(false);
  });
});
