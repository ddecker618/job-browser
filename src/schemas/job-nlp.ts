import { z } from 'zod';

// ---------------------------------------------------------------------------
// Versioned NLP enrichment contract (shadow mode).
//
// This contract is INDEPENDENT of role-details-v2 (`ROLE_DETAILS_VERSION`).
// The existing deterministic RoleDetails document and the production scoring
// pipeline remain authoritative; NLP enrichment is additive and shadow-only:
// it may analyze, classify, extract, normalize, persist, compare, and expose
// diagnostics, but it MUST NOT alter production score, eligibility, ranking,
// filtering, or removal/archive behavior.
//
// Versioning: `NLP_EXTRACTION_VERSION` changes only when the NLP extraction
// contract or its determinism semantics change. Consumers must treat a stored
// version mismatch as stale (see Stage 14 reprocessing).
//
// Dimension separation: requirement CATEGORY and requirement STRENGTH are
// independent axes. A statement is classified with exactly one strength and
// one or more categories (multi-label), never fused into a single
// "preferred-certification" pseudo-category.
//
// Explainability: every material fact must be traceable to its exact source
// evidence, extraction method, extraction version, and confidence.
// ---------------------------------------------------------------------------

export const NLP_EXTRACTION_VERSION = 'job-nlp-v1';

// The existing role-details document remains authoritative and unchanged by
// NLP extraction. NLP enrichment is an additive shadow projection.
export const NLP_ROLE_DETAILS_RELATIONSHIP = 'additive-shadow';

export const nlpRequirementCategorySchema = z.enum([
  'skill',
  'experience',
  'education',
  'certification',
  'clearance',
  'citizenship',
  'location',
  'work-arrangement',
  'travel',
  'schedule',
  'employment-type',
  'responsibility',
  'compensation',
  'benefit',
  'company-description',
  'legal-eeo-boilerplate',
  'unknown',
]);

export const nlpRequirementStrengthSchema = z.enum([
  'required',
  'preferred',
  'nice-to-have',
  'ability-to-obtain',
  'required-after-hire',
  'equivalent-accepted',
  'informational',
  'unknown',
]);

export const nlpExtractionMethodSchema = z.enum([
  'deterministic-pattern',
  'segment-rules',
  'category-classifier',
  'modality-classifier',
  'entity-normalizer',
  'reconciliation',
]);

export const nlpSegmentKindSchema = z.enum([
  'sentence',
  'bullet',
  'heading',
  'fragment',
  'list-item',
  'unknown',
]);

export const nlpConflictStateSchema = z.enum([
  'agreement',
  'deterministic-only',
  'nlp-only',
  'conflict',
  'unknown',
]);

export const nlpConflictNatureSchema = z.enum([
  'value',
  'modality',
  'entity',
  'scope',
  'missing-deterministic',
  'missing-nlp',
]);

export const nlpEvidenceSourceSchema = z.enum([
  'title',
  'location',
  'description',
  'requirements',
  'preferredQualifications',
  'other',
]);

export const nlpEntityTypeSchema = z.enum([
  'text',
  'degree-level',
  'years',
  'years-range',
  'percentage',
  'certification',
  'clearance-level',
  'state',
  'city',
  'boolean',
  'unknown',
]);

export const nlpEvidenceSchema = z
  .strictObject({
    segmentText: z.string().trim().min(1),
    sourceField: nlpEvidenceSourceSchema,
    segmentIndex: z.number().int().nonnegative(),
    charStart: z.number().int().nonnegative(),
    charEnd: z.number().int().nonnegative(),
  })
  .superRefine((evidence, context) => {
    if (evidence.charEnd < evidence.charStart) {
      context.addIssue({
        code: 'custom',
        message: 'charEnd must be >= charStart',
        path: ['charEnd'],
      });
    }
  });

export const nlpEntitySchema = z.strictObject({
  id: z.string().trim().min(1),
  raw: z.string().trim().min(1),
  normalized: z.string().trim().min(1),
  type: nlpEntityTypeSchema,
  confidence: z.number().min(0).max(1),
  evidenceText: z.string().trim().min(1),
});

// Optional per-fact metadata captured from the extraction pipeline (Phase 3
// envelope wiring). Additive: older persisted envelopes without `meta` remain
// valid and parse correctly. Metadata is shadow evidence and is never used by
// a production decide path.
export const nlpFactMetaSchema = z
  .object({
    isBoilerplate: z.boolean().optional(),
    preserveRequirement: z.boolean().optional(),
    boilerplateDisposition: z
      .enum(['boilerplate', 'requirement', 'mixed', 'unknown'])
      .optional(),
    experience: z
      .object({
        nestedYears: z
          .array(
            z.object({
              minimum: z.number(),
              maximum: z.number().nullable(),
              modifier: z.string(),
              domain: z.string().nullable(),
            }),
          )
          .optional(),
        context: z.string().nullable().optional(),
      })
      .optional(),
    clearance: z
      .object({
        teamContext: z.boolean().optional(),
      })
      .optional(),
    certification: z
      .object({
        key: z.string().optional(),
        vendor: z.string().optional(),
        raw: z.string().optional(),
        span: z
          .strictObject({
            start: z.number().int().nonnegative(),
            end: z.number().int().nonnegative(),
          })
          .optional(),
      })
      .optional(),
    location: z
      .object({
        arrangementConflict: z.boolean().optional(),
        remoteDenied: z.boolean().optional(),
        remoteScope: z
          .object({
            kind: z
              .enum(['nationwide', 'state-limited', 'unspecified'])
              .optional(),
            states: z.array(z.string()).optional(),
            excludedStates: z.array(z.string()).optional(),
          })
          .optional(),
        commute: z
          .object({
            required: z.boolean().optional(),
            miles: z.number().nullable().optional(),
            raw: z.string().nullable().optional(),
          })
          .optional(),
        onsiteFrequency: z
          .enum(['occasional', 'regular', 'unknown'])
          .optional(),
        relocation: z
          .object({
            status: z
              .enum([
                'required',
                'preferred',
                'available',
                'not-available',
                'unknown',
              ])
              .optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .strict();

export const nlpFactSchema = z.strictObject({
  factId: z.string().trim().min(1),
  category: nlpRequirementCategorySchema,
  strength: nlpRequirementStrengthSchema,
  entities: z.array(nlpEntitySchema),
  confidence: z.number().min(0).max(1),
  extractionMethod: nlpExtractionMethodSchema,
  extractionVersion: z.literal(NLP_EXTRACTION_VERSION),
  evidence: nlpEvidenceSchema,
  conflict: z.strictObject({
    state: nlpConflictStateSchema,
    nature: z.array(nlpConflictNatureSchema),
    deterministicValue: z.string().nullable(),
    nlpValue: z.string().nullable(),
    note: z.string().nullable(),
  }),
  meta: nlpFactMetaSchema.optional(),
});

export const nlpSegmentSchema = z
  .strictObject({
    index: z.number().int().nonnegative(),
    text: z.string().trim().min(1),
    normalized: z.string(),
    kind: nlpSegmentKindSchema,
    sourceField: nlpEvidenceSourceSchema,
    charStart: z.number().int().nonnegative(),
    charEnd: z.number().int().nonnegative(),
  })
  .superRefine((segment, context) => {
    if (segment.charEnd < segment.charStart) {
      context.addIssue({
        code: 'custom',
        message: 'charEnd must be >= charStart',
        path: ['charEnd'],
      });
    }
  });

export const jobNlpEnrichmentSchema = z.strictObject({
  version: z.literal(NLP_EXTRACTION_VERSION),
  generatedAt: z.string(),
  sourceTextHash: z.string(),
  segmentation: z.strictObject({
    segments: z.array(nlpSegmentSchema),
    method: z.literal('segmentation-v1'),
  }),
  facts: z.array(nlpFactSchema),
});

export type NlpRequirementCategory = z.infer<
  typeof nlpRequirementCategorySchema
>;
export type NlpRequirementStrength = z.infer<
  typeof nlpRequirementStrengthSchema
>;
export type NlpExtractionMethod = z.infer<typeof nlpExtractionMethodSchema>;
export type NlpSegmentKind = z.infer<typeof nlpSegmentKindSchema>;
export type NlpConflictState = z.infer<typeof nlpConflictStateSchema>;
export type NlpConflictNature = z.infer<typeof nlpConflictNatureSchema>;
export type NlpEvidenceSource = z.infer<typeof nlpEvidenceSourceSchema>;
export type NlpEntityType = z.infer<typeof nlpEntityTypeSchema>;
export type NlpEvidence = z.infer<typeof nlpEvidenceSchema>;
export type NlpEntity = z.infer<typeof nlpEntitySchema>;
export type NlpFact = z.infer<typeof nlpFactSchema>;
export type NlpFactMeta = z.infer<typeof nlpFactMetaSchema>;
export type NlpSegment = z.infer<typeof nlpSegmentSchema>;
export type JobNlpEnrichment = z.infer<typeof jobNlpEnrichmentSchema>;

// Confidence is a 0..1 reliability score for a given extraction method and
// evidence, NOT a probability and NOT a qualification-claim probability.
export function describeNlpConfidence(confidence: number): string {
  if (confidence >= 0.9) return 'high';
  if (confidence >= 0.7) return 'moderate';
  if (confidence >= 0.4) return 'low';
  return 'very-low';
}
