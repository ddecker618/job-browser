import { describe, expect, it } from 'vitest';

import {
  JOB_TYPE_NORMALIZATION_METHOD,
  JOB_TYPE_NORMALIZATION_VERSION,
  normalizeJobTitle,
} from '../src/intelligence/nlp/jobTypeNormalization.js';
import { JOB_TYPE_TAXONOMY_VERSION } from '../src/intelligence/nlp/jobTypeTaxonomy.js';

describe('NLP job-type normalization shadow mode (P37)', () => {
  it('returns an EXACT relationship when the stripped title equals a canonical label', () => {
    const result = normalizeJobTitle({ title: 'Software Engineer' });

    expect(result.method).toBe(JOB_TYPE_NORMALIZATION_METHOD);
    expect(result.version).toBe(JOB_TYPE_NORMALIZATION_VERSION);
    expect(result.taxonomyVersion).toBe(JOB_TYPE_TAXONOMY_VERSION);
    expect(result.relationship).toBe('EXACT');
    expect(result.score).toBe(1);
    expect(result.conceptKey).toBe('software-engineering');
    expect(result.conceptLabel).toBe('Software Engineer');
    expect(result.matchedAlias).toBe('Software Engineer');
    expect(result.abstained).toBe(false);
    expect(result.explanation).toContain('canonical label');
  });

  it('returns CANONICAL_ALIAS for reviewed aliases that are not the canonical label', () => {
    const result = normalizeJobTitle({ title: 'Software Developer' });

    expect(result.relationship).toBe('CANONICAL_ALIAS');
    expect(result.score).toBe(0.95);
    expect(result.conceptKey).toBe('software-engineering');
    expect(result.matchedAlias).toBe('Software Developer');
    expect(result.abstained).toBe(false);
  });

  it('strips role-prefix and employment-type words and still resolves the canonical alias', () => {
    const result = normalizeJobTitle({
      title: '  Senior Software Developer (Remote) ',
    });

    expect(result.strippedTokens).toEqual(['software', 'developer']);
    expect(result.relationship).toBe('CANONICAL_ALIAS');
    expect(result.conceptKey).toBe('software-engineering');
    expect(result.conceptLabel).toBe('Software Engineer');
    expect(result.matchedAlias).toBe('Software Developer');
    expect(result.explanation).toContain('reviewed alias');
  });

  it('strips seniority words before matching an explicit alias (SRE)', () => {
    const result = normalizeJobTitle({ title: 'Senior SRE' });

    expect(result.relationship).toBe('CANONICAL_ALIAS');
    expect(result.conceptKey).toBe('devops-platform');
    expect(result.matchedAlias).toBe('SRE');
  });

  it('strips seniority words before matching a canonical label (Software Engineer)', () => {
    const result = normalizeJobTitle({ title: 'Staff Software Engineer' });

    expect(result.relationship).toBe('EXACT');
    expect(result.conceptKey).toBe('software-engineering');
    expect(result.matchedAlias).toBe('Software Engineer');
  });

  it('strips every role-prefix word and still resolves a canonical concept', () => {
    const result = normalizeJobTitle({
      title: '  Senior,  Principal   Staff Software   Engineer',
    });

    expect(result.relationship).toBe('EXACT');
    expect(result.conceptKey).toBe('software-engineering');
  });

  it('abstains on a generic "Engineer" title that has no equivalent single-token canonical alias', () => {
    const result = normalizeJobTitle({ title: 'Engineer' });

    expect(result.abstained).toBe(true);
    expect(result.relationship).toBe('UNRELATED');
    expect(result.conceptKey).toBeNull();
    expect(result.score).toBe(0);
    expect(result.abstentionReason).toBe('no-reviewed-alias-matched');
    expect(result.explanation).toContain('no occupation is claimed');
  });

  it('abstains on a context-stripped title with mixed-role ambiguity', () => {
    const result = normalizeJobTitle({ title: 'Engineer Manager' });

    expect(result.abstained).toBe(true);
    expect(result.relationship).toBe('UNRELATED');
    expect(result.conceptKey).toBeNull();
  });

  it('abstains on a title with no catalog coverage without claiming an unrelated concept', () => {
    const result = normalizeJobTitle({ title: 'Senior Cook' });

    expect(result.abstained).toBe(true);
    expect(result.relationship).toBe('UNRELATED');
    expect(result.conceptKey).toBeNull();
  });

  it('reports UNKNOWN on empty input with a stable abstention reason', () => {
    const result = normalizeJobTitle({ title: '' });

    expect(result.abstained).toBe(true);
    expect(result.relationship).toBe('UNKNOWN');
    expect(result.conceptKey).toBeNull();
    expect(result.score).toBe(0);
    expect(result.abstentionReason).toBe('empty-title-input');
    expect(result.explanation).toContain('Title input is empty');
  });

  it('reports UNKNOWN on whitespace-only input with the empty-title-input abstention reason', () => {
    const result = normalizeJobTitle({ title: '   \t  ' });

    expect(result.abstained).toBe(true);
    expect(result.relationship).toBe('UNKNOWN');
    expect(result.abstentionReason).toBe('empty-title-input');
  });

  it('reports UNKNOWN when the only retained token after stripping is a strip word', () => {
    const result = normalizeJobTitle({ title: 'Senior Position' });

    expect(result.abstained).toBe(true);
    expect(result.relationship).toBe('UNKNOWN');
    expect(result.abstentionReason).toBe(
      'no-tokens-after-stripping-role-prefix-and-noise-words',
    );
    expect(result.strippedTokens).toEqual([]);
    expect(result.conceptKey).toBeNull();
  });

  it('is deterministic across repeated calls and never mutates the catalog', () => {
    const first = normalizeJobTitle({ title: 'Senior Software Engineer' });
    const second = normalizeJobTitle({ title: 'Senior Software Engineer' });
    const third = normalizeJobTitle({ title: '  Senior Software Engineer  ' });

    expect(second).toEqual(first);
    expect(third.catalogHash).toBe(first.catalogHash);
  });

  it('exposes a stable, JSON-serializable payload shape', () => {
    const result = normalizeJobTitle({ title: 'Pen Tester' });

    expect(JSON.parse(JSON.stringify(result))).toMatchObject({
      method: 'deterministic-fallback',
      version: 'job-type-normalization-v1',
      taxonomyVersion: 'job-type-taxonomy-v1',
      title: 'Pen Tester',
      relationship: 'CANONICAL_ALIAS',
      conceptKey: 'cybersecurity',
      conceptLabel: 'Cybersecurity Engineer',
      abstained: false,
      score: 0.95,
    });
  });

  it('does not match across concepts when an alias is followed by an unrelated word', () => {
    const result = normalizeJobTitle({ title: 'Software Engineer Pilot' });

    expect(result.abstained).toBe(true);
    expect(result.relationship).toBe('UNRELATED');
    expect(result.conceptKey).toBeNull();
    expect(result.strippedTokens).toEqual(['software', 'engineer', 'pilot']);
  });

  it('does not match across families when the input has two unrelated family tokens', () => {
    const result = normalizeJobTitle({ title: 'DBA Pilot' });

    expect(result.abstained).toBe(true);
    expect(result.relationship).toBe('UNRELATED');
    expect(result.conceptKey).toBeNull();
  });

  it('isolates effect across calls so that one call cannot change another call', () => {
    const a = normalizeJobTitle({ title: 'Senior Software Engineer' });
    const b = normalizeJobTitle({ title: 'Engineer' });
    const c = normalizeJobTitle({ title: 'Senior Software Engineer' });

    expect(a.relationship).toBe('EXACT');
    expect(b.relationship).toBe('UNRELATED');
    expect(c.relationship).toBe('EXACT');
    expect(c.conceptKey).toBe(a.conceptKey);
  });
});
