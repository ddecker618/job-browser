import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import type { Application } from '../src/models/application.js';
import { ApplicationRepository } from '../src/repositories/application-repository.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { SmartRecruitersProvider } from '../src/providers/smartRecruiters.provider.js';
import { createJobFixture } from './helpers/job-fixture.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';

describe('JobRepository', () => {
  let database: JobDatabase;
  let repository: JobRepository;
  let sourceId: string;

  beforeEach(() => {
    database = createTestDatabase();
    repository = new JobRepository(database);
    sourceId = insertTestSource(database);
  });

  afterEach(() => {
    vi.useRealTimers();
    database.close();
  });

  it('inserts and retrieves a normalized job using parameterized values', () => {
    const job = createJobFixture({
      title: "Security Analyst's Assistant",
      normalizedTitle: "security analyst's assistant",
    });
    const result = repository.upsertObservation({
      job,
      sourceId,
      rawData: job,
    });

    expect(result).toEqual({
      jobId: job.id,
      inserted: true,
      rediscovered: false,
      crossSourceMerge: false,
      materiallyUpdated: false,
      identityConflict: false,
    });
    expect(repository.findJob(job.id)?.title).toBe(
      "Security Analyst's Assistant",
    );
    expect(repository.countJobs()).toBe(1);
  });

  it('marks a Job applied with one effective event and a folded Application projection', () => {
    const jobId = insertNewJob();
    const changedAt = '2026-02-01T00:00:00.000Z';

    expect(
      repository.changeStatus(jobId, {
        status: 'applied',
        changedBy: 'user',
        changedAt,
      }),
    ).toBe(true);

    expect(repository.getStatus(jobId)).toBe('applied');
    expect(
      database
        .prepare<
          [string],
          { count: number }
        >('SELECT COUNT(*) AS count FROM applications WHERE job_id = ?')
        .get(jobId)?.count,
    ).toBe(1);
    expect(
      database
        .prepare<[string], { count: number }>(
          `SELECT COUNT(*) AS count FROM application_effective_events
           WHERE job_id = ? AND event_type = 'applied'`,
        )
        .get(jobId)?.count,
    ).toBe(1);
    expect(persistedProjection(jobId)).toMatchObject({
      status: 'applied',
      appliedAt: changedAt,
      appliedAtPrecision: 'exact',
      lastEventAt: changedAt,
    });
    expect(
      new ApplicationRepository(database).findByJobId(jobId),
    ).toMatchObject({
      titleAtApplication: 'Security Analyst',
      companyAtApplication: 'Example Employer',
      locationAtApplication: 'Example City, EX',
      applicationUrl: null,
      sourceId: null,
      providerId: null,
      sourceLabel: null,
    });
    expectProjectionEquivalent(jobId);
  });

  it('folds every existing coarse Application transition from its event ledger', () => {
    const jobId = insertNewJob();
    const transitions = [
      ['applied', '2026-02-01T00:00:00.000Z'],
      ['interview', '2026-03-01T00:00:00.000Z'],
      ['offer', '2026-04-01T00:00:00.000Z'],
      ['rejected', '2026-05-01T00:00:00.000Z'],
    ] as const;

    for (const [status, changedAt] of transitions) {
      expect(
        repository.changeStatus(jobId, {
          status,
          changedBy: 'user',
          changedAt,
        }),
      ).toBe(true);
      expectProjectionEquivalent(jobId);
    }

    expect(repository.getStatus(jobId)).toBe('rejected');
    expect(persistedProjection(jobId).status).toBe('rejected');
    expect(
      database
        .prepare<[string], { event_type: string; resulting_status: string }>(
          `SELECT event_type, resulting_status FROM application_history
           WHERE job_id = ? ORDER BY occurred_at_sort, recorded_at_sort, id`,
        )
        .all(jobId),
    ).toEqual([
      { event_type: 'applied', resulting_status: 'applied' },
      { event_type: 'interview', resulting_status: 'interview' },
      { event_type: 'offer', resulting_status: 'offer' },
      { event_type: 'rejected', resulting_status: 'rejected' },
    ]);
  });

  it('does not append or change the Application projection for a Job-status no-op', () => {
    const jobId = insertNewJob();
    repository.changeStatus(jobId, {
      status: 'applied',
      changedBy: 'user',
      changedAt: '2026-02-01T00:00:00.000Z',
    });
    const applicationRepository = new ApplicationRepository(database);
    const before = applicationRepository.findByJobId(jobId);
    const eventCountBefore = applicationEventCount(jobId);

    expect(
      repository.changeStatus(jobId, {
        status: 'applied',
        changedBy: 'user',
        changedAt: '2026-03-01T00:00:00.000Z',
      }),
    ).toBe(false);

    expect(applicationEventCount(jobId)).toBe(eventCountBefore);
    expect(applicationRepository.findByJobId(jobId)).toEqual(before);
    expectProjectionEquivalent(jobId);
  });

  it('keeps repeated backdated Applied writes equivalent to a fresh event fold', () => {
    const jobId = insertNewJob();
    vi.useFakeTimers();

    vi.setSystemTime('2026-06-01T00:00:00.000Z');
    repository.changeStatus(jobId, {
      status: 'applied',
      changedBy: 'user',
      changedAt: '2026-03-10T00:00:00.000Z',
    });
    expectProjectionEquivalent(jobId);

    vi.setSystemTime('2026-06-02T00:00:00.000Z');
    repository.changeStatus(jobId, {
      status: 'interview',
      changedBy: 'user',
      changedAt: '2026-04-10T00:00:00.000Z',
    });
    expectProjectionEquivalent(jobId);

    vi.setSystemTime('2026-06-03T00:00:00.000Z');
    repository.changeStatus(jobId, {
      status: 'applied',
      changedBy: 'user',
      changedAt: '2026-02-10T00:00:00.000Z',
    });

    const beforeReproject = persistedProjection(jobId);
    expect(repository.getStatus(jobId)).toBe('interview');
    expect(beforeReproject).toEqual({
      status: 'interview',
      appliedAt: '2026-02-10T00:00:00.000Z',
      appliedAtPrecision: 'exact',
      lastEventAt: '2026-04-10T00:00:00.000Z',
      lastRecordedAt: '2026-06-03T00:00:00.000Z',
    });
    expect(
      database
        .prepare<
          [string],
          { recorded_at: string | null }
        >('SELECT MAX(recorded_at_sort) AS recorded_at FROM application_history WHERE job_id = ?')
        .get(jobId)?.recorded_at,
    ).toBe(beforeReproject.lastRecordedAt);
    expectProjectionEquivalent(jobId);
  });

  it('derives compatibility from the post-fold status and preserves Application summary notes', () => {
    const jobId = insertNewJob();
    repository.changeStatus(jobId, {
      status: 'applied',
      changedBy: 'user',
      changedAt: '2026-03-01T00:00:00.000Z',
      reason: 'Applied reason',
    });
    repository.changeStatus(jobId, {
      status: 'interview',
      changedBy: 'user',
      changedAt: '2026-04-01T00:00:00.000Z',
      reason: 'Interview reason',
    });
    const application = new ApplicationRepository(database).findByJobId(jobId);
    if (application === null) throw new Error('Expected Application');
    database
      .prepare(
        `UPDATE jobs
            SET title = 'Changed current title', company = 'Changed current company',
                location = 'Changed current location'
          WHERE id = ?`,
      )
      .run(jobId);
    database
      .prepare('UPDATE applications SET notes = ? WHERE id = ?')
      .run('Mutable summary remains', application.id);
    const historyBefore = repository.getStatusHistory(jobId).length;
    const eventsBefore = applicationEventCount(jobId);

    expect(
      repository.changeStatus(jobId, {
        status: 'offer',
        changedBy: 'user',
        changedAt: '2026-02-01T00:00:00.000Z',
        reason: 'Backdated offer reason',
      }),
    ).toBe(true);

    expect(repository.getStatus(jobId)).toBe('interview');
    expect(repository.getStatusHistory(jobId)).toHaveLength(historyBefore);
    expect(applicationEventCount(jobId)).toBe(eventsBefore + 1);
    expect(
      new ApplicationRepository(database).findByJobId(jobId),
    ).toMatchObject({
      status: 'interview',
      notes: 'Mutable summary remains',
      titleAtApplication: 'Security Analyst',
      companyAtApplication: 'Example Employer',
      locationAtApplication: 'Example City, EX',
    });
    expect(
      database
        .prepare<
          [string],
          { notes: string | null }
        >("SELECT notes FROM application_history WHERE job_id = ? AND event_type = 'offer'")
        .get(jobId)?.notes,
    ).toBe('Backdated offer reason');
    expectProjectionEquivalent(jobId);
  });

  it('does not synchronize Job status from a winning Legacy State Imported event', () => {
    const jobId = insertNewJob();
    database
      .prepare(
        `INSERT INTO applications (
          id, job_id, status, title_at_application, company_at_application,
          location_at_application, legacy_provenance, created_at, updated_at
        ) VALUES (
          'compatibility-migrated-application', ?, 'offer', 'Migrated title',
          'Migrated company', 'Migrated location', 'legacy:test',
          '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'
        )`,
      )
      .run(jobId);
    database
      .prepare(
        `INSERT INTO application_history (
          id, application_id, job_id, event_type, resulting_status,
          occurred_at, occurred_at_sort, occurrence_precision, recorded_at_sort,
          notes, source, created_at
        ) VALUES (
          'compatibility-imported-status', 'compatibility-migrated-application', ?,
          'legacy_state_imported', 'offer', NULL, NULL, 'unknown',
          '2025-01-02T00:00:00.000Z', 'Imported status', 'migration',
          '2025-01-02T00:00:00.000Z'
        )`,
      )
      .run(jobId);
    const historyBefore = repository.getStatusHistory(jobId).length;
    const eventsBefore = applicationEventCount(jobId);

    expect(
      repository.changeStatus(jobId, {
        status: 'rejected',
        changedBy: 'user',
        changedAt: '2020-01-01T00:00:00.000Z',
        reason: 'Backdated compatibility fact',
      }),
    ).toBe(true);

    expect(new ApplicationRepository(database).findByJobId(jobId)?.status).toBe(
      'offer',
    );
    expect(repository.getStatus(jobId)).toBe('new');
    expect(repository.getStatusHistory(jobId)).toHaveLength(historyBefore);
    expect(applicationEventCount(jobId)).toBe(eventsBefore + 1);
    expectProjectionEquivalent(jobId);
  });

  it('persists BaseProvider confidence for migration 007 fields', () => {
    const job = createJobFixture();
    new SmartRecruitersProvider().save({ repository, sourceId }, job, job);
    expect(repository.findJob(job.id)?.providerConfidence).toBe(0.95);
  });

  it('detects a canonical URL duplicate and preserves status', () => {
    const original = createJobFixture({ status: 'review' });
    repository.upsertObservation({
      job: original,
      sourceId,
      rawData: original,
    });
    if (original.postingUrl === null)
      throw new Error('Fixture posting URL is required');
    const duplicate = createJobFixture({
      id: '10000000-0000-4000-8000-000000000001',
      status: 'new',
      postingUrl: `${original.postingUrl}?utm_source=test#details`,
    });

    expect(
      repository.upsertObservation({
        job: duplicate,
        sourceId,
        rawData: duplicate,
      }),
    ).toEqual({
      jobId: original.id,
      inserted: false,
      rediscovered: true,
      crossSourceMerge: false,
      materiallyUpdated: false,
      identityConflict: false,
    });
    expect(repository.countJobs()).toBe(1);
    expect(repository.getStatus(original.id)).toBe('review');
  });

  it('detects source/external-ID duplicates', () => {
    const original = createJobFixture();
    repository.upsertObservation({
      job: original,
      sourceId,
      rawData: original,
    });
    const duplicate = createJobFixture({
      id: '10000000-0000-4000-8000-000000000002',
      postingUrl: 'https://jobs.example.com/changed-url',
      location: 'St. Louis, Missouri',
    });

    expect(
      repository.upsertObservation({
        job: duplicate,
        sourceId,
        rawData: duplicate,
      }).jobId,
    ).toBe(original.id);
    expect(repository.countJobs()).toBe(1);
  });

  it('attaches a shared canonical URL across sources', () => {
    const original = createJobFixture();
    repository.upsertObservation({
      job: original,
      sourceId,
      rawData: { board: 'one' },
    });
    const secondSourceId = insertTestSource(database, {
      employer: 'Second Board',
    });
    if (original.postingUrl === null)
      throw new Error('Fixture posting URL is required');
    const duplicate = createJobFixture({
      id: '10000000-0000-4000-8000-000000000003',
      externalId: 'other-board-456',
      postingUrl: `${original.postingUrl}?utm_source=second`,
      sourceName: 'Second Board',
    });

    const result = repository.upsertObservation({
      job: duplicate,
      sourceId: secondSourceId,
      rawData: { board: 'two' },
    });
    expect(result.jobId).toBe(original.id);
    expect(result.crossSourceMerge).toBe(true);
    expect(repository.countJobs()).toBe(1);
    expect(repository.countJobSources(original.id)).toBe(2);
  });

  it('does not merge a fingerprint with conflicting strong identities', () => {
    const original = createJobFixture();
    repository.upsertObservation({
      job: original,
      sourceId,
      rawData: original,
    });
    const secondSourceId = insertTestSource(database, {
      employer: 'Another Provider',
    });
    const duplicate = createJobFixture({
      id: '10000000-0000-4000-8000-000000000004',
      fingerprint: original.fingerprint,
      externalId: 'another-provider-id',
      normalizedTitle: 'provider-specific title normalization',
      postingUrl: 'https://another.example/jobs/different-url',
    });

    const result = repository.upsertObservation({
      job: duplicate,
      sourceId: secondSourceId,
      providerId: 'another-provider',
      rawData: duplicate,
    });
    expect(result).toMatchObject({
      jobId: duplicate.id,
      inserted: true,
      identityConflict: true,
    });
    expect(repository.countJobs()).toBe(2);
    expect(
      database
        .prepare<
          [],
          { count: number }
        >('SELECT COUNT(*) AS count FROM identity_conflict_diagnostics')
        .get()?.count,
    ).toBe(1);
    const fingerprints = database
      .prepare<[], { fingerprint: string }>('SELECT fingerprint FROM jobs')
      .all()
      .map((row) => row.fingerprint);
    expect(new Set(fingerprints).size).toBe(2);
  });

  it('does not merge solely on title similarity', () => {
    const original = createJobFixture({
      title: 'Senior Cyber Security Analyst',
      normalizedTitle: 'senior cyber security analyst',
    });
    repository.upsertObservation({
      job: original,
      sourceId,
      rawData: original,
    });
    const secondSourceId = insertTestSource(database, {
      employer: 'Employer ATS',
    });
    const duplicate = createJobFixture({
      id: '10000000-0000-4000-8000-000000000005',
      title: 'Cyber Security Analyst Senior',
      normalizedTitle: 'cyber security analyst senior',
      fingerprint: 'a'.repeat(64),
      externalId: 'ats-789',
      postingUrl: 'https://ats.example/jobs/789',
    });
    const result = repository.upsertObservation({
      job: duplicate,
      sourceId: secondSourceId,
      rawData: duplicate,
    });
    expect(result).toMatchObject({ jobId: duplicate.id, inserted: true });
    expect(repository.countJobs()).toBe(2);
  });

  it('separates unchanged rediscovery from a material update', () => {
    const original = createJobFixture();
    repository.upsertObservation({
      job: original,
      sourceId,
      rawData: original,
    });

    const unchanged = repository.upsertObservation({
      job: original,
      sourceId,
      rawData: original,
    });
    const changed = repository.upsertObservation({
      job: createJobFixture({
        ...original,
        description: 'Materially revised responsibilities.',
      }),
      sourceId,
      rawData: { version: 2 },
    });

    expect(unchanged).toMatchObject({
      rediscovered: true,
      materiallyUpdated: false,
    });
    expect(changed).toMatchObject({
      rediscovered: true,
      materiallyUpdated: true,
    });
    expect(
      database
        .prepare<
          [],
          { discovery_count: number; materially_updated_at: string }
        >('SELECT discovery_count, materially_updated_at FROM jobs')
        .get(),
    ).toMatchObject({ discovery_count: 3 });
  });

  it('records conflicting strong signals without moving source identities', () => {
    const first = createJobFixture();
    repository.upsertObservation({ job: first, sourceId, rawData: first });
    const secondSourceId = insertTestSource(database);
    const second = createJobFixture({
      id: '10000000-0000-4000-8000-000000000006',
      fingerprint: 'b'.repeat(64),
      externalId: 'second-id',
      postingUrl: 'https://jobs.example.com/second/456',
    });
    repository.upsertObservation({
      job: second,
      sourceId: secondSourceId,
      rawData: second,
    });

    const conflict = repository.upsertObservation({
      job: createJobFixture({
        id: '10000000-0000-4000-8000-000000000007',
        externalId: first.externalId,
        postingUrl: second.postingUrl,
      }),
      sourceId,
      rawData: { conflict: true },
    });

    expect(conflict).toMatchObject({
      jobId: first.id,
      identityConflict: true,
      rediscovered: true,
    });
    expect(repository.countJobs()).toBe(2);
    expect(
      database
        .prepare<
          [string],
          { external_id: string; canonical_posting_url: string }
        >('SELECT external_id, canonical_posting_url FROM job_sources WHERE job_id = ?')
        .get(first.id),
    ).toMatchObject({ external_id: first.externalId });
  });

  function insertNewJob(): string {
    const job = createJobFixture({ status: 'new' });
    repository.upsertObservation({ job, sourceId, rawData: job });
    return job.id;
  }

  function applicationEventCount(jobId: string): number {
    return (
      database
        .prepare<
          [string],
          { count: number }
        >('SELECT COUNT(*) AS count FROM application_history WHERE job_id = ?')
        .get(jobId)?.count ?? 0
    );
  }

  function persistedProjection(jobId: string): ReturnType<typeof projectionOf> {
    return projectionOf(new ApplicationRepository(database).findByJobId(jobId));
  }

  function expectProjectionEquivalent(jobId: string): void {
    const applicationRepository = new ApplicationRepository(database);
    const before = projectionOf(applicationRepository.findByJobId(jobId));
    const rebuilt = projectionOf(applicationRepository.reproject(jobId));
    expect(rebuilt).toEqual(before);
  }
});

function projectionOf(application: Application | null) {
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
