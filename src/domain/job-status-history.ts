import type { JobStatus } from './job-status.js';

export interface JobStatusHistory {
  id: string;
  jobId: string;
  previousStatus: JobStatus | null;
  newStatus: JobStatus;
  changedAt: string;
  changedBy: string;
  reason: string | null;
}
