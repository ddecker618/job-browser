import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto';

import { z, type ZodType } from 'zod';

import type { JobDatabase } from '../db/database.js';
import {
  resultingStatusForEventType,
  type ApplicationHistory,
} from '../domain/application-history.js';
import { USER_SELECTABLE_APPLICATION_STATUSES } from '../domain/application-status.js';
import type {
  ApplicationDetail,
  ApplicationListItem,
  ApplicationListResponse,
  ApplicationNotesWriteResponse,
  ApplicationTimelineEvent,
  ApplicationWriteResponse,
} from '../models/application-management.js';
import type { Application } from '../models/application.js';
import {
  applicationEventSchema,
  applicationListQuerySchema,
  applicationOpaqueIdSchema,
  applicationSummaryNotesSchema,
  createApplicationSchema,
  type ParsedApplicationEventCommand,
  type ParsedCreateApplicationCommand,
} from '../schemas/application.js';
import {
  ApplicationCursorError,
  ApplicationRepository,
  type ApplicationEventInsertInput,
  type ApplicationEventWithCorrectionState,
} from '../repositories/application-repository.js';
import { ResumeSnapshotRepository } from '../repositories/resume-snapshot-repository.js';
import { JobRepository } from '../repositories/job-repository.js';
import type { PreparedResumeSnapshot } from '../resumes/resumeSnapshotCapture.js';
import {
  canonicalizeOccurrence,
  normalizeOccurrence,
  type NormalizedOccurrence,
} from '../utilities/timestamps.js';

const EVENT_DEFINITION = 'application-event-v1';

export type ApplicationServiceErrorStatus = 400 | 404 | 409;

export type ApplicationServiceErrorCode =
  | 'application_validation_failed'
  | 'application_not_found'
  | 'job_not_found'
  | 'application_already_exists'
  | 'application_event_id_conflict'
  | 'application_source_not_on_job'
  | 'application_correction_target_not_found'
  | 'application_correction_target_conflict'
  | 'application_correction_target_stale'
  | 'application_correction_kind_mismatch'
  | 'application_correction_recorded_before_target'
  | 'application_final_status_required';

export type ApplicationServiceErrorDetails = Readonly<
  Record<string, string | number | boolean | null>
>;

export class ApplicationServiceError extends Error {
  public readonly details: ApplicationServiceErrorDetails;

  public constructor(
    public readonly status: ApplicationServiceErrorStatus,
    public readonly code: ApplicationServiceErrorCode,
    message: string,
    details: ApplicationServiceErrorDetails = {},
    options: ErrorOptions = {},
  ) {
    super(message.slice(0, 1_000), options);
    this.name = 'ApplicationServiceError';
    this.details = boundedDetails(details);
  }
}

export interface ApplicationServiceOptions {
  now?: (() => Date | string) | undefined;
  randomUUID?: (() => string) | undefined;
}

interface PreparedCommandTime {
  date: Date;
  timestamp: string;
}

export class ApplicationService {
  private readonly applications: ApplicationRepository;
  private readonly jobs: JobRepository;

  public constructor(
    private readonly database: JobDatabase,
    private readonly options: ApplicationServiceOptions = {},
  ) {
    this.applications = new ApplicationRepository(database);
    this.jobs = new JobRepository(database);
  }

  public listApplications(input: unknown = {}): ApplicationListResponse {
    const query = this.parse(applicationListQuerySchema, input);
    try {
      const page = this.applications.listPage(query);
      return {
        items: page.items.map(toListItem),
        nextCursor: page.nextCursor,
      };
    } catch (error) {
      if (error instanceof ApplicationCursorError) {
        throw this.validationError(error.message, error);
      }
      throw error;
    }
  }

  public getApplication(applicationId: string): ApplicationDetail {
    const id = this.parseIdentifier(applicationId);
    const application = this.applications.findById(id);
    if (application === null) throw applicationNotFound(id);
    return toDetail(application);
  }

  public getTimeline(applicationId: string): ApplicationTimelineEvent[] {
    const id = this.parseIdentifier(applicationId);
    if (this.applications.findById(id) === null) throw applicationNotFound(id);
    return this.applications.getTimeline(id);
  }

  public createApplication(
    input: unknown,
    preparedSnapshot: PreparedResumeSnapshot | null = null,
  ): ApplicationWriteResponse {
    const command = this.parse(createApplicationSchema, input);
    const time = this.commandTime();
    const occurrence = this.canonicalizeCommandOccurrence(
      command.occurredAt,
      command.occurrencePrecision,
    );
    const notes = command.notes ?? null;
    const submittedResumeSnapshotId = preparedSnapshot?.snapshot.id ?? null;
    const commandHash = hashCanonicalCommand({
      kind: 'create',
      eventId: command.eventId,
      jobId: command.jobId,
      occurredAt: occurrence.source,
      occurrencePrecision: occurrence.precision,
      titleAtApplication: command.titleAtApplication,
      companyAtApplication: command.companyAtApplication,
      locationAtApplication: command.locationAtApplication,
      applicationUrl: command.applicationUrl,
      sourceId: command.sourceId,
      notes,
      submittedResumeSnapshotId,
    });

    return this.database.transaction(() => {
      const existingEvent = this.applications.findEventById(command.eventId);
      if (existingEvent !== null) {
        const existingApplication = this.applications.findById(
          existingEvent.applicationId,
        );
        if (
          existingApplication !== null &&
          isCreationReplay(
            existingEvent,
            existingApplication,
            command,
            occurrence,
            notes,
            commandHash,
          )
        ) {
          return this.writeResponse(
            existingApplication,
            existingEvent.id,
            true,
          );
        }
        throw eventIdConflict(command.eventId);
      }

      this.assertOccurrenceNotFuture(
        command.occurredAt,
        command.occurrencePrecision,
        time.date,
      );

      const existingApplication = this.applications.findByJobId(command.jobId);
      if (existingApplication !== null) {
        throw new ApplicationServiceError(
          409,
          'application_already_exists',
          'The Job already has an Application',
          { existingApplicationId: existingApplication.id },
        );
      }
      if (this.applications.findJobCreationContext(command.jobId) === null) {
        throw new ApplicationServiceError(
          404,
          'job_not_found',
          'The retained Job was not found',
          { jobId: command.jobId },
        );
      }

      const source =
        command.sourceId === null
          ? null
          : this.applications.findSourceMembership(
              command.jobId,
              command.sourceId,
            );
      if (command.sourceId !== null && source === null) {
        throw new ApplicationServiceError(
          400,
          'application_source_not_on_job',
          'The selected Source does not currently belong to the Job',
          { jobId: command.jobId, sourceId: command.sourceId },
        );
      }

      const applicationId = (this.options.randomUUID ?? nodeRandomUUID)();
      if (preparedSnapshot?.insertInput !== null && preparedSnapshot !== null) {
        new ResumeSnapshotRepository(this.database).insertSnapshot(
          preparedSnapshot.insertInput,
        );
      }
      this.applications.insertApplication({
        id: applicationId,
        jobId: command.jobId,
        status: 'applied',
        titleAtApplication: command.titleAtApplication,
        companyAtApplication: command.companyAtApplication,
        locationAtApplication: command.locationAtApplication,
        applicationUrl: command.applicationUrl,
        sourceId: source?.sourceId ?? null,
        providerId: source?.providerId ?? null,
        sourceLabel: source?.sourceLabel ?? null,
        notes: null,
        createdAt: time.timestamp,
      });
      this.applications.insertEvent({
        id: command.eventId,
        applicationId,
        jobId: command.jobId,
        eventType: 'applied',
        resultingStatus: 'applied',
        occurredAt: occurrence.source,
        occurredAtSort: occurrence.sort,
        occurrencePrecision: occurrence.precision,
        recordedAt: time.timestamp,
        notes,
        source: 'user',
        metadataJson: eventMetadata(commandHash),
        supersedesEventId: null,
        supersedeAction: null,
        submittedResumeSnapshotId,
      });
      const application = this.requireReproject(command.jobId, time.timestamp);
      this.jobs.syncApplicationStatus(
        command.jobId,
        time.timestamp,
        'user',
        notes,
      );
      return this.writeResponse(application, command.eventId, false);
    })();
  }

  public appendEvent(
    applicationId: string,
    input: unknown,
    preparedSnapshot: PreparedResumeSnapshot | null = null,
  ): ApplicationWriteResponse {
    const id = this.parseIdentifier(applicationId);
    const command = this.parse(applicationEventSchema, input);
    const time = this.commandTime();
    const occurrence =
      command.kind === 'void'
        ? null
        : this.canonicalizeCommandOccurrence(
            command.occurredAt,
            command.occurrencePrecision,
          );
    const submittedResumeSnapshotId = preparedSnapshot?.snapshot.id ?? null;
    if (
      preparedSnapshot !== null &&
      !(
        command.kind === 'replace' && command.replacementEventType === 'applied'
      )
    ) {
      throw this.validationError(
        'A Resume snapshot can only be attached to an Applied event',
        null,
      );
    }
    const commandHash = hashCanonicalCommand(
      canonicalEventCommand(id, command, occurrence, submittedResumeSnapshotId),
    );

    return this.database.transaction(() => {
      const existingEvent = this.applications.findEventById(command.eventId);
      if (existingEvent !== null) {
        if (
          isEventReplay(
            existingEvent,
            id,
            command,
            occurrence,
            commandHash,
            submittedResumeSnapshotId,
          )
        ) {
          const application = this.applications.findById(id);
          if (application === null) throw applicationNotFound(id);
          return this.writeResponse(application, existingEvent.id, true);
        }
        throw eventIdConflict(command.eventId);
      }

      const currentApplication = this.applications.findById(id);
      if (currentApplication === null) throw applicationNotFound(id);
      if (command.kind !== 'void') {
        this.assertOccurrenceNotFuture(
          command.occurredAt,
          command.occurrencePrecision,
          time.date,
        );
      }

      const plan = this.buildEventPlan(
        currentApplication,
        command,
        occurrence,
        commandHash,
        time.timestamp,
        submittedResumeSnapshotId,
      );
      if (preparedSnapshot !== null && preparedSnapshot.insertInput !== null) {
        new ResumeSnapshotRepository(this.database).insertSnapshot(
          preparedSnapshot.insertInput,
        );
      }
      this.applications.insertEvent(plan.event);
      const application = this.requireReproject(
        currentApplication.jobId,
        time.timestamp,
      );
      if (plan.synchronizeJob) {
        this.jobs.syncApplicationStatus(
          currentApplication.jobId,
          time.timestamp,
          'user',
          plan.jobHistoryReason,
        );
      }
      return this.writeResponse(application, command.eventId, false);
    })();
  }

  public updateSummaryNotes(
    applicationId: string,
    input: unknown,
  ): ApplicationNotesWriteResponse {
    const id = this.parseIdentifier(applicationId);
    const command = this.parse(applicationSummaryNotesSchema, input);
    const timestamp = this.commandTime().timestamp;
    return this.database.transaction(() => {
      if (!this.applications.updateSummaryNotes(id, command.notes, timestamp)) {
        throw applicationNotFound(id);
      }
      const application = this.applications.findById(id);
      if (application === null) throw applicationNotFound(id);
      return { application: toDetail(application) };
    })();
  }

  private buildEventPlan(
    application: Application,
    command: ParsedApplicationEventCommand,
    occurrence: NormalizedOccurrence | null,
    commandHash: string,
    recordedAt: string,
    submittedResumeSnapshotId: string | null,
  ): {
    event: ApplicationEventInsertInput;
    synchronizeJob: boolean;
    jobHistoryReason: string | null;
  } {
    const base = {
      id: command.eventId,
      applicationId: application.id,
      jobId: application.jobId,
      recordedAt,
      source: 'user',
      supersedesEventId: null,
      supersedeAction: null,
      submittedResumeSnapshotId: null,
    } as const;

    if (command.kind === 'lifecycle') {
      const normalized = requireOccurrence(occurrence);
      const notes = command.notes ?? null;
      return {
        event: {
          ...base,
          eventType: command.eventType,
          resultingStatus: command.eventType,
          occurredAt: normalized.source,
          occurredAtSort: normalized.sort,
          occurrencePrecision: normalized.precision,
          notes,
          metadataJson: eventMetadata(commandHash),
        },
        synchronizeJob: true,
        jobHistoryReason: notes,
      };
    }

    if (command.kind === 'note') {
      const normalized = requireOccurrence(occurrence);
      return {
        event: {
          ...base,
          eventType: 'note',
          resultingStatus: null,
          occurredAt: normalized.source,
          occurredAtSort: normalized.sort,
          occurrencePrecision: normalized.precision,
          notes: command.text,
          metadataJson: eventMetadata(commandHash),
        },
        synchronizeJob: false,
        jobHistoryReason: null,
      };
    }

    const target = this.requireCorrectionTarget(
      application.id,
      command.targetEventId,
      command.kind,
      recordedAt,
    );
    const targetIsNote = target.event.eventType === 'note';
    const targetIsStatus = isUserStatusEvent(target.event);

    if (command.kind === 'replace') {
      if (
        (targetIsNote && command.replacementEventType !== 'note') ||
        (targetIsStatus && command.replacementEventType === 'note') ||
        (!targetIsNote && !targetIsStatus)
      ) {
        throw new ApplicationServiceError(
          409,
          'application_correction_kind_mismatch',
          'A status event must be replaced by a status and a Note by a Note',
          { targetEventId: command.targetEventId },
        );
      }
      const normalized = requireOccurrence(occurrence);
      const noteReplacement = command.replacementEventType === 'note';
      const eventType = noteReplacement ? 'note' : command.replacementEventType;
      const resultingStatus = noteReplacement
        ? null
        : resultingStatusForEventType(eventType);
      if (!noteReplacement && resultingStatus === null) {
        throw new ApplicationServiceError(
          400,
          'application_validation_failed',
          'Replacement status is not user-selectable',
        );
      }
      const reason = command.reason ?? null;
      return {
        event: {
          ...base,
          eventType,
          resultingStatus,
          occurredAt: normalized.source,
          occurredAtSort: normalized.sort,
          occurrencePrecision: normalized.precision,
          notes: noteReplacement ? (command.text ?? null) : reason,
          metadataJson: eventMetadata(
            commandHash,
            noteReplacement ? reason : undefined,
          ),
          supersedesEventId: target.event.id,
          supersedeAction: 'replace',
          submittedResumeSnapshotId:
            eventType === 'applied' ? submittedResumeSnapshotId : null,
        },
        synchronizeJob: targetIsStatus,
        jobHistoryReason: targetIsStatus ? reason : null,
      };
    }

    const reason = command.reason ?? null;
    return {
      event: {
        ...base,
        eventType: 'void',
        resultingStatus: null,
        occurredAt: target.event.occurredAt,
        occurredAtSort: target.event.occurredAtSort,
        occurrencePrecision: target.event.occurrencePrecision,
        notes: reason,
        metadataJson: eventMetadata(commandHash),
        supersedesEventId: target.event.id,
        supersedeAction: 'void',
      },
      synchronizeJob: targetIsStatus,
      jobHistoryReason: targetIsStatus ? reason : null,
    };
  }

  private requireCorrectionTarget(
    applicationId: string,
    targetEventId: string,
    action: 'replace' | 'void',
    recordedAt: string,
  ): ApplicationEventWithCorrectionState {
    const target =
      this.applications.findEventWithCorrectionState(targetEventId);
    if (target === null) {
      throw new ApplicationServiceError(
        409,
        'application_correction_target_not_found',
        'The correction target is not available',
        { targetEventId },
      );
    }
    if (target.event.applicationId !== applicationId) {
      throw new ApplicationServiceError(
        409,
        'application_correction_target_conflict',
        'The correction target belongs to another Application',
        { targetEventId },
      );
    }
    const allowed =
      action === 'replace' ? target.state.canReplace : target.state.canVoid;
    if (!allowed) {
      if (
        action === 'void' &&
        target.state.correctionIneligibilityReason === 'final_effective_status'
      ) {
        throw new ApplicationServiceError(
          409,
          'application_final_status_required',
          'Void would remove the final effective status-bearing event',
          { targetEventId },
        );
      }
      throw new ApplicationServiceError(
        409,
        'application_correction_target_stale',
        'The correction target is not a current eligible terminal event',
        {
          targetEventId,
          reason:
            target.state.correctionIneligibilityReason ?? 'ineligible_target',
        },
      );
    }
    if (
      target.event.recordedAtSort === null ||
      target.event.recordedAtSort > recordedAt
    ) {
      throw new ApplicationServiceError(
        409,
        'application_correction_recorded_before_target',
        'The correction cannot be recorded before its target',
        { targetEventId },
      );
    }
    return target;
  }

  private requireReproject(jobId: string, updatedAt: string): Application {
    const application = this.applications.reproject(jobId, updatedAt);
    if (application === null) {
      throw new Error(
        `Unable to rebuild Application projection for Job ${jobId}`,
      );
    }
    return application;
  }

  private writeResponse(
    application: Application,
    eventId: string,
    replayed: boolean,
  ): ApplicationWriteResponse {
    const event = this.applications.findTimelineEventById(
      application.id,
      eventId,
    );
    if (event === null) {
      throw new Error(
        `Application event ${eventId} disappeared after persistence`,
      );
    }
    return { application: toDetail(application), event, replayed };
  }

  private canonicalizeCommandOccurrence(
    occurredAt: string,
    precision: 'exact' | 'date',
  ): NormalizedOccurrence {
    try {
      return canonicalizeOccurrence(occurredAt, precision);
    } catch (error) {
      throw this.validationError(
        error instanceof Error ? error.message : 'Invalid occurrence',
        error,
      );
    }
  }

  private assertOccurrenceNotFuture(
    occurredAt: string,
    precision: 'exact' | 'date',
    currentTime: Date,
  ): void {
    try {
      normalizeOccurrence(occurredAt, precision, currentTime);
    } catch (error) {
      throw this.validationError(
        error instanceof Error ? error.message : 'Invalid occurrence',
        error,
      );
    }
  }

  private commandTime(): PreparedCommandTime {
    const supplied = this.options.now?.() ?? new Date();
    const date =
      supplied instanceof Date ? new Date(supplied) : new Date(supplied);
    if (Number.isNaN(date.getTime())) {
      throw new Error('Application service clock returned an invalid time');
    }
    return { date, timestamp: date.toISOString() };
  }

  private parse<T>(schema: ZodType<T>, input: unknown): T {
    try {
      return schema.parse(input);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues
          .slice(0, 8)
          .map(
            (issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`,
          )
          .join('; ');
        throw this.validationError(issues, error);
      }
      throw error;
    }
  }

  private parseIdentifier(value: unknown): string {
    return this.parse(applicationOpaqueIdSchema, value);
  }

  private validationError(
    message: string,
    cause: unknown,
  ): ApplicationServiceError {
    return new ApplicationServiceError(
      400,
      'application_validation_failed',
      'Application command validation failed',
      { reason: message },
      { cause },
    );
  }
}

function canonicalEventCommand(
  applicationId: string,
  command: ParsedApplicationEventCommand,
  occurrence: NormalizedOccurrence | null,
  submittedResumeSnapshotId: string | null,
): Record<string, unknown> {
  if (command.kind === 'lifecycle') {
    return {
      applicationId,
      kind: command.kind,
      eventId: command.eventId,
      eventType: command.eventType,
      occurredAt: requireOccurrence(occurrence).source,
      occurrencePrecision: requireOccurrence(occurrence).precision,
      notes: command.notes ?? null,
    };
  }
  if (command.kind === 'note') {
    return {
      applicationId,
      kind: command.kind,
      eventId: command.eventId,
      occurredAt: requireOccurrence(occurrence).source,
      occurrencePrecision: requireOccurrence(occurrence).precision,
      text: command.text,
    };
  }
  if (command.kind === 'replace') {
    return {
      applicationId,
      kind: command.kind,
      eventId: command.eventId,
      targetEventId: command.targetEventId,
      replacementEventType: command.replacementEventType,
      occurredAt: requireOccurrence(occurrence).source,
      occurrencePrecision: requireOccurrence(occurrence).precision,
      text: command.text ?? null,
      reason: command.reason ?? null,
      submittedResumeSnapshotId,
    };
  }
  return {
    applicationId,
    kind: command.kind,
    eventId: command.eventId,
    targetEventId: command.targetEventId,
    reason: command.reason ?? null,
  };
}

function isCreationReplay(
  event: ApplicationHistory,
  application: Application,
  command: ParsedCreateApplicationCommand,
  occurrence: NormalizedOccurrence,
  notes: string | null,
  commandHash: string,
): boolean {
  return (
    eventHasCommandHash(event, commandHash) &&
    event.source === 'user' &&
    event.eventType === 'applied' &&
    event.resultingStatus === 'applied' &&
    event.supersedesEventId === null &&
    event.supersedeAction === null &&
    event.occurredAt === occurrence.source &&
    event.occurredAtSort === occurrence.sort &&
    event.occurrencePrecision === occurrence.precision &&
    event.notes === notes &&
    application.id === event.applicationId &&
    application.jobId === command.jobId &&
    application.titleAtApplication === command.titleAtApplication &&
    application.companyAtApplication === command.companyAtApplication &&
    application.locationAtApplication === command.locationAtApplication &&
    application.applicationUrl === command.applicationUrl &&
    application.sourceId === command.sourceId
  );
}

function isEventReplay(
  event: ApplicationHistory,
  applicationId: string,
  command: ParsedApplicationEventCommand,
  occurrence: NormalizedOccurrence | null,
  commandHash: string,
  submittedResumeSnapshotId: string | null,
): boolean {
  if (
    event.applicationId !== applicationId ||
    event.source !== 'user' ||
    !eventHasCommandHash(event, commandHash)
  ) {
    return false;
  }
  if (command.kind === 'lifecycle') {
    const normalized = requireOccurrence(occurrence);
    return (
      event.eventType === command.eventType &&
      event.resultingStatus === command.eventType &&
      event.occurredAt === normalized.source &&
      event.occurredAtSort === normalized.sort &&
      event.occurrencePrecision === normalized.precision &&
      event.notes === (command.notes ?? null) &&
      event.supersedesEventId === null &&
      event.supersedeAction === null
    );
  }
  if (command.kind === 'note') {
    const normalized = requireOccurrence(occurrence);
    return (
      event.eventType === 'note' &&
      event.resultingStatus === null &&
      event.occurredAt === normalized.source &&
      event.occurredAtSort === normalized.sort &&
      event.occurrencePrecision === normalized.precision &&
      event.notes === command.text &&
      event.supersedesEventId === null &&
      event.supersedeAction === null
    );
  }
  if (command.kind === 'replace') {
    const normalized = requireOccurrence(occurrence);
    const noteReplacement = command.replacementEventType === 'note';
    return (
      event.eventType ===
        (noteReplacement ? 'note' : command.replacementEventType) &&
      event.resultingStatus ===
        (noteReplacement ? null : command.replacementEventType) &&
      event.occurredAt === normalized.source &&
      event.occurredAtSort === normalized.sort &&
      event.occurrencePrecision === normalized.precision &&
      event.notes ===
        (noteReplacement ? (command.text ?? null) : (command.reason ?? null)) &&
      event.supersedesEventId === command.targetEventId &&
      event.supersedeAction === 'replace' &&
      event.submittedResumeSnapshotId === submittedResumeSnapshotId
    );
  }
  return (
    event.eventType === 'void' &&
    event.resultingStatus === null &&
    event.notes === (command.reason ?? null) &&
    event.supersedesEventId === command.targetEventId &&
    event.supersedeAction === 'void'
  );
}

function eventMetadata(
  commandHash: string,
  correctionReason?: string | null,
): string {
  return stableStringify({
    definition: EVENT_DEFINITION,
    commandHash,
    ...(correctionReason === undefined ? {} : { correctionReason }),
  });
}

function eventHasCommandHash(
  event: ApplicationHistory,
  commandHash: string,
): boolean {
  if (event.metadataJson === null) return false;
  try {
    const metadata: unknown = JSON.parse(event.metadataJson);
    return (
      typeof metadata === 'object' &&
      metadata !== null &&
      !Array.isArray(metadata) &&
      'definition' in metadata &&
      metadata.definition === EVENT_DEFINITION &&
      'commandHash' in metadata &&
      metadata.commandHash === commandHash
    );
  } catch {
    return false;
  }
}

function hashCanonicalCommand(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortCanonicalValue(value));
}

function sortCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonicalValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, sortCanonicalValue(item)]),
  );
}

function requireOccurrence(
  occurrence: NormalizedOccurrence | null,
): NormalizedOccurrence {
  if (occurrence === null) throw new Error('Occurrence was not normalized');
  return occurrence;
}

function isUserStatusEvent(event: ApplicationHistory): boolean {
  return (
    event.resultingStatus !== null &&
    USER_SELECTABLE_APPLICATION_STATUSES.includes(
      event.eventType as (typeof USER_SELECTABLE_APPLICATION_STATUSES)[number],
    )
  );
}

function toListItem(application: Application): ApplicationListItem {
  return {
    id: application.id,
    jobId: application.jobId,
    status: application.status,
    appliedAt: application.appliedAt,
    appliedAtPrecision: application.appliedAtPrecision,
    lastRecordedAt: application.lastRecordedAt,
    titleAtApplication: application.titleAtApplication,
    companyAtApplication: application.companyAtApplication,
  };
}

function toDetail(application: Application): ApplicationDetail {
  return { ...application };
}

function applicationNotFound(applicationId: string): ApplicationServiceError {
  return new ApplicationServiceError(
    404,
    'application_not_found',
    'The Application was not found',
    { applicationId },
  );
}

function eventIdConflict(eventId: string): ApplicationServiceError {
  return new ApplicationServiceError(
    409,
    'application_event_id_conflict',
    'The Event ID has already been used for a different command',
    { eventId },
  );
}

function boundedDetails(
  details: ApplicationServiceErrorDetails,
): ApplicationServiceErrorDetails {
  return Object.fromEntries(
    Object.entries(details)
      .slice(0, 12)
      .map(([key, value]) => [
        key.slice(0, 80),
        typeof value === 'string' ? value.slice(0, 500) : value,
      ]),
  );
}
