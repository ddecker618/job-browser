import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import type { JobDetail } from '../../models/dashboard.js';
import type { CreateApplicationCommand } from '../../models/application-management.js';
import {
  api,
  apiRequestErrorReason,
  ApiRequestError,
  isDefinitiveApiCommandError,
} from '../api.js';
import { invalidateApplicationQueries } from '../applicationCache.js';
import { Dialog } from './Dialog.js';
import {
  createOccurrenceDraft,
  OccurrenceFields,
  occurrenceCommandFields,
  type OccurrenceDraft,
} from './OccurrenceFields.js';

interface AppliedDraft {
  eventId: string;
  title: string;
  company: string;
  location: string;
  occurrence: OccurrenceDraft;
  urlChoice: ApplicationUrlChoice;
  manualUrl: string;
  sourceId: string | null | undefined;
  notes: string;
}

type ApplicationUrlChoice =
  | { kind: 'known'; url: string }
  | { kind: 'manual' }
  | { kind: 'unknown' }
  | null;

export function AppliedCreationDialog({
  job,
  onClose,
}: {
  job: JobDetail;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const formId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<AppliedDraft>(() => createDraft(job));
  const [submittedCommand, setSubmittedCommand] =
    useState<CreateApplicationCommand | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const createApplication = useMutation({
    mutationFn: (command: CreateApplicationCommand) =>
      api.createApplication(command),
    onSuccess: async (result) => {
      await invalidateApplicationQueries(
        client,
        result.application.id,
        result.application.jobId,
      );
      void navigate(
        `/applications/${encodeURIComponent(result.application.id)}`,
      );
    },
    onError: async (error, command) => {
      if (
        error instanceof ApiRequestError &&
        error.status === 409 &&
        error.code === 'application_already_exists'
      ) {
        const existingApplicationId = error.details['existingApplicationId'];
        if (typeof existingApplicationId === 'string') {
          await invalidateApplicationQueries(
            client,
            existingApplicationId,
            command.jobId,
          );
          void navigate(
            `/applications/${encodeURIComponent(existingApplicationId)}`,
          );
        }
      }
    },
  });

  const submit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    try {
      if (submittedCommand !== null) {
        createApplication.mutate(submittedCommand);
        return;
      }
      const applicationUrl = selectedUrl(job, draft);
      const sourceId = selectedSource(job, draft.sourceId);
      const command: CreateApplicationCommand = Object.freeze({
        eventId: draft.eventId,
        jobId: job.id,
        ...occurrenceCommandFields(draft.occurrence),
        titleAtApplication: draft.title,
        companyAtApplication: draft.company,
        locationAtApplication:
          draft.location.trim() === '' ? null : draft.location,
        applicationUrl,
        sourceId,
        notes: draft.notes,
      });
      setSubmittedCommand(command);
      setClientError(null);
      createApplication.mutate(command);
    } catch (error) {
      setClientError(
        error instanceof Error
          ? error.message
          : 'Review the Application details.',
      );
    }
  };
  const commandLocked = submittedCommand !== null;
  const mutationError = createApplication.isError
    ? createApplication.error
    : null;
  const errorReason = apiRequestErrorReason(mutationError);
  const canEditAsNew =
    commandLocked &&
    isDefinitiveApiCommandError(mutationError) &&
    mutationError.code !== 'application_already_exists';
  const unavailableUrl =
    draft.urlChoice?.kind === 'known' &&
    !job.applicationUrls.includes(draft.urlChoice.url)
      ? draft.urlChoice.url
      : null;
  const unavailableSourceId =
    typeof draft.sourceId === 'string' &&
    !job.sources.some((source) => source.sourceId === draft.sourceId)
      ? draft.sourceId
      : null;
  const editAsNewCommand = () => {
    setDraft((current) => ({ ...current, eventId: crypto.randomUUID() }));
    setSubmittedCommand(null);
    setClientError(null);
    createApplication.reset();
  };

  return (
    <Dialog
      title="Confirm Applied application"
      description="Confirm the copied context and when the application was submitted. This creates an immutable Applied event."
      initialFocusRef={titleRef}
      pending={createApplication.isPending}
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            disabled={createApplication.isPending}
            onClick={onClose}
          >
            {commandLocked ? 'Abandon command' : 'Cancel'}
          </button>
          {canEditAsNew ? (
            <button type="button" onClick={editAsNewCommand}>
              Edit as new command
            </button>
          ) : null}
          <button
            type="submit"
            form={formId}
            className="button primary"
            disabled={createApplication.isPending}
          >
            {createApplication.isPending
              ? 'Recording…'
              : commandLocked && createApplication.isError
                ? 'Retry'
                : 'Confirm Applied'}
          </button>
        </>
      }
    >
      <form id={formId} className="application-command-form" onSubmit={submit}>
        <fieldset className="command-fields" disabled={commandLocked}>
          <legend className="visually-hidden">Applied command fields</legend>
          <section className="command-form-section">
            <h3>Copied context</h3>
            <p>
              These editable values are copied into the Application and will not
              follow later Job changes.
            </p>
            <label>
              Application title
              <input
                ref={titleRef}
                required
                maxLength={500}
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Company
              <input
                required
                maxLength={500}
                value={draft.company}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    company: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Location (optional)
              <input
                maxLength={500}
                value={draft.location}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    location: event.target.value,
                  }))
                }
              />
            </label>
          </section>

          <OccurrenceFields
            value={draft.occurrence}
            disabled={commandLocked}
            onChange={(occurrence) =>
              setDraft((current) => ({ ...current, occurrence }))
            }
          />

          <fieldset
            className="application-choice-fieldset"
            aria-required="true"
          >
            <legend>Application URL</legend>
            <p>
              Select a known URL, enter an exact HTTP/HTTPS URL, or choose
              Unknown.
            </p>
            {job.applicationUrls.map((url, index) => (
              <label className="choice-row" key={`${url}-${String(index)}`}>
                <input
                  type="radio"
                  name={`${formId}-url`}
                  required
                  value={url}
                  checked={
                    draft.urlChoice?.kind === 'known' &&
                    draft.urlChoice.url === url
                  }
                  onChange={() =>
                    setDraft((current) => ({
                      ...current,
                      urlChoice: { kind: 'known', url },
                    }))
                  }
                />
                <span>{url}</span>
              </label>
            ))}
            {unavailableUrl === null ? null : (
              <label className="choice-row">
                <input
                  type="radio"
                  name={`${formId}-url`}
                  required
                  value={unavailableUrl}
                  checked
                  onChange={() => undefined}
                />
                <span>Unavailable Application URL · {unavailableUrl}</span>
              </label>
            )}
            <label className="choice-row">
              <input
                type="radio"
                name={`${formId}-url`}
                required
                value="manual"
                checked={draft.urlChoice?.kind === 'manual'}
                onChange={() =>
                  setDraft((current) => ({
                    ...current,
                    urlChoice: { kind: 'manual' },
                  }))
                }
              />
              <span>Enter another URL</span>
            </label>
            {draft.urlChoice?.kind === 'manual' ? (
              <label>
                Exact HTTP/HTTPS URL
                <input
                  type="url"
                  required
                  maxLength={2_048}
                  placeholder="https://…"
                  value={draft.manualUrl}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      manualUrl: event.target.value,
                    }))
                  }
                />
              </label>
            ) : null}
            <label className="choice-row">
              <input
                type="radio"
                name={`${formId}-url`}
                required
                value="unknown"
                checked={draft.urlChoice?.kind === 'unknown'}
                onChange={() =>
                  setDraft((current) => ({
                    ...current,
                    urlChoice: { kind: 'unknown' },
                  }))
                }
              />
              <span>Unknown Application URL</span>
            </label>
          </fieldset>

          <fieldset
            className="application-choice-fieldset"
            aria-required="true"
          >
            <legend>Source</legend>
            <p>Source and provider labels are copied by the backend.</p>
            {job.sources.map((source) => (
              <label className="choice-row" key={source.sourceId}>
                <input
                  type="radio"
                  name={`${formId}-source`}
                  required
                  value={source.sourceId}
                  checked={draft.sourceId === source.sourceId}
                  onChange={() =>
                    setDraft((current) => ({
                      ...current,
                      sourceId: source.sourceId,
                    }))
                  }
                />
                <span>
                  {source.sourceLabel} ·{' '}
                  {source.providerId ?? 'provider unknown'} · Source ID{' '}
                  {source.sourceId}
                </span>
              </label>
            ))}
            {unavailableSourceId === null ? null : (
              <label className="choice-row">
                <input
                  type="radio"
                  name={`${formId}-source`}
                  required
                  value={unavailableSourceId}
                  checked
                  onChange={() => undefined}
                />
                <span>
                  Unavailable Source · Source ID {unavailableSourceId}
                </span>
              </label>
            )}
            <label className="choice-row">
              <input
                type="radio"
                name={`${formId}-source`}
                required
                value="unknown"
                checked={draft.sourceId === null}
                onChange={() =>
                  setDraft((current) => ({
                    ...current,
                    sourceId: null,
                  }))
                }
              />
              <span>Unknown / no source</span>
            </label>
          </fieldset>

          <label>
            Applied event notes (optional)
            <textarea
              maxLength={4_000}
              value={draft.notes}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
            />
          </label>
        </fieldset>
        {(clientError ?? mutationError?.message) ? (
          <p className="source-error" role="alert">
            <span>{clientError ?? mutationError?.message}</span>
            {errorReason === null ? null : (
              <span className="command-error-reason">
                Reason: {errorReason}
              </span>
            )}
          </p>
        ) : null}
        {commandLocked && createApplication.isError ? (
          <p className="immutable-command-copy">
            Retry resends this exact locked command. Close the dialog to abandon
            it and start a new command with a new Event ID.
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

function createDraft(job: JobDetail): AppliedDraft {
  return {
    eventId: crypto.randomUUID(),
    title: job.title,
    company: job.company,
    location: job.location ?? '',
    occurrence: createOccurrenceDraft(),
    urlChoice:
      job.applicationUrls.length === 1
        ? { kind: 'known', url: job.applicationUrls[0] ?? '' }
        : job.applicationUrls.length === 0
          ? { kind: 'unknown' }
          : null,
    manualUrl: '',
    sourceId:
      job.sources.length === 1
        ? job.sources[0]?.sourceId
        : job.sources.length === 0
          ? null
          : undefined,
    notes: '',
  };
}

function selectedUrl(job: JobDetail, draft: AppliedDraft): string | null {
  if (draft.urlChoice?.kind === 'unknown') return null;
  if (draft.urlChoice?.kind === 'manual') {
    const value = draft.manualUrl.trim();
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error('Enter an absolute HTTP or HTTPS Application URL.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Enter an absolute HTTP or HTTPS Application URL.');
    }
    return value;
  }
  if (draft.urlChoice?.kind !== 'known') {
    throw new Error('Choose an Application URL or explicitly choose Unknown.');
  }
  if (!job.applicationUrls.includes(draft.urlChoice.url)) {
    throw new Error(
      'The selected Application URL is no longer available. Choose again or close this dialog.',
    );
  }
  return draft.urlChoice.url;
}

function selectedSource(
  job: JobDetail,
  sourceId: string | null | undefined,
): string | null {
  if (sourceId === null) return null;
  if (sourceId === undefined) {
    throw new Error('Choose a Source or explicitly choose Unknown.');
  }
  if (!job.sources.some((source) => source.sourceId === sourceId)) {
    throw new Error(
      'The selected Source is no longer available. Choose again or close this dialog.',
    );
  }
  return sourceId;
}
