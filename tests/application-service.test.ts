import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ApplicationService,
  ApplicationServiceError,
} from '../src/applications/applicationService.js';
import type { JobDatabase } from '../src/db/database.js';
import type { ApplicationLifecycleStatus } from '../src/domain/application-status.js';
import { ApplicationRepository } from '../src/repositories/application-repository.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { createJobFixture } from './helpers/job-fixture.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';

const JOB_ID = '10000000-0000-4000-8000-000000000083';
const NOW = '2026-08-08T12:00:00.000Z';

describe('ApplicationService', () => {
  let database: JobDatabase;
  let jobs: JobRepository;
  let applications: ApplicationRepository;
  let service: ApplicationService;
  let sourceId: string;
  let currentTime: string;
  let applicationSequence: number;

  beforeEach(() => {
    database = createTestDatabase();
    jobs = new JobRepository(database);
    applications = new ApplicationRepository(database);
    sourceId = insertTestSource(database, {
      id: 'source:opaque/application',
      employer: 'Fallback Employer Label',
    });
    database
      .prepare(
        `UPDATE sources
            SET display_name = 'Backend Careers', provider_id = 'backend-provider'
          WHERE id = ?`,
      )
      .run(sourceId);
    insertJob(JOB_ID, sourceId);
    currentTime = NOW;
    applicationSequence = 0;
    service = new ApplicationService(database, {
      now: () => currentTime,
      randomUUID: () => `server-application-${String(++applicationSequence)}`,
    });
  });

  afterEach(() => database.close());

  it('creates only through Applied and copies confirmed context and backend Source data', () => {
    const result = service.createApplication({
      ...createCommand(),
      eventId: ' event opaque / 1 ',
      titleAtApplication: '  Confirmed Security Engineer  ',
      companyAtApplication: '  Confirmed Company  ',
      applicationUrl: '  https://jobs.example/Apply?Ref=Exact#Top  ',
      notes: 'Applied after referral',
    });

    expect(result.replayed).toBe(false);
    expect(result.application).toMatchObject({
      id: 'server-application-1',
      jobId: JOB_ID,
      status: 'applied',
      appliedAt: '2026-08-01T15:00:00.000Z',
      appliedAtPrecision: 'exact',
      titleAtApplication: 'Confirmed Security Engineer',
      companyAtApplication: 'Confirmed Company',
      locationAtApplication: 'Remote',
      applicationUrl: 'https://jobs.example/Apply?Ref=Exact#Top',
      sourceId,
      providerId: 'observed-provider',
      sourceLabel: 'Backend Careers',
      notes: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(result.event).toMatchObject({
      id: ' event opaque / 1 ',
      eventType: 'applied',
      notes: 'Applied after referral',
      actor: 'user',
      definitionVersion: 'application-event-v1',
      effective: true,
    });
    expect(jobs.getStatus(JOB_ID)).toBe('applied');
    const metadata = eventMetadata(' event opaque / 1 ');
    expect(metadata['definition']).toBe('application-event-v1');
    expect(metadata['commandHash']).toMatch(/^[a-f0-9]{64}$/);
    expect(
      captureServiceError(() =>
        service.createApplication({ ...createCommand(), eventId: '   ' }),
      ).status,
    ).toBe(400);
    expect(() =>
      service.createApplication({
        ...createCommand(),
        eventId: 'strict-command',
        applicationId: 'client-owned-not-allowed',
      }),
    ).toThrow(ApplicationServiceError);
  });

  it('replays an identical canonical creation without writes or membership revalidation', () => {
    const first = service.createApplication(createCommand());
    const before = persistenceSnapshot(first.application.id);
    database.prepare('DELETE FROM job_sources WHERE job_id = ?').run(JOB_ID);
    currentTime = '2026-07-01T12:00:00.000Z';

    const replay = service.createApplication({
      notes: null,
      sourceId,
      applicationUrl: 'https://jobs.example/apply/83',
      locationAtApplication: 'Remote',
      companyAtApplication: 'Example Company',
      titleAtApplication: 'Security Engineer',
      occurrencePrecision: 'exact',
      occurredAt: '2026-08-01T15:00:00.000Z',
      jobId: JOB_ID,
      eventId: 'creation-event',
    });

    expect(replay.replayed).toBe(true);
    expect(replay.application.id).toBe(first.application.id);
    expect(persistenceSnapshot(first.application.id)).toEqual(before);
    expect(applicationSequence).toBe(1);
    currentTime = '2026-08-09T12:00:00.000Z';

    const changed = captureServiceError(() =>
      service.createApplication({
        ...createCommand(),
        titleAtApplication: 'Changed title',
      }),
    );
    expect(changed).toMatchObject({
      status: 409,
      code: 'application_event_id_conflict',
    });

    const secondEvent = captureServiceError(() =>
      service.createApplication({
        ...createCommand(),
        eventId: 'different-creation-event',
        sourceId: null,
      }),
    );
    expect(secondEvent).toMatchObject({
      status: 409,
      code: 'application_already_exists',
      details: { existingApplicationId: first.application.id },
    });

    const otherJob = '10000000-0000-4000-8000-000000000084';
    insertJob(otherJob, null);
    expect(
      captureServiceError(() =>
        service.createApplication({
          ...createCommand(),
          jobId: otherJob,
          sourceId: null,
        }),
      ).code,
    ).toBe('application_event_id_conflict');
  });

  it('validates list queries and serves list, detail, and complete timeline reads', () => {
    const first = service.createApplication(createCommand()).application;
    const otherJob = '10000000-0000-4000-8000-000000000086';
    insertJob(otherJob, null);
    currentTime = '2026-08-08T12:30:00.000Z';
    const second = service.createApplication({
      ...createCommand(),
      eventId: 'second-list-creation',
      jobId: otherJob,
      companyAtApplication: 'Other Company',
      sourceId: null,
    }).application;

    const firstPage = service.listApplications({ limit: '1' });
    expect(firstPage.items.map((application) => application.id)).toEqual([
      second.id,
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(
      service
        .listApplications({
          limit: 1,
          cursor: firstPage.nextCursor,
        })
        .items.map((application) => application.id),
    ).toEqual([first.id]);
    expect(
      service.listApplications({ company: 'example company' }).items,
    ).toHaveLength(1);
    expect(service.getApplication(first.id).jobId).toBe(JOB_ID);
    expect(service.getTimeline(first.id).map((event) => event.id)).toEqual([
      'creation-event',
    ]);
    expect(
      captureServiceError(() => service.listApplications({ limit: 101 }))
        .status,
    ).toBe(400);
    expect(
      captureServiceError(() =>
        service.listApplications({ cursor: 'invalid+cursor' }),
      ).status,
    ).toBe(400);
    for (const lastRecordedAt of ['', 'not-a-canonical-timestamp']) {
      const cursor = Buffer.from(
        JSON.stringify({
          v: 1,
          lastRecordedAt,
          applicationId: first.id,
        }),
      ).toString('base64url');
      expect(
        captureServiceError(() => service.listApplications({ cursor })),
      ).toMatchObject({
        status: 400,
        code: 'application_validation_failed',
      });
    }
    expect(
      captureServiceError(() => service.getApplication('missing')).status,
    ).toBe(404);
  });

  it('accepts every rich non-Applied lifecycle status, repetitions, and post-outcome facts', () => {
    const applicationId =
      service.createApplication(createCommand()).application.id;
    const transitions: readonly (readonly [
      ApplicationLifecycleStatus,
      string,
    ])[] = [
      ['recruiter_contact', 'applied'],
      ['phone_screen', 'interview'],
      ['technical_interview', 'interview'],
      ['manager_interview', 'interview'],
      ['final_interview', 'interview'],
      ['interview', 'interview'],
      ['offer', 'offer'],
      ['accepted', 'offer'],
      ['rejected', 'rejected'],
      ['ghosted', 'rejected'],
      ['withdrawn', 'ignored'],
      ['recruiter_contact', 'applied'],
      ['recruiter_contact', 'applied'],
    ];

    let priorCoarse = 'applied';
    let historyCount = jobHistoryCount();
    transitions.forEach(([eventType, expectedCoarse], index) => {
      const result = service.appendEvent(applicationId, {
        kind: 'lifecycle',
        eventId: `lifecycle-${String(index)}`,
        eventType,
        occurredAt: `2026-08-02T${String(index).padStart(2, '0')}:00:00Z`,
        occurrencePrecision: 'exact',
      });
      expect(result.application.status).toBe(eventType);
      expect(jobs.getStatus(JOB_ID)).toBe(expectedCoarse);
      const nextHistoryCount = jobHistoryCount();
      expect(nextHistoryCount - historyCount).toBe(
        expectedCoarse === priorCoarse ? 0 : 1,
      );
      historyCount = nextHistoryCount;
      priorCoarse = expectedCoarse;
    });
    expect(eventCount()).toBe(1 + transitions.length);
    expect(
      captureServiceError(() =>
        service.appendEvent(applicationId, {
          kind: 'lifecycle',
          eventId: 'later-applied-not-allowed',
          eventType: 'applied',
          occurredAt: '2026-08-01',
          occurrencePrecision: 'date',
        }),
      ).status,
    ).toBe(400);
  });

  it('normalizes exact offsets and date-only values and rejects invalid or future occurrences', () => {
    const created = service.createApplication(createCommand());
    expect(created.event.occurredAt).toBe('2026-08-01T15:00:00.000Z');
    expect(created.event.occurredAtSort).toBe('2026-08-01T15:00:00.000Z');

    const today = service.appendEvent(created.application.id, {
      kind: 'lifecycle',
      eventId: 'today-date',
      eventType: 'phone_screen',
      occurredAt: '2026-08-08',
      occurrencePrecision: 'date',
    });
    expect(today.event).toMatchObject({
      occurredAt: '2026-08-08',
      occurredAtSort: '2026-08-08T00:00:00.000Z',
      occurrencePrecision: 'date',
    });

    service.appendEvent(created.application.id, {
      kind: 'note',
      eventId: 'millisecond-event',
      occurredAt: '2026-08-01T10:00:00.001Z',
      occurrencePrecision: 'exact',
      text: 'Exact millisecond',
    });
    const millisecondConflict = captureServiceError(() =>
      service.appendEvent(created.application.id, {
        kind: 'note',
        eventId: 'millisecond-event',
        occurredAt: '2026-08-01T10:00:00.002Z',
        occurrencePrecision: 'exact',
        text: 'Exact millisecond',
      }),
    );
    expect(millisecondConflict.code).toBe('application_event_id_conflict');

    expect(
      service.appendEvent(created.application.id, {
        kind: 'note',
        eventId: 'maximum-offset',
        occurredAt: '2026-08-01T14:00:00+14:00',
        occurrencePrecision: 'exact',
        text: 'Maximum valid offset',
      }).event.occurredAt,
    ).toBe('2026-08-01T00:00:00.000Z');

    const before = eventCount();
    for (const occurredAt of [
      '2026-02-30T10:00:00Z',
      '2026-08-08T10:00:00',
      '2026-08-08T13:00:00Z',
      '2026-08-08T12:00:00.001Z',
      '2026-08-01T10:00:00.0001Z',
      '2026-08-01T10:00:00+14:01',
      '2026-08-01T10:00:00-15:00',
    ]) {
      expect(
        captureServiceError(() =>
          service.appendEvent(created.application.id, {
            kind: 'note',
            eventId: `invalid:${occurredAt}`,
            occurredAt,
            occurrencePrecision: 'exact',
            text: 'Should not persist',
          }),
        ).status,
      ).toBe(400);
    }
    expect(
      captureServiceError(() =>
        service.appendEvent(created.application.id, {
          kind: 'note',
          eventId: 'future-date',
          occurredAt: '2026-08-09',
          occurrencePrecision: 'date',
          text: 'Should not persist',
        }),
      ).status,
    ).toBe(400);
    expect(eventCount()).toBe(before);
  });

  it('keeps immutable Note events separate from mutable summary notes and Job history', () => {
    const created = service.createApplication(createCommand());
    const historyBefore = jobHistoryCount();
    currentTime = '2026-08-08T12:30:00.000Z';
    const note = service.appendEvent(created.application.id, {
      kind: 'note',
      eventId: 'historical-note',
      occurredAt: '2026-08-04',
      occurrencePrecision: 'date',
      text: 'Recruiter requested references',
    });
    expect(note.event.notes).toBe('Recruiter requested references');
    expect(note.application.notes).toBeNull();
    expect(note.application.status).toBe('applied');
    expect(jobHistoryCount()).toBe(historyBefore);

    const recordedBeforeSummary = note.application.lastRecordedAt;
    const eventCountBeforeSummary = eventCount();
    currentTime = '2026-08-08T13:00:00.000Z';
    const summary = service.updateSummaryNotes(created.application.id, {
      notes: 'Current follow-up summary',
    });
    expect(summary.application).toMatchObject({
      notes: 'Current follow-up summary',
      updatedAt: currentTime,
      lastRecordedAt: recordedBeforeSummary,
    });
    expect(eventCount()).toBe(eventCountBeforeSummary);
    expect(jobHistoryCount()).toBe(historyBefore);
    expect(
      service.updateSummaryNotes(created.application.id, { notes: '   ' })
        .application.notes,
    ).toBeNull();

    expect(
      captureServiceError(() =>
        service.appendEvent(created.application.id, {
          kind: 'note',
          eventId: 'blank-note',
          occurredAt: '2026-08-04',
          occurrencePrecision: 'date',
          text: '   ',
        }),
      ).status,
    ).toBe(400);
    expect(
      captureServiceError(() =>
        service.appendEvent(created.application.id, {
          kind: 'note',
          eventId: 'long-note',
          occurredAt: '2026-08-04',
          occurrencePrecision: 'date',
          text: 'n'.repeat(4_001),
        }),
      ).status,
    ).toBe(400);
    expect(
      captureServiceError(() =>
        service.updateSummaryNotes(created.application.id, {
          notes: 's'.repeat(10_001),
        }),
      ).status,
    ).toBe(400);
  });

  it('replaces status and Note terminals, exposes correction reasons, and replays stale retries', () => {
    const applicationId =
      service.createApplication(createCommand()).application.id;
    service.appendEvent(applicationId, {
      kind: 'lifecycle',
      eventId: 'status-target',
      eventType: 'technical_interview',
      occurredAt: '2026-08-03T09:00:00-05:00',
      occurrencePrecision: 'exact',
      notes: 'Original status context',
    });
    service.appendEvent(applicationId, {
      kind: 'note',
      eventId: 'note-target',
      occurredAt: '2026-08-02',
      occurrencePrecision: 'date',
      text: 'Original note',
    });

    currentTime = '2026-08-08T13:00:00.000Z';
    const replacementCommand = {
      kind: 'replace' as const,
      eventId: 'status-replacement',
      targetEventId: 'status-target',
      replacementEventType: 'offer' as const,
      occurredAt: '2026-08-04',
      occurrencePrecision: 'date' as const,
      reason: 'The prior stage was entered incorrectly',
    };
    const replacement = service.appendEvent(applicationId, replacementCommand);
    expect(replacement.application.status).toBe('offer');
    expect(replacement.event).toMatchObject({
      eventType: 'offer',
      notes: 'The prior stage was entered incorrectly',
      supersedesEventId: 'status-target',
      supersedeAction: 'replace',
      correctionReason: 'The prior stage was entered incorrectly',
    });
    const countBeforeReplay = eventCount();
    const updatedBeforeReplay = replacement.application.updatedAt;
    currentTime = '2026-08-08T14:00:00.000Z';
    const replay = service.appendEvent(applicationId, replacementCommand);
    expect(replay.replayed).toBe(true);
    expect(eventCount()).toBe(countBeforeReplay);
    expect(replay.application.updatedAt).toBe(updatedBeforeReplay);

    const noteReplacement = service.appendEvent(applicationId, {
      kind: 'replace',
      eventId: 'note-replacement',
      targetEventId: 'note-target',
      replacementEventType: 'note',
      occurredAt: '2026-08-02',
      occurrencePrecision: 'date',
      text: 'Corrected immutable note',
      reason: 'Fixed the employer name',
    });
    expect(noteReplacement.event).toMatchObject({
      notes: 'Corrected immutable note',
      correctionReason: 'Fixed the employer name',
    });
    expect(noteReplacement.application.status).toBe('offer');

    const timeline = service.getTimeline(applicationId);
    expect(
      timeline.find((event) => event.id === 'status-target'),
    ).toMatchObject({
      effective: false,
      supersededByEventId: 'status-replacement',
      terminal: false,
      canReplace: false,
      canVoid: false,
      correctionIneligibilityReason: 'superseded',
    });
  });

  it('voids eligible events with inherited occurrence and protects the final status', () => {
    const applicationId =
      service.createApplication(createCommand()).application.id;
    service.appendEvent(applicationId, {
      kind: 'lifecycle',
      eventId: 'void-target',
      eventType: 'rejected',
      occurredAt: '2026-08-05',
      occurrencePrecision: 'date',
    });
    currentTime = '2026-08-08T13:00:00.000Z';
    const result = service.appendEvent(applicationId, {
      kind: 'void',
      eventId: 'void-event',
      targetEventId: 'void-target',
      reason: 'Duplicate employer update',
    });
    expect(result.event).toMatchObject({
      eventType: 'void',
      occurredAt: '2026-08-05',
      occurredAtSort: '2026-08-05T00:00:00.000Z',
      occurrencePrecision: 'date',
      recordedAtSort: currentTime,
      correctionReason: 'Duplicate employer update',
      canReplace: false,
      canVoid: false,
      correctionIneligibilityReason: 'void_event',
    });
    expect(result.application.status).toBe('applied');
    expect(jobs.getStatus(JOB_ID)).toBe('applied');

    expect(
      captureServiceError(() =>
        service.appendEvent(applicationId, {
          kind: 'void',
          eventId: 'void-the-void',
          targetEventId: 'void-event',
        }),
      ).code,
    ).toBe('application_correction_target_stale');
    expect(
      captureServiceError(() =>
        service.appendEvent(applicationId, {
          kind: 'void',
          eventId: 'void-final-applied',
          targetEventId: 'creation-event',
        }),
      ).code,
    ).toBe('application_final_status_required');
  });

  it('does not synchronize Job status when Void reveals a Legacy State Imported winner', () => {
    const applicationId = 'migrated-application';
    insertMigratedApplication(applicationId);
    database
      .prepare("UPDATE jobs SET status = 'review' WHERE id = ?")
      .run(JOB_ID);
    const historyBefore = jobHistoryCount();

    const result = service.appendEvent(applicationId, {
      kind: 'void',
      eventId: 'void-migrated-current-status',
      targetEventId: 'migrated-current-status',
      reason: 'Imported status should be revealed only in the Application',
    });

    expect(result.application.status).toBe('offer');
    expect(result.event.eventType).toBe('void');
    expect(jobs.getStatus(JOB_ID)).toBe('review');
    expect(jobHistoryCount()).toBe(historyBefore);
  });

  it('rejects stale, wrong-kind, cross-Application, migration, and ambiguous correction targets', () => {
    const applicationId =
      service.createApplication(createCommand()).application.id;
    service.appendEvent(applicationId, {
      kind: 'note',
      eventId: 'stale-note',
      occurredAt: '2026-08-02',
      occurrencePrecision: 'date',
      text: 'First version',
    });
    service.appendEvent(applicationId, {
      kind: 'replace',
      eventId: 'current-note',
      targetEventId: 'stale-note',
      replacementEventType: 'note',
      occurredAt: '2026-08-02',
      occurrencePrecision: 'date',
      text: 'Current version',
    });
    expect(
      captureServiceError(() =>
        service.appendEvent(applicationId, {
          kind: 'replace',
          eventId: 'second-stale-replacement',
          targetEventId: 'stale-note',
          replacementEventType: 'note',
          occurredAt: '2026-08-02',
          occurrencePrecision: 'date',
          text: 'Conflicting version',
        }),
      ).code,
    ).toBe('application_correction_target_stale');
    expect(
      captureServiceError(() =>
        service.appendEvent(applicationId, {
          kind: 'replace',
          eventId: 'wrong-kind',
          targetEventId: 'current-note',
          replacementEventType: 'offer',
          occurredAt: '2026-08-03',
          occurrencePrecision: 'date',
        }),
      ).code,
    ).toBe('application_correction_kind_mismatch');

    const otherJob = '10000000-0000-4000-8000-000000000085';
    insertJob(otherJob, null);
    const otherApplication = service.createApplication({
      ...createCommand(),
      eventId: 'other-creation',
      jobId: otherJob,
      sourceId: null,
    }).application.id;
    expect(
      captureServiceError(() =>
        service.appendEvent(otherApplication, {
          kind: 'void',
          eventId: 'cross-application-void',
          targetEventId: 'current-note',
        }),
      ).code,
    ).toBe('application_correction_target_conflict');

    insertRawNote(applicationId, 'migration-note', NOW, 'migration');
    insertRawNote(applicationId, 'ambiguous-note', null, 'legacy-import');
    insertRawNote(
      applicationId,
      'malformed-recorded-note',
      'not-a-normalized-time',
      'legacy-import',
    );
    expect(
      captureServiceError(() =>
        service.appendEvent(applicationId, {
          kind: 'void',
          eventId: 'void-migration',
          targetEventId: 'migration-note',
        }),
      ).code,
    ).toBe('application_correction_target_stale');
    for (const [eventId, targetEventId] of [
      ['void-ambiguous', 'ambiguous-note'],
      ['void-malformed-recorded', 'malformed-recorded-note'],
    ] as const) {
      expect(
        captureServiceError(() =>
          service.appendEvent(applicationId, {
            kind: 'void',
            eventId,
            targetEventId,
          }),
        ),
      ).toMatchObject({
        code: 'application_correction_target_stale',
        details: { reason: 'missing_recorded_time' },
      });
    }
  });

  it('preserves copied context, rebuilds equivalently, and rolls back the whole command on Job sync failure', () => {
    const created = service.createApplication(createCommand());
    database
      .prepare(
        `UPDATE jobs
            SET title = 'Changed current Job', company = 'Changed Company',
                location = 'Changed location'
          WHERE id = ?`,
      )
      .run(JOB_ID);
    service.appendEvent(created.application.id, {
      kind: 'lifecycle',
      eventId: 'context-preserving-event',
      eventType: 'phone_screen',
      occurredAt: '2026-08-03',
      occurrencePrecision: 'date',
    });
    expect(service.getApplication(created.application.id)).toMatchObject({
      titleAtApplication: 'Security Engineer',
      companyAtApplication: 'Example Company',
      locationAtApplication: 'Remote',
      applicationUrl: 'https://jobs.example/apply/83',
      sourceId,
      providerId: 'observed-provider',
      sourceLabel: 'Backend Careers',
    });
    expect(() =>
      database
        .prepare(
          "UPDATE applications SET title_at_application = 'Mutated' WHERE id = ?",
        )
        .run(created.application.id),
    ).toThrow('immutable');

    const expected = projection(created.application.id);
    database
      .prepare(
        `UPDATE applications
            SET status = 'accepted', applied_at = NULL,
                applied_at_precision = NULL, last_event_at = NULL,
                last_recorded_at = NULL
          WHERE id = ?`,
      )
      .run(created.application.id);
    applications.reproject(JOB_ID, currentTime);
    expect(projection(created.application.id)).toEqual(expected);

    database.exec(`
      CREATE TRIGGER fail_offer_job_sync
      BEFORE UPDATE OF status ON jobs
      WHEN NEW.status = 'offer'
      BEGIN
        SELECT RAISE(ABORT, 'forced Job sync failure');
      END;
    `);
    const beforeFailure = persistenceSnapshot(created.application.id);
    expect(() =>
      service.appendEvent(created.application.id, {
        kind: 'lifecycle',
        eventId: 'rolled-back-offer',
        eventType: 'offer',
        occurredAt: '2026-08-06',
        occurrencePrecision: 'date',
      }),
    ).toThrow('forced Job sync failure');
    expect(applications.findEventById('rolled-back-offer')).toBeNull();
    expect(persistenceSnapshot(created.application.id)).toEqual(beforeFailure);
  });

  it('rolls back parent Application creation when the Applied event insert fails', () => {
    database.exec(`
      CREATE TRIGGER fail_applied_event_insert
      BEFORE INSERT ON application_history
      WHEN NEW.id = 'failing-applied-event'
      BEGIN
        SELECT RAISE(ABORT, 'forced Application event insert failure');
      END;
    `);
    const beforeStatus = jobs.getStatus(JOB_ID);
    const beforeJobHistory = jobHistoryCount();

    expect(() =>
      service.createApplication({
        ...createCommand(),
        eventId: 'failing-applied-event',
      }),
    ).toThrow('forced Application event insert failure');
    expect(applications.findByJobId(JOB_ID)).toBeNull();
    expect(applications.findEventById('failing-applied-event')).toBeNull();
    expect(eventCount()).toBe(0);
    expect(jobs.getStatus(JOB_ID)).toBe(beforeStatus);
    expect(jobHistoryCount()).toBe(beforeJobHistory);
  });

  it('rolls back parent Application creation when reprojection fails', () => {
    database.exec(`
      CREATE TRIGGER fail_reprojection
      BEFORE UPDATE ON applications
      BEGIN
        SELECT RAISE(ABORT, 'forced reprojection failure');
      END;
    `);
    const beforeStatus = jobs.getStatus(JOB_ID);
    const beforeJobHistory = jobHistoryCount();

    expect(() =>
      service.createApplication({
        ...createCommand(),
        eventId: 'creation-reprojection-failure',
      }),
    ).toThrow('forced reprojection failure');
    expect(applications.findByJobId(JOB_ID)).toBeNull();
    expect(
      applications.findEventById('creation-reprojection-failure'),
    ).toBeNull();
    expect(eventCount()).toBe(0);
    expect(jobs.getStatus(JOB_ID)).toBe(beforeStatus);
    expect(jobHistoryCount()).toBe(beforeJobHistory);
  });

  it('rolls back an appended event and projection changes when reprojection fails', () => {
    const created = service.createApplication(createCommand());
    database.exec(`
      CREATE TRIGGER fail_reprojection
      BEFORE UPDATE ON applications
      BEGIN
        SELECT RAISE(ABORT, 'forced reprojection failure');
      END;
    `);
    const beforeFailure = persistenceSnapshot(created.application.id);

    expect(() =>
      service.appendEvent(created.application.id, {
        kind: 'lifecycle',
        eventId: 'rolled-back-reproject',
        eventType: 'phone_screen',
        occurredAt: '2026-08-03',
        occurrencePrecision: 'date',
      }),
    ).toThrow('forced reprojection failure');
    expect(applications.findEventById('rolled-back-reproject')).toBeNull();
    expect(persistenceSnapshot(created.application.id)).toEqual(beforeFailure);
  });

  it('rejects a missing Job or non-member Source without partial rows', () => {
    const missingJob = captureServiceError(() =>
      service.createApplication({
        ...createCommand(),
        eventId: 'missing-job-event',
        jobId: 'missing-job',
        sourceId: null,
      }),
    );
    expect(missingJob).toMatchObject({ status: 404, code: 'job_not_found' });

    const nonMember = captureServiceError(() =>
      service.createApplication({
        ...createCommand(),
        eventId: 'non-member-source-event',
        sourceId: insertTestSource(database, { id: 'other-source' }),
      }),
    );
    expect(nonMember).toMatchObject({
      status: 400,
      code: 'application_source_not_on_job',
    });
    expect(applications.findByJobId(JOB_ID)).toBeNull();
    expect(eventCount()).toBe(0);
  });

  function createCommand() {
    return {
      eventId: 'creation-event',
      jobId: JOB_ID,
      occurredAt: '2026-08-01T10:00:00-05:00',
      occurrencePrecision: 'exact' as const,
      titleAtApplication: 'Security Engineer',
      companyAtApplication: 'Example Company',
      locationAtApplication: 'Remote',
      applicationUrl: 'https://jobs.example/apply/83',
      sourceId,
      notes: null,
    };
  }

  function insertJob(jobId: string, memberSourceId: string | null): void {
    const job = createJobFixture({
      id: jobId,
      externalId: `external:${jobId}`,
      postingUrl: `https://jobs.example/${jobId}`,
      title: 'Current Security Engineer',
      normalizedTitle: 'current security engineer',
      company: 'Current Example Company',
      normalizedCompany: 'current example company',
      location: 'Current Remote',
      status: 'new',
    });
    const selectedSource = memberSourceId ?? sourceId;
    jobs.upsertObservation({
      job,
      sourceId: selectedSource,
      providerId: 'observed-provider',
      rawData: job,
    });
    if (memberSourceId === null) {
      database.prepare('DELETE FROM job_sources WHERE job_id = ?').run(jobId);
    }
  }

  function eventCount(): number {
    return scalar('SELECT COUNT(*) AS value FROM application_history');
  }

  function jobHistoryCount(): number {
    return scalar(
      'SELECT COUNT(*) AS value FROM job_status_history WHERE job_id = ?',
      JOB_ID,
    );
  }

  function scalar(sql: string, ...parameters: string[]): number {
    return (
      database.prepare<string[], { value: number }>(sql).get(...parameters)
        ?.value ?? 0
    );
  }

  function eventMetadata(eventId: string): Record<string, unknown> {
    const row = database
      .prepare<
        [string],
        { metadata_json: string }
      >('SELECT metadata_json FROM application_history WHERE id = ?')
      .get(eventId);
    if (row === undefined) throw new Error(`Missing event ${eventId}`);
    return JSON.parse(row.metadata_json) as Record<string, unknown>;
  }

  function persistenceSnapshot(applicationId: string) {
    const application = applications.findById(applicationId);
    if (application === null) throw new Error('Missing Application');
    return {
      eventCount: eventCount(),
      jobHistoryCount: jobHistoryCount(),
      jobStatus: jobs.getStatus(JOB_ID),
      application,
    };
  }

  function projection(applicationId: string) {
    const application = applications.findById(applicationId);
    if (application === null) throw new Error('Missing Application');
    return {
      status: application.status,
      appliedAt: application.appliedAt,
      appliedAtPrecision: application.appliedAtPrecision,
      lastEventAt: application.lastEventAt,
      lastRecordedAt: application.lastRecordedAt,
    };
  }

  function insertRawNote(
    applicationId: string,
    eventId: string,
    recordedAtSort: string | null,
    source: string,
  ): void {
    database
      .prepare(
        `INSERT INTO application_history (
          id, application_id, job_id, event_type, resulting_status,
          occurred_at, occurred_at_sort, occurrence_precision, recorded_at_sort,
          notes, source, created_at
        ) VALUES (?, ?, ?, 'note', NULL, '2026-08-02',
          '2026-08-02T00:00:00.000Z', 'date', ?, 'Legacy note', ?, ?)`,
      )
      .run(
        eventId,
        applicationId,
        JOB_ID,
        recordedAtSort,
        source,
        recordedAtSort ?? 'ambiguous-recorded-time',
      );
  }

  function insertMigratedApplication(applicationId: string): void {
    database
      .prepare(
        `INSERT INTO applications (
          id, job_id, status, title_at_application, company_at_application,
          location_at_application, legacy_provenance, created_at, updated_at
        ) VALUES (?, ?, 'rejected', 'Migrated title', 'Migrated company',
          'Migrated location', 'legacy:test', ?, ?)`,
      )
      .run(applicationId, JOB_ID, '2026-08-01T00:00:00.000Z', NOW);
    database
      .prepare(
        `INSERT INTO application_history (
          id, application_id, job_id, event_type, resulting_status,
          occurred_at, occurred_at_sort, occurrence_precision, recorded_at_sort,
          notes, source, created_at
        ) VALUES (
          'migrated-imported-status', ?, ?, 'legacy_state_imported', 'offer',
          NULL, NULL, 'unknown', '2026-08-01T00:00:00.000Z',
          'Imported aggregate status', 'migration', '2026-08-01T00:00:00.000Z'
        )`,
      )
      .run(applicationId, JOB_ID);
    database
      .prepare(
        `INSERT INTO application_history (
          id, application_id, job_id, event_type, resulting_status,
          occurred_at, occurred_at_sort, occurrence_precision, recorded_at_sort,
          notes, source, created_at
        ) VALUES (
          'migrated-current-status', ?, ?, 'rejected', 'rejected',
          '2026-08-02', '2026-08-02T00:00:00.000Z', 'date',
          '2026-08-03T00:00:00.000Z', NULL, 'legacy-test',
          '2026-08-03T00:00:00.000Z'
        )`,
      )
      .run(applicationId, JOB_ID);
    applications.reproject(JOB_ID, NOW);
  }
});

function captureServiceError(action: () => unknown): ApplicationServiceError {
  try {
    action();
  } catch (error) {
    if (error instanceof ApplicationServiceError) return error;
    throw error;
  }
  throw new Error('Expected ApplicationServiceError');
}
