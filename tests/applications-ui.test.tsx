// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/client/App.js';
import { api, ApiRequestError } from '../src/client/api.js';
import { formatDateOnly } from '../src/client/applicationFormatting.js';
import { AppliedCreationDialog } from '../src/client/components/AppliedCreationDialog.js';
import { Dialog } from '../src/client/components/Dialog.js';
import { JobDetailPanel } from '../src/client/components/JobDetailPanel.js';
import { occurrenceCommandFields } from '../src/client/components/OccurrenceFields.js';
import { ApplicationDetailPage } from '../src/client/pages/ApplicationDetailPage.js';
import { ApplicationsPage } from '../src/client/pages/ApplicationsPage.js';
import type {
  ApplicationDetail,
  ApplicationListItem,
  ApplicationTimelineEvent,
} from '../src/models/application-management.js';
import type { JobDetail } from '../src/models/dashboard.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Applications API client', () => {
  it('forwards one filter and an opaque cursor without decoding it', async () => {
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url.toString());
      return listResponse([]);
    });

    await api.listApplications({
      limit: 50,
      status: 'phone_screen',
      company: 'A&B Company',
      cursor: 'opaque+/=._~',
    });

    const requestUrl = new URL(calls[0] ?? '', 'http://localhost');
    expect(requestUrl.pathname).toBe('/api/applications');
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      limit: '50',
      status: 'phone_screen',
      company: 'A&B Company',
      cursor: 'opaque+/=._~',
    });
  });

  it('throws a typed bounded error while retaining the API message', async () => {
    mockFetch(() =>
      response(
        {
          error: 'An Application already exists for this Job',
          code: 'application_already_exists',
          details: Object.fromEntries(
            Array.from({ length: 15 }, (_, index) => [
              `detail-${String(index)}`,
              'x'.repeat(700),
            ]),
          ),
        },
        409,
      ),
    );

    const error = await api
      .createApplication(createCommand('event-error'))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 409,
      code: 'application_already_exists',
      message: 'An Application already exists for this Job',
    });
    expect(Object.keys((error as ApiRequestError).details)).toHaveLength(12);
    expect(String((error as ApiRequestError).details['detail-0']).length).toBe(
      500,
    );
  });
});

describe('Application occurrence fields', () => {
  it('rejects a normalized DST-gap wall time and converts a valid local time', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      expect(() =>
        occurrenceCommandFields({
          precision: 'exact',
          exactLocal: '2026-03-08T02:30',
          date: '2026-03-08',
        }),
      ).toThrow('valid local occurrence');
      expect(
        occurrenceCommandFields({
          precision: 'exact',
          exactLocal: '2026-03-08T01:30',
          date: '2026-03-08',
        }),
      ).toEqual({
        occurredAt: '2026-03-08T06:30:00.000Z',
        occurrencePrecision: 'exact',
      });
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});

describe('Applications routes and list', () => {
  it('renders the lazy route and explicitly names every responsive nav link', async () => {
    mockFetch((url) => {
      if (url.pathname === '/api/sources/control-center') {
        return { summary: {}, discovery: { running: false } };
      }
      if (url.pathname === '/api/applications') return listResponse([]);
      return {};
    });
    renderPage(<App />, ['/applications']);

    expect(
      await screen.findByRole('heading', { name: 'Applications', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveAttribute(
      'aria-label',
      'Jobs',
    );
    expect(screen.getByRole('link', { name: 'Applications' })).toHaveAttribute(
      'aria-label',
      'Applications',
    );
  });

  it('requests 25 by default and forwards opaque Next cursors with a Previous stack', async () => {
    const calls: URL[] = [];
    mockFetch((url) => {
      calls.push(url);
      const cursor = url.searchParams.get('cursor');
      return listResponse(
        [applicationListItem({ id: cursor === null ? 'app-1' : 'app-2' })],
        cursor === null ? 'v1.opaque+/=cursor' : null,
      );
    });
    const user = userEvent.setup();
    renderPage(<ApplicationsPage />, ['/applications']);

    expect(
      await screen.findByText('Copied Security Engineer'),
    ).toBeInTheDocument();
    expect(calls[0]?.searchParams.get('limit')).toBe('25');
    expect(calls[0]?.searchParams.has('cursor')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(
        calls.some(
          (url) => url.searchParams.get('cursor') === 'v1.opaque+/=cursor',
        ),
      ).toBe(true),
    );
    expect(screen.getByText('Page 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });

  it('applies one current status and exact Company filter and resets paging', async () => {
    const calls: URL[] = [];
    mockFetch((url) => {
      calls.push(url);
      return listResponse([applicationListItem()], 'next-page');
    });
    const user = userEvent.setup();
    renderPage(<ApplicationsPage />, ['/applications']);
    await screen.findByText('Copied Security Engineer');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Page 2')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Current status'), 'offer');
    await user.type(screen.getByLabelText('Company (exact)'), 'Alpha & Beta');

    await waitFor(() =>
      expect(
        calls.some(
          (url) =>
            url.searchParams.get('status') === 'offer' &&
            url.searchParams.get('company') === 'Alpha & Beta' &&
            !url.searchParams.has('cursor'),
        ),
      ).toBe(true),
    );
    expect(
      calls.some(
        (url) =>
          url.searchParams.get('company') !== null &&
          url.searchParams.has('cursor'),
      ),
    ).toBe(false);
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });

  it('shows explicit unknown copied context and never shifts a date-only value', async () => {
    mockFetch(() =>
      listResponse([
        applicationListItem({
          titleAtApplication: null,
          companyAtApplication: null,
          appliedAt: '2026-01-01',
          appliedAtPrecision: 'date',
        }),
      ]),
    );
    renderPage(<ApplicationsPage />, ['/applications']);

    expect(await screen.findAllByText('Unknown')).toHaveLength(2);
    expect(screen.getByText('Jan 1, 2026 (date only)')).toBeInTheDocument();
    expect(formatDateOnly('2026-01-01')).toBe('Jan 1, 2026');
    expect(screen.queryByText(/12:00/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    expect(screen.getAllByRole('cell', { name: 'Unknown' })[0]).toHaveAttribute(
      'data-label',
      'Role',
    );
  });
});

describe('Application detail and commands', () => {
  it('renders copied context, external-link attributes, and textual audit markers', async () => {
    const original = timelineEvent({
      id: 'event-original',
      effective: false,
      supersededByEventId: 'event-replacement',
      terminal: false,
      canReplace: false,
      canVoid: false,
      correctionIneligibilityReason: 'superseded',
    });
    const replacement = timelineEvent({
      id: 'event-replacement',
      eventType: 'offer',
      resultingStatus: 'offer',
      supersedesEventId: 'event-original',
      supersedeAction: 'replace',
      correctionReason: 'Wrong stage',
      notes: 'Wrong stage',
      canVoid: true,
    });
    const voidRecord = timelineEvent({
      id: 'event-void',
      eventType: 'void',
      resultingStatus: null,
      effective: false,
      supersedesEventId: 'event-note',
      supersedeAction: 'void',
      canReplace: false,
      canVoid: false,
      correctionIneligibilityReason: 'void_event',
    });
    mockDetailFetch(applicationDetail(), [original, replacement, voidRecord]);
    renderDetail();

    expect(await screen.findByText('Copied Company')).toBeInTheDocument();
    const external = screen.getByRole('link', { name: 'Open application URL' });
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      screen.getByText('https://apply.example.test/application/1'),
    ).toBeInTheDocument();
    expect(screen.getByText('source-1')).toBeInTheDocument();
    expect(screen.getByText('Superseded')).toBeInTheDocument();
    expect(screen.getByText('Replacement')).toBeInTheDocument();
    expect(screen.getAllByText('Void').length).toBeGreaterThan(0);
    expect(screen.getByText('Replaces original event')).toBeInTheDocument();
    expect(screen.getAllByText('Audit detail')).toHaveLength(3);
    expect(screen.getByText('Superseded ancestor')).toBeInTheDocument();
    expect(screen.getByText('Terminal replacement')).toBeInTheDocument();
    expect(screen.getByText('Terminal Void')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View retained Job' }),
    ).toHaveAttribute('href', '/jobs?job=job-1');
  });

  it('uses the latest effective Note occurrence and exposes retained legacy source time', async () => {
    const note = timelineEvent({
      id: 'effective-note',
      eventType: 'note',
      resultingStatus: null,
      occurredAt: '2026-07-03',
      occurredAtSort: '2026-07-03T00:00:00.000Z',
      occurrencePrecision: 'date',
      notes: 'Latest effective activity',
    });
    const legacy = timelineEvent({
      id: 'legacy-unknown',
      eventType: 'legacy_applied_date_imported',
      resultingStatus: null,
      occurredAt: 'legacy-source-value',
      occurredAtSort: null,
      occurrencePrecision: 'unknown',
      actor: 'migration',
      effective: false,
      canReplace: false,
      correctionIneligibilityReason: 'migration_event',
    });
    mockDetailFetch(applicationDetail(), [timelineEvent(), note, legacy]);
    renderDetail();

    const summary = await screen.findByRole('region', {
      name: 'Application summary',
    });
    expect(
      within(
        within(summary).getByText('Last effective occurrence').parentElement!,
      ).getByText('Jul 3, 2026 (date only)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Retained occurrence source')).toBeInTheDocument();
    expect(screen.getByText('legacy-source-value')).toBeInTheDocument();
    expect(
      screen.getAllByText('Uncorrected terminal event').length,
    ).toBeGreaterThan(0);
  });

  it('saves mutable summary notes explicitly, including whitespace input', async () => {
    let patchBody: unknown;
    mockFetch((url, init) => {
      if (url.pathname.endsWith('/timeline')) return [timelineEvent()];
      if (
        url.pathname === '/api/applications/app-1/notes' &&
        init?.method === 'PATCH'
      ) {
        patchBody = bodyOf(init);
        return { application: applicationDetail({ notes: null }) };
      }
      if (url.pathname === '/api/applications/app-1') {
        return applicationDetail({ notes: 'Existing summary' });
      }
      return listResponse([]);
    });
    const user = userEvent.setup();
    renderDetail();

    const notes = await screen.findByLabelText('Summary notes');
    fireEvent.change(notes, { target: { value: '   ' } });
    expect(screen.getByText(/3 \/ 10,000/)).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Save summary notes' }),
    );

    await waitFor(() => expect(patchBody).toEqual({ notes: '   ' }));
  });

  it('preserves a dirty summary draft across a background detail refetch', async () => {
    let serverNotes = 'Initial server notes';
    let detailRequests = 0;
    mockFetch((url) => {
      if (url.pathname.endsWith('/timeline')) return [timelineEvent()];
      if (url.pathname === '/api/applications/app-1') {
        detailRequests += 1;
        return applicationDetail({ notes: serverNotes });
      }
      return listResponse([]);
    });
    const client = testQueryClient();
    const user = userEvent.setup();
    renderDetail(client);

    const notes = await screen.findByDisplayValue('Initial server notes');
    await user.clear(notes);
    await user.type(notes, 'Unsaved local draft');
    serverNotes = 'Background server update';
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['application', 'app-1'] });
    });

    await waitFor(() => expect(detailRequests).toBeGreaterThanOrEqual(2));
    expect(notes).toHaveValue('Unsaved local draft');
    expect(screen.getByText(/19.*Unsaved/)).toBeInTheDocument();
  });

  it('submits a summary snapshot and locks the textarea while saving', async () => {
    let patchBody: unknown;
    let serverNotes = 'Initial';
    let resolveSave: ((value: unknown) => void) | undefined;
    const pendingSave = new Promise<unknown>((resolve) => {
      resolveSave = resolve;
    });
    mockFetch((url, init) => {
      if (url.pathname.endsWith('/timeline')) return [timelineEvent()];
      if (
        url.pathname === '/api/applications/app-1/notes' &&
        init?.method === 'PATCH'
      ) {
        patchBody = bodyOf(init);
        return pendingSave;
      }
      if (url.pathname === '/api/applications/app-1') {
        return applicationDetail({ notes: serverNotes });
      }
      return listResponse([]);
    });
    const user = userEvent.setup();
    renderDetail();
    const notes = await screen.findByDisplayValue('Initial');
    await user.clear(notes);
    await user.type(notes, 'Submitted snapshot');
    await user.click(
      screen.getByRole('button', { name: 'Save summary notes' }),
    );

    await waitFor(() =>
      expect(patchBody).toEqual({ notes: 'Submitted snapshot' }),
    );
    expect(notes).toBeDisabled();
    await act(async () => {
      serverNotes = 'Submitted snapshot';
      resolveSave?.({
        application: applicationDetail({ notes: 'Submitted snapshot' }),
      });
      await pendingSave;
    });
    await waitFor(() => expect(notes).not.toBeDisabled());
    expect(notes).toHaveValue('Submitted snapshot');
  });

  it('presents the lifecycle allowlist in binding order without Applied', async () => {
    mockDetailFetch(applicationDetail(), [timelineEvent()]);
    const user = userEvent.setup();
    renderDetail();
    await user.click(
      await screen.findByRole('button', { name: 'Add lifecycle event' }),
    );

    const select = screen.getByLabelText('Lifecycle event');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Recruiter contact',
      'Phone screen',
      'Technical interview',
      'Manager interview',
      'Final interview',
      'Interview (stage unknown)',
      'Offer',
      'Accepted',
      'Rejected',
      'Ghosted',
      'Withdrawn',
    ]);
    expect(
      within(select).queryByRole('option', { name: 'Applied' }),
    ).toBeNull();
  });

  it('submits lifecycle and Note payloads with date-only occurrence unchanged', async () => {
    const commands: Record<string, unknown>[] = [];
    mockCommandFetch([timelineEvent()], commands);
    const user = userEvent.setup();
    renderDetail();

    await user.click(
      await screen.findByRole('button', { name: 'Add lifecycle event' }),
    );
    await user.selectOptions(
      screen.getByLabelText('Lifecycle event'),
      'accepted',
    );
    await user.selectOptions(
      screen.getByLabelText('Occurrence precision'),
      'date',
    );
    fireEvent.change(screen.getByLabelText('Date only'), {
      target: { value: '2026-08-01' },
    });
    await user.type(screen.getByLabelText('Event notes (optional)'), 'Signed');
    await user.click(screen.getByRole('button', { name: 'Record event' }));
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      kind: 'lifecycle',
      eventType: 'accepted',
      occurredAt: '2026-08-01',
      occurrencePrecision: 'date',
      notes: 'Signed',
    });

    await user.click(screen.getByRole('button', { name: 'Add timeline note' }));
    await user.type(
      screen.getByLabelText('Timeline Note text'),
      'Immutable detail',
    );
    await user.selectOptions(
      screen.getByLabelText('Occurrence precision'),
      'date',
    );
    fireEvent.change(screen.getByLabelText('Date only'), {
      target: { value: '2026-08-02' },
    });
    await user.click(screen.getByRole('button', { name: 'Record event' }));
    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[1]).toMatchObject({
      kind: 'note',
      text: 'Immutable detail',
      occurredAt: '2026-08-02',
      occurrencePrecision: 'date',
    });
  });

  it('locks an event command after submission and retries byte-equivalent JSON', async () => {
    const bodies: string[] = [];
    let attempts = 0;
    mockFetch((url, init) => {
      if (url.pathname.endsWith('/timeline')) return [timelineEvent()];
      if (
        url.pathname === '/api/applications/app-1/events' &&
        init?.method === 'POST'
      ) {
        if (typeof init.body !== 'string') throw new Error('Missing body');
        bodies.push(init.body);
        attempts += 1;
        if (attempts === 1) {
          return response(
            { error: 'Retry event command', code: 'temporary', details: {} },
            500,
          );
        }
        return writeResponse(bodyOf(init) as Record<string, unknown>);
      }
      if (url.pathname === '/api/applications/app-1') {
        return applicationDetail();
      }
      return listResponse([]);
    });
    const user = userEvent.setup();
    renderDetail();
    await user.click(
      await screen.findByRole('button', { name: 'Add timeline note' }),
    );
    const text = screen.getByLabelText('Timeline Note text');
    await user.type(text, 'Frozen Note command');
    await user.click(screen.getByRole('button', { name: 'Record event' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Retry event command',
    );
    expect(text).toBeDisabled();
    expect(screen.getByLabelText('Occurrence precision')).toBeDisabled();
    await user.type(text, 'changed');
    expect(text).toHaveValue('Frozen Note command');
    expect(
      screen.getByText(/Retry resends this exact locked command/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit as new command' }),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toBe(bodies[0]);
    const first = bodyOf({ body: bodies[0]! }) as Record<string, unknown>;
    const second = bodyOf({ body: bodies[1]! }) as Record<string, unknown>;
    expect(second).toMatchObject({
      eventId: first['eventId'],
      kind: 'note',
      text: 'Frozen Note command',
    });
  });

  it('shows validation reason and edits an event draft under a fresh Event ID', async () => {
    const firstEventId = '00000000-0000-4000-8000-000000000101';
    const secondEventId = '00000000-0000-4000-8000-000000000102';
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(firstEventId)
      .mockReturnValueOnce(secondEventId);
    const commands: Record<string, unknown>[] = [];
    mockFetch((url, init) => {
      if (url.pathname.endsWith('/timeline')) return [timelineEvent()];
      if (
        url.pathname === '/api/applications/app-1/events' &&
        init?.method === 'POST'
      ) {
        const command = bodyOf(init) as Record<string, unknown>;
        commands.push(command);
        if (commands.length === 1) {
          return response(
            {
              error: 'Application command validation failed',
              code: 'application_validation_failed',
              details: { reason: 'Note text cannot be blank' },
            },
            400,
          );
        }
        return writeResponse(command);
      }
      if (url.pathname === '/api/applications/app-1') {
        return applicationDetail();
      }
      return listResponse([]);
    });
    const user = userEvent.setup();
    renderDetail();
    await user.click(
      await screen.findByRole('button', { name: 'Add timeline note' }),
    );
    const text = screen.getByLabelText('Timeline Note text');
    await user.type(text, '   ');
    await user.click(screen.getByRole('button', { name: 'Record event' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Reason: Note text cannot be blank',
    );
    expect(text).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Edit as new command' }),
    );
    expect(text).not.toBeDisabled();
    expect(text).toHaveValue('   ');
    await user.clear(text);
    await user.type(text, 'Corrected Note');
    await user.click(screen.getByRole('button', { name: 'Record event' }));

    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[0]?.['eventId']).toBe(firstEventId);
    expect(commands[1]?.['eventId']).toBe(secondEventId);
    expect(commands[1]?.['text']).toBe('Corrected Note');
  });

  it('submits complete status and Note replacements', async () => {
    const statusTarget = timelineEvent({ id: 'status-target', canVoid: true });
    const noteTarget = timelineEvent({
      id: 'note-target',
      eventType: 'note',
      resultingStatus: null,
      notes: 'Original Note',
      canVoid: true,
    });
    const commands: Record<string, unknown>[] = [];
    mockCommandFetch([statusTarget, noteTarget], commands);
    const user = userEvent.setup();
    renderDetail();

    const items = await screen.findAllByRole('listitem');
    await user.click(
      within(items[0]!).getByRole('button', {
        name: 'Replace event',
      }),
    );
    const statusSelect = screen.getByLabelText('Replacement status');
    expect(
      within(statusSelect).getByRole('option', { name: 'Applied' }),
    ).toBeInTheDocument();
    await user.selectOptions(statusSelect, 'final_interview');
    await user.selectOptions(
      screen.getByLabelText('Occurrence precision'),
      'date',
    );
    fireEvent.change(screen.getByLabelText('Date only'), {
      target: { value: '2026-07-20' },
    });
    await user.type(
      screen.getByLabelText('Correction reason (optional)'),
      'Correct stage',
    );
    await user.click(screen.getByRole('button', { name: 'Record event' }));
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      kind: 'replace',
      targetEventId: 'status-target',
      replacementEventType: 'final_interview',
      occurredAt: '2026-07-20',
      occurrencePrecision: 'date',
      reason: 'Correct stage',
    });

    const refreshedItems = screen.getAllByRole('listitem');
    await user.click(
      within(refreshedItems[1]!).getByRole('button', {
        name: 'Replace event',
      }),
    );
    const replacementText = screen.getByLabelText(
      'Complete replacement Note text',
    );
    expect(replacementText).toHaveValue('Original Note');
    await user.clear(replacementText);
    await user.type(replacementText, 'Complete corrected Note');
    await user.click(screen.getByRole('button', { name: 'Record event' }));
    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[1]).toMatchObject({
      kind: 'replace',
      targetEventId: 'note-target',
      replacementEventType: 'note',
      text: 'Complete corrected Note',
    });
  });

  it('submits Void without occurrence and hides actions on ineligible records', async () => {
    const eligible = timelineEvent({ id: 'void-target', canVoid: true });
    const migration = timelineEvent({
      id: 'migration-event',
      eventType: 'legacy_state_imported',
      resultingStatus: 'unknown_legacy_state',
      actor: 'migration',
      canReplace: false,
      canVoid: false,
      correctionIneligibilityReason: 'migration_event',
    });
    const commands: Record<string, unknown>[] = [];
    mockCommandFetch([eligible, migration], commands);
    const user = userEvent.setup();
    renderDetail();

    const items = await screen.findAllByRole('listitem');
    expect(
      within(items[1]!).queryByRole('button', {
        name: /event/,
      }),
    ).toBeNull();
    await user.click(
      within(items[0]!).getByRole('button', {
        name: 'Void event',
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Void event' });
    expect(within(dialog).queryByLabelText('Occurrence precision')).toBeNull();
    await user.type(
      within(dialog).getByLabelText('Correction reason (optional)'),
      'Duplicate fact',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Confirm Void' }),
    );
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toEqual(
      expect.objectContaining({
        kind: 'void',
        targetEventId: 'void-target',
        reason: 'Duplicate fact',
      }),
    );
    expect(commands[0]).not.toHaveProperty('occurredAt');
    expect(commands[0]).not.toHaveProperty('occurrencePrecision');
  });

  it('keeps a stale correction open, displays the 409, and refetches timeline', async () => {
    let timelineRequests = 0;
    let detailRequests = 0;
    const invalidations = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    mockFetch((url, init) => {
      if (url.pathname.endsWith('/timeline')) {
        timelineRequests += 1;
        return [timelineEvent({ id: 'stale-target' })];
      }
      if (
        url.pathname === '/api/applications/app-1/events' &&
        init?.method === 'POST'
      ) {
        return response(
          {
            error: 'The correction target is stale',
            code: 'application_correction_target_stale',
            details: { targetEventId: 'stale-target' },
          },
          409,
        );
      }
      if (url.pathname === '/api/applications/app-1') {
        detailRequests += 1;
        return applicationDetail();
      }
      return listResponse([]);
    });
    const user = userEvent.setup();
    renderDetail();
    const item = (await screen.findAllByRole('listitem'))[0]!;
    await user.click(
      within(item).getByRole('button', { name: 'Replace event' }),
    );
    await user.click(screen.getByRole('button', { name: 'Record event' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The correction target is stale',
    );
    expect(
      screen.getByRole('dialog', { name: 'Replace status event' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(timelineRequests).toBeGreaterThanOrEqual(2));
    expect(detailRequests).toBeGreaterThanOrEqual(2);
    const invalidatedKeys = invalidations.mock.calls.map(
      ([filters]) => filters?.queryKey,
    );
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([
        ['applications'],
        ['jobs'],
        ['dashboard'],
        ['application', 'app-1'],
        ['application-timeline', 'app-1'],
        ['job', 'job-1'],
      ]),
    );
  });

  it('keeps a final-status correction conflict visible while refreshing state', async () => {
    let timelineRequests = 0;
    mockFetch((url, init) => {
      if (url.pathname.endsWith('/timeline')) {
        timelineRequests += 1;
        return [timelineEvent({ id: 'final-status-target', canVoid: true })];
      }
      if (
        url.pathname === '/api/applications/app-1/events' &&
        init?.method === 'POST'
      ) {
        return response(
          {
            error: 'One effective status must remain',
            code: 'application_final_status_required',
            details: { targetEventId: 'final-status-target' },
          },
          409,
        );
      }
      if (url.pathname === '/api/applications/app-1') {
        return applicationDetail();
      }
      return listResponse([]);
    });
    const user = userEvent.setup();
    renderDetail();
    const item = (await screen.findAllByRole('listitem'))[0]!;
    await user.click(within(item).getByRole('button', { name: 'Void event' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Void' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'One effective status must remain',
    );
    expect(
      screen.getByRole('dialog', { name: 'Void event' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await waitFor(() => expect(timelineRequests).toBeGreaterThanOrEqual(2));
  });
});

describe('Job detail modal drawer', () => {
  it('moves focus to the panel when pending disables the active control', async () => {
    const user = userEvent.setup();
    renderPage(<PendingDialogHarness />);
    const dialog = screen.getByRole('dialog', { name: 'Pending command' });

    await user.click(screen.getByRole('button', { name: 'Submit command' }));

    expect(dialog).toHaveFocus();
    expect(
      screen.getByRole('link', { name: 'Command help' }),
    ).not.toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('link', { name: 'Command help' })).toHaveFocus();
  });

  it('provides modal semantics, Escape close, and trigger focus restoration', async () => {
    mockFetch(() => jobDetail());
    const user = userEvent.setup();
    renderPage(<JobDrawerHarness />, ['/jobs']);
    const opener = screen.getByRole('button', { name: 'Open job details' });
    await user.click(opener);

    const drawer = await screen.findByRole('dialog', { name: 'Job details' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Close job details' }),
      ).toHaveFocus(),
    );
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Job details' })).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('makes the drawer inert while the nested Applied dialog is active', async () => {
    mockFetch(() => jobDetail());
    const user = userEvent.setup();
    renderPage(<JobDrawerHarness />, ['/jobs']);
    await user.click(screen.getByRole('button', { name: 'Open job details' }));
    await user.click(
      await screen.findByRole('button', { name: 'Mark applied' }),
    );

    expect(
      screen.getByRole('dialog', { name: 'Confirm Applied application' }),
    ).toBeInTheDocument();
    const hiddenDrawer = document.querySelector('.job-drawer');
    expect(hiddenDrawer).not.toBeNull();
    expect(hiddenDrawer).toHaveAttribute('aria-hidden', 'true');
    expect(hiddenDrawer).toHaveAttribute('inert');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.keyDown(hiddenDrawer!, { key: 'Escape' });
    expect(
      screen.getByRole('dialog', { name: 'Confirm Applied application' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('dialog', { name: 'Job details' }),
    ).toBeInTheDocument();
  });

  it('contains focus on the nested panel when pending disables every control', async () => {
    let resolvePost: ((value: Response) => void) | undefined;
    const pendingPost = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    mockFetch((url, init) => {
      if (url.pathname === '/api/jobs/job-1') return jobDetail();
      if (url.pathname === '/api/applications' && init?.method === 'POST') {
        return pendingPost;
      }
      return listResponse([]);
    });
    const user = userEvent.setup();
    renderPage(<JobDrawerHarness />, ['/jobs']);
    await user.click(screen.getByRole('button', { name: 'Open job details' }));
    await user.click(
      await screen.findByRole('button', { name: 'Mark applied' }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm Applied' }));

    const dialog = screen.getByRole('dialog', {
      name: 'Confirm Applied application',
    });
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog).toHaveFocus();
    await act(async () => {
      resolvePost?.(
        response(
          { error: 'Temporary failure', code: 'temporary', details: {} },
          500,
        ),
      );
      await pendingPost;
    });
    expect(
      await screen.findByRole('button', { name: 'Retry' }),
    ).toBeInTheDocument();
  });
});

describe('Applied creation from Job detail', () => {
  it('confirms editable copied context and leaves multiple URLs and Sources unselected', async () => {
    const job = jobDetail({
      applicationUrls: [
        'https://apply.example.test/first',
        'https://apply.example.test/second',
      ],
      sources: [
        jobSource('source-1', 'Careers one', 'greenhouse'),
        jobSource('source-2', 'Careers two', 'lever'),
      ],
    });
    mockFetch(() => job);
    const user = userEvent.setup();
    renderJob();
    const opener = await screen.findByRole('button', { name: 'Mark applied' });
    await user.click(opener);

    expect(
      screen.getByRole('dialog', { name: 'Confirm Applied application' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Application title')).toHaveValue(job.title);
    expect(screen.getByLabelText('Company')).toHaveValue(job.company);
    expect(screen.getByLabelText('Location (optional)')).toHaveValue(
      job.location,
    );
    expect(
      screen.getByLabelText('https://apply.example.test/first'),
    ).not.toBeChecked();
    expect(
      screen.getByLabelText('https://apply.example.test/first'),
    ).toBeRequired();
    expect(
      screen.getByLabelText('https://apply.example.test/second'),
    ).not.toBeChecked();
    expect(
      screen.getByLabelText('Careers one · greenhouse · Source ID source-1'),
    ).not.toBeChecked();
    expect(
      screen.getByLabelText('Careers one · greenhouse · Source ID source-1'),
    ).toBeRequired();
    expect(
      screen.getByLabelText('Careers two · lever · Source ID source-2'),
    ).not.toBeChecked();
    expect(screen.queryByText(job.postingUrl ?? '')).not.toBeInTheDocument();
  });

  it('shows validation reason and edits an Applied draft under a fresh Event ID', async () => {
    const firstEventId = '00000000-0000-4000-8000-000000000201';
    const secondEventId = '00000000-0000-4000-8000-000000000202';
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(firstEventId)
      .mockReturnValueOnce(secondEventId);
    const commands: Record<string, unknown>[] = [];
    mockFetch((url, init) => {
      if (url.pathname === '/api/jobs/job-1') return jobDetail();
      if (url.pathname === '/api/applications' && init?.method === 'POST') {
        const command = bodyOf(init) as Record<string, unknown>;
        commands.push(command);
        if (commands.length === 1) {
          return response(
            {
              error: 'Application command validation failed',
              code: 'application_validation_failed',
              details: { reason: 'Title cannot be blank' },
            },
            400,
          );
        }
        return writeResponse(command);
      }
      return listResponse([]);
    });
    const user = userEvent.setup();
    renderJob();
    await user.click(
      await screen.findByRole('button', { name: 'Mark applied' }),
    );
    const title = screen.getByLabelText('Application title');
    await user.clear(title);
    await user.type(title, '   ');
    await user.click(screen.getByRole('button', { name: 'Confirm Applied' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Reason: Title cannot be blank',
    );
    expect(title).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Edit as new command' }),
    );
    expect(title).not.toBeDisabled();
    expect(title).toHaveValue('   ');
    await user.clear(title);
    await user.type(title, 'Corrected Application Title');
    await user.click(screen.getByRole('button', { name: 'Confirm Applied' }));

    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[0]?.['eventId']).toBe(firstEventId);
    expect(commands[1]?.['eventId']).toBe(secondEventId);
    expect(commands[1]?.['titleAtApplication']).toBe(
      'Corrected Application Title',
    );
  });

  it('keeps URL and Source identity stable when Job choices reorder', async () => {
    const firstUrl = 'https://apply.example.test/first';
    const secondUrl = 'https://apply.example.test/second';
    const sourceOne = jobSource('source-1', 'Careers one', 'greenhouse');
    const sourceTwo = jobSource('source-2', 'Careers two', 'lever');
    const initial = jobDetail({
      applicationUrls: [firstUrl, secondUrl],
      sources: [sourceOne, sourceTwo],
    });
    const reordered = jobDetail({
      applicationUrls: [secondUrl, firstUrl],
      sources: [sourceTwo, sourceOne],
    });
    let posted: Record<string, unknown> | undefined;
    mockFetch((url, init) => {
      if (url.pathname === '/api/applications' && init?.method === 'POST') {
        posted = bodyOf(init) as Record<string, unknown>;
        return writeResponse(posted);
      }
      return listResponse([]);
    });
    const user = userEvent.setup();
    renderPage(<AppliedChoiceHarness initial={initial} updated={reordered} />, [
      '/jobs',
    ]);

    await user.click(screen.getByLabelText(firstUrl));
    await user.click(
      screen.getByLabelText('Careers one · greenhouse · Source ID source-1'),
    );
    await user.click(
      screen.getByRole('button', { name: 'Refetch Job choices' }),
    );
    expect(screen.getByLabelText(firstUrl)).toBeChecked();
    expect(
      screen.getByLabelText('Careers one · greenhouse · Source ID source-1'),
    ).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Confirm Applied' }));

    await waitFor(() => expect(posted).toBeDefined());
    expect(posted).toMatchObject({
      applicationUrl: firstUrl,
      sourceId: 'source-1',
    });
  });

  it('fails visibly when selected URL or Source disappears on Job refetch', async () => {
    const firstUrl = 'https://apply.example.test/first';
    const secondUrl = 'https://apply.example.test/second';
    const initial = jobDetail({
      applicationUrls: [firstUrl, secondUrl],
      sources: [
        jobSource('source-1', 'Careers one', 'greenhouse'),
        jobSource('source-2', 'Careers two', 'lever'),
      ],
    });
    const removed = jobDetail({
      applicationUrls: [secondUrl],
      sources: [jobSource('source-2', 'Careers two', 'lever')],
    });
    let posts = 0;
    mockFetch((url, init) => {
      if (url.pathname === '/api/applications' && init?.method === 'POST') {
        posts += 1;
      }
      return listResponse([]);
    });
    const user = userEvent.setup();
    renderPage(<AppliedChoiceHarness initial={initial} updated={removed} />, [
      '/jobs',
    ]);

    await user.click(screen.getByLabelText(firstUrl));
    await user.click(
      screen.getByLabelText('Careers one · greenhouse · Source ID source-1'),
    );
    await user.click(
      screen.getByRole('button', { name: 'Refetch Job choices' }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm Applied' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'selected Application URL is no longer available',
    );

    await user.click(screen.getByLabelText(secondUrl));
    await user.click(screen.getByRole('button', { name: 'Confirm Applied' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'selected Source is no longer available',
      ),
    );
    expect(posts).toBe(0);
  });

  it('converts exact local datetime to UTC and retains one Event ID across a failed retry', async () => {
    const commands: Record<string, unknown>[] = [];
    const bodies: string[] = [];
    let attempts = 0;
    const retryEventId = '00000000-0000-4000-8000-000000000001';
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(retryEventId);
    mockFetch((url, init) => {
      if (url.pathname === '/api/applications' && init?.method === 'POST') {
        if (typeof init.body !== 'string') throw new Error('Missing body');
        bodies.push(init.body);
        const command = bodyOf(init) as Record<string, unknown>;
        commands.push(command);
        attempts += 1;
        if (attempts === 1) {
          return response(
            { error: 'Temporary failure', code: 'temporary', details: {} },
            500,
          );
        }
        return writeResponse(command);
      }
      return listResponse([]);
    });
    const user = userEvent.setup();
    renderPage(
      <AppliedChoiceHarness
        initial={jobDetail()}
        updated={jobDetail({
          title: 'Refetched Job title',
          applicationUrls: ['https://apply.example.test/new'],
          sources: [jobSource('new-source', 'New source', 'lever')],
        })}
      />,
      ['/jobs'],
    );
    fireEvent.change(screen.getByLabelText('Exact local date and time'), {
      target: { value: '2026-08-08T10:30' },
    });
    await user.click(screen.getByRole('button', { name: 'Confirm Applied' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Temporary failure',
    );
    const title = screen.getByLabelText('Application title');
    expect(title).toBeDisabled();
    expect(screen.getByLabelText('Occurrence precision')).toBeDisabled();
    await user.type(title, 'changed');
    expect(title).toHaveValue('Current Job Security Engineer');
    expect(
      screen.getByText(/Retry resends this exact locked command/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit as new command' }),
    ).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Refetch Job choices' }),
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(commands).toHaveLength(2));
    expect(bodies[1]).toBe(bodies[0]);
    expect(commands[0]?.['eventId']).toBe(retryEventId);
    expect(commands[1]?.['eventId']).toBe(retryEventId);
    expect(commands[0]?.['occurredAt']).toBe(
      new Date('2026-08-08T10:30').toISOString(),
    );
    expect(commands[0]?.['occurrencePrecision']).toBe('exact');
  });

  it('navigates to the existing Application returned by a 409', async () => {
    let jobRequests = 0;
    const invalidations = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    mockFetch((url, init) => {
      if (url.pathname === '/api/jobs/job-1') {
        jobRequests += 1;
        return jobDetail();
      }
      if (url.pathname === '/api/applications' && init?.method === 'POST') {
        return response(
          {
            error: 'Application already exists',
            code: 'application_already_exists',
            details: { existingApplicationId: 'existing-from-conflict' },
          },
          409,
        );
      }
      return {};
    });
    const user = userEvent.setup();
    renderJob(true);
    await user.click(
      await screen.findByRole('button', { name: 'Mark applied' }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm Applied' }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/applications/existing-from-conflict',
      ),
    );
    expect(jobRequests).toBeGreaterThanOrEqual(2);
    expect(
      invalidations.mock.calls.map(([filters]) => filters?.queryKey),
    ).toEqual(
      expect.arrayContaining([
        ['applications'],
        ['dashboard'],
        ['application', 'existing-from-conflict'],
        ['job', 'job-1'],
      ]),
    );
  });

  it('renders View application instead of create when the Job is already linked', async () => {
    mockFetch(() => jobDetail({ existingApplicationId: 'existing-app' }));
    renderJob();

    const view = await screen.findByRole('link', { name: 'View application' });
    expect(view).toHaveAttribute('href', '/applications/existing-app');
    expect(screen.queryByRole('button', { name: 'Mark applied' })).toBeNull();
  });

  it('provides dialog focus, Escape close, and trigger focus restoration', async () => {
    mockFetch(() => jobDetail());
    const user = userEvent.setup();
    renderJob();
    const opener = await screen.findByRole('button', { name: 'Mark applied' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog', {
      name: 'Confirm Applied application',
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Application title')).toHaveFocus(),
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(
      screen.queryByRole('dialog', { name: 'Confirm Applied application' }),
    ).toBeNull();
    expect(
      screen.getByRole('dialog', { name: 'Job details' }),
    ).toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(
  element: ReactElement,
  entries = ['/'],
  client = testQueryClient(),
) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries}>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderDetail(client = testQueryClient()) {
  return renderPage(
    <Routes>
      <Route
        path="/applications/:applicationId"
        element={<ApplicationDetailPage />}
      />
    </Routes>,
    ['/applications/app-1'],
    client,
  );
}

function renderJob(withLocation = false) {
  return renderPage(
    <>
      <JobDetailPanel jobId="job-1" onClose={() => undefined} />
      {withLocation ? <LocationProbe /> : null}
    </>,
    ['/jobs?job=job-1'],
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function JobDrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open job details
      </button>
      {open ? (
        <JobDetailPanel jobId="job-1" onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function PendingDialogHarness() {
  const [pending, setPending] = useState(false);
  return (
    <>
      <button type="button">Outside control</button>
      <Dialog
        title="Pending command"
        pending={pending}
        onClose={() => undefined}
        actions={
          <button type="button" disabled={pending}>
            Footer action
          </button>
        }
      >
        <button
          type="button"
          disabled={pending}
          onClick={() => setPending(true)}
        >
          Submit command
        </button>
        <a href="/help">Command help</a>
      </Dialog>
    </>
  );
}

function AppliedChoiceHarness({
  initial,
  updated,
}: {
  initial: JobDetail;
  updated: JobDetail;
}) {
  const [job, setJob] = useState(initial);
  return (
    <>
      <button type="button" onClick={() => setJob(updated)}>
        Refetch Job choices
      </button>
      <AppliedCreationDialog job={job} onClose={() => undefined} />
    </>
  );
}

function mockFetch(
  handler: (url: URL, init?: RequestInit) => unknown,
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(
    async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const rawUrl = input instanceof Request ? input.url : input.toString();
      const result = await handler(new URL(rawUrl, 'http://localhost'), init);
      return result instanceof Response ? result : response(result, 200);
    },
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function bodyOf(init: RequestInit): unknown {
  if (typeof init.body !== 'string') throw new Error('Expected JSON body');
  return JSON.parse(init.body) as unknown;
}

function listResponse(
  items: ApplicationListItem[],
  nextCursor: string | null = null,
) {
  return { items, nextCursor };
}

function applicationListItem(
  overrides: Partial<ApplicationListItem> = {},
): ApplicationListItem {
  return {
    id: 'app-1',
    jobId: 'job-1',
    status: 'applied',
    appliedAt: '2026-07-01T15:00:00.000Z',
    appliedAtPrecision: 'exact',
    lastRecordedAt: '2026-07-01T15:05:00.000Z',
    titleAtApplication: 'Copied Security Engineer',
    companyAtApplication: 'Copied Company',
    ...overrides,
  };
}

function applicationDetail(
  overrides: Partial<ApplicationDetail> = {},
): ApplicationDetail {
  return {
    id: 'app-1',
    jobId: 'job-1',
    status: 'applied',
    appliedAt: '2026-07-01T15:00:00.000Z',
    appliedAtPrecision: 'exact',
    lastEventAt: '2026-07-01T15:00:00.000Z',
    lastRecordedAt: '2026-07-01T15:05:00.000Z',
    titleAtApplication: 'Copied Security Engineer',
    companyAtApplication: 'Copied Company',
    locationAtApplication: 'Copied Remote',
    applicationUrl: 'https://apply.example.test/application/1',
    sourceId: 'source-1',
    providerId: 'greenhouse',
    sourceLabel: 'Copied careers source',
    notes: null,
    legacyProvenance: null,
    submittedResumeSnapshotId: null,
    createdAt: '2026-07-01T15:05:00.000Z',
    updatedAt: '2026-07-01T15:05:00.000Z',
    ...overrides,
  };
}

function timelineEvent(
  overrides: Partial<ApplicationTimelineEvent> = {},
): ApplicationTimelineEvent {
  return {
    id: 'event-applied',
    applicationId: 'app-1',
    jobId: 'job-1',
    eventType: 'applied',
    resultingStatus: 'applied',
    occurredAt: '2026-07-01T15:00:00.000Z',
    occurredAtSort: '2026-07-01T15:00:00.000Z',
    occurrencePrecision: 'exact',
    recordedAt: '2026-07-01T15:05:00.000Z',
    recordedAtSort: '2026-07-01T15:05:00.000Z',
    notes: null,
    actor: 'user',
    effective: true,
    supersededByEventId: null,
    supersedesEventId: null,
    supersedeAction: null,
    submittedResumeSnapshotId: null,
    terminal: true,
    canReplace: true,
    canVoid: false,
    correctionIneligibilityReason: 'final_effective_status',
    definitionVersion: 'application-event-v1',
    correctionReason: null,
    ...overrides,
  };
}

function mockDetailFetch(
  detail: ApplicationDetail,
  timeline: ApplicationTimelineEvent[],
) {
  mockFetch((url) => {
    if (url.pathname.endsWith('/timeline')) return timeline;
    if (url.pathname === `/api/applications/${detail.id}`) return detail;
    return listResponse([]);
  });
}

function mockCommandFetch(
  timeline: ApplicationTimelineEvent[],
  commands: Record<string, unknown>[],
) {
  mockFetch((url, init) => {
    if (url.pathname.endsWith('/timeline')) return timeline;
    if (url.pathname === '/api/applications/app-1/events') {
      const command = bodyOf(init ?? {}) as Record<string, unknown>;
      commands.push(command);
      return writeResponse(command);
    }
    if (url.pathname === '/api/applications/app-1') return applicationDetail();
    return listResponse([]);
  });
}

function writeResponse(command: Record<string, unknown>) {
  const eventId = command['eventId'];
  return {
    application: applicationDetail(),
    event: timelineEvent({
      id: typeof eventId === 'string' ? eventId : 'event-result',
    }),
    replayed: false,
  };
}

function createCommand(eventId: string) {
  return {
    eventId,
    jobId: 'job-1',
    occurredAt: '2026-07-01T15:00:00.000Z',
    occurrencePrecision: 'exact' as const,
    titleAtApplication: 'Title',
    companyAtApplication: 'Company',
    locationAtApplication: null,
    applicationUrl: null,
    sourceId: null,
    notes: null,
  };
}

function jobSource(
  sourceId: string,
  sourceLabel: string,
  providerId: string,
): JobDetail['sources'][number] {
  return {
    sourceId,
    sourceLabel,
    providerId,
    postingUrl: `https://jobs.example.test/${sourceId}`,
    externalId: sourceId,
    firstSeenAt: '2026-07-01T12:00:00.000Z',
    lastSeenAt: '2026-07-02T12:00:00.000Z',
  };
}

function jobDetail(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    id: 'job-1',
    title: 'Current Job Security Engineer',
    company: 'Current Job Company',
    location: 'Remote',
    remoteType: 'remote',
    salaryMinimum: 90_000,
    salaryMaximum: 120_000,
    score: 88,
    recommendation: 'Strong Match',
    matchedFamilies: 'security',
    status: 'new',
    firstSeenAt: '2026-07-01T12:00:00.000Z',
    lastSeenAt: '2026-07-02T12:00:00.000Z',
    provider: 'greenhouse',
    favorite: false,
    active: true,
    lifecycleReason: 'active',
    lastVerifiedAt: '2026-07-02T12:00:00.000Z',
    removedAt: null,
    verificationStatus: 'verified',
    eligibilityPassed: true,
    eligibilityRejection: null,
    workArrangement: 'remote',
    scoreVersion: 'current',
    existingApplicationId: null,
    city: null,
    state: null,
    employmentType: 'Full-time',
    salaryText: null,
    description: null,
    requirements: null,
    preferredQualifications: null,
    postingUrl: 'https://posting.example.test/job-1',
    datePosted: null,
    clearanceRequirement: null,
    agency: null,
    department: null,
    gradeLow: null,
    gradeHigh: null,
    payPlan: null,
    appointmentType: null,
    workSchedule: null,
    teleworkEligible: null,
    openingDate: null,
    closingDate: null,
    applicationUrls: [],
    categoryScores: null,
    explanations: [],
    missingQualifications: [],
    skills: [],
    certifications: [],
    sources: [],
    notes: null,
    recommendationStatus: null,
    ...overrides,
  };
}
