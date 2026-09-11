// ---------------------------------------------------------------------------
// Phase 2 - production trust levels for NLP promotion.
//
// These named trust levels map 1:1 onto the numeric Level 0-4 ladder defined
// in docs/NLP_PROMOTION_DESIGN.md and are documented in
// docs/NLP_TRUST_LEVELS.md. Promotion is monotonic (one step at a time) and
// fail-closed: a target level is reachable only when every piece of that
// level's required evidence is present.
//
// THIS SPRINT NEVER PROMOTES ABOVE 'enrichment' (Level 2). Level 3 ('scoring')
// and Level 4 ('hard-gate') require a new separate authorization. No trust
// level may ever weaken a deterministic eligibility gate; hard gates stay
// authoritative at every level.
// ---------------------------------------------------------------------------

export const NLP_TRUST_LEVELS = [
  'shadow',
  'explanation',
  'enrichment',
  'scoring',
  'hard-gate',
] as const;

export type NlpProductionLevel = (typeof NLP_TRUST_LEVELS)[number];

// Monotonic rank: shadow(0) -> explanation(1) -> enrichment(2) -> scoring(3)
// -> hard-gate(4).
export const NLP_TRUST_LEVEL_RANK: Record<NlpProductionLevel, number> = {
  shadow: 0,
  explanation: 1,
  enrichment: 2,
  scoring: 3,
  'hard-gate': 4,
};

// Hard ceiling for this authorized sprint; going beyond requires a new
// authorization.
export const SPRINT_MAXIMUM_LEVEL: NlpProductionLevel = 'enrichment';

const SHADOW_EVIDENCE = [
  'acceptance gate passed',
  'persistence versioning works',
  'inspector redacts PII',
  'conflicts remain visible',
] as const;

const EXPLANATION_EVIDENCE = [
  ...SHADOW_EVIDENCE,
  'per-fact interpretation label',
  'evidence spans rendered',
  'deterministic value marked authoritative on conflict',
] as const;

const ENRICHMENT_EVIDENCE = [
  ...EXPLANATION_EVIDENCE,
  'content-hash + extraction-version cache',
  'bounded background materialization',
  'rollback flag restores prior behavior exactly',
] as const;

const SCORING_EVIDENCE = [
  ...ENRICHMENT_EVIDENCE,
  'score cap below any eligibility boundary',
  'production-vs-shadow diff gate',
  'dual-side consistency (deterministic + NLP)',
] as const;

const HARD_GATE_EVIDENCE = [
  ...SCORING_EVIDENCE,
  'explicit field-specific authorization',
  'user-visible correction and audit path',
] as const;

export interface NlpTrustLevelDescriptor {
  level: number;
  key: NlpProductionLevel;
  label: string;
  permittedConsumers: string;
  requiredEvidence: readonly string[];
}

export const NLP_TRUST_LEVEL_DESCRIPTORS: Record<
  NlpProductionLevel,
  NlpTrustLevelDescriptor
> = {
  shadow: {
    level: 0,
    key: 'shadow',
    label: 'SHADOW',
    permittedConsumers:
      'persistence, diagnostics, off-screen comparison; never rendered opaquely and never consulted by production decide paths',
    requiredEvidence: SHADOW_EVIDENCE,
  },
  explanation: {
    level: 1,
    key: 'explanation',
    label: 'EXPLANATION',
    permittedConsumers:
      'typed add-on panels attached to production display; every claim carries an interpretation label and evidence span; no ranking or gate effect',
    requiredEvidence: EXPLANATION_EVIDENCE,
  },
  enrichment: {
    level: 2,
    key: 'enrichment',
    label: 'ENRICHMENT',
    permittedConsumers:
      'additive relevance index, search tie-break, and diagnostics; indexing/relevance only, behind a flag off by default; never scores or gates',
    requiredEvidence: ENRICHMENT_EVIDENCE,
  },
  scoring: {
    level: 3,
    key: 'scoring',
    label: 'SCORING',
    permittedConsumers:
      'bounded, capped contribution to a displayed recommendation metric only; requires new authorization; never an eligibility gate',
    requiredEvidence: SCORING_EVIDENCE,
  },
  'hard-gate': {
    level: 4,
    key: 'hard-gate',
    label: 'HARD_GATE',
    permittedConsumers:
      'out of scope for this program; would override deterministic eligibility and requires the strongest evidence, a user-visible audit path, and a new authorization',
    requiredEvidence: HARD_GATE_EVIDENCE,
  },
};

export interface NlpPromotionRequest {
  from: NlpProductionLevel;
  to: NlpProductionLevel;
  evidence: readonly string[];
}

export interface NlpPromotionDecision {
  allowed: boolean;
  reasons: readonly string[];
}

// Monotonic, evidence-gated, one-step-at-a-time, fail-closed promotion check.
export function canPromoteNlpLevel(
  request: NlpPromotionRequest,
  descriptorMap: Record<
    NlpProductionLevel,
    NlpTrustLevelDescriptor
  > = NLP_TRUST_LEVEL_DESCRIPTORS,
  sprintMaximum: NlpProductionLevel = SPRINT_MAXIMUM_LEVEL,
): NlpPromotionDecision {
  const reasons: string[] = [];
  const fromDescriptor = descriptorMap[request.from];
  const toDescriptor = descriptorMap[request.to];

  if (!fromDescriptor || !toDescriptor) {
    return {
      allowed: false,
      reasons: [
        `unknown level in request: from=${request.from} to=${request.to}`,
      ],
    };
  }

  if (toDescriptor.level <= fromDescriptor.level) {
    reasons.push(
      `promotion must advance exactly one level; ${request.from}->${request.to} is not an advance`,
    );
  } else if (toDescriptor.level !== fromDescriptor.level + 1) {
    reasons.push(
      `promotion must advance exactly one level; cannot skip ${request.from}->${request.to}`,
    );
  }

  if (
    NLP_TRUST_LEVEL_RANK[toDescriptor.key] > NLP_TRUST_LEVEL_RANK[sprintMaximum]
  ) {
    reasons.push(
      `target level ${request.to} exceeds the current sprint maximum (${sprintMaximum})`,
    );
  }

  const evidenceSet = new Set(request.evidence);
  for (const requirement of toDescriptor.requiredEvidence) {
    if (!evidenceSet.has(requirement)) {
      reasons.push(`missing required evidence: ${requirement}`);
    }
  }

  const unknownEvidence = request.evidence.filter(
    (item) => !toDescriptor.requiredEvidence.includes(item),
  );
  if (unknownEvidence.length > 0) {
    reasons.push(
      `evidence outside the level checklist is rejected: ${unknownEvidence.join(', ')}`,
    );
  }

  return { allowed: reasons.length === 0, reasons };
}
