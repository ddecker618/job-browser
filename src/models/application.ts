import type { JobStatus } from '../domain/job-status.js';

export interface Application {
  id: string;
  jobId: string;
  status: Extract<JobStatus, 'applied' | 'interview' | 'rejected' | 'offer'>;
  appliedAt: string | null;
  lastEventAt: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
