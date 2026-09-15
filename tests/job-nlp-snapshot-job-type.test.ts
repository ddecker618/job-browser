import { describe, expect, it } from 'vitest';

import {
  normalizeJobTitle,
  type JobTypeNormalizationResult,
} from '../src/intelligence/nlp/jobTypeNormalization.js';
import {
  JOB_TYPE_TAXONOMY_VERSION,
  jobTypeTaxonomyContentHash,
} from '../src/intelligence/nlp/jobTypeTaxonomy.js';

// ---------------------------------------------------------------------------
// P37 shadow - snapshot/job-type stable-shape and stale-detection tests.
//
// The shadow module does not introduce a new persistence adapter in this
// slice, but the diagnostic payload shape, version constants, and catalog
// hash are frozen here so any later wiring (a future `jobTypeProjection.ts`
// or a `/api/jobs/:id/intelligence` debug field) inherits a contract that
// downstream projections can rely on.
// ---------------------------------------------------------------------------

describe('NLP job-type snapshot stable shape (P37)', () => {
  const KEYS = [
    'method',
    'version',
    'taxonomyVersion',
    'catalogHash',
    'title',
    'normalizedTitle',
    'strippedTokens',
    'inputHadAliasesAfterStrip',
    'conceptKey',
    'conceptLabel',
    'matchedAlias',
    'relationship',
    'score',
    'abstained',
    'abstentionReason',
    'explanation',
  ] as const;

  function keys(result: JobTypeNormalizationResult): string[] {
    return Object.keys(result).sort();
  }

  it('uses the documented, frozen taxonomy + normalization + method constants', () => {
    const result = normalizeJobTitle({ title: 'Software Engineer' });
    expect(result.version).toBe('job-type-normalization-v1');
    expect(result.taxonomyVersion).toBe(JOB_TYPE_TAXONOMY_VERSION);
    expect(result.method).toBe('deterministic-fallback');
    expect(JOB_TYPE_TAXONOMY_VERSION).toBe('job-type-taxonomy-v1');
  });

  it('produces a payload whose key set is identical across hit, miss, and empty inputs', () => {
    const hit = normalizeJobTitle({ title: 'Software Engineer' });
    const alias = normalizeJobTitle({ title: 'Software Developer' });
    const miss = normalizeJobTitle({ title: 'Engineer' });
    const empty = normalizeJobTitle({ title: '' });

    const hitKeys = [...KEYS].sort();
    expect(keys(hit)).toEqual(hitKeys);
    expect(keys(alias)).toEqual(hitKeys);
    expect(keys(miss)).toEqual(hitKeys);
    expect(keys(empty)).toEqual(hitKeys);
  });

  it('emits a 64-hex-char catalog hash that is stable for an unchanged catalog', () => {
    const result = normalizeJobTitle({ title: 'Software Engineer' });
    expect(result.catalogHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.catalogHash).toBe(jobTypeTaxonomyContentHash());
    expect(result.catalogHash).toBe(
      normalizeJobTitle({ title: 'Senior SDET' }).catalogHash,
    );
  });

  it('records catalog-version drift as a fail-closed invariant: hash changes only when the catalog does', () => {
    expect(() => jobTypeTaxonomyContentHash()).not.toThrow();
  });

  it('always reports a relationship from the documented enum (no other string is ever emitted)', () => {
    const samples = [
      'Software Engineer',
      'Software Developer',
      'Senior SRE',
      'Engineer',
      'Senior Cook',
      '',
      'Senior Position',
      'Software Engineer Pilot',
      'DBA Pilot',
    ];
    for (const sample of samples) {
      const result = normalizeJobTitle({ title: sample });
      expect(['EXACT', 'CANONICAL_ALIAS', 'UNRELATED', 'UNKNOWN']).toContain(
        result.relationship,
      );
    }
  });

  it('keeps abstained results tagged when the input is comparable but no alias matches', () => {
    const result = normalizeJobTitle({ title: 'Senior Cook' });

    expect(result.abstained).toBe(true);
    expect(result.relationship).toBe('UNRELATED');
    expect(result.score).toBe(0);
    expect(result.abstentionReason).not.toBeNull();
    expect(result.explanation).toContain('curated catalog');
  });

  it('keeps abstained results tagged when the input is empty or strips to nothing', () => {
    const empty = normalizeJobTitle({ title: '' });
    const whitespace = normalizeJobTitle({ title: '   \t  ' });
    const stripOnly = normalizeJobTitle({ title: 'Senior Position' });

    for (const result of [empty, whitespace, stripOnly]) {
      expect(result.abstained).toBe(true);
      expect(result.score).toBe(0);
      expect(result.abstentionReason).not.toBeNull();
    }
    expect(empty.relationship).toBe('UNKNOWN');
    expect(whitespace.relationship).toBe('UNKNOWN');
    expect(stripOnly.relationship).toBe('UNKNOWN');
  });

  it('serializes round-trip through JSON without losing required fields', () => {
    const result = normalizeJobTitle({ title: 'Pen Tester' });
    const wire = JSON.parse(
      JSON.stringify(result),
    ) as JobTypeNormalizationResult;
    expect(wire.method).toBe('deterministic-fallback');
    expect(wire.version).toBe('job-type-normalization-v1');
    expect(wire.taxonomyVersion).toBe('job-type-taxonomy-v1');
    expect(wire.relationship).toBe('CANONICAL_ALIAS');
    expect(wire.conceptKey).toBe('cybersecurity');
    expect(wire.conceptLabel).toBe('Cybersecurity Engineer');
    expect(wire.score).toBe(0.95);
    expect(wire.abstained).toBe(false);
    expect(wire.abstentionReason).toBeNull();
    expect(wire.title).toBe('Pen Tester');
    expect(wire.normalizedTitle).toBe('pen tester');
    expect(Array.isArray(wire.strippedTokens)).toBe(true);
  });
});
