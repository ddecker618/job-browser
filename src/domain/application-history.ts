import type {
  ApplicationStatus,
  OccurrencePrecision,
} from './application-status.js';

export const APPLICATION_EVENT_TYPES = [
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
  'note',
  'void',
  'legacy_state_imported',
  'legacy_applied_date_imported',
] as const;

export type ApplicationEventType = (typeof APPLICATION_EVENT_TYPES)[number];

export const APPLICATION_SUPERSEDE_ACTIONS = ['replace', 'void'] as const;

export type ApplicationSupersedeAction =
  (typeof APPLICATION_SUPERSEDE_ACTIONS)[number];

export const APPLICATION_CORRECTION_INELIGIBILITY_REASONS = [
  'superseded',
  'void_event',
  'migration_event',
  'missing_recorded_time',
  'unsupported_event_type',
  'not_effective',
  'final_effective_status',
] as const;

export type ApplicationCorrectionIneligibilityReason =
  (typeof APPLICATION_CORRECTION_INELIGIBILITY_REASONS)[number];

const RESULTING_STATUS_BY_STATUS_EVENT: Readonly<
  Partial<Record<ApplicationEventType, ApplicationStatus>>
> = {
  applied: 'applied',
  recruiter_contact: 'recruiter_contact',
  phone_screen: 'phone_screen',
  technical_interview: 'technical_interview',
  manager_interview: 'manager_interview',
  final_interview: 'final_interview',
  interview: 'interview',
  offer: 'offer',
  accepted: 'accepted',
  rejected: 'rejected',
  ghosted: 'ghosted',
  withdrawn: 'withdrawn',
};

export function resultingStatusForEventType(
  eventType: ApplicationEventType,
): ApplicationStatus | null {
  return RESULTING_STATUS_BY_STATUS_EVENT[eventType] ?? null;
}

export interface ApplicationHistory {
  id: string;
  applicationId: string;
  jobId: string;
  eventType: ApplicationEventType;
  resultingStatus: ApplicationStatus | null;
  occurredAt: string | null;
  occurredAtSort: string | null;
  occurrencePrecision: OccurrencePrecision;
  recordedAt: string;
  recordedAtSort: string | null;
  notes: string | null;
  source: string;
  metadataJson: string | null;
  supersedesEventId: string | null;
  supersedeAction: ApplicationSupersedeAction | null;
  submittedResumeSnapshotId: string | null;
  createdAt: string;
}

export interface ApplicationCorrectionState {
  effective: boolean;
  supersededByEventId: string | null;
  terminal: boolean;
  canReplace: boolean;
  canVoid: boolean;
  correctionIneligibilityReason: ApplicationCorrectionIneligibilityReason | null;
}
