import { describe, expect, it } from 'vitest';

import {
  NLP_EXTRACTION_VERSION,
  NLP_ROLE_DETAILS_RELATIONSHIP,
  describeNlpConfidence,
  jobNlpEnrichmentSchema,
  nlpConflictNatureSchema,
  nlpEvidenceSchema,
  nlpFactSchema,
  nlpRequirementCategorySchema,
  nlpRequirementStrengthSchema,
  type JobNlpEnrichment,
  type NlpFact,
} from '../src/schemas/job-nlp.js';
import { ROLE_DETAILS_VERSION } from '../src/schemas/role-details.js';

function fact(overrides: Partial<NlpFact> = {}): NlpFact {
  return {
    factId: 'fact-1',
    category: 'certification',
    strength: 'preferred',
    entities: [
      {
        id: 'entity-1',
        raw: 'Security+',
        normalized: 'Security+',
        type: 'certification',
        confidence: 0.96,
        evidenceText: 'Security+ preferred.',
      },
    ],
    confidence: 0.96,
    extractionMethod: 'modality-classifier',
    extractionVersion: NLP_EXTRACTION_VERSION,
    evidence: {
      segmentText: 'Security+ preferred.',
      sourceField: 'description',
      segmentIndex: 2,
      charStart: 0,
      charEnd: 19,
    },
    conflict: {
      state: 'unknown',
      nature: [],
      deterministicValue: null,
      nlpValue: null,
      note: null,
    },
    ...overrides,
  };
}

function enrichment(
  overrides: {
    facts?: NlpFact[];
    segments?: JobNlpEnrichment['segmentation']['segments'];
  } = {},
): JobNlpEnrichment {
  return {
    version: NLP_EXTRACTION_VERSION,
    generatedAt: '2026-09-10T00:00:00.000Z',
    sourceTextHash: 'a'.repeat(64),
    segmentation: {
      segments: overrides.segments ?? [
        {
          index: 2,
          text: 'Security+ preferred.',
          normalized: 'security+ preferred.',
          kind: 'sentence',
          sourceField: 'description',
          charStart: 0,
          charEnd: 19,
        },
      ],
      method: 'segmentation-v1',
    },
    facts: overrides.facts ?? [fact()],
  };
}

describe('job-nlp contract', () => {
  describe('versioning', () => {
    it('is independently versioned as job-nlp-v1', () => {
      expect(NLP_EXTRACTION_VERSION).toBe('job-nlp-v1');
    });

    it('is distinct from the authoritative role-details version', () => {
      expect(NLP_EXTRACTION_VERSION).not.toBe(ROLE_DETAILS_VERSION);
      expect(ROLE_DETAILS_VERSION).toBe('role-details-v2');
    });

    it('declares the additive-shadow relationship to role details', () => {
      expect(NLP_ROLE_DETAILS_RELATIONSHIP).toBe('additive-shadow');
    });
  });

  describe('category and strength are separate axes', () => {
    it('allows any category with any strength', () => {
      for (const category of nlpRequirementCategorySchema.options) {
        for (const strength of nlpRequirementStrengthSchema.options) {
          const parsed = nlpFactSchema.safeParse(fact({ category, strength }));
          expect(parsed.success).toBe(true);
        }
      }
    });

    it('rejects an invented fused strength value', () => {
      const parsed = nlpFactSchema.safeParse(
        fact({ strength: 'preferred-certification' as never }),
      );
      expect(parsed.success).toBe(false);
    });

    it('rejects an unknown category', () => {
      const parsed = nlpFactSchema.safeParse(
        fact({ category: 'mystery' as never }),
      );
      expect(parsed.success).toBe(false);
    });
  });

  describe('confidence', () => {
    it('rejects confidence outside the 0..1 range', () => {
      const high = nlpFactSchema.safeParse(fact({ confidence: 1.2 }));
      const low = nlpFactSchema.safeParse(fact({ confidence: -0.1 }));
      expect(high.success).toBe(false);
      expect(low.success).toBe(false);
    });

    it('accepts boundary confidence values', () => {
      expect(nlpFactSchema.safeParse(fact({ confidence: 0 })).success).toBe(
        true,
      );
      expect(nlpFactSchema.safeParse(fact({ confidence: 1 })).success).toBe(
        true,
      );
    });

    it('labels confidence bands deterministically', () => {
      expect(describeNlpConfidence(0.95)).toBe('high');
      expect(describeNlpConfidence(0.75)).toBe('moderate');
      expect(describeNlpConfidence(0.5)).toBe('low');
      expect(describeNlpConfidence(0.1)).toBe('very-low');
    });
  });

  describe('evidence provenance', () => {
    it('requires letter-for-letter source text', () => {
      const parsed = nlpEvidenceSchema.safeParse({
        segmentText: '',
        sourceField: 'description',
        segmentIndex: 0,
        charStart: 0,
        charEnd: 5,
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects an inverted character span', () => {
      const parsed = nlpFactSchema.safeParse(
        fact({
          evidence: {
            segmentText: 'Security+ preferred.',
            sourceField: 'description',
            segmentIndex: 2,
            charStart: 19,
            charEnd: 0,
          },
        }),
      );
      expect(parsed.success).toBe(false);
    });
  });

  describe('conflict representation', () => {
    it('supports every reconciliation state', () => {
      for (const state of [
        'agreement',
        'deterministic-only',
        'nlp-only',
        'conflict',
        'unknown',
      ]) {
        const parsed = nlpFactSchema.safeParse(
          fact({ conflict: { ...fact().conflict, state: state as never } }),
        );
        expect(parsed.success).toBe(true);
      }
    });

    it('supports conflict-nature classification', () => {
      expect(nlpConflictNatureSchema.options).toContain('modality');
      expect(nlpConflictNatureSchema.options).toContain(
        'missing-deterministic',
      );
    });
  });

  describe('enrichment envelope', () => {
    it('accepts a fully-formed enrichment document', () => {
      const parsed = jobNlpEnrichmentSchema.safeParse(enrichment());
      expect(parsed.success).toBe(true);
    });

    it('rejects a stale extraction version', () => {
      const parsed = jobNlpEnrichmentSchema.safeParse({
        ...enrichment(),
        version: 'job-nlp-v0',
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects an invalid segment span', () => {
      const bad = enrichment({
        segments: [
          {
            index: 2,
            text: 'Security+ preferred.',
            normalized: 'security+ preferred.',
            kind: 'sentence',
            sourceField: 'description',
            charStart: 5,
            charEnd: 3,
          },
        ],
      });
      expect(jobNlpEnrichmentSchema.safeParse(bad).success).toBe(false);
    });

    it('rejects unknown extraction methods', () => {
      const parsed = nlpFactSchema.safeParse(
        fact({ extractionMethod: 'llm-call' as never }),
      );
      expect(parsed.success).toBe(false);
    });
  });
});
