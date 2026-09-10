import type { NlpEvaluationReport } from './evaluation.js';

// ---------------------------------------------------------------------------
// Stage 18 - shadow-mode acceptance gate.
//
// The gate is intentionally fail-closed. Quality metrics alone cannot promote
// NLP: callers must also provide evidence that persistence, reprocessing,
// explainability, conflict visibility, and production-field invariance hold.
// ---------------------------------------------------------------------------

export const NLP_ACCEPTANCE_VERSION = 'acceptance-v1';

export interface NlpAcceptanceThresholds {
  minimumCategoryPrecision: number;
  minimumCategoryRecall: number;
  minimumStrengthAccuracy: number;
  minimumEntityPrecision: number;
  minimumEntityRecall: number;
  maximumArrangementDisagreementRate: number;
  maximumLabelDisagreementRate: number;
  maximumCriticalFailureRate: number;
}

export const NLP_ACCEPTANCE_THRESHOLDS: NlpAcceptanceThresholds = {
  minimumCategoryPrecision: 0.9,
  minimumCategoryRecall: 0.9,
  minimumStrengthAccuracy: 0.95,
  minimumEntityPrecision: 0.9,
  minimumEntityRecall: 0.9,
  maximumArrangementDisagreementRate: 0.15,
  maximumLabelDisagreementRate: 0.15,
  maximumCriticalFailureRate: 0,
};

export interface NlpAcceptanceEvidence {
  productionFieldsUnchanged: boolean;
  persistenceVersioningWorks: boolean;
  staleReprocessingWorks: boolean;
  evidenceRetained: boolean;
  conflictsVisible: boolean;
  inspectorWorks: boolean;
}

export interface NlpAcceptanceGateResult {
  acceptanceVersion: typeof NLP_ACCEPTANCE_VERSION;
  passed: boolean;
  failures: string[];
  caseCount: number;
  thresholds: NlpAcceptanceThresholds;
  evidence: NlpAcceptanceEvidence;
}

export function evaluateNlpAcceptanceGate(
  report: NlpEvaluationReport,
  evidence: NlpAcceptanceEvidence,
  thresholds: NlpAcceptanceThresholds = NLP_ACCEPTANCE_THRESHOLDS,
): NlpAcceptanceGateResult {
  const failures: string[] = [];

  requireMinimum(
    failures,
    'category precision',
    report.categories.precision,
    thresholds.minimumCategoryPrecision,
  );
  requireMinimum(
    failures,
    'category recall',
    report.categories.recall,
    thresholds.minimumCategoryRecall,
  );
  requireMinimum(
    failures,
    'strength accuracy',
    report.strengths.accuracy,
    thresholds.minimumStrengthAccuracy,
  );
  requireMinimum(
    failures,
    'entity precision',
    report.entities.precision,
    thresholds.minimumEntityPrecision,
  );
  requireMinimum(
    failures,
    'entity recall',
    report.entities.recall,
    thresholds.minimumEntityRecall,
  );
  requireMaximum(
    failures,
    'arrangement disagreement rate',
    report.arrangements.disagreementRate,
    thresholds.maximumArrangementDisagreementRate,
  );
  requireMaximum(
    failures,
    'label disagreement rate',
    report.disagreementRate,
    thresholds.maximumLabelDisagreementRate,
  );
  requireMaximum(
    failures,
    'critical failure rate',
    report.critical.failureRate,
    thresholds.maximumCriticalFailureRate,
  );

  for (const [name, value] of Object.entries(evidence)) {
    if (!value) failures.push(`missing safety evidence: ${name}`);
  }

  return {
    acceptanceVersion: NLP_ACCEPTANCE_VERSION,
    passed: failures.length === 0,
    failures,
    caseCount: report.caseCount,
    thresholds,
    evidence,
  };
}

function requireMinimum(
  failures: string[],
  label: string,
  actual: number,
  minimum: number,
): void {
  if (actual < minimum) {
    failures.push(
      `${label} ${formatMetric(actual)} is below ${formatMetric(minimum)}`,
    );
  }
}

function requireMaximum(
  failures: string[],
  label: string,
  actual: number,
  maximum: number,
): void {
  if (actual > maximum) {
    failures.push(
      `${label} ${formatMetric(actual)} exceeds ${formatMetric(maximum)}`,
    );
  }
}

function formatMetric(value: number): string {
  return value.toFixed(3);
}
