import {
  freshnessBadgeLabel,
  freshnessTitle,
  scoreFreshness,
  type ScoreLabelEvidence,
} from '../scoreLabels.js';

export function FreshnessBadge({
  evidence,
  currentScoreVersion,
}: {
  evidence: ScoreLabelEvidence;
  currentScoreVersion: string | null;
}) {
  const freshness = scoreFreshness(evidence, currentScoreVersion);
  const label = freshnessBadgeLabel(freshness);
  if (label === null) return null;
  return (
    <span
      className={`freshness-badge freshness-${freshness}`}
      title={freshnessTitle(freshness) ?? undefined}
    >
      {label}
    </span>
  );
}
