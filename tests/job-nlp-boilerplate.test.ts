import { describe, expect, it } from 'vitest';

import {
  BOILERPLATE_INTELLIGENCE_VERSION,
  extractBoilerplate,
  extractBoilerplateBatch,
} from '../src/intelligence/nlp/boilerplate.js';
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

describe('boilerplate intelligence - non-requirement content', () => {
  it('identifies EEO language as boilerplate', () => {
    const result = extractBoilerplate(
      segment('We are an equal opportunity employer.'),
    );
    expect(result.kinds).toEqual(['eeo']);
    expect(result.disposition).toBe('boilerplate');
    expect(result.isBoilerplate).toBe(true);
  });

  it('identifies benefits content', () => {
    const result = extractBoilerplate(
      segment('Medical, dental, and vision insurance are available.'),
    );
    expect(result.kinds).toEqual(['benefits']);
    expect(result.isBoilerplate).toBe(true);
  });

  it('identifies compensation content', () => {
    const result = extractBoilerplate(
      segment('The salary range is $80,000 to $100,000 plus bonus.'),
    );
    expect(result.kinds).toContain('compensation');
    expect(result.isBoilerplate).toBe(true);
  });

  it('identifies marketing and company-description language', () => {
    const result = extractBoilerplate(
      segment('We are a leading company building secure software products.'),
    );
    expect(result.kinds).toEqual(
      expect.arrayContaining(['marketing', 'company-description']),
    );
    expect(result.disposition).toBe('boilerplate');
  });

  it('identifies legal and accommodation language', () => {
    const result = extractBoilerplate(
      segment(
        'Reasonable accommodations are available; background checks apply.',
      ),
    );
    expect(result.kinds).toEqual(
      expect.arrayContaining(['accommodation', 'legal']),
    );
    expect(result.isBoilerplate).toBe(true);
  });

  it('identifies culture language without treating it as an applicant requirement', () => {
    const result = extractBoilerplate(
      segment('We value an inclusive culture and work-life balance.'),
    );
    expect(result.kinds).toContain('culture');
    expect(result.preserveRequirement).toBe(false);
    expect(result.disposition).toBe('boilerplate');
  });
});

describe('boilerplate intelligence - conservative requirement preservation', () => {
  it('preserves a generic soft-skill requirement', () => {
    const result = extractBoilerplate(
      segment('Excellent communication skills are required.'),
    );
    expect(result.kinds).toEqual([]);
    expect(result.disposition).toBe('requirement');
    expect(result.isBoilerplate).toBe(false);
    expect(result.preserveRequirement).toBe(true);
  });

  it('marks benefits plus an applicant requirement as mixed', () => {
    const result = extractBoilerplate(
      segment('Experience administering employee benefits is required.'),
    );
    expect(result.kinds).toContain('benefits');
    expect(result.disposition).toBe('mixed');
    expect(result.isBoilerplate).toBe(false);
    expect(result.preserveRequirement).toBe(true);
  });

  it('preserves a responsibility involving compensation systems', () => {
    const result = extractBoilerplate(
      segment('Manage compensation and payroll programs.'),
    );
    expect(result.kinds).toContain('compensation');
    expect(result.disposition).toBe('mixed');
    expect(result.preserveRequirement).toBe(true);
  });

  it('preserves a required legal condition for later reconciliation', () => {
    const result = extractBoilerplate(
      segment('Successful completion of a background check is required.'),
    );
    expect(result.kinds).toContain('legal');
    expect(result.disposition).toBe('mixed');
    expect(result.isBoilerplate).toBe(false);
  });

  it('does not classify unrelated prose as boilerplate', () => {
    const result = extractBoilerplate(
      segment('The service processes events across distributed systems.'),
    );
    expect(result.kinds).toEqual([]);
    expect(result.disposition).toBe('unknown');
    expect(result.confidence).toBe(0.4);
  });
});

describe('boilerplate intelligence - evidence and metadata', () => {
  it('preserves signal spans', () => {
    const text = 'We are an equal opportunity employer.';
    const result = extractBoilerplate(segment(text));
    const signal = result.signals[0];
    expect(signal).toBeDefined();
    expect(text.slice(signal?.span.start ?? 0, signal?.span.end ?? 0)).toBe(
      signal?.raw,
    );
  });

  it('supports batch extraction without changing segments', () => {
    const segments = [
      segment('Equal opportunity employer.', 0),
      segment('Python is required.', 1),
    ];
    const results = extractBoilerplateBatch(segments);
    expect(results.map((item) => item.segmentIndex)).toEqual([0, 1]);
    expect(results[0]?.isBoilerplate).toBe(true);
    expect(results[1]?.disposition).toBe('requirement');
  });

  it('reports method, version, and confidence bounds', () => {
    const result = extractBoilerplate(segment('401(k) benefits are offered.'));
    expect(result.method).toBe('segment-rules');
    expect(result.version).toBe('job-nlp-v1');
    expect(result.boilerplateVersion).toBe(BOILERPLATE_INTELLIGENCE_VERSION);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
