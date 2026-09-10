import { describe, expect, it } from 'vitest';

import {
  LOCATION_INTELLIGENCE_VERSION,
  extractLocation,
  extractLocationBatch,
} from '../src/intelligence/nlp/location.js';
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

describe('location intelligence - arrangement', () => {
  it('recognizes a fully remote role', () => {
    const result = extractLocation(segment('This is a fully remote role.'));
    expect(result.arrangement).toBe('remote');
    expect(result.remoteDenied).toBe(false);
    expect(result.arrangementConflict).toBe(false);
  });

  it('recognizes hybrid office frequency', () => {
    const result = extractLocation(
      segment('Hybrid role with three days per week in the office.'),
    );
    expect(result.arrangement).toBe('hybrid');
    expect(result.onsiteFrequency).toBe('regular');
  });

  it('recognizes explicit remote denial as onsite', () => {
    const result = extractLocation(segment('Remote work is not authorized.'));
    expect(result.arrangement).toBe('onsite');
    expect(result.remoteDenied).toBe(true);
  });

  it('does not turn technical remote terminology into remote work', () => {
    const result = extractLocation(
      segment('Provides remote support for on-premises infrastructure.'),
    );
    expect(result.arrangement).toBe('unknown');
    expect(result.arrangementEvidence[0]).toContain('technical terminology');
  });

  it('keeps occasional onsite as a remote qualifier and records a conflict', () => {
    const result = extractLocation(
      segment('Remote role with occasional onsite visits.'),
    );
    expect(result.arrangement).toBe('remote');
    expect(result.onsiteFrequency).toBe('occasional');
    // Existing deterministic work-arrangement precedence treats generic onsite
    // wording as onsite; this is reported, never used to change eligibility.
    expect(result.deterministicArrangement).toBe('onsite');
    expect(result.arrangementConflict).toBe(true);
  });
});

describe('location intelligence - places and remote scope', () => {
  it('extracts a city/state pair with exact evidence spans', () => {
    const text = 'The position is based in Austin, TX.';
    const result = extractLocation(segment(text));
    const city = result.locations.find((item) => item.kind === 'city');
    const state = result.locations.find((item) => item.kind === 'state');
    expect(city?.normalized).toBe('austin');
    expect(state?.normalized).toBe('TX');
    expect(
      city === undefined ? '' : text.slice(city.span.start, city.span.end),
    ).toBe(city?.raw);
    expect(
      state === undefined ? '' : text.slice(state.span.start, state.span.end),
    ).toBe(state?.raw);
  });

  it('normalizes full state names and multiple locations', () => {
    const result = extractLocation(
      segment('Remote work is available in California or New York.'),
    );
    expect(result.remoteScope.kind).toBe('state-limited');
    expect(result.remoteScope.states).toEqual(['CA', 'NY']);
  });

  it('recognizes nationwide remote without inventing a state', () => {
    const result = extractLocation(
      segment('This is a nationwide remote position.'),
    );
    expect(result.remoteScope.kind).toBe('nationwide');
    expect(result.remoteScope.states).toEqual([]);
    expect(result.locations).toEqual([]);
  });

  it('records excluded states without changing hard gates', () => {
    const result = extractLocation(
      segment('Remote work is not available in California.'),
    );
    expect(result.remoteScope.excludedStates).toEqual(['CA']);
    expect(result.arrangement).toBe('onsite');
    expect(result.remoteDenied).toBe(true);
  });
});

describe('location intelligence - commute, relocation, and travel', () => {
  it('extracts a required commute distance without calculating mileage', () => {
    const result = extractLocation(
      segment('Candidates must live within 50 miles of the office.'),
    );
    expect(result.commute.required).toBe(true);
    expect(result.commute.miles).toBe(50);
    expect(result.commute.raw).toBe('within 50 miles');
  });

  it('preserves commute language when no numeric distance is given', () => {
    const result = extractLocation(
      segment('Applicants must reside within commuting distance.'),
    );
    expect(result.commute.required).toBe(true);
    expect(result.commute.miles).toBeNull();
  });

  it('distinguishes relocation required, preferred, and unavailable', () => {
    expect(
      extractLocation(segment('Must be willing to relocate.')).relocation
        .status,
    ).toBe('required');
    expect(
      extractLocation(segment('Relocation is preferred.')).relocation.status,
    ).toBe('preferred');
    expect(
      extractLocation(segment('No relocation assistance is available.'))
        .relocation.status,
    ).toBe('not-available');
  });

  it('extracts travel percentage, requirement, and overnight status', () => {
    const result = extractLocation(
      segment('This role requires up to 25% travel and overnight stays.'),
    );
    expect(result.travel.mentioned).toBe(true);
    expect(result.travel.required).toBe(true);
    expect(result.travel.percent).toBe(25);
    expect(result.travel.overnight).toBe(true);
  });

  it('does not invent travel from unrelated text', () => {
    const result = extractLocation(segment('Work is performed in the office.'));
    expect(result.travel.mentioned).toBe(false);
    expect(result.travel.percent).toBeNull();
  });
});

describe('location intelligence - batch and metadata', () => {
  it('honors location/work-arrangement/travel category gates', () => {
    const segments = [
      segment('Fully remote role.', 0),
      segment('Security+ required.', 1),
      segment('Travel up to 10%.', 2),
    ];
    const categories = new Map<
      number,
      readonly ('work-arrangement' | 'certification' | 'travel')[]
    >([
      [0, ['work-arrangement']],
      [1, ['certification']],
      [2, ['travel']],
    ]);
    const results = extractLocationBatch(segments, categories);
    expect(results).toHaveLength(2);
    expect(results.map((item) => item.segmentIndex)).toEqual([0, 2]);
  });

  it('reports version and method metadata', () => {
    const result = extractLocation(segment('Remote role.'));
    expect(result.locationVersion).toBe(LOCATION_INTELLIGENCE_VERSION);
    expect(result.version).toBe('job-nlp-v1');
    expect(result.method).toBe('entity-normalizer');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('returns conservative empty output for unrelated text', () => {
    const result = extractLocation(
      segment('We build secure software products.'),
    );
    expect(result.arrangement).toBe('unknown');
    expect(result.locations).toEqual([]);
    expect(result.remoteScope.kind).toBe('unspecified');
    expect(result.commute.required).toBe(false);
    expect(result.relocation.status).toBe('unknown');
    expect(result.travel.mentioned).toBe(false);
    expect(result.confidence).toBe(0.4);
  });
});
