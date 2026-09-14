export type ScoreFreshness = 'current' | 'stale' | 'unknown' | 'unscored';

export interface ScoreLabelEvidence {
  score: number | null;
  recommendation: string | null;
  scoreVersion: string | null;
}

export function scoreFreshness(
  evidence: ScoreLabelEvidence,
  currentScoreVersion: string | null,
): ScoreFreshness {
  if (evidence.score === null && evidence.recommendation === null) {
    return 'unscored';
  }
  if (currentScoreVersion === null || evidence.scoreVersion === null) {
    return 'unknown';
  }
  return evidence.scoreVersion === currentScoreVersion ? 'current' : 'stale';
}

export function freshnessBadgeLabel(freshness: ScoreFreshness): string | null {
  switch (freshness) {
    case 'stale':
      return 'Stale score';
    case 'unknown':
      return 'Freshness unknown';
    default:
      return null;
  }
}

export function freshnessTitle(freshness: ScoreFreshness): string | null {
  switch (freshness) {
    case 'stale':
      return 'Personal-fit score was produced under an older scoring version.';
    case 'unknown':
      return 'Score freshness cannot be confirmed.';
    default:
      return null;
  }
}
