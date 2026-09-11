import {
  describeNlpConfidence,
  type JobNlpEnrichment,
  type NlpConflictNature,
  type NlpConflictState,
  type NlpEntityType,
  type NlpExtractionMethod,
  type NlpEvidenceSource,
  type NlpRequirementCategory,
  type NlpRequirementStrength,
} from '../../schemas/job-nlp.js';

// ---------------------------------------------------------------------------
// Stage 15 - read-only NLP debug projection.
//
// The inspector exposes enough evidence to debug extraction without returning
// the complete stored document. User-derived text is redacted before it leaves
// this projection; the inspector has no scoring, eligibility, or write path.
// ---------------------------------------------------------------------------

export const NLP_INSPECTOR_VERSION = 'inspector-v1';

export interface NlpInspectorEvidence {
  segmentText: string;
  sourceField: NlpEvidenceSource;
  segmentIndex: number;
  charStart: number;
  charEnd: number;
}

export interface NlpInspectorEntity {
  id: string;
  raw: string;
  normalized: string;
  type: NlpEntityType;
  confidence: number;
  confidenceBand: string;
  evidenceText: string;
}

export interface NlpInspectorReconciliation {
  state: NlpConflictState;
  nature: NlpConflictNature[];
  deterministicValue: string | null;
  nlpValue: string | null;
  note: string | null;
}

export interface NlpInspectorFact {
  factId: string;
  category: NlpRequirementCategory;
  strength: NlpRequirementStrength;
  entities: NlpInspectorEntity[];
  confidence: number;
  confidenceBand: string;
  evidence: NlpInspectorEvidence;
  extractionMethod: NlpExtractionMethod;
  extractionVersion: string;
  reconciliation: NlpInspectorReconciliation;
}

export interface NlpInspectorConfidenceSummary {
  average: number;
  minimum: number;
  maximum: number;
}

export interface NlpInspection {
  inspectorVersion: typeof NLP_INSPECTOR_VERSION;
  jobId: string;
  generatedAt: string;
  sourceTextHash: string;
  extractionVersion: string;
  segmentationMethod: JobNlpEnrichment['segmentation']['method'];
  segmentCount: number;
  factCount: number;
  redactedValueCount: number;
  confidence: NlpInspectorConfidenceSummary;
  method: 'inspector';
  facts: NlpInspectorFact[];
}

export function inspectJobNlp(
  jobId: string,
  enrichment: JobNlpEnrichment,
): NlpInspection {
  let redactedValueCount = 0;
  const facts = [...enrichment.facts].sort(compareFacts).map((fact) => {
    const projected = projectFact(fact);
    redactedValueCount += projected.redactedValueCount;
    return projected.fact;
  });
  const confidenceValues = facts.map((fact) => fact.confidence);

  return {
    inspectorVersion: NLP_INSPECTOR_VERSION,
    jobId,
    generatedAt: enrichment.generatedAt,
    sourceTextHash: enrichment.sourceTextHash,
    extractionVersion: enrichment.version,
    segmentationMethod: enrichment.segmentation.method,
    segmentCount: enrichment.segmentation.segments.length,
    factCount: facts.length,
    redactedValueCount,
    confidence: summarizeConfidence(confidenceValues),
    method: 'inspector',
    facts,
  };
}

interface ProjectedFact {
  fact: NlpInspectorFact;
  redactedValueCount: number;
}

function projectFact(fact: JobNlpEnrichment['facts'][number]): ProjectedFact {
  let redactedValueCount = 0;
  const redact = (value: string): string => {
    const result = redactSensitiveText(value);
    redactedValueCount += result.replacements;
    return result.value;
  };
  const redactNullable = (value: string | null): string | null =>
    value === null ? null : redact(value);

  const entities = [...fact.entities].sort(compareEntities).map((entity) => ({
    id: redact(entity.id),
    raw: redact(entity.raw),
    normalized: redact(entity.normalized),
    type: entity.type,
    confidence: entity.confidence,
    confidenceBand: describeNlpConfidence(entity.confidence),
    evidenceText: redact(entity.evidenceText),
  }));

  return {
    fact: {
      factId: redact(fact.factId),
      category: fact.category,
      strength: fact.strength,
      entities,
      confidence: fact.confidence,
      confidenceBand: describeNlpConfidence(fact.confidence),
      evidence: {
        segmentText: redact(fact.evidence.segmentText),
        sourceField: fact.evidence.sourceField,
        segmentIndex: fact.evidence.segmentIndex,
        charStart: fact.evidence.charStart,
        charEnd: fact.evidence.charEnd,
      },
      extractionMethod: fact.extractionMethod,
      extractionVersion: fact.extractionVersion,
      reconciliation: {
        state: fact.conflict.state,
        nature: [...fact.conflict.nature].sort(),
        deterministicValue: redactNullable(fact.conflict.deterministicValue),
        nlpValue: redactNullable(fact.conflict.nlpValue),
        note: redactNullable(fact.conflict.note),
      },
    },
    redactedValueCount,
  };
}

function compareFacts(
  left: JobNlpEnrichment['facts'][number],
  right: JobNlpEnrichment['facts'][number],
): number {
  return (
    left.evidence.segmentIndex - right.evidence.segmentIndex ||
    left.evidence.charStart - right.evidence.charStart ||
    left.evidence.charEnd - right.evidence.charEnd ||
    left.factId.localeCompare(right.factId)
  );
}

function compareEntities(
  left: JobNlpEnrichment['facts'][number]['entities'][number],
  right: JobNlpEnrichment['facts'][number]['entities'][number],
): number {
  return (
    left.id.localeCompare(right.id) ||
    left.normalized.localeCompare(right.normalized) ||
    left.raw.localeCompare(right.raw)
  );
}

function summarizeConfidence(
  values: readonly number[],
): NlpInspectorConfidenceSummary {
  if (values.length === 0) {
    return { average: 0, minimum: 0, maximum: 0 };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    average: total / values.length,
    minimum: Math.min(...values),
    maximum: Math.max(...values),
  };
}

interface RedactionResult {
  value: string;
  replacements: number;
}

export function redactSensitiveText(value: string): RedactionResult {
  let replacements = 0;
  let redacted = value;
  const replace = (pattern: RegExp, replacement: string): void => {
    redacted = redacted.replace(pattern, () => {
      replacements += 1;
      return replacement;
    });
  };

  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]');
  replace(
    /(?<![A-Za-z0-9])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g,
    '[phone redacted]',
  );
  replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn redacted]');
  replace(
    /\b(?:api[_ -]?key|access[_ -]?token|auth[_ -]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
    '[secret redacted]',
  );
  replace(
    /\blinkedin\.com\/in\/[\w-]+\b/gi,
    'linkedin.com/in/[profile redacted]',
  );
  replace(
    /\b\d{1,5}\s+[A-Za-z]+(?:\s+[A-Za-z]+){0,3}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct)\b/gi,
    '[address redacted]',
  );

  return { value: redacted, replacements };
}
