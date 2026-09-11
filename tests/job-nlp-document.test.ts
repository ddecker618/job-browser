import { describe, expect, it } from 'vitest';
import {
  documentHash,
  extractNlpDocument,
} from '../src/intelligence/nlp/document.js';
import {
  jobNlpEnrichmentSchema,
  NLP_EXTRACTION_VERSION,
} from '../src/schemas/job-nlp.js';
const parts = {
  title: 'Security Analyst',
  location: null,
  description: null,
  requirements: null,
  preferredQualifications: null,
};
describe('complete document enrichment', () => {
  it('reads descriptions, inherits headings and retains exact original evidence', async () => {
    const input = {
      ...parts,
      description:
        '<h2>Required qualifications</h2><p>Linux</p><h2>Preferred qualifications</h2><p>Security+ preferred.</p>',
    };
    const result = await extractNlpDocument(input);
    expect(
      result.facts.some(
        (f) => f.category === 'skill' && f.strength === 'required',
      ),
    ).toBe(true);
    expect(
      result.facts.some(
        (f) => f.category === 'certification' && f.strength === 'preferred',
      ),
    ).toBe(true);
    for (const fact of result.facts)
      expect(
        input.description.slice(fact.evidence.charStart, fact.evidence.charEnd),
      ).toBe(fact.evidence.segmentText);
  });
  it('does not infer qualifications from title alone', async () => {
    expect(
      (
        await extractNlpDocument({
          ...parts,
          title: 'Secret clearance Linux engineer',
        })
      ).facts,
    ).toEqual([]);
  });
  it('versioned identity changes for source fields and distinguishes null', () => {
    expect(documentHash(parts)).not.toBe(
      documentHash({ ...parts, requirements: '' }),
    );
    expect(documentHash(parts)).not.toBe(
      documentHash({ ...parts, description: 'Linux' }),
    );
  });
  it('bounds input and honors cancellation', async () => {
    await expect(
      extractNlpDocument({ ...parts, description: 'x'.repeat(50001) }),
    ).rejects.toThrow('limit');
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractNlpDocument(
        { ...parts, description: 'Linux required.' },
        controller.signal,
      ),
    ).rejects.toThrow();
  });
  it('extracts four-year education and obtainable clearance', async () => {
    const result = await extractNlpDocument({
      ...parts,
      description:
        'A four-year degree or comparable experience will be considered. Must be able to obtain a Secret clearance.',
    });
    expect(
      result.facts.some(
        (f) =>
          f.category === 'education' &&
          f.entities.some((e) => e.normalized.includes('bachelor')),
      ),
    ).toBe(true);
    expect(
      result.facts.some(
        (f) => f.category === 'clearance' && f.strength === 'ability-to-obtain',
      ),
    ).toBe(true);
  });
  it('wires additive meta from the extractors (document-v2)', async () => {
    const result = await extractNlpDocument({
      ...parts,
      description: `
<p>Security+ required.</p>
<p>We are an Equal Opportunity Employer.</p>
<p>3-5 years of Linux experience.</p>
<p>This role is fully remote and we require 100% travel.</p>`,
    });

    const certification = result.facts.find(
      (f) => f.category === 'certification',
    );
    const certificationMeta = certification?.meta?.certification;
    expect(typeof certificationMeta?.key).toBe('string');
    expect(typeof certificationMeta?.vendor).toBe('string');
    expect(typeof certificationMeta?.raw).toBe('string');
    expect(typeof certificationMeta?.span?.start).toBe('number');
    expect(typeof certificationMeta?.span?.end).toBe('number');

    const experience = result.facts.find((f) => f.category === 'experience');
    expect(Array.isArray(experience?.meta?.experience?.nestedYears)).toBe(true);
    expect(experience?.meta?.experience).toHaveProperty('context');

    const arrangement = result.facts.find(
      (f) => f.category === 'work-arrangement',
    );
    expect(typeof arrangement?.meta?.location?.arrangementConflict).toBe(
      'boolean',
    );

    const eeo = result.facts.find(
      (f) => f.category === 'legal-eeo-boilerplate',
    );
    expect(eeo?.meta?.isBoilerplate).toBe(true);
  });
  it('emits compensation facts with amount metadata without scoring authority', async () => {
    const result = await extractNlpDocument({
      ...parts,
      description:
        'The salary range is $90,000 to $110,000 per year plus annual bonus.',
    });

    const compensation = result.facts.find(
      (f) => f.category === 'compensation',
    );
    expect(compensation?.strength).toBe('informational');
    expect(compensation?.entities[0]?.normalized).toBe(
      'base-pay:USD:annual:90000-110000',
    );
    expect(compensation?.meta?.compensation).toMatchObject({
      kind: 'base-pay',
      period: 'annual',
      minimum: 90000,
      maximum: 110000,
      currency: 'USD',
    });
    expect(compensation?.conflict.note).toContain('Shadow only');
  });
  it('stays backward compatible with pre-meta envelopes', () => {
    const legacy = {
      version: NLP_EXTRACTION_VERSION,
      generatedAt: '2026-09-10T00:00:00.000Z',
      sourceTextHash: 'legacy-hash',
      segmentation: { segments: [], method: 'segmentation-v1' },
      facts: [
        {
          factId: '0:skill:0',
          category: 'skill',
          strength: 'required',
          entities: [
            {
              id: '0:skill:0:0',
              raw: 'Linux required.',
              normalized: 'Linux',
              type: 'text',
              confidence: 0.9,
              evidenceText: 'Linux required.',
            },
          ],
          confidence: 0.9,
          extractionMethod: 'entity-normalizer',
          extractionVersion: NLP_EXTRACTION_VERSION,
          evidence: {
            segmentText: 'Linux required.',
            sourceField: 'description',
            segmentIndex: 0,
            charStart: 0,
            charEnd: 15,
          },
          conflict: {
            state: 'unknown',
            nature: [],
            deterministicValue: null,
            nlpValue: null,
            note: 'Not reconciled.',
          },
        },
      ],
    };
    expect(jobNlpEnrichmentSchema.safeParse(legacy).success).toBe(true);
  });
});
