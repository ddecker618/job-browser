import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  ApplicationListResponse,
  ApplicationNotesWriteResponse,
  ApplicationTimelineEvent,
  ApplicationWriteResponse,
} from '../src/models/application-management.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { APPLICATION_OPAQUE_ID_MAX_LENGTH } from '../src/schemas/application.js';
import { SourceRepository } from '../src/repositories/source-repository.js';
import { startBackend, type BackendHandle } from '../src/server/backend.js';
import { createJobFixture } from './helpers/job-fixture.js';

const JOB_IDS = [
  '10000000-0000-4000-8000-000000000831',
  '10000000-0000-4000-8000-000000000832',
  '10000000-0000-4000-8000-000000000833',
] as const;
const CREATION_OCCURRED_AT = '2020-01-02T15:00:00.000Z';
const handles: BackendHandle[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const directory of directories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

describe('Application REST API', () => {
  it('serves all six routes, every event union, complete timelines, filters, and legacy Jobs', async () => {
    const fixture = await backend(2);
    const createBody = createCommand(
      fixture.jobIds[0],
      fixture.sourceId,
      'api-create-primary',
    );
    const createResponse = await sendJson(
      fixture.handle,
      '/api/applications',
      'POST',
      createBody,
    );
    expect(createResponse.status).toBe(201);
    const created = await readJson<ApplicationWriteResponse>(createResponse);
    expect(created).toMatchObject({
      replayed: false,
      application: {
        jobId: fixture.jobIds[0],
        status: 'applied',
        appliedAt: CREATION_OCCURRED_AT,
        appliedAtPrecision: 'exact',
        titleAtApplication: 'Copied API Security Engineer',
        companyAtApplication: 'Copied API Company',
        locationAtApplication: 'Copied Remote',
        applicationUrl: 'https://apply.example.test/jobs/primary?ref=api#form',
        sourceId: fixture.sourceId,
        providerId: 'api-observed-provider',
        sourceLabel: 'API Fixture Careers',
        notes: null,
      },
      event: {
        id: 'api-create-primary',
        eventType: 'applied',
        actor: 'user',
        effective: true,
        definitionVersion: 'application-event-v1',
      },
    });

    const applicationId = created.application.id;
    const lifecycleResponse = await sendJson(
      fixture.handle,
      `/api/applications/${applicationId}/events`,
      'POST',
      {
        kind: 'lifecycle',
        eventId: 'api-phone-screen',
        eventType: 'phone_screen',
        occurredAt: '2020-01-04T09:00:00-05:00',
        occurrencePrecision: 'exact',
        notes: 'Recruiter call completed',
      },
    );
    expect(lifecycleResponse.status).toBe(201);
    expect(
      (await readJson<ApplicationWriteResponse>(lifecycleResponse)).application
        .status,
    ).toBe('phone_screen');

    const noteResponse = await sendJson(
      fixture.handle,
      `/api/applications/${applicationId}/events`,
      'POST',
      {
        kind: 'note',
        eventId: 'api-note-original',
        occurredAt: '2020-01-05',
        occurrencePrecision: 'date',
        text: 'Original immutable note',
      },
    );
    expect(noteResponse.status).toBe(201);
    expect(
      (await readJson<ApplicationWriteResponse>(noteResponse)).event,
    ).toMatchObject({
      eventType: 'note',
      notes: 'Original immutable note',
    });

    const replacementResponse = await sendJson(
      fixture.handle,
      `/api/applications/${applicationId}/events`,
      'POST',
      {
        kind: 'replace',
        eventId: 'api-note-replacement',
        targetEventId: 'api-note-original',
        replacementEventType: 'note',
        occurredAt: '2020-01-05',
        occurrencePrecision: 'date',
        text: 'Corrected immutable note',
        reason: 'Corrected the contact name',
      },
    );
    expect(replacementResponse.status).toBe(201);
    expect(
      (await readJson<ApplicationWriteResponse>(replacementResponse)).event,
    ).toMatchObject({
      eventType: 'note',
      notes: 'Corrected immutable note',
      correctionReason: 'Corrected the contact name',
      supersedesEventId: 'api-note-original',
      supersedeAction: 'replace',
    });

    const offerResponse = await sendJson(
      fixture.handle,
      `/api/applications/${applicationId}/events`,
      'POST',
      {
        kind: 'lifecycle',
        eventId: 'api-offer',
        eventType: 'offer',
        occurredAt: '2020-01-08',
        occurrencePrecision: 'date',
      },
    );
    expect(offerResponse.status).toBe(201);

    const voidResponse = await sendJson(
      fixture.handle,
      `/api/applications/${applicationId}/events`,
      'POST',
      {
        kind: 'void',
        eventId: 'api-phone-screen-void',
        targetEventId: 'api-phone-screen',
        reason: 'Duplicate stage imported by mistake',
      },
    );
    expect(voidResponse.status).toBe(201);
    expect(
      await readJson<ApplicationWriteResponse>(voidResponse),
    ).toMatchObject({
      application: { status: 'offer' },
      event: {
        eventType: 'void',
        occurredAt: '2020-01-04T14:00:00.000Z',
        supersedesEventId: 'api-phone-screen',
        supersedeAction: 'void',
        correctionReason: 'Duplicate stage imported by mistake',
      },
    });

    const notesResponse = await sendJson(
      fixture.handle,
      `/api/applications/${applicationId}/notes`,
      'PATCH',
      { notes: 'Waiting for the written offer' },
    );
    expect(notesResponse.status).toBe(200);
    expect(
      (await readJson<ApplicationNotesWriteResponse>(notesResponse))
        .application,
    ).toMatchObject({
      id: applicationId,
      notes: 'Waiting for the written offer',
      status: 'offer',
    });

    const detailResponse = await fetch(
      `${fixture.handle.url}/api/applications/${applicationId}`,
    );
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toMatchObject({
      id: applicationId,
      jobId: fixture.jobIds[0],
      titleAtApplication: 'Copied API Security Engineer',
      companyAtApplication: 'Copied API Company',
      sourceId: fixture.sourceId,
      providerId: 'api-observed-provider',
      sourceLabel: 'API Fixture Careers',
      notes: 'Waiting for the written offer',
    });

    const timelineResponse = await fetch(
      `${fixture.handle.url}/api/applications/${applicationId}/timeline`,
    );
    expect(timelineResponse.status).toBe(200);
    const timeline =
      await readJson<ApplicationTimelineEvent[]>(timelineResponse);
    expect(timeline).toHaveLength(6);
    expect(timeline.map((event) => event.id)).toEqual(
      expect.arrayContaining([
        'api-create-primary',
        'api-phone-screen',
        'api-note-original',
        'api-note-replacement',
        'api-offer',
        'api-phone-screen-void',
      ]),
    );
    expect(eventById(timeline, 'api-note-original')).toMatchObject({
      effective: false,
      supersededByEventId: 'api-note-replacement',
      terminal: false,
      canReplace: false,
      canVoid: false,
      correctionIneligibilityReason: 'superseded',
    });
    expect(eventById(timeline, 'api-note-replacement')).toMatchObject({
      effective: true,
      supersedesEventId: 'api-note-original',
      supersedeAction: 'replace',
      correctionReason: 'Corrected the contact name',
    });
    expect(eventById(timeline, 'api-phone-screen')).toMatchObject({
      effective: false,
      supersededByEventId: 'api-phone-screen-void',
      terminal: false,
      correctionIneligibilityReason: 'superseded',
    });

    const secondCreateResponse = await sendJson(
      fixture.handle,
      '/api/applications',
      'POST',
      {
        ...createCommand(fixture.jobIds[1], null, 'api-create-secondary'),
        companyAtApplication: 'Another Copied Company',
      },
    );
    expect(secondCreateResponse.status).toBe(201);
    const secondApplication =
      await readJson<ApplicationWriteResponse>(secondCreateResponse);

    const defaultListResponse = await fetch(
      `${fixture.handle.url}/api/applications`,
    );
    expect(defaultListResponse.status).toBe(200);
    const defaultList =
      await readJson<ApplicationListResponse>(defaultListResponse);
    expect(defaultList.nextCursor).toBeNull();
    expect(defaultList.items.map((item) => item.id).sort()).toEqual(
      [applicationId, secondApplication.application.id].sort(),
    );

    const statusListResponse = await fetch(
      `${fixture.handle.url}/api/applications?status=offer`,
    );
    expect(statusListResponse.status).toBe(200);
    expect(
      (await readJson<ApplicationListResponse>(statusListResponse)).items.map(
        (item) => item.id,
      ),
    ).toEqual([applicationId]);

    const companyListResponse = await fetch(
      `${fixture.handle.url}/api/applications?company=${encodeURIComponent(
        'copied api company',
      )}`,
    );
    expect(companyListResponse.status).toBe(200);
    expect(
      (await readJson<ApplicationListResponse>(companyListResponse)).items.map(
        (item) => item.id,
      ),
    ).toEqual([applicationId]);

    const firstPageResponse = await fetch(
      `${fixture.handle.url}/api/applications?limit=1`,
    );
    expect(firstPageResponse.status).toBe(200);
    const firstPage =
      await readJson<ApplicationListResponse>(firstPageResponse);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPageResponse = await fetch(
      `${fixture.handle.url}/api/applications?limit=1&cursor=${encodeURIComponent(
        firstPage.nextCursor ?? '',
      )}`,
    );
    expect(secondPageResponse.status).toBe(200);
    const secondPage =
      await readJson<ApplicationListResponse>(secondPageResponse);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(
      [...firstPage.items, ...secondPage.items].map((item) => item.id).sort(),
    ).toEqual([applicationId, secondApplication.application.id].sort());

    const legacyListResponse = await fetch(`${fixture.handle.url}/api/jobs`);
    expect(legacyListResponse.status).toBe(200);
    expect(Array.isArray(await legacyListResponse.json())).toBe(true);
    const legacyUpdateResponse = await sendJson(
      fixture.handle,
      `/api/jobs/${fixture.jobIds[0]}`,
      'PATCH',
      { favorite: true },
    );
    expect(legacyUpdateResponse.status).toBe(200);
    expect(await legacyUpdateResponse.json()).toMatchObject({
      id: fixture.jobIds[0],
      favorite: true,
      status: 'offer',
      existingApplicationId: applicationId,
    });
  });

  it('returns 200 for identical replays and 409 for changed commands without duplicates', async () => {
    const fixture = await backend(2);
    const createBody = createCommand(
      fixture.jobIds[0],
      fixture.sourceId,
      'api-idempotent-create',
    );
    const firstResponse = await sendJson(
      fixture.handle,
      '/api/applications',
      'POST',
      createBody,
    );
    expect(firstResponse.status).toBe(201);
    const first = await readJson<ApplicationWriteResponse>(firstResponse);

    const replayResponse = await sendJson(
      fixture.handle,
      '/api/applications',
      'POST',
      {
        notes: null,
        sourceId: fixture.sourceId,
        applicationUrl: 'https://apply.example.test/jobs/primary?ref=api#form',
        locationAtApplication: 'Copied Remote',
        companyAtApplication: 'Copied API Company',
        titleAtApplication: 'Copied API Security Engineer',
        occurrencePrecision: 'exact',
        occurredAt: CREATION_OCCURRED_AT,
        jobId: fixture.jobIds[0],
        eventId: 'api-idempotent-create',
      },
    );
    expect(replayResponse.status).toBe(200);
    expect(
      await readJson<ApplicationWriteResponse>(replayResponse),
    ).toMatchObject({
      replayed: true,
      application: { id: first.application.id },
      event: { id: 'api-idempotent-create' },
    });

    const creationTimeline = await getTimeline(
      fixture.handle,
      first.application.id,
    );
    expect(creationTimeline.map((event) => event.id)).toEqual([
      'api-idempotent-create',
    ]);
    const replayList = await readJson<ApplicationListResponse>(
      await fetch(`${fixture.handle.url}/api/applications`),
    );
    expect(replayList.items).toHaveLength(1);

    const changedCreateResponse = await sendJson(
      fixture.handle,
      '/api/applications',
      'POST',
      { ...createBody, titleAtApplication: 'Changed copied title' },
    );
    await expectApplicationError(
      changedCreateResponse,
      409,
      'application_event_id_conflict',
      { eventId: 'api-idempotent-create' },
    );

    const secondEventResponse = await sendJson(
      fixture.handle,
      '/api/applications',
      'POST',
      { ...createBody, eventId: 'api-second-create-command' },
    );
    await expectApplicationError(
      secondEventResponse,
      409,
      'application_already_exists',
      { existingApplicationId: first.application.id },
    );

    const secondApplicationResponse = await sendJson(
      fixture.handle,
      '/api/applications',
      'POST',
      createCommand(fixture.jobIds[1], null, 'api-other-application-create'),
    );
    expect(secondApplicationResponse.status).toBe(201);

    const noteBody = {
      kind: 'note',
      eventId: 'api-idempotent-note',
      occurredAt: '2020-01-05',
      occurrencePrecision: 'date',
      text: 'Stable event payload',
    };
    const firstNoteResponse = await sendJson(
      fixture.handle,
      `/api/applications/${first.application.id}/events`,
      'POST',
      noteBody,
    );
    expect(firstNoteResponse.status).toBe(201);
    expect(
      (await readJson<ApplicationWriteResponse>(firstNoteResponse)).replayed,
    ).toBe(false);

    const noteReplayResponse = await sendJson(
      fixture.handle,
      `/api/applications/${first.application.id}/events`,
      'POST',
      noteBody,
    );
    expect(noteReplayResponse.status).toBe(200);
    expect(
      (await readJson<ApplicationWriteResponse>(noteReplayResponse)).replayed,
    ).toBe(true);

    const changedEventResponse = await sendJson(
      fixture.handle,
      `/api/applications/${first.application.id}/events`,
      'POST',
      { ...noteBody, text: 'Changed event payload' },
    );
    await expectApplicationError(
      changedEventResponse,
      409,
      'application_event_id_conflict',
      { eventId: 'api-idempotent-note' },
    );
    expect(
      (await getTimeline(fixture.handle, first.application.id)).map(
        (event) => event.id,
      ),
    ).toEqual(['api-idempotent-create', 'api-idempotent-note']);
  });

  it('returns stable 400 errors for malformed queries and strict command boundaries', async () => {
    const fixture = await backend(2);
    const validCreate = createCommand(
      fixture.jobIds[0],
      fixture.sourceId,
      'api-validation-create',
    );
    const createResponse = await sendJson(
      fixture.handle,
      '/api/applications',
      'POST',
      validCreate,
    );
    const application =
      await readJson<ApplicationWriteResponse>(createResponse);
    const applicationId = application.application.id;
    const emptyTimestampCursor = Buffer.from(
      JSON.stringify({ v: 1, lastRecordedAt: '', applicationId }),
    ).toString('base64url');
    const malformedTimestampCursor = Buffer.from(
      JSON.stringify({
        v: 1,
        lastRecordedAt: 'not-a-canonical-timestamp',
        applicationId,
      }),
    ).toString('base64url');

    const invalidCases: readonly InvalidRequestCase[] = [
      { name: 'unknown query', path: '/api/applications?unknown=value' },
      { name: 'zero limit', path: '/api/applications?limit=0' },
      { name: 'excessive limit', path: '/api/applications?limit=101' },
      { name: 'fractional limit', path: '/api/applications?limit=1.5' },
      { name: 'text limit', path: '/api/applications?limit=ten' },
      { name: 'unknown status', path: '/api/applications?status=waiting' },
      { name: 'blank company', path: '/api/applications?company=%20' },
      {
        name: 'malformed cursor',
        path: '/api/applications?cursor=invalid%2Bcursor',
      },
      {
        name: 'empty cursor timestamp',
        path: `/api/applications?cursor=${encodeURIComponent(emptyTimestampCursor)}`,
      },
      {
        name: 'malformed cursor timestamp',
        path: `/api/applications?cursor=${encodeURIComponent(malformedTimestampCursor)}`,
      },
      {
        name: 'duplicate scalar query',
        path: '/api/applications?status=applied&status=offer',
      },
      {
        name: 'server-owned create fields',
        path: '/api/applications',
        method: 'POST',
        body: {
          ...validCreate,
          eventId: 'api-invalid-server-owned-create',
          id: 'client-application-id',
          applicationId: 'client-application-id',
          status: 'offer',
          providerId: 'client-provider',
          recordedAt: '2020-01-01T00:00:00.000Z',
        },
      },
      {
        name: 'unknown create field',
        path: '/api/applications',
        method: 'POST',
        body: {
          ...validCreate,
          eventId: 'api-invalid-unknown-create',
          unknown: true,
        },
      },
      {
        name: 'invalid URL protocol',
        path: '/api/applications',
        method: 'POST',
        body: {
          ...validCreate,
          eventId: 'api-invalid-url-protocol',
          applicationUrl: 'ftp://apply.example.test/job',
        },
      },
      {
        name: 'invalid URL whitespace',
        path: '/api/applications',
        method: 'POST',
        body: {
          ...validCreate,
          eventId: 'api-invalid-url-whitespace',
          applicationUrl: 'https://apply.example.test/job bad',
        },
      },
      {
        name: 'URL over limit',
        path: '/api/applications',
        method: 'POST',
        body: {
          ...validCreate,
          eventId: 'api-invalid-url-limit',
          applicationUrl: `https://apply.example.test/${'a'.repeat(2_100)}`,
        },
      },
      {
        name: 'exact time without offset',
        path: '/api/applications',
        method: 'POST',
        body: {
          ...validCreate,
          eventId: 'api-invalid-exact-time',
          occurredAt: '2020-01-02T15:00:00',
        },
      },
      {
        name: 'impossible date',
        path: '/api/applications',
        method: 'POST',
        body: {
          ...validCreate,
          eventId: 'api-invalid-date',
          occurredAt: '2020-02-30',
          occurrencePrecision: 'date',
        },
      },
      {
        name: 'future exact time',
        path: '/api/applications',
        method: 'POST',
        body: {
          ...validCreate,
          eventId: 'api-invalid-future-exact',
          occurredAt: '9999-01-01T00:00:00Z',
        },
      },
      {
        name: 'future date',
        path: '/api/applications',
        method: 'POST',
        body: {
          ...validCreate,
          eventId: 'api-invalid-future-date',
          occurredAt: '9999-01-01',
          occurrencePrecision: 'date',
        },
      },
      {
        name: 'unsupported occurrence precision',
        path: '/api/applications',
        method: 'POST',
        body: {
          ...validCreate,
          eventId: 'api-invalid-precision',
          occurrencePrecision: 'approximate',
        },
      },
      {
        name: 'copied context over limit',
        path: '/api/applications',
        method: 'POST',
        body: {
          ...validCreate,
          eventId: 'api-invalid-context-limit',
          titleAtApplication: 't'.repeat(501),
        },
      },
      {
        name: 'event ID over limit',
        path: '/api/applications',
        method: 'POST',
        body: {
          ...validCreate,
          eventId: 'e'.repeat(APPLICATION_OPAQUE_ID_MAX_LENGTH + 1),
        },
      },
      {
        name: 'bad event kind',
        path: `/api/applications/${applicationId}/events`,
        method: 'POST',
        body: { kind: 'resume_snapshot', eventId: 'api-bad-kind' },
      },
      {
        name: 'bad lifecycle event type',
        path: `/api/applications/${applicationId}/events`,
        method: 'POST',
        body: {
          kind: 'lifecycle',
          eventId: 'api-bad-lifecycle-kind',
          eventType: 'applied',
          occurredAt: '2020-01-04',
          occurrencePrecision: 'date',
        },
      },
      {
        name: 'server-owned event fields',
        path: `/api/applications/${applicationId}/events`,
        method: 'POST',
        body: {
          kind: 'note',
          eventId: 'api-invalid-server-owned-event',
          occurredAt: '2020-01-04',
          occurrencePrecision: 'date',
          text: 'Strict event',
          applicationId,
          resultingStatus: 'offer',
          actor: 'server',
          recordedAt: '2020-01-04T00:00:00.000Z',
        },
      },
      {
        name: 'event unknown field',
        path: `/api/applications/${applicationId}/events`,
        method: 'POST',
        body: {
          kind: 'note',
          eventId: 'api-invalid-unknown-event',
          occurredAt: '2020-01-04',
          occurrencePrecision: 'date',
          text: 'Strict event',
          unknown: true,
        },
      },
      {
        name: 'invalid event time',
        path: `/api/applications/${applicationId}/events`,
        method: 'POST',
        body: {
          kind: 'note',
          eventId: 'api-invalid-event-time',
          occurredAt: '2020-01-04T12:00:00',
          occurrencePrecision: 'exact',
          text: 'Invalid time',
        },
      },
      {
        name: 'invalid event date',
        path: `/api/applications/${applicationId}/events`,
        method: 'POST',
        body: {
          kind: 'note',
          eventId: 'api-invalid-event-date',
          occurredAt: '2020-13-01',
          occurrencePrecision: 'date',
          text: 'Invalid date',
        },
      },
      {
        name: 'future event',
        path: `/api/applications/${applicationId}/events`,
        method: 'POST',
        body: {
          kind: 'note',
          eventId: 'api-invalid-future-event',
          occurredAt: '9999-01-01',
          occurrencePrecision: 'date',
          text: 'Future event',
        },
      },
      {
        name: 'event text over limit',
        path: `/api/applications/${applicationId}/events`,
        method: 'POST',
        body: {
          kind: 'note',
          eventId: 'api-invalid-event-text-limit',
          occurredAt: '2020-01-04',
          occurrencePrecision: 'date',
          text: 'n'.repeat(4_001),
        },
      },
      {
        name: 'replacement Note without text',
        path: `/api/applications/${applicationId}/events`,
        method: 'POST',
        body: {
          kind: 'replace',
          eventId: 'api-invalid-note-replacement',
          targetEventId: 'api-validation-create',
          replacementEventType: 'note',
          occurredAt: '2020-01-04',
          occurrencePrecision: 'date',
        },
      },
      {
        name: 'Void with occurrence fields',
        path: `/api/applications/${applicationId}/events`,
        method: 'POST',
        body: {
          kind: 'void',
          eventId: 'api-invalid-void-fields',
          targetEventId: 'api-validation-create',
          occurredAt: '2020-01-04',
          occurrencePrecision: 'date',
        },
      },
      {
        name: 'summary notes unknown field',
        path: `/api/applications/${applicationId}/notes`,
        method: 'PATCH',
        body: { notes: 'Strict summary', unknown: true },
      },
      {
        name: 'summary notes server-owned field',
        path: `/api/applications/${applicationId}/notes`,
        method: 'PATCH',
        body: {
          notes: 'Strict summary',
          updatedAt: '2020-01-04T00:00:00.000Z',
        },
      },
      {
        name: 'summary notes over limit',
        path: `/api/applications/${applicationId}/notes`,
        method: 'PATCH',
        body: { notes: 's'.repeat(10_001) },
      },
      {
        name: 'Application ID over limit',
        path: `/api/applications/${'a'.repeat(
          APPLICATION_OPAQUE_ID_MAX_LENGTH + 1,
        )}`,
      },
    ];

    for (const invalidCase of invalidCases) {
      const response =
        invalidCase.body === undefined
          ? await fetch(`${fixture.handle.url}${invalidCase.path}`, {
              method: invalidCase.method ?? 'GET',
            })
          : await sendJson(
              fixture.handle,
              invalidCase.path,
              invalidCase.method ?? 'POST',
              invalidCase.body,
            );
      const body = await expectApplicationError(
        response,
        400,
        'application_validation_failed',
        undefined,
        invalidCase.name,
      );
      expect(body.details['reason'], invalidCase.name).toEqual(
        expect.any(String),
      );
    }

    const nonMemberSourceResponse = await sendJson(
      fixture.handle,
      '/api/applications',
      'POST',
      {
        ...validCreate,
        eventId: 'api-non-member-source',
        jobId: fixture.jobIds[1],
        sourceId: 'source-not-on-job',
      },
    );
    await expectApplicationError(
      nonMemberSourceResponse,
      400,
      'application_source_not_on_job',
      { jobId: fixture.jobIds[1], sourceId: 'source-not-on-job' },
    );
  });

  it('maps Application body-parser client errors to bounded validation errors', async () => {
    const fixture = await backend(1);
    const malformedResponse = await fetch(
      `${fixture.handle.url}/api/applications`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"eventId":',
      },
    );
    const malformedBody = await expectApplicationError(
      malformedResponse,
      400,
      'application_validation_failed',
    );
    expect(malformedBody.details).toEqual({
      reason: 'Request body must contain valid JSON',
    });

    const oversizedResponse = await fetch(
      `${fixture.handle.url}/api/applications`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'x'.repeat(2 * 1024 * 1024) }),
      },
    );
    const oversizedBody = await expectApplicationError(
      oversizedResponse,
      400,
      'application_validation_failed',
    );
    expect(oversizedBody.details).toEqual({
      reason: 'Request body exceeds the allowed size',
    });

    const charsetResponse = await fetch(
      `${fixture.handle.url}/api/applications`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=iso-8859-1',
        },
        body: '{}',
      },
    );
    const charsetBody = await expectApplicationError(
      charsetResponse,
      400,
      'application_validation_failed',
    );
    expect(charsetBody.details).toEqual({
      reason: 'Request body uses an unsupported character encoding',
    });
    expect(malformedBody).not.toHaveProperty('stack');
    expect(malformedBody).not.toHaveProperty('cause');
  });

  it('returns stable 404 errors for missing records and leaves mutation and deletion routes absent', async () => {
    const fixture = await backend(1);
    const missingJobResponse = await sendJson(
      fixture.handle,
      '/api/applications',
      'POST',
      createCommand('missing-job', null, 'api-missing-job-create'),
    );
    await expectApplicationError(missingJobResponse, 404, 'job_not_found', {
      jobId: 'missing-job',
    });

    const missingApplicationId = 'missing-application';
    const missingDetailResponse = await fetch(
      `${fixture.handle.url}/api/applications/${missingApplicationId}`,
    );
    await expectApplicationError(
      missingDetailResponse,
      404,
      'application_not_found',
      { applicationId: missingApplicationId },
    );
    const missingTimelineResponse = await fetch(
      `${fixture.handle.url}/api/applications/${missingApplicationId}/timeline`,
    );
    await expectApplicationError(
      missingTimelineResponse,
      404,
      'application_not_found',
      { applicationId: missingApplicationId },
    );
    const missingEventResponse = await sendJson(
      fixture.handle,
      `/api/applications/${missingApplicationId}/events`,
      'POST',
      {
        kind: 'note',
        eventId: 'api-missing-application-note',
        occurredAt: '2020-01-04',
        occurrencePrecision: 'date',
        text: 'Missing Application',
      },
    );
    await expectApplicationError(
      missingEventResponse,
      404,
      'application_not_found',
      { applicationId: missingApplicationId },
    );
    const missingNotesResponse = await sendJson(
      fixture.handle,
      `/api/applications/${missingApplicationId}/notes`,
      'PATCH',
      { notes: 'Missing summary' },
    );
    await expectApplicationError(
      missingNotesResponse,
      404,
      'application_not_found',
      { applicationId: missingApplicationId },
    );

    const createResponse = await sendJson(
      fixture.handle,
      '/api/applications',
      'POST',
      createCommand(
        fixture.jobIds[0],
        fixture.sourceId,
        'api-no-mutation-create',
      ),
    );
    const created = await readJson<ApplicationWriteResponse>(createResponse);
    const eventMutationResponse = await sendJson(
      fixture.handle,
      `/api/applications/${created.application.id}/events/api-no-mutation-create`,
      'PATCH',
      { notes: 'Mutation is not supported' },
    );
    expect(eventMutationResponse.status).toBe(404);
    const deleteApplicationResponse = await fetch(
      `${fixture.handle.url}/api/applications/${created.application.id}`,
      { method: 'DELETE' },
    );
    expect(deleteApplicationResponse.status).toBe(404);
  });

  it('maps stale, correction-target, kind, cross-Application, and final-status conflicts', async () => {
    const fixture = await backend(2);
    const firstCreateResponse = await sendJson(
      fixture.handle,
      '/api/applications',
      'POST',
      createCommand(
        fixture.jobIds[0],
        fixture.sourceId,
        'api-conflict-first-create',
      ),
    );
    const first = await readJson<ApplicationWriteResponse>(firstCreateResponse);
    const secondCreateResponse = await sendJson(
      fixture.handle,
      '/api/applications',
      'POST',
      createCommand(fixture.jobIds[1], null, 'api-conflict-second-create'),
    );
    const second =
      await readJson<ApplicationWriteResponse>(secondCreateResponse);

    const finalStatusResponse = await sendJson(
      fixture.handle,
      `/api/applications/${first.application.id}/events`,
      'POST',
      {
        kind: 'void',
        eventId: 'api-void-final-status',
        targetEventId: 'api-conflict-first-create',
      },
    );
    await expectApplicationError(
      finalStatusResponse,
      409,
      'application_final_status_required',
      { targetEventId: 'api-conflict-first-create' },
    );

    const missingTargetResponse = await sendJson(
      fixture.handle,
      `/api/applications/${first.application.id}/events`,
      'POST',
      {
        kind: 'void',
        eventId: 'api-missing-correction-target',
        targetEventId: 'missing-event',
      },
    );
    await expectApplicationError(
      missingTargetResponse,
      409,
      'application_correction_target_not_found',
      { targetEventId: 'missing-event' },
    );

    const noteResponse = await sendJson(
      fixture.handle,
      `/api/applications/${first.application.id}/events`,
      'POST',
      {
        kind: 'note',
        eventId: 'api-conflict-note-original',
        occurredAt: '2020-01-04',
        occurrencePrecision: 'date',
        text: 'Original correction target',
      },
    );
    expect(noteResponse.status).toBe(201);
    const replacementResponse = await sendJson(
      fixture.handle,
      `/api/applications/${first.application.id}/events`,
      'POST',
      {
        kind: 'replace',
        eventId: 'api-conflict-note-current',
        targetEventId: 'api-conflict-note-original',
        replacementEventType: 'note',
        occurredAt: '2020-01-04',
        occurrencePrecision: 'date',
        text: 'Current correction target',
      },
    );
    expect(replacementResponse.status).toBe(201);

    const staleResponse = await sendJson(
      fixture.handle,
      `/api/applications/${first.application.id}/events`,
      'POST',
      {
        kind: 'void',
        eventId: 'api-stale-correction',
        targetEventId: 'api-conflict-note-original',
      },
    );
    await expectApplicationError(
      staleResponse,
      409,
      'application_correction_target_stale',
      {
        targetEventId: 'api-conflict-note-original',
        reason: 'superseded',
      },
    );

    const wrongKindResponse = await sendJson(
      fixture.handle,
      `/api/applications/${first.application.id}/events`,
      'POST',
      {
        kind: 'replace',
        eventId: 'api-wrong-correction-kind',
        targetEventId: 'api-conflict-note-current',
        replacementEventType: 'offer',
        occurredAt: '2020-01-08',
        occurrencePrecision: 'date',
      },
    );
    await expectApplicationError(
      wrongKindResponse,
      409,
      'application_correction_kind_mismatch',
      { targetEventId: 'api-conflict-note-current' },
    );

    const crossApplicationResponse = await sendJson(
      fixture.handle,
      `/api/applications/${second.application.id}/events`,
      'POST',
      {
        kind: 'void',
        eventId: 'api-cross-application-correction',
        targetEventId: 'api-conflict-note-current',
      },
    );
    await expectApplicationError(
      crossApplicationResponse,
      409,
      'application_correction_target_conflict',
      { targetEventId: 'api-conflict-note-current' },
    );
  });
});

interface BackendFixture {
  handle: BackendHandle;
  sourceId: string;
  jobIds: typeof JOB_IDS;
}

interface InvalidRequestCase {
  name: string;
  path: string;
  method?: string;
  body?: unknown;
}

interface ApplicationApiError {
  error: string;
  code: string;
  details: Record<string, string | number | boolean | null>;
}

async function backend(jobCount: number): Promise<BackendFixture> {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-application-api-'));
  directories.push(directory);
  const handle = await startBackend({
    databasePath: join(directory, 'jobs.sqlite'),
    resumeDirectory: join(directory, 'resumes'),
    clientDirectory: join(directory, 'client'),
    enableScheduler: false,
    apiRequestsPerMinute: 1_000,
    logger: () => undefined,
  });
  handles.push(handle);

  const source = new SourceRepository(handle.database).create(
    {
      displayName: 'API Fixture Careers',
      employer: 'API Fixture Employer',
      providerId: 'api-source-provider',
      careersUrl: 'https://careers.example.test',
      configuration: {},
      searchCriteria: {
        query: 'security',
        location: null,
        remoteOnly: false,
        limit: 25,
      },
      enabled: false,
      schedule: {
        enabled: false,
        cadence: 'manual',
        dailyLocalTime: null,
      },
    },
    'valid',
  );
  const jobs = new JobRepository(handle.database);
  const insertedJobIds = JOB_IDS.slice(0, jobCount);
  insertedJobIds.forEach((jobId, index) => {
    const job = createJobFixture({
      id: jobId,
      externalId: `application-api-job-${String(index + 1)}`,
      title: `Current API Engineer ${String(index + 1)}`,
      normalizedTitle: `current api engineer ${String(index + 1)}`,
      company: `Current API Company ${String(index + 1)}`,
      normalizedCompany: `current api company ${String(index + 1)}`,
      location: `Current Location ${String(index + 1)}`,
      postingUrl: `https://jobs.example.test/application-api/${String(index + 1)}`,
      firstSeenAt: `2020-01-0${String(index + 1)}T00:00:00.000Z`,
      lastSeenAt: `2020-01-0${String(index + 1)}T00:00:00.000Z`,
      datePosted: `2020-01-0${String(index + 1)}T00:00:00.000Z`,
      status: 'new',
    });
    jobs.upsertObservation({
      job,
      sourceId: source.id,
      providerId: 'api-observed-provider',
      rawData: job,
    });
  });

  return { handle, sourceId: source.id, jobIds: JOB_IDS };
}

function createCommand(
  jobId: string,
  sourceId: string | null,
  eventId: string,
) {
  return {
    eventId,
    jobId,
    occurredAt: CREATION_OCCURRED_AT,
    occurrencePrecision: 'exact',
    titleAtApplication: 'Copied API Security Engineer',
    companyAtApplication: 'Copied API Company',
    locationAtApplication: 'Copied Remote',
    applicationUrl: 'https://apply.example.test/jobs/primary?ref=api#form',
    sourceId,
    notes: null,
  };
}

async function sendJson(
  handle: BackendHandle,
  path: string,
  method: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${handle.url}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function getTimeline(
  handle: BackendHandle,
  applicationId: string,
): Promise<ApplicationTimelineEvent[]> {
  const response = await fetch(
    `${handle.url}/api/applications/${applicationId}/timeline`,
  );
  expect(response.status).toBe(200);
  return readJson<ApplicationTimelineEvent[]>(response);
}

async function expectApplicationError(
  response: Response,
  status: 400 | 404 | 409,
  code: string,
  details?: Record<string, unknown>,
  assertionMessage?: string,
): Promise<ApplicationApiError> {
  expect(response.status, assertionMessage).toBe(status);
  const body = await readJson<ApplicationApiError>(response);
  expect(Object.keys(body).sort(), assertionMessage).toEqual([
    'code',
    'details',
    'error',
  ]);
  expect(body.error, assertionMessage).toEqual(expect.any(String));
  expect(body.error.length, assertionMessage).toBeLessThanOrEqual(1_000);
  expect(body.code, assertionMessage).toBe(code);
  expect(body.details, assertionMessage).toEqual(expect.any(Object));
  expect(
    Object.keys(body.details).length,
    assertionMessage,
  ).toBeLessThanOrEqual(12);
  if (details !== undefined) {
    expect(body.details, assertionMessage).toMatchObject(details);
  }
  for (const value of Object.values(body.details)) {
    if (typeof value === 'string') {
      expect(value.length, assertionMessage).toBeLessThanOrEqual(500);
    }
  }
  return body;
}

function eventById(
  timeline: ApplicationTimelineEvent[],
  eventId: string,
): ApplicationTimelineEvent {
  const event = timeline.find((candidate) => candidate.id === eventId);
  if (event === undefined) throw new Error(`Missing timeline event ${eventId}`);
  return event;
}
