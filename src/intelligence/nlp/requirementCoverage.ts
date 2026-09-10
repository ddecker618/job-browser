import {
  type NlpRequirementCategory,
  type NlpRequirementStrength,
} from '../../schemas/job-nlp.js';
import {
  type ResumeEvidenceRequirementResult,
  type ResumeEvidenceStatus,
} from './resumeEvidence.js';

// ---------------------------------------------------------------------------
// Stage 23 - requirement coverage projection.
//
// Coverage is a diagnostic/UI model built from Stage 22 evidence. Its modality
// weights and diagnostic ratio are not production scoring and cannot affect
// eligibility, ranking, filtering, or lifecycle behavior.
// ---------------------------------------------------------------------------

export const REQUIREMENT_COVERAGE_INTELLIGENCE_VERSION =
  'requirement-coverage-v1';

export type RequirementCoverageStatus =
  | 'DIRECT'
  | 'STRONG_RELATED'
  | 'WEAK_RELATED'
  | 'MISSING'
  | 'UNKNOWN';

export const REQUIREMENT_COVERAGE_WEIGHTS: Record<
  NlpRequirementStrength,
  number
> = {
  required: 1,
  preferred: 0.5,
  'nice-to-have': 0.25,
  'ability-to-obtain': 0.9,
  'required-after-hire': 0.9,
  'equivalent-accepted': 0.8,
  informational: 0,
  unknown: 0.5,
};

export interface RequirementCoverageInput {
  requirementId: string;
  phrase: string;
  category: NlpRequirementCategory;
  strength: NlpRequirementStrength;
  evidence: ResumeEvidenceRequirementResult;
}

export interface RequirementCoverageRow {
  requirementId: string;
  phrase: string;
  category: NlpRequirementCategory;
  strength: NlpRequirementStrength;
  status: RequirementCoverageStatus;
  evidenceStatus: ResumeEvidenceStatus;
  modalityWeight: number;
  diagnosticContribution: number;
  evidence: ResumeEvidenceRequirementResult['evidence'];
  explanation: string;
  productionEffect: 'none';
}

export interface RequirementCoverageSummary {
  totalRequirements: number;
  counts: Record<RequirementCoverageStatus, number>;
  weightedEligibleTotal: number;
  weightedDiagnosticEvidence: number;
  weightedDiagnosticCoverage: number;
  productionEffect: 'none';
}

export interface RequirementCoverageProjection {
  method: 'coverage-projection';
  version: typeof REQUIREMENT_COVERAGE_INTELLIGENCE_VERSION;
  rows: RequirementCoverageRow[];
  summary: RequirementCoverageSummary;
  productionEffect: 'none';
}

export function buildRequirementCoverage(
  inputs: readonly RequirementCoverageInput[],
): RequirementCoverageProjection {
  const ids = new Set<string>();
  const rows = inputs.map((input) => {
    if (ids.has(input.requirementId)) {
      throw new Error(
        `Duplicate requirement coverage id: ${input.requirementId}`,
      );
    }
    ids.add(input.requirementId);
    if (input.evidence.requirementId !== input.requirementId) {
      throw new Error(
        `Evidence requirement id ${input.evidence.requirementId} does not match ${input.requirementId}`,
      );
    }

    const status = coverageStatus(input.evidence.status);
    const modalityWeight = REQUIREMENT_COVERAGE_WEIGHTS[input.strength];
    return {
      requirementId: input.requirementId,
      phrase: input.phrase,
      category: input.category,
      strength: input.strength,
      status,
      evidenceStatus: input.evidence.status,
      modalityWeight,
      diagnosticContribution: modalityWeight * contributionFactor(status),
      evidence: input.evidence.evidence.map((item) => ({ ...item })),
      explanation: explanationFor(status),
      productionEffect: 'none' as const,
    };
  });

  const counts: Record<RequirementCoverageStatus, number> = {
    DIRECT: 0,
    STRONG_RELATED: 0,
    WEAK_RELATED: 0,
    MISSING: 0,
    UNKNOWN: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  const weightedEligibleTotal = rows.reduce(
    (total, row) => total + row.modalityWeight,
    0,
  );
  const weightedDiagnosticEvidence = rows.reduce(
    (total, row) => total + row.diagnosticContribution,
    0,
  );

  return {
    method: 'coverage-projection',
    version: REQUIREMENT_COVERAGE_INTELLIGENCE_VERSION,
    rows,
    summary: {
      totalRequirements: rows.length,
      counts,
      weightedEligibleTotal,
      weightedDiagnosticEvidence,
      weightedDiagnosticCoverage:
        weightedEligibleTotal === 0
          ? 0
          : weightedDiagnosticEvidence / weightedEligibleTotal,
      productionEffect: 'none',
    },
    productionEffect: 'none',
  };
}

function coverageStatus(
  status: ResumeEvidenceStatus,
): RequirementCoverageStatus {
  switch (status) {
    case 'DIRECT_MATCH':
      return 'DIRECT';
    case 'STRONG_RELATED_EVIDENCE':
      return 'STRONG_RELATED';
    case 'WEAK_RELATED_EVIDENCE':
      return 'WEAK_RELATED';
    case 'NO_EVIDENCE':
      return 'MISSING';
    case 'UNKNOWN':
      return 'UNKNOWN';
  }
}

function contributionFactor(status: RequirementCoverageStatus): number {
  switch (status) {
    case 'DIRECT':
      return 1;
    case 'STRONG_RELATED':
      return 0.75;
    case 'WEAK_RELATED':
      return 0.35;
    case 'MISSING':
    case 'UNKNOWN':
      return 0;
  }
}

function explanationFor(status: RequirementCoverageStatus): string {
  switch (status) {
    case 'DIRECT':
      return 'Direct parsed evidence is present; this diagnostic row does not claim possession or change production scoring.';
    case 'STRONG_RELATED':
      return 'Strongly related evidence is present; equivalence and possession are not claimed.';
    case 'WEAK_RELATED':
      return 'Weakly related evidence is present; equivalence and possession are not claimed.';
    case 'MISSING':
      return 'No matching parsed evidence was supplied.';
    case 'UNKNOWN':
      return 'Evidence or normalization is unknown; the row is not treated as covered.';
  }
}
