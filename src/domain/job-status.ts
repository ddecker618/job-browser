export const JOB_STATUSES = [
  'new',
  'review',
  'recommended',
  'applied',
  'ignored',
  'rejected',
  'interview',
  'offer',
  'expired',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
