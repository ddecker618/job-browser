import type {
  ApplicationCorrectionIneligibilityReason,
  ApplicationEventType,
  ApplicationSupersedeAction,
} from '../domain/application-history.js';
import type {
  ApplicationLifecycleStatus,
  ApplicationStatus,
  OccurrencePrecision,
  UserOccurrencePrecision,
  UserSelectableApplicationStatus,
} from '../domain/application-status.js';

export interface ApplicationListQuery {
  limit: number;
  status?: ApplicationStatus | undefined;
  company?: string | undefined;
  cursor?: string | undefined;
}

export interface ApplicationListItem {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  appliedAtPrecision: OccurrencePrecision | null;
  lastRecordedAt: string | null;
  titleAtApplication: string | null;
  companyAtApplication: string | null;
}

export interface ApplicationListResponse {
  items: ApplicationListItem[];
  nextCursor: string | null;
}

export interface ApplicationDetail {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  appliedAtPrecision: OccurrencePrecision | null;
  lastEventAt: string | null;
  lastRecordedAt: string | null;
  titleAtApplication: string | null;
  companyAtApplication: string | null;
  locationAtApplication: string | null;
  applicationUrl: string | null;
  sourceId: string | null;
  providerId: string | null;
  sourceLabel: string | null;
  notes: string | null;
  legacyProvenance: string | null;
  submittedResumeSnapshotId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationTimelineEvent {
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
  actor: string;
  effective: boolean;
  supersededByEventId: string | null;
  supersedesEventId: string | null;
  supersedeAction: ApplicationSupersedeAction | null;
  submittedResumeSnapshotId: string | null;
  terminal: boolean;
  canReplace: boolean;
  canVoid: boolean;
  correctionIneligibilityReason: ApplicationCorrectionIneligibilityReason | null;
  definitionVersion: string | null;
  correctionReason: string | null;
}

export interface CreateApplicationCommand {
  eventId: string;
  jobId: string;
  occurredAt: string;
  occurrencePrecision: UserOccurrencePrecision;
  titleAtApplication: string;
  companyAtApplication: string;
  locationAtApplication: string | null;
  applicationUrl: string | null;
  sourceId: string | null;
  notes?: string | null | undefined;
}

export interface ApplicationLifecycleEventCommand {
  kind: 'lifecycle';
  eventId: string;
  eventType: ApplicationLifecycleStatus;
  occurredAt: string;
  occurrencePrecision: UserOccurrencePrecision;
  notes?: string | null | undefined;
}

export interface ApplicationNoteEventCommand {
  kind: 'note';
  eventId: string;
  occurredAt: string;
  occurrencePrecision: UserOccurrencePrecision;
  text: string;
}

export interface ApplicationReplaceEventCommand {
  kind: 'replace';
  eventId: string;
  targetEventId: string;
  replacementEventType: UserSelectableApplicationStatus | 'note';
  occurredAt: string;
  occurrencePrecision: UserOccurrencePrecision;
  text?: string | undefined;
  reason?: string | null | undefined;
  resumeId?: string | null | undefined;
}

export interface ApplicationVoidEventCommand {
  kind: 'void';
  eventId: string;
  targetEventId: string;
  reason?: string | null | undefined;
}

export type ApplicationEventCommand =
  | ApplicationLifecycleEventCommand
  | ApplicationNoteEventCommand
  | ApplicationReplaceEventCommand
  | ApplicationVoidEventCommand;

export interface ApplicationSummaryNotesCommand {
  notes: string | null;
}

export interface ApplicationWriteResponse {
  application: ApplicationDetail;
  event: ApplicationTimelineEvent;
  replayed: boolean;
}

export interface ApplicationNotesWriteResponse {
  application: ApplicationDetail;
}
