export const JOB_LIFECYCLE_REASONS = [
  'active',
  'snapshot-missing',
  'closing-date-expired',
  'provider-closed',
  'unknown',
] as const;

export type JobLifecycleReason = (typeof JOB_LIFECYCLE_REASONS)[number];
export type ClosingDatePrecision = 'date' | 'instant';
export type ProviderLifecycleStatus = 'open' | 'closed' | 'unknown';

export interface JobLifecycleEvidence {
  closingDate: string | null;
  closingDatePrecision: ClosingDatePrecision | null;
  providerLifecycleStatus: ProviderLifecycleStatus;
}

export function lifecycleFromEvidence(
  evidence: JobLifecycleEvidence,
  asOf: string,
): { active: boolean; reason: JobLifecycleReason } {
  if (evidence.providerLifecycleStatus === 'closed') {
    return { active: false, reason: 'provider-closed' };
  }
  if (
    evidence.closingDate !== null &&
    evidence.closingDatePrecision !== null &&
    closingBoundary(evidence.closingDate, evidence.closingDatePrecision) <=
      Date.parse(asOf)
  ) {
    return { active: false, reason: 'closing-date-expired' };
  }
  return { active: true, reason: 'active' };
}

function closingBoundary(
  closingDate: string,
  precision: ClosingDatePrecision,
): number {
  const timestamp = Date.parse(closingDate);
  if (precision === 'instant') return timestamp;
  const date = closingDate.slice(0, 10);
  return Date.parse(`${date}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
}
