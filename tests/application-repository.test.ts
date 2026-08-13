import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import type { ApplicationEventType } from '../src/domain/application-history.js';
import type {
  ApplicationStatus,
  OccurrencePrecision,
} from '../src/domain/application-status.js';
import { ApplicationRepository } from '../src/repositories/application-repository.js';
import { APPLICATION_OPAQUE_ID_MAX_LENGTH } from '../src/schemas/application.js';
import { createTestDatabase } from './helpers/test-database.js';

interface ApplicationInput {
  id: string;
  jobId: string;
  status?: ApplicationStatus;
  appliedAt?: string | null;
  appliedAtPrecision?: OccurrencePrecision | null;
  lastEventAt?: string | null;
  lastRecordedAt?: string | null;
  titleAtApplication?: string | null;
  companyAtApplication?: string | null;
  locationAtApplication?: string | null;
  applicationUrl?: string | null;
  sourceId?: string | null;
  providerId?: string | null;
  sourceLabel?: string | null;
  notes?: string | null;
  legacyProvenance?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface EventInput {
  id: string;
  applicationId: string;
  jobId: string;
  eventType: ApplicationEventType;
  resultingStatus: ApplicationStatus | null;
  occurredAt: string | null;
  occurredAtSort?: string | null;
  occurrencePrecision?: OccurrencePrecision;
  recordedAt: string;
  notes?: string | null;
  supersedesEventId?: string | null;
  supersedeAction?: 'replace' | 'void' | null;
  source?: string;
  metadataJson?: string | null;
}

const BASE_TIME = '2026-01-01T00:00:00.000Z';

describe('ApplicationRepository', () => {
  let database: JobDatabase;
  let repository: ApplicationRepository;

  beforeEach(() => {
    database = createTestDatabase();
    repository = new ApplicationRepository(database);
  });

  afterEach(() => database.close());

  it('maps every V2 Application field in findByJobId', () => {
    insertJob('job-mapped');
    insertApplication({
      id: 'application-mapped',
      jobId: 'job-mapped',
      status: 'offer',
      appliedAt: '2026-01-02T03:04:05.000Z',
      appliedAtPrecision: 'exact',
      lastEventAt: '2026-02-03T04:05:06.000Z',
      lastRecordedAt: '2026-02-04T04:05:06.000Z',
      titleAtApplication: 'Security Engineer',
      companyAtApplication: 'Example Company',
      locationAtApplication: 'Remote',
      applicationUrl: 'https://example.com/apply/1',
      sourceId: 'source-at-application',
      providerId: 'provider-at-application',
      sourceLabel: 'Example Careers',
      notes: 'Current summary',
      legacyProvenance: 'legacy:test',
      createdAt: '2026-01-02T03:04:06.000Z',
      updatedAt: '2026-02-04T04:05:07.000Z',
    });
    insertEvent({
      id: 'event-mapped',
      applicationId: 'application-mapped',
      jobId: 'job-mapped',
      eventType: 'offer',
      resultingStatus: 'offer',
      occurredAt: '2026-02-03T04:05:06.000Z',
      recordedAt: '2026-02-04T04:05:06.000Z',
    });

    expect(repository.findByJobId('job-mapped')).toEqual({
      id: 'application-mapped',
      jobId: 'job-mapped',
      status: 'offer',
      appliedAt: '2026-01-02T03:04:05.000Z',
      appliedAtPrecision: 'exact',
      lastEventAt: '2026-02-03T04:05:06.000Z',
      lastRecordedAt: '2026-02-04T04:05:06.000Z',
      titleAtApplication: 'Security Engineer',
      companyAtApplication: 'Example Company',
      companyId: null,
      locationAtApplication: 'Remote',
      applicationUrl: 'https://example.com/apply/1',
      sourceId: 'source-at-application',
      providerId: 'provider-at-application',
      sourceLabel: 'Example Careers',
      notes: 'Current summary',
      legacyProvenance: 'legacy:test',
      submittedResumeSnapshotId: null,
      createdAt: '2026-01-02T03:04:06.000Z',
      updatedAt: '2026-02-04T04:05:07.000Z',
    });
    expect(repository.findByJobId('missing-job')).toBeNull();
  });

  it('lists Applications by deterministic activity and stable ID', () => {
    for (const [jobId, applicationId, lastRecordedAt, lastEventAt] of [
      [
        'job-list-b',
        'application-b',
        '2026-03-01T00:00:00.000Z',
        '2026-02-01T00:00:00.000Z',
      ],
      [
        'job-list-a',
        'application-a',
        '2026-03-01T00:00:00.000Z',
        '2026-02-02T00:00:00.000Z',
      ],
      ['job-list-c', 'application-c', null, '2026-02-15T00:00:00.000Z'],
    ] as const) {
      insertJob(jobId);
      insertApplication({
        id: applicationId,
        jobId,
        lastRecordedAt,
        lastEventAt,
      });
    }

    expect(
      repository.listApplications().map((application) => application.id),
    ).toEqual(['application-a', 'application-b', 'application-c']);
  });

  it('keyset-paginates exact activity order including nulls and applies exact filters', () => {
    const inputs = [
      [
        'job-page-b',
        'application-b',
        '2026-03-03T00:00:00.000Z',
        'offer',
        'Acme',
      ],
      [
        'job-page-a',
        'application-a',
        '2026-03-03T00:00:00.000Z',
        'offer',
        'ACME',
      ],
      [
        'job-page-c',
        'application-c',
        '2026-03-02T00:00:00.000Z',
        'rejected',
        'Other',
      ],
      ['job-page-e', 'application-e', null, 'offer', 'acme'],
      ['job-page-d', 'application-d', null, 'offer', 'Acme Holdings'],
    ] as const;
    for (const [
      jobId,
      applicationId,
      lastRecordedAt,
      status,
      company,
    ] of inputs) {
      insertJob(jobId);
      insertApplication({
        id: applicationId,
        jobId,
        status,
        companyAtApplication: company,
        lastRecordedAt,
      });
    }

    const first = repository.listApplications({ limit: 2 });
    expect(first.items.map((application) => application.id)).toEqual([
      'application-a',
      'application-b',
    ]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = repository.listApplications({
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((application) => application.id)).toEqual([
      'application-c',
      'application-d',
    ]);
    const third = repository.listApplications({
      limit: 2,
      cursor: second.nextCursor!,
    });
    expect(third.items.map((application) => application.id)).toEqual([
      'application-e',
    ]);
    expect(third.nextCursor).toBeNull();

    expect(
      repository
        .listApplications({ limit: 100, status: 'offer', company: 'aCmE' })
        .items.map((application) => application.id),
    ).toEqual(['application-a', 'application-b', 'application-e']);
    expect(() =>
      repository.listApplications({ limit: 25, cursor: 'not+a+cursor' }),
    ).toThrow('Invalid Application list cursor');
    for (const lastRecordedAt of ['', 'not-a-canonical-timestamp']) {
      const cursor = Buffer.from(
        JSON.stringify({
          v: 1,
          lastRecordedAt,
          applicationId: 'application-a',
        }),
      ).toString('base64url');
      expect(() => repository.listApplications({ limit: 25, cursor })).toThrow(
        'Invalid Application list cursor',
      );
    }
  });

  it('round-trips a cursor containing an exact-byte boundary-length Application ID', () => {
    const boundaryId = ` ${'x'.repeat(APPLICATION_OPAQUE_ID_MAX_LENGTH - 2)} `;
    insertJob('job-boundary-cursor');
    insertApplication({
      id: boundaryId,
      jobId: 'job-boundary-cursor',
      lastRecordedAt: '2026-04-02T00:00:00.000Z',
    });
    insertJob('job-after-boundary-cursor');
    insertApplication({
      id: 'application-after-boundary',
      jobId: 'job-after-boundary-cursor',
      lastRecordedAt: '2026-04-01T00:00:00.000Z',
    });

    const first = repository.listApplications({ limit: 1 });
    expect(first.items[0]?.id).toBe(boundaryId);
    expect(first.nextCursor).not.toBeNull();
    expect(
      repository.listApplications({ limit: 1, cursor: first.nextCursor! })
        .items[0]?.id,
    ).toBe('application-after-boundary');
  });

  it('returns a complete ordered timeline with backend-derived correction state', () => {
    insertJob('job-timeline');
    insertApplication({
      id: 'application-timeline',
      jobId: 'job-timeline',
    });
    insertEvent({
      id: 'timeline-applied',
      applicationId: 'application-timeline',
      jobId: 'job-timeline',
      eventType: 'applied',
      resultingStatus: 'applied',
      occurredAt: '2026-01-01',
      occurredAtSort: '2026-01-01T00:00:00.000Z',
      occurrencePrecision: 'date',
      recordedAt: '2026-01-05T00:00:00.000Z',
      metadataJson: '{not valid json',
    });
    insertEvent({
      id: 'timeline-status-original',
      applicationId: 'application-timeline',
      jobId: 'job-timeline',
      eventType: 'interview',
      resultingStatus: 'interview',
      occurredAt: '2026-01-04T00:00:00.000Z',
      recordedAt: '2026-01-06T00:00:00.000Z',
    });
    insertEvent({
      id: 'timeline-status-replacement',
      applicationId: 'application-timeline',
      jobId: 'job-timeline',
      eventType: 'phone_screen',
      resultingStatus: 'phone_screen',
      occurredAt: '2026-01-02',
      occurredAtSort: '2026-01-02T00:00:00.000Z',
      occurrencePrecision: 'date',
      recordedAt: '2026-01-07T00:00:00.000Z',
      notes: 'Corrected stage',
      supersedesEventId: 'timeline-status-original',
      supersedeAction: 'replace',
      metadataJson: JSON.stringify({ definition: 'application-event-v99' }),
    });
    insertEvent({
      id: 'timeline-note-original',
      applicationId: 'application-timeline',
      jobId: 'job-timeline',
      eventType: 'note',
      resultingStatus: null,
      occurredAt: '2026-01-03',
      occurredAtSort: '2026-01-03T00:00:00.000Z',
      occurrencePrecision: 'date',
      recordedAt: '2026-01-08T00:00:00.000Z',
      notes: 'Original note',
    });
    insertEvent({
      id: 'timeline-note-replacement',
      applicationId: 'application-timeline',
      jobId: 'job-timeline',
      eventType: 'note',
      resultingStatus: null,
      occurredAt: '2026-01-03',
      occurredAtSort: '2026-01-03T00:00:00.000Z',
      occurrencePrecision: 'date',
      recordedAt: '2026-01-09T00:00:00.000Z',
      notes: 'Replacement note',
      supersedesEventId: 'timeline-note-original',
      supersedeAction: 'replace',
      metadataJson: JSON.stringify({
        definition: 'application-event-v1',
        commandHash: 'internal-not-exposed',
        correctionReason: 'Corrected wording',
      }),
    });

    const timeline = repository.getTimeline('application-timeline');
    expect(timeline.map((event) => event.id)).toEqual([
      'timeline-applied',
      'timeline-status-replacement',
      'timeline-note-original',
      'timeline-note-replacement',
      'timeline-status-original',
    ]);
    expect(
      timeline.find((event) => event.id === 'timeline-status-original'),
    ).toMatchObject({
      effective: false,
      supersededByEventId: 'timeline-status-replacement',
      terminal: false,
      canReplace: false,
      canVoid: false,
      correctionIneligibilityReason: 'superseded',
    });
    expect(
      timeline.find((event) => event.id === 'timeline-status-replacement'),
    ).toMatchObject({
      effective: true,
      supersedesEventId: 'timeline-status-original',
      canReplace: true,
      canVoid: true,
      definitionVersion: 'application-event-v99',
      correctionReason: 'Corrected stage',
    });
    expect(
      timeline.find((event) => event.id === 'timeline-note-replacement'),
    ).toMatchObject({
      effective: true,
      correctionReason: 'Corrected wording',
      definitionVersion: 'application-event-v1',
    });
    expect(timeline[0]).not.toHaveProperty('commandHash');
    expect(timeline[0]).not.toHaveProperty('metadataJson');
  });

  it('reprojects status, applied date, precision, and activity from effective events', () => {
    insertJob('job-fold');
    insertApplication({
      id: 'application-fold',
      jobId: 'job-fold',
      status: 'rejected',
      appliedAt: null,
      appliedAtPrecision: null,
      lastEventAt: null,
      lastRecordedAt: null,
    });
    insertEvent({
      id: 'event-applied',
      applicationId: 'application-fold',
      jobId: 'job-fold',
      eventType: 'applied',
      resultingStatus: 'applied',
      occurredAt: '2026-02-10T00:00:00.000Z',
      recordedAt: '2026-02-11T00:00:00.000Z',
    });
    insertEvent({
      id: 'event-legacy-date',
      applicationId: 'application-fold',
      jobId: 'job-fold',
      eventType: 'legacy_applied_date_imported',
      resultingStatus: null,
      occurredAt: '2026-01-15',
      occurredAtSort: '2026-01-15T00:00:00.000Z',
      occurrencePrecision: 'approximate',
      recordedAt: '2026-02-12T00:00:00.000Z',
    });
    insertEvent({
      id: 'event-interview',
      applicationId: 'application-fold',
      jobId: 'job-fold',
      eventType: 'interview',
      resultingStatus: 'interview',
      occurredAt: '2026-03-10T00:00:00.000Z',
      recordedAt: '2026-03-11T00:00:00.000Z',
    });
    insertEvent({
      id: 'event-note',
      applicationId: 'application-fold',
      jobId: 'job-fold',
      eventType: 'note',
      resultingStatus: null,
      occurredAt: '2026-04-01T00:00:00.000Z',
      recordedAt: '2026-04-02T00:00:00.000Z',
      notes: 'Timeline note',
    });

    const rebuilt = repository.reproject('job-fold');
    expect(projectionOf(rebuilt)).toEqual({
      status: 'interview',
      appliedAt: '2026-01-15',
      appliedAtPrecision: 'approximate',
      lastEventAt: '2026-04-01T00:00:00.000Z',
      lastRecordedAt: '2026-04-02T00:00:00.000Z',
    });
    expect(projectionOf(repository.reproject('job-fold'))).toEqual(
      projectionOf(rebuilt),
    );
    expect(projectionOf(repository.findByJobId('job-fold'))).toEqual(
      projectionOf(rebuilt),
    );
  });

  it('excludes replaced and voided status events from every effective fold', () => {
    insertJob('job-corrections');
    insertApplication({
      id: 'application-corrections',
      jobId: 'job-corrections',
      status: 'accepted',
    });
    insertEvent({
      id: 'correction-applied',
      applicationId: 'application-corrections',
      jobId: 'job-corrections',
      eventType: 'applied',
      resultingStatus: 'applied',
      occurredAt: '2026-01-01T00:00:00.000Z',
      recordedAt: '2026-01-02T00:00:00.000Z',
    });
    insertEvent({
      id: 'status-original',
      applicationId: 'application-corrections',
      jobId: 'job-corrections',
      eventType: 'interview',
      resultingStatus: 'interview',
      occurredAt: '2026-04-01T00:00:00.000Z',
      recordedAt: '2026-04-02T00:00:00.000Z',
    });
    insertEvent({
      id: 'status-replacement',
      applicationId: 'application-corrections',
      jobId: 'job-corrections',
      eventType: 'phone_screen',
      resultingStatus: 'phone_screen',
      occurredAt: '2026-02-01T00:00:00.000Z',
      recordedAt: '2026-04-03T00:00:00.000Z',
      supersedesEventId: 'status-original',
      supersedeAction: 'replace',
    });
    insertEvent({
      id: 'status-void-target',
      applicationId: 'application-corrections',
      jobId: 'job-corrections',
      eventType: 'rejected',
      resultingStatus: 'rejected',
      occurredAt: '2026-05-01T00:00:00.000Z',
      recordedAt: '2026-05-02T00:00:00.000Z',
    });
    insertEvent({
      id: 'status-void',
      applicationId: 'application-corrections',
      jobId: 'job-corrections',
      eventType: 'void',
      resultingStatus: null,
      occurredAt: '2026-06-01T00:00:00.000Z',
      recordedAt: '2026-06-02T00:00:00.000Z',
      supersedesEventId: 'status-void-target',
      supersedeAction: 'void',
    });

    expect(projectionOf(repository.reproject('job-corrections'))).toEqual({
      status: 'phone_screen',
      appliedAt: '2026-01-01T00:00:00.000Z',
      appliedAtPrecision: 'exact',
      lastEventAt: '2026-02-01T00:00:00.000Z',
      lastRecordedAt: '2026-06-02T00:00:00.000Z',
    });
    expect(effectiveEventIds('application-corrections')).toEqual([
      'correction-applied',
      'status-replacement',
    ]);
  });

  it('keeps only the deterministic terminal correction effective', () => {
    insertJob('job-chain');
    insertApplication({ id: 'application-chain', jobId: 'job-chain' });
    insertEvent({
      id: 'chain-original',
      applicationId: 'application-chain',
      jobId: 'job-chain',
      eventType: 'applied',
      resultingStatus: 'applied',
      occurredAt: '2026-01-10T00:00:00.000Z',
      recordedAt: '2026-01-10T01:00:00.000Z',
    });
    insertEvent({
      id: 'chain-replacement-1',
      applicationId: 'application-chain',
      jobId: 'job-chain',
      eventType: 'applied',
      resultingStatus: 'applied',
      occurredAt: '2026-01-05T00:00:00.000Z',
      recordedAt: '2026-01-11T00:00:00.000Z',
      supersedesEventId: 'chain-original',
      supersedeAction: 'replace',
    });
    insertEvent({
      id: 'chain-replacement-2',
      applicationId: 'application-chain',
      jobId: 'job-chain',
      eventType: 'applied',
      resultingStatus: 'applied',
      occurredAt: '2026-01-07T00:00:00.000Z',
      recordedAt: '2026-01-12T00:00:00.000Z',
      supersedesEventId: 'chain-replacement-1',
      supersedeAction: 'replace',
    });

    expect(projectionOf(repository.reproject('job-chain'))).toEqual({
      status: 'applied',
      appliedAt: '2026-01-07T00:00:00.000Z',
      appliedAtPrecision: 'exact',
      lastEventAt: '2026-01-07T00:00:00.000Z',
      lastRecordedAt: '2026-01-12T00:00:00.000Z',
    });
    expect(effectiveEventIds('application-chain')).toEqual([
      'chain-replacement-2',
    ]);
  });

  it('enforces prior-target, same-Application, linear correction chains', () => {
    insertJob('job-integrity-a');
    insertJob('job-integrity-b');
    insertApplication({
      id: 'application-integrity-a',
      jobId: 'job-integrity-a',
    });
    insertApplication({
      id: 'application-integrity-b',
      jobId: 'job-integrity-b',
    });
    insertEvent({
      id: 'integrity-target-a',
      applicationId: 'application-integrity-a',
      jobId: 'job-integrity-a',
      eventType: 'applied',
      resultingStatus: 'applied',
      occurredAt: '2026-01-01T00:00:00.000Z',
      recordedAt: '2026-01-02T00:00:00.000Z',
    });
    insertEvent({
      id: 'integrity-target-b',
      applicationId: 'application-integrity-b',
      jobId: 'job-integrity-b',
      eventType: 'applied',
      resultingStatus: 'applied',
      occurredAt: '2026-01-01T00:00:00.000Z',
      recordedAt: '2026-01-05T00:00:00.000Z',
    });

    expect(() =>
      insertEvent({
        id: 'integrity-cross-application',
        applicationId: 'application-integrity-b',
        jobId: 'job-integrity-b',
        eventType: 'offer',
        resultingStatus: 'offer',
        occurredAt: '2026-01-03T00:00:00.000Z',
        recordedAt: '2026-01-06T00:00:00.000Z',
        supersedesEventId: 'integrity-target-a',
        supersedeAction: 'replace',
      }),
    ).toThrow('same Application');
    expect(() =>
      insertEvent({
        id: 'integrity-self',
        applicationId: 'application-integrity-a',
        jobId: 'job-integrity-a',
        eventType: 'offer',
        resultingStatus: 'offer',
        occurredAt: '2026-01-03T00:00:00.000Z',
        recordedAt: '2026-01-06T00:00:00.000Z',
        supersedesEventId: 'integrity-self',
        supersedeAction: 'replace',
      }),
    ).toThrow('cannot supersede itself');
    expect(() =>
      insertEvent({
        id: 'cycle-forward-reference',
        applicationId: 'application-integrity-a',
        jobId: 'job-integrity-a',
        eventType: 'offer',
        resultingStatus: 'offer',
        occurredAt: '2026-01-03T00:00:00.000Z',
        recordedAt: '2026-01-06T00:00:00.000Z',
        supersedesEventId: 'cycle-missing-target',
        supersedeAction: 'replace',
      }),
    ).toThrow('same Application');
    expect(() =>
      insertEvent({
        id: 'integrity-backdated-write',
        applicationId: 'application-integrity-b',
        jobId: 'job-integrity-b',
        eventType: 'offer',
        resultingStatus: 'offer',
        occurredAt: '2026-01-03T00:00:00.000Z',
        recordedAt: '2026-01-04T00:00:00.000Z',
        supersedesEventId: 'integrity-target-b',
        supersedeAction: 'replace',
      }),
    ).toThrow('recorded after');
    expect(() =>
      insertEvent({
        id: 'integrity-only-status-void',
        applicationId: 'application-integrity-b',
        jobId: 'job-integrity-b',
        eventType: 'void',
        resultingStatus: null,
        occurredAt: '2026-01-06T00:00:00.000Z',
        recordedAt: '2026-01-06T00:00:00.000Z',
        supersedesEventId: 'integrity-target-b',
        supersedeAction: 'void',
      }),
    ).toThrow('retain an effective status-bearing event');

    insertEvent({
      id: 'integrity-replacement',
      applicationId: 'application-integrity-a',
      jobId: 'job-integrity-a',
      eventType: 'offer',
      resultingStatus: 'offer',
      occurredAt: '2026-01-03T00:00:00.000Z',
      recordedAt: '2026-01-06T00:00:00.000Z',
      supersedesEventId: 'integrity-target-a',
      supersedeAction: 'replace',
    });
    expect(() =>
      insertEvent({
        id: 'integrity-conflict',
        applicationId: 'application-integrity-a',
        jobId: 'job-integrity-a',
        eventType: 'rejected',
        resultingStatus: 'rejected',
        occurredAt: '2026-01-04T00:00:00.000Z',
        recordedAt: '2026-01-07T00:00:00.000Z',
        supersedesEventId: 'integrity-target-a',
        supersedeAction: 'replace',
      }),
    ).toThrow('already has a direct superseder');
  });

  function insertJob(jobId: string): void {
    database
      .prepare(
        `INSERT INTO jobs (
          id, fingerprint, title, normalized_title, company, normalized_company,
          remote_type, employment_type, source_name, source_type, first_seen_at,
          last_seen_at, active, seniority_level, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'remote', 'full-time', 'Test', 'fixture',
          ?, ?, 1, 'mid', 'new', ?, ?)`,
      )
      .run(
        jobId,
        `fingerprint:${jobId}`,
        `Job ${jobId}`,
        `job ${jobId}`,
        'Example Company',
        'example company',
        BASE_TIME,
        BASE_TIME,
        BASE_TIME,
        BASE_TIME,
      );
  }

  function insertApplication(input: ApplicationInput): void {
    database
      .prepare(
        `INSERT INTO applications (
          id, job_id, status, applied_at, applied_at_precision, last_event_at,
          last_recorded_at, title_at_application, company_at_application,
          location_at_application, application_url, source_id, provider_id,
          source_label, notes, legacy_provenance, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.jobId,
        input.status ?? 'applied',
        input.appliedAt ?? null,
        input.appliedAtPrecision ?? null,
        input.lastEventAt ?? null,
        input.lastRecordedAt ?? null,
        input.titleAtApplication ?? null,
        input.companyAtApplication ?? null,
        input.locationAtApplication ?? null,
        input.applicationUrl ?? null,
        input.sourceId ?? null,
        input.providerId ?? null,
        input.sourceLabel ?? null,
        input.notes ?? null,
        input.legacyProvenance ?? null,
        input.createdAt ?? BASE_TIME,
        input.updatedAt ?? BASE_TIME,
      );
  }

  function insertEvent(input: EventInput): void {
    database
      .prepare(
        `INSERT INTO application_history (
          id, application_id, job_id, event_type, resulting_status, occurred_at,
          occurred_at_sort, occurrence_precision, recorded_at_sort, notes,
          source, metadata_json, supersedes_event_id, supersede_action,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.applicationId,
        input.jobId,
        input.eventType,
        input.resultingStatus,
        input.occurredAt,
        input.occurredAtSort === undefined
          ? input.occurredAt
          : input.occurredAtSort,
        input.occurrencePrecision ?? 'exact',
        input.recordedAt,
        input.notes ?? null,
        input.source ?? 'test',
        input.metadataJson ?? null,
        input.supersedesEventId ?? null,
        input.supersedeAction ?? null,
        input.recordedAt,
      );
  }

  function effectiveEventIds(applicationId: string): string[] {
    return database
      .prepare<[string], { id: string }>(
        'SELECT id FROM application_effective_events WHERE application_id = ? ORDER BY id',
      )
      .all(applicationId)
      .map((row) => row.id);
  }
});

function projectionOf(
  application: ReturnType<ApplicationRepository['reproject']>,
) {
  if (application === null)
    throw new Error('Expected an Application projection');
  return {
    status: application.status,
    appliedAt: application.appliedAt,
    appliedAtPrecision: application.appliedAtPrecision,
    lastEventAt: application.lastEventAt,
    lastRecordedAt: application.lastRecordedAt,
  };
}
