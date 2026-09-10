import { describe, expect, it } from 'vitest';

import { extractExperience } from '../src/intelligence/nlp/experience.js';
import type { NlpSegment } from '../src/schemas/job-nlp.js';

function segment(text: string, index = 0): NlpSegment {
  return {
    index,
    text,
    normalized: text.toLowerCase(),
    kind: 'sentence',
    sourceField: 'description',
    charStart: 0,
    charEnd: text.length,
  };
}

function extract(text: string) {
  return extractExperience(segment(text));
}

describe('job-nlp experience intelligence (Stage 6)', () => {
  it('extracts a bare number of years without fabricating a modifier', () => {
    const result = extract(
      '5 years of IT experience, including 2 years of cybersecurity.',
    );
    expect(result.years?.minimum).toBe(5);
    expect(result.years?.maximum).toBeNull();
    expect(result.years?.modifier).toBe('unknown');
    expect(result.years?.domain).toBe('it');
  });

  it('extracts nested experience clauses', () => {
    const result = extract(
      '5 years of IT experience, including 2 years of cybersecurity.',
    );
    expect(result.nestedYears).toHaveLength(1);
    expect(result.nestedYears[0]?.minimum).toBe(2);
    expect(result.nestedYears[0]?.domain).toBe('cybersecurity');
  });

  it('preserves year ranges', () => {
    const result = extract(
      '3-5 years of progressive cybersecurity experience.',
    );
    expect(result.years?.minimum).toBe(3);
    expect(result.years?.maximum).toBe(5);
    expect(result.years?.modifier).toBe('range');
  });

  it('extracts explicit minimums', () => {
    const result = extract('At least 2 years of experience with Linux.');
    expect(result.years?.minimum).toBe(2);
    expect(result.years?.modifier).toBe('at-least');
  });

  it('extracts explicit maximums', () => {
    const result = extract('Up to 5 years of related experience.');
    expect(result.years?.maximum).toBe(5);
    expect(result.years?.modifier).toBe('at-most');
  });

  it('extracts plus-sign years', () => {
    const result = extract('1+ years of hands-on experience.');
    expect(result.years?.minimum).toBe(1);
    expect(result.years?.modifier).toBe('at-least');
  });

  it('extracts "or more" years', () => {
    const result = extract('8 or more years of experience.');
    expect(result.years?.minimum).toBe(8);
    expect(result.years?.modifier).toBe('at-least');
  });

  it('extracts months separately without fabricating years', () => {
    const result = extract('6 months experience with Azure.');
    expect(result.years).toBeNull();
    expect(result.months).toHaveLength(1);
    expect(result.months[0]?.value).toBe(6);
    expect(result.months[0]?.domain).toBe('azure');
  });

  it('extracts of-which nesting', () => {
    const result = extract('10 years, 5 of which in security operations.');
    expect(result.years?.minimum).toBe(10);
    expect(result.nestedYears.some((n) => n.minimum === 5)).toBe(true);
  });

  it('captures experience domains', () => {
    const result = extract(
      '5 years of experience in cybersecurity operations.',
    );
    expect(result.domains).toContain('cybersecurity operations');
  });

  it('never returns false years when none are present', () => {
    const result = extract('Experience required.');
    expect(result.years).toBeNull();
    expect(result.nestedYears).toHaveLength(0);
    expect(result.months).toHaveLength(0);
    expect(result.confidence).toBeLessThan(0.6);
  });

  it('preserves alternatives after or', () => {
    const result = extract(
      '5 years of Linux or 3 years of Windows administration.',
    );
    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives[0]?.minimum).toBe(3);
  });

  it('exposes method and version metadata', () => {
    const result = extract('3-5 years of experience.');
    expect(result.method).toBe('entity-normalizer');
    expect(result.version).toBe('job-nlp-v1');
    expect(result.segmentIndex).toBe(0);
  });
});
