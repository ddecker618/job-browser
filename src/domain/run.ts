export const RUN_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'interrupted',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface Run {
  id: string;
  sourceId: string | null;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  jobsDiscovered: number;
  jobsInserted: number;
  jobsUpdated: number;
  duplicatesFound: number;
  recordsRejected: number;
  rediscoveries: number;
  crossSourceMerges: number;
  materialUpdates: number;
  identityConflicts: number;
  fetchTruncated: boolean;
  completeSnapshot: boolean;
  retryCount: number;
  errorMessage: string | null;
}
