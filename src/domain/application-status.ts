import type { JobStatus } from './job-status.js';

export const APPLICATION_STATUSES = [
  'applied',
  'recruiter_contact',
  'phone_screen',
  'technical_interview',
  'manager_interview',
  'final_interview',
  'interview',
  'offer',
  'accepted',
  'rejected',
  'ghosted',
  'withdrawn',
  'unknown_legacy_state',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const USER_SELECTABLE_APPLICATION_STATUSES = [
  'applied',
  'recruiter_contact',
  'phone_screen',
  'technical_interview',
  'manager_interview',
  'final_interview',
  'interview',
  'offer',
  'accepted',
  'rejected',
  'ghosted',
  'withdrawn',
] as const satisfies readonly ApplicationStatus[];

export type UserSelectableApplicationStatus =
  (typeof USER_SELECTABLE_APPLICATION_STATUSES)[number];

export const APPLICATION_LIFECYCLE_STATUSES = [
  'recruiter_contact',
  'phone_screen',
  'technical_interview',
  'manager_interview',
  'final_interview',
  'interview',
  'offer',
  'accepted',
  'rejected',
  'ghosted',
  'withdrawn',
] as const satisfies readonly UserSelectableApplicationStatus[];

export type ApplicationLifecycleStatus =
  (typeof APPLICATION_LIFECYCLE_STATUSES)[number];

export const APPLICATION_STATUS_TO_JOB_STATUS = {
  applied: 'applied',
  recruiter_contact: 'applied',
  phone_screen: 'interview',
  technical_interview: 'interview',
  manager_interview: 'interview',
  final_interview: 'interview',
  interview: 'interview',
  offer: 'offer',
  accepted: 'offer',
  rejected: 'rejected',
  ghosted: 'rejected',
  withdrawn: 'ignored',
  unknown_legacy_state: null,
} as const satisfies Readonly<Record<ApplicationStatus, JobStatus | null>>;

export function jobStatusForApplicationStatus(
  status: ApplicationStatus,
): JobStatus | null {
  return APPLICATION_STATUS_TO_JOB_STATUS[status];
}

export const OCCURRENCE_PRECISIONS = [
  'exact',
  'date',
  'approximate',
  'unknown',
] as const;

export type OccurrencePrecision = (typeof OCCURRENCE_PRECISIONS)[number];

export const USER_OCCURRENCE_PRECISIONS = ['exact', 'date'] as const;

export type UserOccurrencePrecision =
  (typeof USER_OCCURRENCE_PRECISIONS)[number];
