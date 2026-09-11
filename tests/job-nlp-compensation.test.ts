import { describe, expect, it } from 'vitest';

import {
  COMPENSATION_INTELLIGENCE_VERSION,
  extractCompensation,
  extractCompensationBatch,
} from '../src/intelligence/nlp/compensation.js';
import {
  NLP_EXTRACTION_VERSION,
  type NlpSegment,
} from '../src/schemas/job-nlp.js';

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

describe('compensation intelligence', () => {
  it('extracts an annual salary range with exact spans', () => {
    const text = 'The salary range is $90,000 to $110,000 per year.';
    const result = extractCompensation(segment(text));

    expect(result.amounts).toHaveLength(1);
    expect(result.amounts[0]).toMatchObject({
      kind: 'base-pay',
      minimum: 90000,
      maximum: 110000,
      currency: 'USD',
      period: 'annual',
      normalized: 'base-pay:USD:annual:90000-110000',
    });
    const span = result.amounts[0]?.span;
    expect(span === undefined ? '' : text.slice(span.start, span.end)).toBe(
      '$90,000 to $110,000',
    );
  });

  it('extracts hourly pay and orders reversed ranges', () => {
    const result = extractCompensation(
      segment('Pay is $45-$35 per hour depending on experience.'),
    );

    expect(result.amounts[0]).toMatchObject({
      minimum: 35,
      maximum: 45,
      period: 'hourly',
      normalized: 'base-pay:USD:hourly:35-45',
    });
  });

  it('recognizes compact thousands and sign-on bonuses', () => {
    const result = extractCompensation(
      segment('Includes a $10k sign-on bonus.'),
    );

    expect(result.amounts[0]).toMatchObject({
      kind: 'sign-on',
      minimum: 10000,
      maximum: null,
      period: 'one-time',
    });
    expect(result.signals).toContain('sign-on');
    expect(result.signals).toContain('bonus');
  });

  it('records compensation signals when no amount is disclosed', () => {
    const result = extractCompensation(
      segment('Compensation includes commission, equity, and annual bonus.'),
    );

    expect(result.amounts).toEqual([]);
    expect(result.signals).toEqual(['bonus', 'commission', 'equity']);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('honors the compensation category gate in batch mode', () => {
    const segments = [
      segment('Salary range is $80,000 to $95,000.', 0),
      segment('Security+ required.', 1),
    ];
    const result = extractCompensationBatch(
      segments,
      new Map([
        [0, ['compensation']],
        [1, ['certification']],
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.amounts[0]?.minimum).toBe(80000);
  });

  it('reports extraction versions', () => {
    const result = extractCompensation(segment('Salary is $100,000.'));

    expect(result.version).toBe(NLP_EXTRACTION_VERSION);
    expect(result.compensationVersion).toBe(COMPENSATION_INTELLIGENCE_VERSION);
  });
});
