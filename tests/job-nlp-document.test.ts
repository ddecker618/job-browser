import { describe, expect, it } from 'vitest';
import {
  documentHash,
  extractNlpDocument,
} from '../src/intelligence/nlp/document.js';
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
});
