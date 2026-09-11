import { describe, it, expect } from 'vitest';
import { extractNlpDocument } from '../src/intelligence/nlp/document.js';
import {
  deriveSearchRelevance,
  withSearchRelevanceIndex,
} from '../src/intelligence/nlp/searchRelevance.js';
import { projectSkillCoverage } from '../src/intelligence/nlp/skillCoverage.js';
const parts = {
  title: 'Analyst',
  location: null,
  description: 'Amazon Web Services required. Splunk required.',
  requirements: null,
  preferredQualifications: null,
};
describe('P9 reviewed skill consumers', () => {
  it('canonicalizes aliases without related-skill expansion or source mutation', async () => {
    const document = await extractNlpDocument(parts);
    const before = JSON.stringify(document);
    const index = deriveSearchRelevance(document);
    expect(index.canonicalSkills).toContain('AWS');
    expect(index.canonicalSkills).not.toContain('Azure');
    expect(index.canonicalSkills).not.toContain('SIEM');
    expect(JSON.stringify(document)).toBe(before);
    const coverage = projectSkillCoverage(document, [
      {
        evidenceId: 'e1',
        kind: 'skill',
        rawLabel: 'Azure',
        provenance: 'snapshot:test',
        parserVersion: 'p1',
        normalizationVersion: 'n1',
      },
    ]);
    expect(
      coverage.rows.find((r) => r.phrase === 'Amazon Web Services')?.status,
    ).toBe('WEAK_RELATED');
    expect(coverage.productionEffect).toBe('none');
  });
  it('abstains on unknown and contradictory raw labels', async () => {
    const document = await extractNlpDocument(parts);
    for (const fact of document.facts)
      for (const entity of fact.entities)
        entity.raw = 'Unreviewed Mystery Skill';
    expect(deriveSearchRelevance(document).canonicalSkills).toEqual([]);
    expect(
      projectSkillCoverage(document, []).rows.every(
        (r) => r.status === 'UNKNOWN',
      ),
    ).toBe(true);
  });
  it('rebuilds missing or corrupt derived indexes even when extraction is fresh', () => {
    const target = { save: () => undefined, isStale: () => false };
    expect(
      withSearchRelevanceIndex(target, {
        save: () => undefined,
        get: () => null,
      }).isStale('j', 'v', 'h'),
    ).toBe(true);
    expect(
      withSearchRelevanceIndex(target, {
        save: () => undefined,
        get: () => {
          throw Error('corrupt');
        },
      }).isStale('j', 'v', 'h'),
    ).toBe(true);
  });
});
