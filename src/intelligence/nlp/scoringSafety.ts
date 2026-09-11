export const SHADOW_RECOMMENDATION_CONTRIBUTION_VERSION =
  'shadow-recommendation-contribution-v1';
export const MAX_SHADOW_RECOMMENDATION_CONTRIBUTION = 3;
const THRESHOLD_MARGIN = 0.001;

export interface ShadowRecommendationSignal {
  signalId: string;
  weight: number;
  confidence: number | null;
  current: boolean;
  evidenceSpanValid: boolean;
  deterministicState: 'agreement' | 'conflict' | 'unknown' | 'nlp-only';
  approvedForScoring: boolean;
}

export interface ShadowRecommendationInput {
  baselineScore: number;
  eligibilityPassed: boolean;
  nextDeterministicThreshold: number | null;
  signals: readonly ShadowRecommendationSignal[];
}

export interface ShadowRecommendationResult {
  version: typeof SHADOW_RECOMMENDATION_CONTRIBUTION_VERSION;
  baselineScore: number;
  eligibilityPassed: boolean;
  contribution: number;
  experimentalRecommendationMetric: number;
  qualifyingSignalIds: string[];
  excludedSignalIds: string[];
  productionEffect: 'none';
}

/** Implements the P12 formula for tests and offline shadow comparison only.
 * It is deliberately not imported by either production scoring engine. */
export function calculateShadowRecommendationContribution(
  input: ShadowRecommendationInput,
): ShadowRecommendationResult {
  const safeBaseline = finiteInRange(input.baselineScore, 0, 100);
  const idsAreUnique =
    new Set(input.signals.map((signal) => signal.signalId)).size ===
    input.signals.length;
  if (safeBaseline === null || !idsAreUnique || !input.eligibilityPassed) {
    const baseline = safeBaseline ?? 0;
    return result(
      baseline,
      input.eligibilityPassed,
      0,
      [],
      input.signals.map((signal) => signal.signalId),
    );
  }

  const qualifying = input.signals.filter(isQualifying);
  const excluded = input.signals.filter((signal) => !isQualifying(signal));
  const signalTotal = qualifying.reduce(
    (total, signal) => total + signal.weight,
    0,
  );
  const thresholdRoom = thresholdAllowance(
    safeBaseline,
    input.nextDeterministicThreshold,
  );
  const contribution = Math.max(
    0,
    Math.min(
      MAX_SHADOW_RECOMMENDATION_CONTRIBUTION,
      signalTotal,
      thresholdRoom,
    ),
  );
  return result(
    safeBaseline,
    input.eligibilityPassed,
    contribution,
    qualifying.map((signal) => signal.signalId),
    excluded.map((signal) => signal.signalId),
  );
}

function isQualifying(signal: ShadowRecommendationSignal): boolean {
  return (
    signal.weight > 0 &&
    signal.weight <= MAX_SHADOW_RECOMMENDATION_CONTRIBUTION &&
    signal.confidence !== null &&
    signal.confidence >= 0.9 &&
    signal.confidence <= 1 &&
    signal.current &&
    signal.evidenceSpanValid &&
    signal.deterministicState === 'agreement' &&
    signal.approvedForScoring
  );
}

function thresholdAllowance(
  baselineScore: number,
  nextThreshold: number | null,
): number {
  if (nextThreshold === null) return MAX_SHADOW_RECOMMENDATION_CONTRIBUTION;
  const safeThreshold = finiteInRange(nextThreshold, 0, 100);
  if (safeThreshold === null || safeThreshold <= baselineScore) return 0;
  return Math.max(0, safeThreshold - baselineScore - THRESHOLD_MARGIN);
}

function result(
  baselineScore: number,
  eligibilityPassed: boolean,
  contribution: number,
  qualifyingSignalIds: string[],
  excludedSignalIds: string[],
): ShadowRecommendationResult {
  return {
    version: SHADOW_RECOMMENDATION_CONTRIBUTION_VERSION,
    baselineScore,
    eligibilityPassed,
    contribution,
    experimentalRecommendationMetric: Math.min(
      100,
      baselineScore + contribution,
    ),
    qualifyingSignalIds,
    excludedSignalIds,
    productionEffect: 'none',
  };
}

function finiteInRange(
  value: number,
  minimum: number,
  maximum: number,
): number | null {
  return Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}
