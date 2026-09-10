import { describe, expect, it } from 'vitest';

import {
  CLEARANCE_INTELLIGENCE_VERSION,
  clearanceCatalog,
  extractClearance,
  extractClearanceBatch,
} from '../src/intelligence/nlp/clearance.js';
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

function clearancesFor(text: string) {
  return extractClearance(segment(text)).clearances;
}

function citizenshipFor(text: string) {
  return extractClearance(segment(text)).citizenship;
}

describe('clearance intelligence - level catalog', () => {
  it('catalog covers the expected clearance levels', () => {
    const keys = clearanceCatalog().map((entry) => entry.key);
    expect(keys).toContain('ts-sci');
    expect(keys).toContain('top-secret');
    expect(keys).toContain('secret');
    expect(keys).toContain('confidential');
    expect(keys).toContain('sci');
    expect(keys).toContain('public-trust');
    expect(keys).toContain('ssbi');
    expect(keys).toContain('polygraph');
  });
});

describe('clearance intelligence - level and status', () => {
  it('recognizes TS/SCI as current from active language', () => {
    const items = clearancesFor('Active Top Secret/SCI clearance required.');
    expect(items).toEqual([
      {
        level: 'ts-sci',
        name: 'Top Secret/SCI',
        raw: 'Top Secret/SCI',
        span: { start: 7, end: 21 },
        status: 'current',
      },
    ]);
  });

  it('handles a single level without duplicate overlapping entries', () => {
    const items = clearancesFor('Clearance required: Top Secret.');
    expect(items.length).toBe(1);
    expect(items[0]?.level).toBe('top-secret');
    expect(items[0]?.status).toBe('required');
  });

  it('distinguishes ability-to-obtain', () => {
    const items = clearancesFor('Must be able to obtain a Secret clearance.');
    expect(items[0]?.level).toBe('secret');
    expect(items[0]?.status).toBe('ability-to-obtain');
  });

  it('distinguishes maintenance', () => {
    const items = clearancesFor(
      'Must maintain an active Top Secret clearance.',
    );
    expect(items[0]?.level).toBe('top-secret');
    expect(items[0]?.status).toBe('maintenance');
  });

  it('extracts multiple clearance levels', () => {
    const items = clearancesFor('SSBI and polygraph are required.');
    expect(items.map((item) => item.level)).toEqual(['ssbi', 'polygraph']);
    for (const item of items) {
      expect(item.status).toBe('required');
    }
  });

  it('extracts TS/SCI written with a slash', () => {
    const items = clearancesFor('Ability to obtain a TS/SCI clearance.');
    expect(items[0]?.level).toBe('ts-sci');
    expect(items[0]?.status).toBe('ability-to-obtain');
  });

  it('reports an unknown level when only the word clearance appears', () => {
    const items = clearancesFor('This position requires an active clearance.');
    expect(items[0]?.level).toBe('unknown');
    expect(items[0]?.name).toBe('Security Clearance');
    expect(items[0]?.status).toBe('current');
  });

  it('does not infer a confidential clearance from NDA language', () => {
    const items = clearancesFor('All communications are confidential.');
    expect(items).toEqual([]);
  });

  it('sorts by span and honors raw/span integrity', () => {
    const result = extractClearance(
      segment('Polygraph and SSBI clearance required.'),
    );
    const items = result.clearances;
    const keys = items.map((item) => item.level);
    expect(keys).toEqual(['polygraph', 'ssbi']);
    for (const item of items) {
      expect(
        segment('Polygraph and SSBI clearance required.').text.slice(
          item.span.start,
          item.span.end,
        ),
      ).toBe(item.raw);
    }
  });
});

describe('clearance intelligence - adversarial guard', () => {
  it('refuses to imply applicant clearance from "our cleared team"', () => {
    const result = extractClearance(
      segment('Our cleared team handles classified projects.'),
    );
    expect(result.clearances).toEqual([]);
    expect(result.teamContext).toBe(true);
    expect(result.confidence).toBe(0.55);
  });

  it('still extracts applicant-directed clearances when applicant language is present', () => {
    const result = extractClearance(
      segment('You must hold a Top Secret clearance.'),
    );
    expect(result.teamContext).toBe(false);
    expect(result.clearances[0]?.level).toBe('top-secret');
    expect(result.clearances[0]?.status).toBe('required');
  });
});

describe('clearance intelligence - citizenship separation', () => {
  it('detects mandatory U.S. citizenship', () => {
    const items = citizenshipFor('Must be a U.S. citizen.');
    expect(items[0]?.status).toBe('us-citizen');
    expect(items[0]?.modality).toBe('required');
  });

  it('detects green card and permanent residency separately from work authorization', () => {
    const items = citizenshipFor(
      'Green card or lawful permanent resident eligible to work.',
    );
    expect(items.map((item) => item.status)).toEqual([
      'permanent-resident',
      'work-authorization',
    ]);
  });

  it('keeps citizenship and clearance independent in one segment', () => {
    const result = extractClearance(
      segment('U.S. citizenship required; TS/SCI clearance preferred.'),
    );
    expect(result.citizenship[0]?.status).toBe('us-citizen');
    expect(result.citizenship[0]?.modality).toBe('required');
    expect(result.clearances[0]?.level).toBe('ts-sci');
    // Two separate entities: citizenship preferred keyword must not bleed into clearance.
    expect(result.clearances[0]?.status).toBe('preferred');
  });
});

describe('clearance intelligence - batch and metadata', () => {
  it('batch honors the clearance/citizenship category gate', () => {
    const segments = [
      segment('Active Secret clearance required.', 0),
      segment('All communications are confidential.', 1),
    ];
    const categories = new Map<number, readonly ('clearance' | 'benefit')[]>([
      [0, ['clearance']],
      [1, ['benefit']],
    ]);
    const results = extractClearanceBatch(segments, categories);
    expect(results).toHaveLength(1);
    expect(results[0]?.clearances[0]?.level).toBe('secret');
  });

  it('version constants are present', () => {
    expect(CLEARANCE_INTELLIGENCE_VERSION).toBe('clearance-intelligence-v1');
    const result = extractClearance(
      segment('Active Secret clearance required.'),
    );
    expect(result.version).toBe('job-nlp-v1');
    expect(result.clearanceVersion).toBe('clearance-intelligence-v1');
    expect(result.method).toBe('entity-normalizer');
  });
});
