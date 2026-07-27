import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import { JobSearchRepository } from '../src/repositories/job-search-repository.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { jobSearchQuerySchema } from '../src/schemas/job-search.js';
import { createJobFixture } from './helpers/job-fixture.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';

describe('JobSearchRepository', () => {
  let database: JobDatabase;
  let firstSource: string;
  let secondSource: string;
  let sequence: number;

  beforeEach(() => {
    database = createTestDatabase();
    firstSource = insertTestSource(database, {
      id: 'source-greenhouse',
      employer: 'Greenhouse Feed',
    });
    secondSource = insertTestSource(database, {
      id: 'source-usajobs',
      employer: 'USAJobs Feed',
    });
    database
      .prepare(
        'UPDATE sources SET display_name = ?, provider_id = ? WHERE id = ?',
      )
      .run('Greenhouse Feed', 'greenhouse', firstSource);
    database
      .prepare(
        'UPDATE sources SET display_name = ?, provider_id = ? WHERE id = ?',
      )
      .run('USAJobs Feed', 'usajobs', secondSource);
    sequence = 0;
  });

  afterEach(() => database.close());

  it('combines every filter and preserves every source membership', () => {
    const now = new Date();
    const firstSeen = new Date(
      now.getTime() - 24 * 60 * 60 * 1000,
    ).toISOString();
    const closingDate = new Date(
      now.getTime() + 5 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const jobId = insertJob({
      title: 'Senior Cloud Security Engineer',
      normalizedTitle: 'senior cloud security engineer',
      company: 'Acme Defense',
      normalizedCompany: 'acme defense',
      location: 'Denver, Colorado',
      remoteType: 'remote',
      description: 'Build zero trust controls with Kubernetes.',
      score: 91,
      salaryMinimum: 110_000,
      salaryMaximum: 140_000,
      recommendation: 'Strong Match',
      status: 'recommended',
      firstSeenAt: firstSeen,
      lastSeenAt: now.toISOString(),
      closingDate,
    });
    database
      .prepare(
        `UPDATE jobs SET materially_updated_at = ?, last_verified_at = ? WHERE id = ?`,
      )
      .run(now.toISOString(), now.toISOString(), jobId);
    addMembership(jobId, secondSource, 'usajobs');
    insertJob({ title: 'Unrelated Analyst', score: 30 });

    const repository = new JobSearchRepository(database);
    const response = repository.search(
      parse({
        q: 'zero trust Kubernetes',
        title: 'cloud security',
        company: 'Acme Defense',
        location: 'Denver, Colorado',
        remoteType: 'remote',
        provider: 'greenhouse',
        sourceId: firstSource,
        minScore: '90',
        maxScore: '95',
        minSalary: '120000',
        recommendation: 'Strong Match',
        status: 'recommended',
        firstDiscoveredFrom: new Date(
          now.getTime() - 2 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        firstDiscoveredTo: now.toISOString(),
        lastVerifiedFrom: new Date(
          now.getTime() - 2 * 60 * 60 * 1000,
        ).toISOString(),
        lastVerifiedTo: new Date(now.getTime() + 60 * 1000).toISOString(),
        newlyDiscovered: 'true',
        materiallyUpdated: 'true',
        closingSoon: 'true',
        active: 'active',
        multipleSource: 'true',
      }),
    );

    expect(response.total).toBe(1);
    expect(response.items[0]?.id).toBe(jobId);
    expect(response.items[0]?.sources).toEqual([
      {
        sourceId: firstSource,
        sourceName: 'Greenhouse Feed',
        providerId: 'greenhouse',
      },
      {
        sourceId: secondSource,
        sourceName: 'USAJobs Feed',
        providerId: 'usajobs',
      },
    ]);
    expect(response.items[0]).not.toHaveProperty('rawData');
    expect(response.items[0]).not.toHaveProperty('observations');
    expect(response.facets.companies).toContainEqual({
      value: 'Acme Defense',
      label: 'Acme Defense',
      count: 1,
    });
    expect(response.facets.providers.map((facet) => facet.value)).toEqual([
      'greenhouse',
      'usajobs',
    ]);
    expect(response.facets.sources).toHaveLength(2);
    expect(response.facets.recommendations[0]?.value).toBe('Strong Match');
    expect(response.facets.statuses[0]?.value).toBe('recommended');
    expect(response.facets.activeStates[0]?.value).toBe('active');
  });

  it('supports negative lifecycle flags and removed jobs', () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const jobId = insertJob({
      firstSeenAt: old,
      lastSeenAt: old,
      active: false,
    });
    database
      .prepare(
        'UPDATE jobs SET active = 0, last_verified_at = ?, removed_at = ? WHERE id = ?',
      )
      .run(old, old, jobId);
    const result = new JobSearchRepository(database, {
      forceFallback: true,
    }).search(
      parse({
        newlyDiscovered: 'false',
        materiallyUpdated: 'false',
        closingSoon: 'false',
        active: 'removed',
        multipleSource: 'false',
      }),
    );
    expect(result.items.map((item) => item.id)).toEqual([jobId]);
    expect(result.searchMode).toBe('indexed');
  });

  it('uses stable tie ordering across pages with no duplicate or omission', () => {
    const ids = [
      '00000000-0000-4000-8000-000000000005',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ];
    for (const id of ids) insertJob({ id, score: 75 });
    const repository = new JobSearchRepository(database, {
      forceFallback: true,
    });
    const first = repository.search(parse({ page: '1', pageSize: '2' }));
    const second = repository.search(parse({ page: '2', pageSize: '2' }));
    const third = repository.search(parse({ page: '3', pageSize: '2' }));
    expect(first.total).toBe(5);
    expect(first.pages).toBe(3);
    expect(
      [...first.items, ...second.items, ...third.items].map((job) => job.id),
    ).toEqual([...ids].sort());
  });

  it('keeps FTS synchronized for inserts, updates, and deletes', () => {
    const repository = new JobSearchRepository(database);
    if (repository.searchMode !== 'fts5') return;
    const jobId = insertJob({ description: 'A unique falcon term.' });
    expect(repository.search(parse({ q: 'falcon' })).total).toBe(1);
    database
      .prepare('UPDATE jobs SET description = ? WHERE id = ?')
      .run('A unique osprey term.', jobId);
    expect(repository.search(parse({ q: 'falcon' })).total).toBe(0);
    expect(repository.search(parse({ q: 'osprey' })).total).toBe(1);
    database.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    expect(repository.search(parse({ q: 'osprey' })).total).toBe(0);
  });

  it('does not rebuild an existing synchronized FTS table', () => {
    insertJob({ title: 'Persistent row identity' });
    const first = new JobSearchRepository(database);
    if (first.searchMode !== 'fts5') return;
    database
      .prepare('UPDATE job_search_fts SET rowid = 500 WHERE job_id = ?')
      .run('10000000-0000-4000-8000-000000000001');

    const second = new JobSearchRepository(database);

    expect(second.searchMode).toBe('fts5');
    expect(
      database
        .prepare<
          [string],
          { rowid: number }
        >('SELECT rowid FROM job_search_fts WHERE job_id = ?')
        .get('10000000-0000-4000-8000-000000000001')?.rowid,
    ).toBe(500);
    expect(second.search(parse({ q: 'persistent' })).total).toBe(1);
  });

  it('treats FTS-like input as text and never exposes parser errors', () => {
    insertJob({ title: 'OR Operator Security', description: 'literal syntax' });
    const repository = new JobSearchRepository(database);
    expect(() => repository.search(parse({ q: 'OR "* -( )' }))).not.toThrow();
    expect(() => repository.search(parse({ q: '***' }))).not.toThrow();
  });

  function insertJob(
    overrides: Parameters<typeof createJobFixture>[0] = {},
  ): string {
    sequence += 1;
    const job = createJobFixture({
      id: `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
      externalId: `external-${String(sequence)}`,
      postingUrl: `https://jobs.example.com/${String(sequence)}`,
      ...overrides,
    });
    new JobRepository(database).upsertObservation({
      job,
      sourceId: firstSource,
      providerId: 'greenhouse',
      rawData: job,
    });
    return job.id;
  }

  function addMembership(
    jobId: string,
    sourceId: string,
    providerId: string,
  ): void {
    const timestamp = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO job_sources (
          id, job_id, source_id, external_id, posting_url, canonical_posting_url,
          raw_data_json, first_seen_at, last_seen_at, provider_id, last_verified_at
        ) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        jobId,
        sourceId,
        timestamp,
        timestamp,
        providerId,
        timestamp,
      );
  }
});

function parse(query: Record<string, string> = {}) {
  return jobSearchQuerySchema.parse(query);
}
