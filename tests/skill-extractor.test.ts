import { describe, expect, it } from 'vitest';

import { loadScoringConfig } from '../src/config/scoring-config.js';
import { extractJobTerms } from '../src/skills/skillExtractor.js';
import { createJobFixture } from './helpers/job-fixture.js';

describe('skill extraction', () => {
  it('extracts normalized skills, frequencies, and certifications', () => {
    const job = createJobFixture({
      description:
        'Use Splunk and SIEM monitoring on Linux. Splunk dashboards are required.',
      requirements: 'CompTIA Security+ and Active Directory experience.',
    });
    const terms = extractJobTerms(job, loadScoringConfig());

    expect(terms.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Splunk', frequency: 2 }),
        expect.objectContaining({ name: 'SIEM', frequency: 2 }),
        expect.objectContaining({ name: 'Linux', frequency: 1 }),
        expect.objectContaining({ name: 'Active Directory', frequency: 1 }),
      ]),
    );
    expect(terms.certifications).toContainEqual(
      expect.objectContaining({ name: 'CompTIA Security+' }),
    );
  });

  it('does not match aliases embedded inside unrelated words', () => {
    const job = createJobFixture({
      description: 'Administer cascading style sheets.',
      requirements: null,
    });
    const terms = extractJobTerms(job, loadScoringConfig());

    expect(terms.certifications.some((term) => term.name === 'CISSP')).toBe(
      false,
    );
  });
});
