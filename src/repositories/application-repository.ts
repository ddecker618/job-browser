import type { JobDatabase } from '../db/database.js';
import {
  APPLICATION_EVENT_TYPES,
  type ApplicationCorrectionState,
  type ApplicationEventType,
  type ApplicationHistory,
  type ApplicationSupersedeAction,
} from '../domain/application-history.js';
import {
  USER_SELECTABLE_APPLICATION_STATUSES,
  jobStatusForApplicationStatus,
  type ApplicationStatus,
  type OccurrencePrecision,
} from '../domain/application-status.js';
import type { JobStatus } from '../domain/job-status.js';
import type {
  ApplicationTimelineEvent,
  ApplicationListQuery,
} from '../models/application-management.js';
import type { Application } from '../models/application.js';
import {
  APPLICATION_CURSOR_MAX_LENGTH,
  applicationOpaqueIdSchema,
} from '../schemas/application.js';
import {
  isCanonicalUtcMillisecondTimestamp,
  nowUtc,
} from '../utilities/timestamps.js';
import { CompanyRepository } from './company-repository.js';

interface ApplicationRow {
  id: string;
  job_id: string;
  status: string;
  applied_at: string | null;
  applied_at_precision: string | null;
  last_event_at: string | null;
  last_recorded_at: string | null;
  title_at_application: string | null;
  company_at_application: string | null;
  company_id: string | null;
  location_at_application: string | null;
  application_url: string | null;
  source_id: string | null;
  provider_id: string | null;
  source_label: string | null;
  notes: string | null;
  legacy_provenance: string | null;
  submitted_resume_snapshot_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ApplicationEventRow {
  id: string;
  application_id: string;
  job_id: string;
  event_type: string;
  resulting_status: string | null;
  occurred_at: string | null;
  occurred_at_sort: string | null;
  occurrence_precision: string;
  recorded_at_sort: string | null;
  notes: string | null;
  source: string;
  metadata_json: string | null;
  supersedes_event_id: string | null;
  supersede_action: string | null;
  submitted_resume_snapshot_id: string | null;
  created_at: string;
}

interface TimelineRow extends ApplicationEventRow {
  effective: number;
  superseded_by_event_id: string | null;
  other_effective_status_count: number;
}

interface ApplicationCursorPayload {
  v: 1;
  lastRecordedAt: string | null;
  applicationId: string;
}

interface CompatibilityStatusWinnerRow {
  event_type: ApplicationEventType;
  status: ApplicationStatus;
}

const STATUS_WINNER_ORDER_SQL = `
  COALESCE(h.occurred_at_sort, h.recorded_at_sort) DESC,
  h.recorded_at_sort DESC,
  h.id DESC
`;

export type ApplicationRepositoryListOptions = ApplicationListQuery;

export interface ApplicationRepositoryListPage {
  items: Application[];
  nextCursor: string | null;
}

export interface ApplicationJobCreationContext {
  id: string;
  title: string;
  company: string;
  location: string | null;
}

export interface ApplicationSourceMembership {
  sourceId: string;
  providerId: string | null;
  sourceLabel: string;
}

export interface ApplicationBootstrapInput {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  titleAtApplication: string | null;
  companyAtApplication: string | null;
  locationAtApplication: string | null;
  applicationUrl: string | null;
  sourceId: string | null;
  providerId: string | null;
  sourceLabel: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ApplicationEventInsertInput {
  id: string;
  applicationId: string;
  jobId: string;
  eventType: ApplicationEventType;
  resultingStatus: ApplicationStatus | null;
  occurredAt: string | null;
  occurredAtSort: string | null;
  occurrencePrecision: OccurrencePrecision;
  recordedAt: string;
  notes: string | null;
  source: string;
  metadataJson: string | null;
  supersedesEventId: string | null;
  supersedeAction: ApplicationSupersedeAction | null;
  submittedResumeSnapshotId: string | null;
}

export interface ApplicationEventWithCorrectionState {
  event: ApplicationHistory;
  state: ApplicationCorrectionState;
}

export class ApplicationCursorError extends Error {
  public constructor(message = 'Invalid Application list cursor') {
    super(message);
    this.name = 'ApplicationCursorError';
  }
}

export class ApplicationRepository {
  public constructor(private readonly database: JobDatabase) {}

  public findById(applicationId: string): Application | null {
    const row = this.database
      .prepare<
        [string],
        ApplicationRow
      >('SELECT * FROM applications WHERE id = ?')
      .get(applicationId);
    return row === undefined ? null : mapApplication(row);
  }

  public findByJobId(jobId: string): Application | null {
    const row = this.database
      .prepare<
        [string],
        ApplicationRow
      >('SELECT * FROM applications WHERE job_id = ?')
      .get(jobId);
    return row === undefined ? null : mapApplication(row);
  }

  public listApplications(): Application[];
  public listApplications(
    options: ApplicationRepositoryListOptions,
  ): ApplicationRepositoryListPage;
  public listApplications(
    options?: ApplicationRepositoryListOptions,
  ): Application[] | ApplicationRepositoryListPage {
    if (options === undefined) {
      return this.database
        .prepare<[], ApplicationRow>(
          `SELECT * FROM applications
           ORDER BY last_recorded_at DESC, id ASC`,
        )
        .all()
        .map(mapApplication);
    }
    return this.listPage(options);
  }

  public listPage(
    options: ApplicationRepositoryListOptions,
  ): ApplicationRepositoryListPage {
    if (
      !Number.isInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 100
    ) {
      throw new RangeError('Application list limit must be between 1 and 100');
    }

    const cursor =
      options.cursor === undefined ? null : decodeCursor(options.cursor);
    const conditions: string[] = [];
    const parameters: (string | number | null)[] = [];
    if (options.status !== undefined) {
      conditions.push('status = ?');
      parameters.push(options.status);
    }
    if (options.company !== undefined) {
      conditions.push('company_at_application = ? COLLATE NOCASE');
      parameters.push(options.company);
    }
    if (cursor !== null) {
      if (cursor.lastRecordedAt === null) {
        conditions.push('last_recorded_at IS NULL AND id > ?');
        parameters.push(cursor.applicationId);
      } else {
        conditions.push(`(
          last_recorded_at < ?
          OR last_recorded_at IS NULL
          OR (last_recorded_at = ? AND id > ?)
        )`);
        parameters.push(
          cursor.lastRecordedAt,
          cursor.lastRecordedAt,
          cursor.applicationId,
        );
      }
    }

    parameters.push(options.limit + 1);
    const rows = this.database
      .prepare<(string | number | null)[], ApplicationRow>(
        `SELECT * FROM applications
         ${conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`}
         ORDER BY last_recorded_at DESC, id ASC
         LIMIT ?`,
      )
      .all(...parameters);
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    const lastRow = pageRows.at(-1);
    return {
      items: pageRows.map(mapApplication),
      nextCursor:
        hasMore && lastRow !== undefined
          ? encodeCursor({
              v: 1,
              lastRecordedAt: lastRow.last_recorded_at,
              applicationId: lastRow.id,
            })
          : null,
    };
  }

  public getTimeline(applicationId: string): ApplicationTimelineEvent[] {
    return this.timelineRows(applicationId).map(mapTimelineEvent);
  }

  public findTimelineEventById(
    applicationId: string,
    eventId: string,
  ): ApplicationTimelineEvent | null {
    const row = this.timelineRows(applicationId).find(
      (candidate) => candidate.id === eventId,
    );
    return row === undefined ? null : mapTimelineEvent(row);
  }

  public findEventById(eventId: string): ApplicationHistory | null {
    const row = this.database
      .prepare<
        [string],
        ApplicationEventRow
      >('SELECT * FROM application_history WHERE id = ?')
      .get(eventId);
    return row === undefined ? null : mapEvent(row);
  }

  public findEventWithCorrectionState(
    eventId: string,
  ): ApplicationEventWithCorrectionState | null {
    const event = this.findEventById(eventId);
    if (event === null) return null;
    const timeline = this.findTimelineEventById(event.applicationId, event.id);
    if (timeline === null) return null;
    return {
      event,
      state: {
        effective: timeline.effective,
        supersededByEventId: timeline.supersededByEventId,
        terminal: timeline.terminal,
        canReplace: timeline.canReplace,
        canVoid: timeline.canVoid,
        correctionIneligibilityReason: timeline.correctionIneligibilityReason,
      },
    };
  }

  public findJobCreationContext(
    jobId: string,
  ): ApplicationJobCreationContext | null {
    return (
      this.database
        .prepare<
          [string],
          ApplicationJobCreationContext
        >('SELECT id, title, company, location FROM jobs WHERE id = ?')
        .get(jobId) ?? null
    );
  }

  public findSourceMembership(
    jobId: string,
    sourceId: string,
  ): ApplicationSourceMembership | null {
    const row = this.database
      .prepare<
        [string, string],
        {
          source_id: string;
          provider_id: string | null;
          source_label: string;
        }
      >(
        `SELECT job_sources.source_id,
                COALESCE(job_sources.provider_id, sources.provider_id) AS provider_id,
                COALESCE(sources.display_name, sources.employer) AS source_label
           FROM job_sources
           JOIN sources ON sources.id = job_sources.source_id
          WHERE job_sources.job_id = ? AND job_sources.source_id = ?
          ORDER BY job_sources.first_seen_at, job_sources.id
          LIMIT 1`,
      )
      .get(jobId, sourceId);
    return row === undefined
      ? null
      : {
          sourceId: row.source_id,
          providerId: row.provider_id,
          sourceLabel: row.source_label,
        };
  }

  public insertApplication(input: ApplicationBootstrapInput): void {
    this.database
      .prepare(
        `INSERT INTO applications (
          id, job_id, status, applied_at, applied_at_precision, last_event_at,
          last_recorded_at, title_at_application, company_at_application,
          location_at_application, application_url, source_id, provider_id,
          source_label, notes, legacy_provenance, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        input.id,
        input.jobId,
        input.status,
        input.titleAtApplication,
        input.companyAtApplication,
        input.locationAtApplication,
        input.applicationUrl,
        input.sourceId,
        input.providerId,
        input.sourceLabel,
        input.notes,
        input.createdAt,
        input.createdAt,
      );
    new CompanyRepository(this.database).assignApplication(
      input.id,
      input.companyAtApplication,
      'application-exact',
      input.createdAt,
    );
  }

  public insertEvent(input: ApplicationEventInsertInput): void {
    this.database
      .prepare(
        `INSERT INTO application_history (
          id, application_id, job_id, event_type, resulting_status,
          occurred_at, occurred_at_sort, occurrence_precision, recorded_at_sort,
          notes, source, metadata_json, supersedes_event_id, supersede_action,
          submitted_resume_snapshot_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.applicationId,
        input.jobId,
        input.eventType,
        input.resultingStatus,
        input.occurredAt,
        input.occurredAtSort,
        input.occurrencePrecision,
        input.recordedAt,
        input.notes,
        input.source,
        input.metadataJson,
        input.supersedesEventId,
        input.supersedeAction,
        input.submittedResumeSnapshotId,
        input.recordedAt,
      );
  }

  public updateSummaryNotes(
    applicationId: string,
    notes: string | null,
    updatedAt: string,
  ): boolean {
    return (
      this.database
        .prepare(
          'UPDATE applications SET notes = ?, updated_at = ? WHERE id = ?',
        )
        .run(notes, updatedAt, applicationId).changes > 0
    );
  }

  /**
   * Rebuilds the current projection from the canonical effective-event fold.
   */
  public reproject(
    jobId: string,
    updatedAt: string = nowUtc(),
  ): Application | null {
    this.database
      .prepare(
        `UPDATE applications AS app
            SET
              status = (
                SELECT h.resulting_status
                  FROM application_effective_events h
                 WHERE h.application_id = app.id AND h.resulting_status IS NOT NULL
                 ORDER BY ${STATUS_WINNER_ORDER_SQL}
                 LIMIT 1
              ),
              applied_at = (
                SELECT h.occurred_at
                  FROM application_effective_events h
                 WHERE h.application_id = app.id
                   AND h.event_type IN ('applied', 'legacy_applied_date_imported')
                   AND h.occurred_at IS NOT NULL
                 ORDER BY COALESCE(h.occurred_at_sort, h.recorded_at_sort),
                          h.recorded_at_sort,
                          h.id
                 LIMIT 1
              ),
              applied_at_precision = (
                SELECT h.occurrence_precision
                  FROM application_effective_events h
                 WHERE h.application_id = app.id
                   AND h.event_type IN ('applied', 'legacy_applied_date_imported')
                   AND h.occurred_at IS NOT NULL
                 ORDER BY COALESCE(h.occurred_at_sort, h.recorded_at_sort),
                           h.recorded_at_sort,
                           h.id
                 LIMIT 1
              ),
              last_event_at = (
                SELECT MAX(h.occurred_at_sort)
                  FROM application_effective_events h
                 WHERE h.application_id = app.id
              ),
              last_recorded_at = (
                SELECT MAX(h.recorded_at_sort)
                  FROM application_history h
                 WHERE h.application_id = app.id
              ),
              submitted_resume_snapshot_id = (
                SELECT h.submitted_resume_snapshot_id
                  FROM application_effective_events h
                 WHERE h.application_id = app.id
                   AND h.event_type IN ('applied', 'legacy_applied_date_imported')
                   AND h.submitted_resume_snapshot_id IS NOT NULL
                 ORDER BY ${STATUS_WINNER_ORDER_SQL}
                 LIMIT 1
              ),
              updated_at = ?
          WHERE app.job_id = ?`,
      )
      .run(updatedAt, jobId);
    return this.findByJobId(jobId);
  }

  public findPostFoldJobCompatibilityStatus(jobId: string): JobStatus | null {
    const winner = this.database
      .prepare<[string], CompatibilityStatusWinnerRow>(
        `SELECT h.event_type, app.status
           FROM applications app
           JOIN application_effective_events h ON h.application_id = app.id
          WHERE app.job_id = ? AND h.resulting_status IS NOT NULL
          ORDER BY ${STATUS_WINNER_ORDER_SQL}
          LIMIT 1`,
      )
      .get(jobId);
    if (winner === undefined || winner.event_type === 'legacy_state_imported') {
      return null;
    }
    return jobStatusForApplicationStatus(winner.status);
  }

  private timelineRows(applicationId: string): TimelineRow[] {
    return this.database
      .prepare<[string], TimelineRow>(
        `SELECT history.*,
                CASE WHEN effective.id IS NULL THEN 0 ELSE 1 END AS effective,
                superseder.id AS superseded_by_event_id,
                (
                  SELECT COUNT(*)
                    FROM application_effective_events status_event
                   WHERE status_event.application_id = history.application_id
                     AND status_event.resulting_status IS NOT NULL
                     AND status_event.id <> history.id
                ) AS other_effective_status_count
           FROM application_history history
           LEFT JOIN application_effective_events effective
             ON effective.id = history.id
           LEFT JOIN application_history superseder
             ON superseder.supersedes_event_id = history.id
          WHERE history.application_id = ?
          ORDER BY COALESCE(history.occurred_at_sort, history.recorded_at_sort) ASC,
                   history.recorded_at_sort ASC,
                   history.id ASC`,
      )
      .all(applicationId);
  }
}

function mapApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status as ApplicationStatus,
    appliedAt: row.applied_at,
    appliedAtPrecision: nullablePrecision(row.applied_at_precision),
    lastEventAt: row.last_event_at,
    lastRecordedAt: row.last_recorded_at,
    titleAtApplication: row.title_at_application,
    companyAtApplication: row.company_at_application,
    companyId: row.company_id,
    locationAtApplication: row.location_at_application,
    applicationUrl: row.application_url,
    sourceId: row.source_id,
    providerId: row.provider_id,
    sourceLabel: row.source_label,
    notes: row.notes,
    legacyProvenance: row.legacy_provenance,
    submittedResumeSnapshotId: row.submitted_resume_snapshot_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: ApplicationEventRow): ApplicationHistory {
  if (
    !APPLICATION_EVENT_TYPES.includes(row.event_type as ApplicationEventType)
  ) {
    throw new Error(`Invalid Application event type: ${row.event_type}`);
  }
  return {
    id: row.id,
    applicationId: row.application_id,
    jobId: row.job_id,
    eventType: row.event_type as ApplicationEventType,
    resultingStatus:
      row.resulting_status === null
        ? null
        : (row.resulting_status as ApplicationStatus),
    occurredAt: row.occurred_at,
    occurredAtSort: row.occurred_at_sort,
    occurrencePrecision: precision(row.occurrence_precision),
    recordedAt: row.created_at,
    recordedAtSort: row.recorded_at_sort,
    notes: row.notes,
    source: row.source,
    metadataJson: row.metadata_json,
    supersedesEventId: row.supersedes_event_id,
    supersedeAction: nullableSupersedeAction(row.supersede_action),
    submittedResumeSnapshotId: row.submitted_resume_snapshot_id,
    createdAt: row.created_at,
  };
}

function mapTimelineEvent(row: TimelineRow): ApplicationTimelineEvent {
  const event = mapEvent(row);
  const state = correctionState(event, row);
  const metadata = parseMetadata(event.metadataJson);
  return {
    id: event.id,
    applicationId: event.applicationId,
    jobId: event.jobId,
    eventType: event.eventType,
    resultingStatus: event.resultingStatus,
    occurredAt: event.occurredAt,
    occurredAtSort: event.occurredAtSort,
    occurrencePrecision: event.occurrencePrecision,
    recordedAt: event.recordedAt,
    recordedAtSort: event.recordedAtSort,
    notes: event.notes,
    actor: event.source,
    effective: state.effective,
    supersededByEventId: state.supersededByEventId,
    supersedesEventId: event.supersedesEventId,
    supersedeAction: event.supersedeAction,
    submittedResumeSnapshotId: event.submittedResumeSnapshotId,
    terminal: state.terminal,
    canReplace: state.canReplace,
    canVoid: state.canVoid,
    correctionIneligibilityReason: state.correctionIneligibilityReason,
    definitionVersion: boundedMetadataString(metadata?.['definition'], 100),
    correctionReason: timelineCorrectionReason(event, metadata),
  };
}

function correctionState(
  event: ApplicationHistory,
  row: TimelineRow,
): ApplicationCorrectionState {
  const effective = Boolean(row.effective);
  const supersededByEventId = row.superseded_by_event_id;
  const terminal = supersededByEventId === null;
  if (!terminal) {
    return ineligibleState(effective, supersededByEventId, 'superseded');
  }
  if (event.eventType === 'void') {
    return ineligibleState(effective, null, 'void_event');
  }
  if (
    event.source === 'migration' ||
    event.eventType === 'legacy_state_imported' ||
    event.eventType === 'legacy_applied_date_imported'
  ) {
    return ineligibleState(effective, null, 'migration_event');
  }
  if (
    event.recordedAtSort === null ||
    !isCanonicalUtcMillisecondTimestamp(event.recordedAtSort)
  ) {
    return ineligibleState(effective, null, 'missing_recorded_time');
  }
  const statusEvent =
    event.resultingStatus !== null &&
    USER_SELECTABLE_APPLICATION_STATUSES.includes(
      event.eventType as (typeof USER_SELECTABLE_APPLICATION_STATUSES)[number],
    );
  if (!statusEvent && event.eventType !== 'note') {
    return ineligibleState(effective, null, 'unsupported_event_type');
  }
  if (!effective) {
    return ineligibleState(effective, null, 'not_effective');
  }

  const canVoid = !statusEvent || row.other_effective_status_count > 0;
  return {
    effective,
    supersededByEventId: null,
    terminal: true,
    canReplace: true,
    canVoid,
    correctionIneligibilityReason: canVoid ? null : 'final_effective_status',
  };
}

function ineligibleState(
  effective: boolean,
  supersededByEventId: string | null,
  reason: ApplicationCorrectionState['correctionIneligibilityReason'],
): ApplicationCorrectionState {
  return {
    effective,
    supersededByEventId,
    terminal: supersededByEventId === null,
    canReplace: false,
    canVoid: false,
    correctionIneligibilityReason: reason,
  };
}

function timelineCorrectionReason(
  event: ApplicationHistory,
  metadata: Record<string, unknown> | null,
): string | null {
  if (event.supersedeAction === null) return null;
  if (event.supersedeAction === 'replace' && event.eventType === 'note') {
    return boundedMetadataString(metadata?.['correctionReason'], 4_000);
  }
  return event.notes !== null && event.notes.length <= 4_000
    ? event.notes
    : null;
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function boundedMetadataString(
  value: unknown,
  maximumLength: number,
): string | null {
  return typeof value === 'string' && value.length <= maximumLength
    ? value
    : null;
}

function nullablePrecision(value: string | null): OccurrencePrecision | null {
  return value === null ? null : precision(value);
}

function precision(value: string): OccurrencePrecision {
  if (
    value !== 'exact' &&
    value !== 'date' &&
    value !== 'approximate' &&
    value !== 'unknown'
  ) {
    throw new Error(`Invalid occurrence precision: ${value}`);
  }
  return value;
}

function nullableSupersedeAction(
  value: string | null,
): ApplicationSupersedeAction | null {
  if (value === null) return null;
  if (value !== 'replace' && value !== 'void') {
    throw new Error(`Invalid Application supersede action: ${value}`);
  }
  return value;
}

function encodeCursor(payload: ApplicationCursorPayload): string {
  if (!applicationOpaqueIdSchema.safeParse(payload.applicationId).success) {
    throw new ApplicationCursorError();
  }
  const cursor = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  if (cursor.length > APPLICATION_CURSOR_MAX_LENGTH) {
    throw new ApplicationCursorError();
  }
  return cursor;
}

function decodeCursor(value: string): ApplicationCursorPayload {
  if (
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length > APPLICATION_CURSOR_MAX_LENGTH
  ) {
    throw new ApplicationCursorError();
  }
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== value) {
      throw new ApplicationCursorError();
    }
    const parsed: unknown = JSON.parse(decoded);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      !('v' in parsed) ||
      parsed.v !== 1 ||
      !('lastRecordedAt' in parsed) ||
      !('applicationId' in parsed) ||
      (parsed.lastRecordedAt !== null &&
        (typeof parsed.lastRecordedAt !== 'string' ||
          !isCanonicalUtcMillisecondTimestamp(parsed.lastRecordedAt))) ||
      typeof parsed.applicationId !== 'string' ||
      !applicationOpaqueIdSchema.safeParse(parsed.applicationId).success
    ) {
      throw new ApplicationCursorError();
    }
    return {
      v: 1,
      lastRecordedAt: parsed.lastRecordedAt,
      applicationId: parsed.applicationId,
    };
  } catch (error) {
    if (error instanceof ApplicationCursorError) throw error;
    throw new ApplicationCursorError();
  }
}
