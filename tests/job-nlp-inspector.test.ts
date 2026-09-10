import { describe, expect, it } from 'vitest';

import {
  NLP_INSPECTOR_VERSION,
  inspectJobNlp,
} from '../src/intelligence/nlp/inspector.js';
import type { JobNlpEnrichment, NlpFact } from '../src/schemas/job-nlp.js';

function fact(
  factId: string,
  segmentIndex: number,
  confidence: number,
  overrides: Partial<NlpFact> = {},
): NlpFact {
  return {
    factId,
    category: 'skill',
    strength: 'required',
    entities: [
      {
        id: 'skill:typescript',
        raw: 'TypeScript',
        normalized: 'typescript',
        type: 'text',
        confidence,
        evidenceText: 'TypeScript',
      },
    ],
    confidence,
    extractionMethod: 'entity-normalizer',
    extractionVersion: 'job-nlp-v1',
    evidence: {
      segmentText: 'TypeScript required.',
      sourceField: 'requirements',
      segmentIndex,
      charStart: 0,
      charEnd: 20,
    },
    conflict: {
      state: 'agreement',
      nature: [],
      deterministicValue: 'TypeScript',
      nlpValue: 'TypeScript',
      note: null,
    },
    ...overrides,
  };
}

function enrichment(facts: NlpFact[]): JobNlpEnrichment {
  return {
    version: 'job-nlp-v1',
    generatedAt: '2026-01-02T00:00:00.000Z',
    sourceTextHash: 'hash-v1',
    segmentation: {
      segments: [
        {
          index: 0,
          text: 'TypeScript required.',
          normalized: 'typescript required.',
          kind: 'sentence',
          sourceField: 'requirements',
          charStart: 0,
          charEnd: 20,
        },
      ],
      method: 'segmentation-v1',
    },
    facts,
  };
}

describe('NLP intelligence inspector', () => {
  it('projects evidence, dimensions, entities, methods, versions, and conflicts', () => {
    const result = inspectJobNlp(
      'job-1',
      enrichment([
        fact('fact-2', 1, 0.8, {
          category: 'certification',
          strength: 'preferred',
          extractionMethod: 'category-classifier',
          conflict: {
            state: 'conflict',
            nature: ['value', 'entity'],
            deterministicValue: 'CISSP',
            nlpValue: 'Security+',
            note: 'Interpretations differ.',
          },
        }),
      ]),
    );

    expect(result).toMatchObject({
      inspectorVersion: NLP_INSPECTOR_VERSION,
      jobId: 'job-1',
      sourceTextHash: 'hash-v1',
      extractionVersion: 'job-nlp-v1',
      segmentationMethod: 'segmentation-v1',
      segmentCount: 1,
      factCount: 1,
      method: 'inspector',
    });
    expect(result.facts[0]).toMatchObject({
      factId: 'fact-2',
      category: 'certification',
      strength: 'preferred',
      confidence: 0.8,
      confidenceBand: 'moderate',
      extractionMethod: 'category-classifier',
      extractionVersion: 'job-nlp-v1',
      evidence: {
        sourceField: 'requirements',
        segmentIndex: 1,
      },
      reconciliation: {
        state: 'conflict',
        nature: ['entity', 'value'],
        deterministicValue: 'CISSP',
        nlpValue: 'Security+',
      },
    });
    expect(result.facts[0]?.entities[0]).toMatchObject({
      id: 'skill:typescript',
      confidenceBand: 'moderate',
    });
  });

  it('redacts personal and secret values in every user-derived text field', () => {
    const sensitive = fact('fact-sensitive', 0, 0.95, {
      entities: [
        {
          id: 'email:jane@example.com',
          raw: 'jane@example.com',
          normalized: 'jane@example.com',
          type: 'text',
          confidence: 0.95,
          evidenceText: 'Call 555-867-5309 at 123 Main Street',
        },
      ],
      evidence: {
        segmentText:
          'Contact jane@example.com at 555-867-5309; password=topsecret; 123 Main Street.',
        sourceField: 'description',
        segmentIndex: 0,
        charStart: 0,
        charEnd: 90,
      },
      conflict: {
        state: 'conflict',
        nature: ['value'],
        deterministicValue: 'jane@example.com',
        nlpValue: 'linkedin.com/in/jane-doe',
        note: 'secret: topsecret',
      },
    });

    const result = inspectJobNlp('job-sensitive', enrichment([sensitive]));
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('jane@example.com');
    expect(serialized).not.toContain('555-867-5309');
    expect(serialized).not.toContain('topsecret');
    expect(serialized).not.toContain('jane-doe');
    expect(serialized).not.toContain('123 Main Street');
    expect(serialized).toContain('[email redacted]');
    expect(serialized).toContain('[phone redacted]');
    expect(serialized).toContain('[secret redacted]');
    expect(serialized).toContain('[address redacted]');
    expect(result.redactedValueCount).toBeGreaterThan(0);
  });

  it('sorts facts and entities deterministically without mutating the enrichment', () => {
    const first = fact('fact-z', 2, 0.9, {
      entities: [
        {
          id: 'skill:z',
          raw: 'Z',
          normalized: 'z',
          type: 'text',
          confidence: 0.9,
          evidenceText: 'Z',
        },
        {
          id: 'skill:a',
          raw: 'A',
          normalized: 'a',
          type: 'text',
          confidence: 0.9,
          evidenceText: 'A',
        },
      ],
    });
    const second = fact('fact-a', 0, 0.6);
    const document = enrichment([first, second]);
    const originalFactOrder = document.facts.map((item) => item.factId);
    const originalEntityOrder = document.facts[0]?.entities.map(
      (item) => item.id,
    );

    const result = inspectJobNlp('job-ordered', document);

    expect(result.facts.map((item) => item.factId)).toEqual([
      'fact-a',
      'fact-z',
    ]);
    expect(result.facts[1]?.entities.map((item) => item.id)).toEqual([
      'skill:a',
      'skill:z',
    ]);
    expect(document.facts.map((item) => item.factId)).toEqual(
      originalFactOrder,
    );
    expect(document.facts[0]?.entities.map((item) => item.id)).toEqual(
      originalEntityOrder,
    );
  });

  it('returns a stable empty confidence summary for an enrichment with no facts', () => {
    const result = inspectJobNlp('job-empty', enrichment([]));

    expect(result.factCount).toBe(0);
    expect(result.facts).toEqual([]);
    expect(result.confidence).toEqual({
      average: 0,
      minimum: 0,
      maximum: 0,
    });
    expect(result.redactedValueCount).toBe(0);
  });
});
