import { describe, expect, it } from 'vitest';

import { extractEducation } from '../src/intelligence/nlp/education.js';
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
  return extractEducation(segment(text));
}

describe('job-nlp education intelligence (Stage 5)', () => {
  it('extracts a bachelor degree with field', () => {
    const result = extract("Bachelor's degree in Computer Science required.");
    expect(result.degrees).toHaveLength(1);
    const degree = result.degrees[0]!;
    expect(degree.level).toBe('bachelor');
    expect(degree.field).toBe('computer science');
  });

  it('extracts master/preferred', () => {
    const result = extract("Master's degree preferred.");
    expect(result.degrees[0]?.level).toBe('master');
    expect(result.degrees[0]?.field).toBeNull();
  });

  it('extracts doctorate', () => {
    const result = extract('Ph.D. in Computer Science required.');
    expect(result.degrees[0]?.level).toBe('doctorate');
    expect(result.degrees[0]?.field).toBe('computer science');
  });

  it('extracts associate degree', () => {
    const result = extract("Associate's degree in Networking required.");
    expect(result.degrees[0]?.level).toBe('associate');
  });

  it('extracts high-school level', () => {
    const result = extract('High school diploma or GED required.');
    expect(result.degrees[0]?.level).toBe('high-school');
  });

  it('keeps generic degree as unknown level', () => {
    const result = extract('A relevant degree is required.');
    expect(result.degrees[0]?.level).toBe('unknown');
    expect(result.degrees[0]?.levelConfidence).toBeLessThan(0.6);
  });

  it('detects experience substitution with years', () => {
    const result = extract(
      "Bachelor's degree or 4 years of related experience.",
    );
    expect(result.equivalency).toBe('experience');
    expect(result.substitutionYears).toBe(4);
  });

  it('detects or-equivalent-experience', () => {
    const result = extract("Bachelor's degree or equivalent experience.");
    expect(result.equivalency).toBe('experience');
    expect(result.substitutionYears).toBeNull();
  });

  it('detects equivalent education/credentials', () => {
    const result = extract(
      'Master\u2019s degree or equivalent education required.',
    );
    expect(['education', 'experience']).toContain(result.equivalency);
  });

  it('detects in-lieu-of substitution', () => {
    const result = extract('A degree in Computer Science in lieu of a degree.');
    expect(result.equivalency).toBe('experience');
  });

  it('marks combined degree requirements', () => {
    const result = extract(
      "A bachelor's and a master's degree are strongly desired.",
    );
    expect(result.combined).toBe(true);
    expect(result.degrees.length).toBeGreaterThanOrEqual(1);
  });

  it('no education content yields no degrees with low confidence', () => {
    const result = extract('Security+ certification required.');
    expect(result.degrees).toHaveLength(0);
    expect(result.confidence).toBeLessThan(0.4);
  });

  it('exposes span and version metadata', () => {
    const text = "Bachelor's degree in Computer Science required.";
    const result = extract(text);
    const degree = result.degrees[0]!;
    expect(degree.degreeSpan.end).toBeGreaterThan(degree.degreeSpan.start);
    expect(
      text.slice(degree.degreeSpan.start, degree.degreeSpan.end),
    ).toContain("Bachelor's");
    expect(result.method).toBe('entity-normalizer');
    expect(result.version).toBe('job-nlp-v1');
  });

  it('captures known vs arbitrary fields conservatively', () => {
    const known = extract("Bachelor's degree in Cybersecurity.");
    expect(known.degrees[0]?.field).toBe('cybersecurity');
    const arbitrary = extract("Bachelor's degree in Nautical Cartography.");
    expect(arbitrary.degrees[0]?.field).toBe('nautical cartography');
  });
});
