import type { RunStatus } from '../domain/run.js';

export interface SearchRun {
  id: string;
  sourceId: string;
  providerId: string;
  status: RunStatus;
  searchParametersJson: string;
  startedAt: string;
  completedAt: string | null;
  executionTimeMs: number | null;
  jobsDiscovered: number;
  jobsInserted: number;
  jobsUpdated: number;
  duplicatesFound: number;
  jobsFailed: number;
  errorMessage: string | null;
  stackTrace: string | null;
  htmlSnapshotPath: string | null;
}
