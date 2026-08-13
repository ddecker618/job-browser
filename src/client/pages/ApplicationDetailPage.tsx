import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';

import {
  APPLICATION_LIFECYCLE_STATUSES,
  USER_SELECTABLE_APPLICATION_STATUSES,
  type ApplicationLifecycleStatus,
  type UserSelectableApplicationStatus,
} from '../../domain/application-status.js';
import type {
  ApplicationEventCommand,
  ApplicationTimelineEvent,
} from '../../models/application-management.js';
import {
  api,
  apiRequestErrorReason,
  ApiRequestError,
  isDefinitiveApiCommandError,
} from '../api.js';
import { invalidateApplicationQueries } from '../applicationCache.js';
import {
  applicationEventLabel,
  applicationStatusLabel,
  correctionIneligibilityLabel,
  formatOccurrence,
  formatRecordedAt,
  occurrencePrecisionLabel,
} from '../applicationFormatting.js';
import { Dialog } from '../components/Dialog.js';
import {
  createOccurrenceDraft,
  OccurrenceFields,
  occurrenceCommandFields,
  occurrenceDraftFrom,
  type OccurrenceDraft,
} from '../components/OccurrenceFields.js';
import { PageHeader } from '../components/PageHeader.js';
import { ErrorState, LoadingState } from '../components/States.js';

type EventDialogState =
  | {
      kind: 'lifecycle';
      eventId: string;
      eventType: ApplicationLifecycleStatus;
      occurrence: OccurrenceDraft;
      notes: string;
    }
  | {
      kind: 'note';
      eventId: string;
      occurrence: OccurrenceDraft;
      text: string;
    }
  | {
      kind: 'replace-status';
      eventId: string;
      targetEventId: string;
      replacementEventType: UserSelectableApplicationStatus;
      occurrence: OccurrenceDraft;
      reason: string;
    }
  | {
      kind: 'replace-note';
      eventId: string;
      targetEventId: string;
      occurrence: OccurrenceDraft;
      text: string;
      reason: string;
    }
  | {
      kind: 'void';
      eventId: string;
      targetEventId: string;
      reason: string;
    };

interface SummaryNotesDraft {
  applicationId: string;
  value: string;
  dirty: boolean;
}

interface SummaryNotesSubmission {
  applicationId: string;
  notes: string;
}

export function ApplicationDetailPage() {
  const { applicationId = '' } = useParams<{ applicationId: string }>();
  const client = useQueryClient();
  const eventFormId = useId();
  const detail = useQuery({
    queryKey: ['application', applicationId],
    queryFn: ({ signal }) => api.getApplication(applicationId, signal),
    enabled: applicationId !== '',
  });
  const timeline = useQuery({
    queryKey: ['application-timeline', applicationId],
    queryFn: ({ signal }) => api.getApplicationTimeline(applicationId, signal),
    enabled: applicationId !== '',
  });
  const [summaryNotes, setSummaryNotes] = useState<SummaryNotesDraft>({
    applicationId,
    value: '',
    dirty: false,
  });
  const [eventDialog, setEventDialog] = useState<EventDialogState | null>(null);
  const [submittedEventCommand, setSubmittedEventCommand] =
    useState<ApplicationEventCommand | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  useEffect(() => {
    if (detail.data === undefined) return;
    setSummaryNotes((current) => {
      if (current.applicationId === applicationId && current.dirty) {
        return current;
      }
      const value = detail.data.notes ?? '';
      if (
        current.applicationId === applicationId &&
        current.value === value &&
        !current.dirty
      ) {
        return current;
      }
      return { applicationId, value, dirty: false };
    });
  }, [applicationId, detail.data]);

  const saveNotes = useMutation({
    mutationFn: (submission: SummaryNotesSubmission) =>
      api.updateApplicationNotes(submission.applicationId, {
        notes: submission.notes,
      }),
    onSuccess: async (result, submission) => {
      setSummaryNotes((current) =>
        current.applicationId === submission.applicationId
          ? {
              applicationId: submission.applicationId,
              value: result.application.notes ?? '',
              dirty: false,
            }
          : current,
      );
      await invalidateApplicationQueries(
        client,
        result.application.id,
        result.application.jobId,
      );
    },
  });
  const appendEvent = useMutation({
    mutationFn: (command: ApplicationEventCommand) =>
      api.appendApplicationEvent(applicationId, command),
    onSuccess: async (result) => {
      setEventDialog(null);
      setSubmittedEventCommand(null);
      setDialogError(null);
      await invalidateApplicationQueries(
        client,
        result.application.id,
        result.application.jobId,
      );
    },
    onError: async (error) => {
      if (isCorrectionStateConflict(error)) {
        await invalidateApplicationQueries(
          client,
          applicationId,
          detail.data?.jobId,
        );
      }
    },
  });

  if (applicationId === '') {
    return (
      <ErrorState
        error={new Error('Application ID is missing.')}
        title="Application unavailable"
      />
    );
  }
  if (detail.isPending || timeline.isPending) {
    return <LoadingState label="Loading application history" />;
  }
  if (detail.isError) {
    return <ErrorState error={detail.error} title="Application unavailable" />;
  }
  if (timeline.isError) {
    return <ErrorState error={timeline.error} title="Timeline unavailable" />;
  }

  const application = detail.data;
  const events = timeline.data;
  const eventIndexes = new Map(
    events.map((event, index) => [event.id, index] as const),
  );
  const lastEffectiveEvent = [...events]
    .reverse()
    .find((event) => event.effective);

  const openDialog = (state: EventDialogState) => {
    appendEvent.reset();
    setSubmittedEventCommand(null);
    setDialogError(null);
    setEventDialog(state);
  };
  const closeDialog = () => {
    if (appendEvent.isPending) return;
    appendEvent.reset();
    setSubmittedEventCommand(null);
    setDialogError(null);
    setEventDialog(null);
  };
  const submitEvent = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    if (eventDialog === null) return;
    try {
      if (submittedEventCommand !== null) {
        appendEvent.mutate(submittedEventCommand);
        return;
      }
      let command: ApplicationEventCommand;
      if (eventDialog.kind === 'lifecycle') {
        command = {
          kind: 'lifecycle',
          eventId: eventDialog.eventId,
          eventType: eventDialog.eventType,
          ...occurrenceCommandFields(eventDialog.occurrence),
          notes: eventDialog.notes,
        };
      } else if (eventDialog.kind === 'note') {
        command = {
          kind: 'note',
          eventId: eventDialog.eventId,
          ...occurrenceCommandFields(eventDialog.occurrence),
          text: eventDialog.text,
        };
      } else if (eventDialog.kind === 'replace-status') {
        command = {
          kind: 'replace',
          eventId: eventDialog.eventId,
          targetEventId: eventDialog.targetEventId,
          replacementEventType: eventDialog.replacementEventType,
          ...occurrenceCommandFields(eventDialog.occurrence),
          reason: eventDialog.reason,
        };
      } else if (eventDialog.kind === 'replace-note') {
        command = {
          kind: 'replace',
          eventId: eventDialog.eventId,
          targetEventId: eventDialog.targetEventId,
          replacementEventType: 'note',
          ...occurrenceCommandFields(eventDialog.occurrence),
          text: eventDialog.text,
          reason: eventDialog.reason,
        };
      } else {
        command = {
          kind: 'void',
          eventId: eventDialog.eventId,
          targetEventId: eventDialog.targetEventId,
          reason: eventDialog.reason,
        };
      }
      command = Object.freeze(command);
      setSubmittedEventCommand(command);
      setDialogError(null);
      appendEvent.mutate(command);
    } catch (error) {
      setDialogError(
        error instanceof Error ? error.message : 'Check the occurrence value.',
      );
    }
  };
  const openReplacement = (target: ApplicationTimelineEvent) => {
    const occurrence = occurrenceDraftFrom(
      target.occurredAt,
      target.occurrencePrecision,
    );
    if (target.eventType === 'note') {
      openDialog({
        kind: 'replace-note',
        eventId: newEventId(),
        targetEventId: target.id,
        occurrence,
        text: target.notes ?? '',
        reason: '',
      });
      return;
    }
    openDialog({
      kind: 'replace-status',
      eventId: newEventId(),
      targetEventId: target.id,
      replacementEventType: isUserSelectableStatus(target.resultingStatus)
        ? target.resultingStatus
        : 'applied',
      occurrence,
      reason: '',
    });
  };
  const commandLocked = submittedEventCommand !== null;
  const eventMutationError = appendEvent.isError ? appendEvent.error : null;
  const eventErrorReason = apiRequestErrorReason(eventMutationError);
  const canEditEventAsNew =
    commandLocked && isDefinitiveApiCommandError(eventMutationError);
  const editEventAsNewCommand = () => {
    setEventDialog((current) =>
      current === null ? null : { ...current, eventId: newEventId() },
    );
    setSubmittedEventCommand(null);
    setDialogError(null);
    appendEvent.reset();
  };

  return (
    <>
      <PageHeader
        eyebrow="Application record"
        title={application.titleAtApplication ?? 'Unknown title'}
        description={`Copied context for Application ${application.id}`}
        actions={
          <Link className="button" to="/applications">
            Back to applications
          </Link>
        }
      />

      <section
        className="application-detail-grid"
        aria-label="Application summary"
      >
        <article className="panel copied-context-panel">
          <div className="application-section-heading">
            <div>
              <span className="eyebrow">Historical snapshot</span>
              <h3>Copied application context</h3>
            </div>
            <span className="application-state-label">
              {applicationStatusLabel(application.status)}
            </span>
          </div>
          <dl className="application-context-list">
            <div>
              <dt>Title</dt>
              <dd>{application.titleAtApplication ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Company</dt>
              <dd>{application.companyAtApplication ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{application.locationAtApplication ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Source label</dt>
              <dd>{application.sourceLabel ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Source ID</dt>
              <dd>{application.sourceId ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd>{application.providerId ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Applied</dt>
              <dd>
                {formatOccurrence(
                  application.appliedAt,
                  application.appliedAtPrecision,
                )}
              </dd>
            </div>
            <div>
              <dt>Last effective occurrence</dt>
              <dd>
                {lastEffectiveEvent === undefined
                  ? 'Unknown'
                  : formatOccurrence(
                      lastEffectiveEvent.occurredAt,
                      lastEffectiveEvent.occurrencePrecision,
                    )}
              </dd>
            </div>
            <div>
              <dt>Recent recorded activity</dt>
              <dd>{formatRecordedAt(application.lastRecordedAt)}</dd>
            </div>
            <div>
              <dt>Internal Job</dt>
              <dd>
                <Link to={`/jobs?job=${encodeURIComponent(application.jobId)}`}>
                  View retained Job
                </Link>
              </dd>
            </div>
            <div>
              <dt>Application URL</dt>
              <dd>
                {application.applicationUrl === null ? (
                  'Unknown'
                ) : (
                  <span className="application-retained-link">
                    <span>{application.applicationUrl}</span>
                    <a
                      href={application.applicationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open application URL
                    </a>
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </article>

        <form
          className="panel application-notes-panel"
          onSubmit={(event) => {
            event.preventDefault();
            saveNotes.mutate(
              Object.freeze({
                applicationId,
                notes: summaryNotes.value,
              }),
            );
          }}
        >
          <span className="eyebrow">Mutable summary</span>
          <h3>Application summary notes</h3>
          <p>
            Separate from Job notes and immutable timeline Note events. Blank or
            whitespace-only content is saved as no summary.
          </p>
          <label>
            Summary notes
            <textarea
              maxLength={10_000}
              disabled={saveNotes.isPending}
              value={summaryNotes.value}
              onChange={(event) =>
                setSummaryNotes({
                  applicationId,
                  value: event.target.value,
                  dirty: true,
                })
              }
            />
          </label>
          <div className="notes-actions">
            <span>
              {summaryNotes.value.length.toLocaleString()} / 10,000
              {summaryNotes.dirty ? ' · Unsaved' : ''}
            </span>
            <button
              type="submit"
              className="button primary"
              disabled={saveNotes.isPending}
            >
              {saveNotes.isPending ? 'Saving…' : 'Save summary notes'}
            </button>
          </div>
          {saveNotes.isError ? (
            <p className="source-error" role="alert">
              {saveNotes.error.message}
            </p>
          ) : null}
        </form>
      </section>

      <section
        className="application-timeline-section"
        aria-labelledby="timeline-heading"
      >
        <div className="timeline-heading">
          <div>
            <span className="eyebrow">Immutable audit ledger</span>
            <h3 id="timeline-heading">Application timeline</h3>
            <p>
              Timeline Note events and lifecycle facts remain in this ledger;
              corrections append new records rather than editing history.
            </p>
          </div>
          <div className="page-actions">
            <button
              type="button"
              onClick={() =>
                openDialog({
                  kind: 'lifecycle',
                  eventId: newEventId(),
                  eventType: APPLICATION_LIFECYCLE_STATUSES[0],
                  occurrence: createOccurrenceDraft(),
                  notes: '',
                })
              }
            >
              Add lifecycle event
            </button>
            <button
              type="button"
              onClick={() =>
                openDialog({
                  kind: 'note',
                  eventId: newEventId(),
                  occurrence: createOccurrenceDraft(),
                  text: '',
                })
              }
            >
              Add timeline note
            </button>
          </div>
        </div>

        <ol className="application-timeline">
          {events.map((timelineEvent, index) => {
            const eventId = timelineDomId(index);
            return (
              <li key={timelineEvent.id} id={eventId}>
                <article>
                  <div className="timeline-event-heading">
                    <div>
                      <span className="timeline-index">
                        Event {String(index + 1)}
                      </span>
                      <h4>{applicationEventLabel(timelineEvent.eventType)}</h4>
                    </div>
                    <div className="timeline-state-labels">
                      <span>
                        {timelineEvent.effective
                          ? 'Effective'
                          : 'Not effective'}
                      </span>
                      {timelineEvent.supersededByEventId === null ? null : (
                        <span>Superseded</span>
                      )}
                      {timelineEvent.supersedeAction === 'replace' ? (
                        <span>Replacement</span>
                      ) : null}
                      {timelineEvent.eventType === 'void' ? (
                        <span>Void</span>
                      ) : null}
                    </div>
                  </div>
                  <p className="timeline-occurrence">
                    <time dateTime={timelineEvent.occurredAt ?? undefined}>
                      {formatOccurrence(
                        timelineEvent.occurredAt,
                        timelineEvent.occurrencePrecision,
                      )}
                    </time>
                    <span>
                      {occurrencePrecisionLabel(
                        timelineEvent.occurrencePrecision,
                      )}
                    </span>
                  </p>
                  {timelineEvent.notes === null ? null : (
                    <p className="timeline-notes">
                      <strong>
                        {timelineEvent.eventType === 'note'
                          ? 'Note text:'
                          : timelineEvent.supersedeAction === null
                            ? 'Event notes:'
                            : 'Correction reason:'}
                      </strong>{' '}
                      {timelineEvent.notes}
                    </p>
                  )}
                  {timelineEvent.supersedesEventId === null ? null : (
                    <p className="timeline-correction-link">
                      {timelineEvent.supersedeAction === 'void'
                        ? 'Voids original event '
                        : 'Replaces original event '}
                      <EventReference
                        eventId={timelineEvent.supersedesEventId}
                        indexes={eventIndexes}
                      />
                    </p>
                  )}
                  {timelineEvent.supersededByEventId === null ? null : (
                    <p className="timeline-correction-link">
                      Superseded by{' '}
                      <EventReference
                        eventId={timelineEvent.supersededByEventId}
                        indexes={eventIndexes}
                      />
                    </p>
                  )}
                  {timelineEvent.correctionReason === null ||
                  timelineEvent.correctionReason ===
                    timelineEvent.notes ? null : (
                    <p className="timeline-notes">
                      <strong>Correction reason:</strong>{' '}
                      {timelineEvent.correctionReason}
                    </p>
                  )}
                  <details>
                    <summary>Audit detail</summary>
                    <dl className="timeline-audit-detail">
                      <div>
                        <dt>Event ID</dt>
                        <dd>{timelineEvent.id}</dd>
                      </div>
                      <div>
                        <dt>Recorded</dt>
                        <dd>
                          <time dateTime={timelineEvent.recordedAt}>
                            {formatRecordedAt(timelineEvent.recordedAt)}
                          </time>
                        </dd>
                      </div>
                      <div>
                        <dt>Actor</dt>
                        <dd>{timelineEvent.actor}</dd>
                      </div>
                      <div>
                        <dt>Resulting status</dt>
                        <dd>
                          {timelineEvent.resultingStatus === null
                            ? 'No status change'
                            : applicationStatusLabel(
                                timelineEvent.resultingStatus,
                              )}
                        </dd>
                      </div>
                      <div>
                        <dt>Definition</dt>
                        <dd>{timelineEvent.definitionVersion ?? 'Unknown'}</dd>
                      </div>
                      {(timelineEvent.occurrencePrecision === 'approximate' ||
                        timelineEvent.occurrencePrecision === 'unknown') &&
                      timelineEvent.occurredAt !== null ? (
                        <div>
                          <dt>Retained occurrence source</dt>
                          <dd>{timelineEvent.occurredAt}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Correction state</dt>
                        <dd>{correctionStateLabel(timelineEvent)}</dd>
                      </div>
                    </dl>
                  </details>
                  {timelineEvent.correctionIneligibilityReason ===
                  null ? null : (
                    <p className="correction-ineligible">
                      {correctionIneligibilityLabel(
                        timelineEvent.correctionIneligibilityReason,
                      )}
                    </p>
                  )}
                  {timelineEvent.canReplace || timelineEvent.canVoid ? (
                    <div className="timeline-actions">
                      {timelineEvent.canReplace ? (
                        <button
                          type="button"
                          onClick={() => openReplacement(timelineEvent)}
                        >
                          Replace event
                        </button>
                      ) : null}
                      {timelineEvent.canVoid ? (
                        <button
                          type="button"
                          className="danger"
                          onClick={() =>
                            openDialog({
                              kind: 'void',
                              eventId: newEventId(),
                              targetEventId: timelineEvent.id,
                              reason: '',
                            })
                          }
                        >
                          Void event
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ol>
      </section>

      {eventDialog === null ? null : (
        <Dialog
          title={dialogTitle(eventDialog.kind)}
          description={dialogDescription(eventDialog.kind)}
          pending={appendEvent.isPending}
          onClose={closeDialog}
          actions={
            <>
              <button
                type="button"
                disabled={appendEvent.isPending}
                onClick={closeDialog}
              >
                {commandLocked ? 'Abandon command' : 'Cancel'}
              </button>
              {canEditEventAsNew ? (
                <button type="button" onClick={editEventAsNewCommand}>
                  Edit as new command
                </button>
              ) : null}
              <button
                type="submit"
                form={eventFormId}
                className={
                  eventDialog.kind === 'void'
                    ? 'button danger'
                    : 'button primary'
                }
                disabled={appendEvent.isPending}
              >
                {appendEvent.isPending
                  ? 'Recording…'
                  : commandLocked && appendEvent.isError
                    ? 'Retry'
                    : eventDialog.kind === 'void'
                      ? 'Confirm Void'
                      : 'Record event'}
              </button>
            </>
          }
        >
          <form
            id={eventFormId}
            className="application-command-form"
            onSubmit={submitEvent}
          >
            <fieldset className="command-fields" disabled={commandLocked}>
              <legend className="visually-hidden">Event command fields</legend>
              {eventDialog.kind === 'lifecycle' ? (
                <>
                  <label>
                    Lifecycle event
                    <select
                      value={eventDialog.eventType}
                      onChange={(event) =>
                        setEventDialog((current) =>
                          current?.kind === 'lifecycle'
                            ? {
                                ...current,
                                eventType: event.target
                                  .value as ApplicationLifecycleStatus,
                              }
                            : current,
                        )
                      }
                    >
                      {APPLICATION_LIFECYCLE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {applicationStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <OccurrenceFields
                    value={eventDialog.occurrence}
                    disabled={commandLocked}
                    onChange={(occurrence) =>
                      setEventDialog((current) =>
                        current?.kind === 'lifecycle'
                          ? { ...current, occurrence }
                          : current,
                      )
                    }
                  />
                  <label>
                    Event notes (optional)
                    <textarea
                      maxLength={4_000}
                      value={eventDialog.notes}
                      onChange={(event) =>
                        setEventDialog((current) =>
                          current?.kind === 'lifecycle'
                            ? { ...current, notes: event.target.value }
                            : current,
                        )
                      }
                    />
                  </label>
                </>
              ) : eventDialog.kind === 'note' ? (
                <>
                  <p className="immutable-command-copy">
                    This Note becomes an immutable timeline event. Correcting it
                    later appends another audit record.
                  </p>
                  <label>
                    Timeline Note text
                    <textarea
                      required
                      maxLength={4_000}
                      value={eventDialog.text}
                      onChange={(event) =>
                        setEventDialog((current) =>
                          current?.kind === 'note'
                            ? { ...current, text: event.target.value }
                            : current,
                        )
                      }
                    />
                  </label>
                  <OccurrenceFields
                    value={eventDialog.occurrence}
                    disabled={commandLocked}
                    onChange={(occurrence) =>
                      setEventDialog((current) =>
                        current?.kind === 'note'
                          ? { ...current, occurrence }
                          : current,
                      )
                    }
                  />
                </>
              ) : eventDialog.kind === 'replace-status' ? (
                <>
                  <p className="command-target-id">
                    Replacing event <strong>{eventDialog.targetEventId}</strong>
                  </p>
                  <label>
                    Replacement status
                    <select
                      value={eventDialog.replacementEventType}
                      onChange={(event) =>
                        setEventDialog((current) =>
                          current?.kind === 'replace-status'
                            ? {
                                ...current,
                                replacementEventType: event.target
                                  .value as UserSelectableApplicationStatus,
                              }
                            : current,
                        )
                      }
                    >
                      {USER_SELECTABLE_APPLICATION_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {applicationStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <OccurrenceFields
                    value={eventDialog.occurrence}
                    disabled={commandLocked}
                    onChange={(occurrence) =>
                      setEventDialog((current) =>
                        current?.kind === 'replace-status'
                          ? { ...current, occurrence }
                          : current,
                      )
                    }
                  />
                  <ReasonField
                    value={eventDialog.reason}
                    onChange={(reason) =>
                      setEventDialog((current) =>
                        current?.kind === 'replace-status'
                          ? { ...current, reason }
                          : current,
                      )
                    }
                  />
                </>
              ) : eventDialog.kind === 'replace-note' ? (
                <>
                  <p className="command-target-id">
                    Replacing Note event{' '}
                    <strong>{eventDialog.targetEventId}</strong>
                  </p>
                  <label>
                    Complete replacement Note text
                    <textarea
                      required
                      maxLength={4_000}
                      value={eventDialog.text}
                      onChange={(event) =>
                        setEventDialog((current) =>
                          current?.kind === 'replace-note'
                            ? { ...current, text: event.target.value }
                            : current,
                        )
                      }
                    />
                  </label>
                  <OccurrenceFields
                    value={eventDialog.occurrence}
                    disabled={commandLocked}
                    onChange={(occurrence) =>
                      setEventDialog((current) =>
                        current?.kind === 'replace-note'
                          ? { ...current, occurrence }
                          : current,
                      )
                    }
                  />
                  <ReasonField
                    value={eventDialog.reason}
                    onChange={(reason) =>
                      setEventDialog((current) =>
                        current?.kind === 'replace-note'
                          ? { ...current, reason }
                          : current,
                      )
                    }
                  />
                </>
              ) : (
                <>
                  <p className="void-warning">
                    The original event{' '}
                    <strong>{eventDialog.targetEventId}</strong> remains in the
                    audit ledger. Void appends a correction record; it does not
                    delete history.
                  </p>
                  <ReasonField
                    value={eventDialog.reason}
                    onChange={(reason) =>
                      setEventDialog((current) =>
                        current?.kind === 'void'
                          ? { ...current, reason }
                          : current,
                      )
                    }
                  />
                </>
              )}
            </fieldset>
            {(dialogError ?? eventMutationError?.message) ? (
              <p className="source-error" role="alert">
                <span>{dialogError ?? eventMutationError?.message}</span>
                {eventErrorReason === null ? null : (
                  <span className="command-error-reason">
                    Reason: {eventErrorReason}
                  </span>
                )}
              </p>
            ) : null}
            {commandLocked && appendEvent.isError ? (
              <p className="immutable-command-copy">
                Retry resends this exact locked command. Close the dialog to
                abandon it and start a new command with a new Event ID.
              </p>
            ) : null}
          </form>
        </Dialog>
      )}
    </>
  );
}

function EventReference({
  eventId,
  indexes,
}: {
  eventId: string;
  indexes: ReadonlyMap<string, number>;
}) {
  const index = indexes.get(eventId);
  return index === undefined ? (
    <span>{eventId}</span>
  ) : (
    <a href={`#${timelineDomId(index)}`}>{eventId}</a>
  );
}

function ReasonField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      Correction reason (optional)
      <textarea
        maxLength={4_000}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function timelineDomId(index: number): string {
  return `application-event-${String(index + 1)}`;
}

function newEventId(): string {
  return crypto.randomUUID();
}

function isUserSelectableStatus(
  value: ApplicationTimelineEvent['resultingStatus'],
): value is UserSelectableApplicationStatus {
  return (
    value !== null &&
    USER_SELECTABLE_APPLICATION_STATUSES.some((status) => status === value)
  );
}

function correctionStateLabel(event: ApplicationTimelineEvent): string {
  if (event.supersededByEventId !== null || !event.terminal) {
    return 'Superseded ancestor';
  }
  if (event.supersedeAction === 'replace') return 'Terminal replacement';
  if (event.eventType === 'void' || event.supersedeAction === 'void') {
    return 'Terminal Void';
  }
  return 'Uncorrected terminal event';
}

function isCorrectionStateConflict(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    error.status === 409 &&
    (error.code.startsWith('application_correction_') ||
      error.code === 'application_final_status_required')
  );
}

function dialogTitle(kind: EventDialogState['kind']): string {
  if (kind === 'lifecycle') return 'Add lifecycle event';
  if (kind === 'note') return 'Add timeline Note';
  if (kind === 'replace-status') return 'Replace status event';
  if (kind === 'replace-note') return 'Replace timeline Note';
  return 'Void event';
}

function dialogDescription(kind: EventDialogState['kind']): string {
  if (kind === 'void') {
    return 'Confirm an append-only correction without entering a new occurrence.';
  }
  if (kind === 'replace-status' || kind === 'replace-note') {
    return 'The replacement is a complete new event; omitted values are not inherited.';
  }
  return 'Record what happened without enforcing a transition sequence.';
}
