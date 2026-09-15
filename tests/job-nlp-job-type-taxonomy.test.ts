import { describe, expect, it } from 'vitest';

import {
  DEFAULT_JOB_TYPE_CATALOG,
  findJobTypeConcept,
  JOB_TYPE_TAXONOMY_VERSION,
  JOB_TYPE_STRIP_WORDS,
  jobTypeAliasIndex,
  jobTypeConcepts,
  jobTypeTaxonomyContentHash,
  normalizeJobTypeAlias,
  type JobTypeCatalogEntry,
} from '../src/intelligence/nlp/jobTypeTaxonomy.js';

describe('NLP job-type taxonomy shadow mode (P37)', () => {
  it('exposes a stable taxonomy version and a content hash that does not drift for an unchanged catalog', () => {
    expect(JOB_TYPE_TAXONOMY_VERSION).toBe('job-type-taxonomy-v1');
    const hashA = jobTypeTaxonomyContentHash();
    const hashB = jobTypeTaxonomyContentHash();
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
    expect(hashA).toBe(hashB);
  });

  it('produces a different content hash when a catalog is structurally edited, enabling stale detection', () => {
    const baselineHash = jobTypeTaxonomyContentHash();
    const editedCatalog: readonly JobTypeCatalogEntry[] = [
      ...DEFAULT_JOB_TYPE_CATALOG,
      {
        key: 'test-only-concept',
        label: 'Test Only Concept',
        aliases: ['Test Only Concept'],
      },
    ];
    const editedHash = jobTypeTaxonomyContentHash(editedCatalog);
    expect(editedHash).not.toBe(baselineHash);
  });

  it('keeps concepts unique by key and never expands the canonical catalog alias sets', () => {
    const concepts = jobTypeConcepts();
    expect(new Set(concepts.map((concept) => concept.key)).size).toBe(
      concepts.length,
    );
    for (const concept of concepts) {
      expect(concept.aliases).toContain(concept.label);
      expect(new Set(concept.aliases).size).toBe(concept.aliases.length);
    }
  });

  it('builds a normalized alias index that is case- and punctuation-insensitive', () => {
    const index = jobTypeAliasIndex();
    const sample = normalizeJobTypeAlias('Software Engineer');
    expect(index.get(sample)).toEqual({
      key: 'software-engineering',
      matchedAlias: 'Software Engineer',
    });
    const lowered = normalizeJobTypeAlias('  swe  ');
    expect(index.get(lowered)?.key).toBe('software-engineering');
  });

  it('keeps the curated alias sets disjoint: a colliding normalized alias is silently ignored, never asserted as a claim', () => {
    const duplicateCatalog: readonly JobTypeCatalogEntry[] = [
      {
        key: 'concept-a',
        label: 'Concept A',
        aliases: ['Shared Alias'],
      },
      {
        key: 'concept-b',
        label: 'Concept B',
        aliases: ['Shared Alias'],
      },
    ];
    const index = jobTypeAliasIndex(duplicateCatalog);
    expect(index.size).toBe(1);
    expect(index.get('shared alias')?.key).toBe('concept-a');
  });

  it('exposes the canonical first entry set and supports lookup by key', () => {
    const first = DEFAULT_JOB_TYPE_CATALOG[0];
    expect(first).toBeDefined();
    if (first === undefined) throw new Error('catalog empty');
    expect(findJobTypeConcept(first.key)?.label).toBe(first.label);
    expect(findJobTypeConcept('not-a-thing')).toBeNull();
  });

  it('defines conservative role-prefix / employment-type / generic strip-word sets for the classifier', () => {
    expect(JOB_TYPE_STRIP_WORDS.has('senior')).toBe(true);
    expect(JOB_TYPE_STRIP_WORDS.has('junior')).toBe(true);
    expect(JOB_TYPE_STRIP_WORDS.has('principal')).toBe(true);
    expect(JOB_TYPE_STRIP_WORDS.has('staff')).toBe(true);
    expect(JOB_TYPE_STRIP_WORDS.has('lead')).toBe(true);
    expect(JOB_TYPE_STRIP_WORDS.has('contract')).toBe(true);
    expect(JOB_TYPE_STRIP_WORDS.has('temporary')).toBe(true);
    expect(JOB_TYPE_STRIP_WORDS.has('remote')).toBe(true);
    expect(JOB_TYPE_STRIP_WORDS.has('job')).toBe(true);
    expect(JOB_TYPE_STRIP_WORDS.has('position')).toBe(true);
    expect(JOB_TYPE_STRIP_WORDS.has('engineer')).toBe(false);
    expect(JOB_TYPE_STRIP_WORDS.has('developer')).toBe(false);
  });
});
