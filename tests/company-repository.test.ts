import { afterEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import {
  CompanyRepository,
  normalizeCompanyExactV1,
} from '../src/repositories/company-repository.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { createJobFixture } from './helpers/job-fixture.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';

const databases: JobDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function setup(): { database: JobDatabase; repository: CompanyRepository } {
  const database = createTestDatabase();
  databases.push(database);
  return { database, repository: new CompanyRepository(database) };
}

function insertJob(
  database: JobDatabase,
  job: ReturnType<typeof createJobFixture>,
): string {
  const sourceId = insertTestSource(database);
  return new JobRepository(database).upsertObservation({
    job,
    sourceId,
    rawData: job,
  }).jobId;
}

describe('company-exact-v1', () => {
  it('normalizes only case and whitespace and excludes frozen generic keys', () => {
    expect(normalizeCompanyExactV1('  ACME   Holdings  ')).toBe(
      'acme holdings',
    );
    expect(normalizeCompanyExactV1('Acme, Inc.')).toBe('acme, inc.');
    expect(normalizeCompanyExactV1('Acme Inc')).toBe('acme inc');
    for (const generic of [
      '',
      'Unknown Company',
      'N/A',
      'Confidential',
      'Company Confidential',
      'Multiple Companies',
    ]) {
      expect(normalizeCompanyExactV1(generic)).toBeNull();
    }
  });

  it('creates stable identity, reuses exact keys, and preserves canonical display', () => {
    const { database, repository } = setup();
    const first = createJobFixture({
      id: '00000000-0000-4000-8000-000000000001',
      company: 'ACME, Inc.',
      normalizedCompany: 'acme, inc.',
      externalId: 'job-1',
      postingUrl: 'https://jobs.example.com/1',
    });
    const second = createJobFixture({
      id: '00000000-0000-4000-8000-000000000002',
      company: ' acme,   inc. ',
      normalizedCompany: 'acme, inc.',
      externalId: 'job-2',
      postingUrl: 'https://jobs.example.com/2',
    });
    insertJob(database, first);
    insertJob(database, second);

    const firstResolution = repository.assignJob(first.id, first.company);
    const secondResolution = repository.assignJob(second.id, second.company);

    expect(secondResolution.companyId).toBe(firstResolution.companyId);
    expect(
      database
        .prepare<
          [string],
          { canonical_name: string }
        >('SELECT canonical_name FROM companies WHERE id = ?')
        .get(firstResolution.companyId!)?.canonical_name,
    ).toBe('ACME, Inc.');
    expect(
      database.prepare('SELECT company FROM jobs WHERE id = ?').get(first.id),
    ).toEqual({ company: 'ACME, Inc.' });
  });

  it('does not fuzzy merge and leaves generic assignments unlinked with provenance', () => {
    const { database, repository } = setup();
    const punctuated = createJobFixture({
      id: '00000000-0000-4000-8000-000000000001',
      company: 'Acme, Inc.',
      externalId: 'job-1',
      postingUrl: 'https://jobs.example.com/1',
    });
    const plain = createJobFixture({
      id: '00000000-0000-4000-8000-000000000002',
      company: 'Acme Inc',
      externalId: 'job-2',
      postingUrl: 'https://jobs.example.com/2',
    });
    const generic = createJobFixture({
      id: '00000000-0000-4000-8000-000000000003',
      company: 'Unknown',
      externalId: 'job-3',
      postingUrl: 'https://jobs.example.com/3',
    });
    for (const job of [punctuated, plain, generic]) insertJob(database, job);

    expect(
      repository.assignJob(punctuated.id, punctuated.company).companyId,
    ).not.toBe(repository.assignJob(plain.id, plain.company).companyId);
    expect(repository.assignJob(generic.id, generic.company)).toMatchObject({
      companyId: null,
      result: 'ineligible',
    });
    expect(
      database
        .prepare<[string], { resolver_version: string; result: string }>(
          `SELECT resolver_version, result FROM job_company_assignments
           WHERE job_id = ? ORDER BY assigned_at DESC LIMIT 1`,
        )
        .get(generic.id),
    ).toEqual({ resolver_version: 'company-exact-v1', result: 'ineligible' });
  });

  it('exposes unlinked Applications in an explicit unknown bucket', () => {
    const { database, repository } = setup();
    const job = createJobFixture({
      id: '00000000-0000-4000-8000-000000000001',
    });
    insertJob(database, job);
    database
      .prepare(
        `INSERT INTO applications (id, job_id, status, company_at_application,
          created_at, updated_at) VALUES ('application-1', ?, 'applied', 'Unknown', ?, ?)`,
      )
      .run(job.id, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    repository.assignApplication('application-1', 'Unknown');

    expect(repository.listApplicationBuckets()).toEqual([
      {
        companyId: null,
        canonicalName: 'Unknown / Unlinked',
        applicationCount: 1,
      },
    ]);
  });
});
