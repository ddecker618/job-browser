import {
  NLP_EXTRACTION_VERSION,
  type NlpConflictNature,
  type NlpConflictState,
  type NlpRequirementCategory,
  type NlpRequirementStrength,
} from '../../schemas/job-nlp.js';
import { normalizeText } from '../../utilities/normalization.js';

// ---------------------------------------------------------------------------
// Stage 12 - deterministic and NLP reconciliation.
//
// Reconciliation preserves both interpretations and reports disagreement. It
// is diagnostic/shadow-only: deterministic authority is exposed for callers,
// but this module never mutates production eligibility, scoring, or ranking.
// ---------------------------------------------------------------------------

export const RECONCILIATION_INTELLIGENCE_VERSION = 'reconciliation-v1';

export interface ReconciliationSide {
  value: string | null;
  strength: NlpRequirementStrength | null;
  entity: string | null;
  scope: string | null;
}

export interface ReconciliationInput {
  factId: string;
  category: NlpRequirementCategory;
  deterministic: ReconciliationSide;
  nlp: ReconciliationSide;
}

export type ReconciliationAuthority = 'deterministic' | 'nlp' | 'none';

export interface ReconciliationResult {
  factId: string;
  category: NlpRequirementCategory;
  state: NlpConflictState;
  nature: NlpConflictNature[];
  deterministic: ReconciliationSide;
  nlp: ReconciliationSide;
  deterministicValue: string | null;
  nlpValue: string | null;
  authority: ReconciliationAuthority;
  authoritativeValue: string | null;
  confidence: number;
  note: string;
  method: 'reconciliation';
  version: typeof NLP_EXTRACTION_VERSION;
  reconciliationVersion: typeof RECONCILIATION_INTELLIGENCE_VERSION;
}

interface Dimension {
  nature: Extract<NlpConflictNature, 'value' | 'modality' | 'entity' | 'scope'>;
  deterministic: string | null;
  nlp: string | null;
}

export function reconcileFact(
  input: ReconciliationInput,
): ReconciliationResult {
  const dimensions: readonly Dimension[] = [
    {
      nature: 'value',
      deterministic: input.deterministic.value,
      nlp: input.nlp.value,
    },
    {
      nature: 'modality',
      deterministic: input.deterministic.strength,
      nlp: input.nlp.strength,
    },
    {
      nature: 'entity',
      deterministic: input.deterministic.entity,
      nlp: input.nlp.entity,
    },
    {
      nature: 'scope',
      deterministic: input.deterministic.scope,
      nlp: input.nlp.scope,
    },
  ];

  const nature: NlpConflictNature[] = [];
  for (const dimension of dimensions) {
    if (dimension.deterministic === null && dimension.nlp === null) continue;
    if (dimension.deterministic === null) {
      nature.push('missing-deterministic');
      continue;
    }
    if (dimension.nlp === null) {
      nature.push('missing-nlp');
      continue;
    }
    if (!sameValue(dimension.deterministic, dimension.nlp)) {
      nature.push(dimension.nature);
    }
  }

  const deterministicPresent = hasData(input.deterministic);
  const nlpPresent = hasData(input.nlp);
  const hasDimensionConflict = nature.some(
    (item) =>
      item === 'value' ||
      item === 'modality' ||
      item === 'entity' ||
      item === 'scope',
  );
  const state = determineState(
    deterministicPresent,
    nlpPresent,
    nature.length > 0,
    hasDimensionConflict,
  );
  const authority: ReconciliationAuthority = deterministicPresent
    ? 'deterministic'
    : nlpPresent
      ? 'nlp'
      : 'none';
  const authoritativeValue =
    input.deterministic.value ?? input.nlp.value ?? null;

  return {
    factId: input.factId,
    category: input.category,
    state,
    nature: [...new Set(nature)],
    deterministic: input.deterministic,
    nlp: input.nlp,
    deterministicValue: input.deterministic.value,
    nlpValue: input.nlp.value,
    authority,
    authoritativeValue,
    confidence: confidenceFor(state),
    note: noteFor(state, nature),
    method: 'reconciliation',
    version: NLP_EXTRACTION_VERSION,
    reconciliationVersion: RECONCILIATION_INTELLIGENCE_VERSION,
  };
}

export function reconcileFacts(
  inputs: readonly ReconciliationInput[],
): ReconciliationResult[] {
  return inputs.map((input) => reconcileFact(input));
}

function determineState(
  deterministicPresent: boolean,
  nlpPresent: boolean,
  hasMissingDimension: boolean,
  hasDimensionConflict: boolean,
): NlpConflictState {
  if (
    hasDimensionConflict ||
    (deterministicPresent && nlpPresent && hasMissingDimension)
  ) {
    return 'conflict';
  }
  if (deterministicPresent && nlpPresent) return 'agreement';
  if (deterministicPresent) return 'deterministic-only';
  if (nlpPresent) return 'nlp-only';
  return 'unknown';
}

function hasData(side: ReconciliationSide): boolean {
  return (
    side.value !== null ||
    side.strength !== null ||
    side.entity !== null ||
    side.scope !== null
  );
}

function sameValue(left: string, right: string): boolean {
  return normalizeText(left) === normalizeText(right);
}

function confidenceFor(state: NlpConflictState): number {
  switch (state) {
    case 'agreement':
      return 0.95;
    case 'conflict':
      return 0.85;
    case 'deterministic-only':
    case 'nlp-only':
      return 0.75;
    case 'unknown':
      return 0.4;
  }
}

function noteFor(
  state: NlpConflictState,
  nature: readonly NlpConflictNature[],
): string {
  switch (state) {
    case 'agreement':
      return 'Deterministic and NLP interpretations agree.';
    case 'deterministic-only':
      return 'Only the deterministic interpretation is present; preserve it as authoritative.';
    case 'nlp-only':
      return 'Only the NLP interpretation is present; retain it as shadow evidence.';
    case 'conflict':
      return `Interpretations differ in ${nature.join(', ')}; deterministic authority remains unchanged.`;
    case 'unknown':
      return 'Neither interpretation is present.';
  }
}
