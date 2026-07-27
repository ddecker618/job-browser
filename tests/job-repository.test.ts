import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { RemoteOkProvider } from '../src/providers/remoteOk.provider.js';
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

  afterEach(() => database.close());

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

  it('persists BaseProvider confidence for migration 007 fields', () => {
    const job = createJobFixture();
    new RemoteOkProvider().save({ repository, sourceId }, job, job);
    expect(repository.findJob(job.id)?.providerConfidence).toBe(0.85);
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
});
