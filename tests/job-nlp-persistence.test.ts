import { afterEach, describe, expect, it } from 'vitest';

import { JobNlpEnrichmentRepository } from '../src/database/jobNlpEnrichmentRepository.js';
import { openDatabase, type JobDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import type { JobNlpEnrichment } from '../src/schemas/job-nlp.js';

const databases: JobDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function database(): JobDatabase {
  const value = openDatabase(':memory:');
  runMigrations(value);
  databases.push(value);
  return value;
}

function insertJob(value: JobDatabase, id = 'job-nlp-1'): void {
  value
    .prepare(
      `INSERT INTO jobs (
         id, title, normalized_title, company, normalized_company,
         description, remote_type, employment_type, source_name, source_type,
         first_seen_at, last_seen_at, active, seniority_level, status,
         created_at, updated_at, score, recommendation, score_explanation
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      'Original title',
      'original title',
      'Original company',
      'original company',
      'Original retained description',
      'remote',
      'full-time',
      'Fixture',
      'fixture',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      1,
      'mid',
      'new',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      42,
      'Possible Match',
      'deterministic score',
    );
}

function enrichment(
  sourceTextHash = 'hash-v1',
  version: 'job-nlp-v1' = 'job-nlp-v1',
): JobNlpEnrichment {
  return {
    version,
    generatedAt: '2026-01-02T00:00:00.000Z',
    sourceTextHash,
    segmentation: {
      segments: [
        {
          index: 0,
          text: 'Python required.',
          normalized: 'python required.',
          kind: 'sentence',
          sourceField: 'description',
          charStart: 0,
          charEnd: 16,
        },
      ],
      method: 'segmentation-v1',
    },
    facts: [],
  };
}

describe('NLP shadow-mode persistence', () => {
  it('stores and reads a versioned enrichment without changing jobs', () => {
    const value = database();
    insertJob(value);
    const before = value
      .prepare<[], Record<string, unknown>>(
        `SELECT title, description, score, recommendation, score_explanation,
                status, role_details_json
           FROM jobs WHERE id = 'job-nlp-1'`,
      )
      .get();
    const repository = new JobNlpEnrichmentRepository(value);
    const document = enrichment();

    repository.save('job-nlp-1', document);

    expect(repository.get('job-nlp-1')).toEqual(document);
    const after = value
      .prepare<[], Record<string, unknown>>(
        `SELECT title, description, score, recommendation, score_explanation,
                status, role_details_json
           FROM jobs WHERE id = 'job-nlp-1'`,
      )
      .get();
    expect(after).toEqual(before);
    expect(
      value
        .prepare<
          [],
          { count: number }
        >('SELECT COUNT(*) AS count FROM job_nlp_enrichments')
        .get()?.count,
    ).toBe(1);
  });

  it('upserts the current document while preserving created_at', () => {
    const value = database();
    insertJob(value);
    const repository = new JobNlpEnrichmentRepository(value);
    repository.save('job-nlp-1', enrichment('hash-v1'));
    const createdAt = value
      .prepare<
        [string],
        { created_at: string }
      >('SELECT created_at FROM job_nlp_enrichments WHERE job_id = ?')
      .get('job-nlp-1')?.created_at;

    const updated = enrichment('hash-v2');
    updated.generatedAt = '2026-01-03T00:00:00.000Z';
    repository.save('job-nlp-1', updated);

    expect(repository.get('job-nlp-1')).toEqual(updated);
    expect(
      value
        .prepare<
          [],
          { count: number }
        >('SELECT COUNT(*) AS count FROM job_nlp_enrichments')
        .get()?.count,
    ).toBe(1);
    expect(
      value
        .prepare<
          [string],
          { created_at: string }
        >('SELECT created_at FROM job_nlp_enrichments WHERE job_id = ?')
        .get('job-nlp-1')?.created_at,
    ).toBe(createdAt);
  });

  it('rejects invalid envelopes before persistence', () => {
    const value = database();
    insertJob(value);
    const repository = new JobNlpEnrichmentRepository(value);

    expect(() =>
      repository.save('job-nlp-1', { version: 'wrong-version' } as never),
    ).toThrow();
    expect(repository.get('job-nlp-1')).toBeNull();
  });

  it('reports missing, hash-stale, and version-stale documents', () => {
    const value = database();
    insertJob(value, 'job-nlp-1');
    insertJob(value, 'job-nlp-2');
    const repository = new JobNlpEnrichmentRepository(value);
    repository.save('job-nlp-1', enrichment('hash-v1', 'job-nlp-v1'));
    repository.save('job-nlp-2', enrichment('hash-v2', 'job-nlp-v1'));

    expect(repository.isStale('missing', 'job-nlp-v1', 'hash-v1')).toBe(true);
    expect(repository.isStale('job-nlp-1', 'job-nlp-v1', 'hash-v1')).toBe(
      false,
    );
    expect(repository.isStale('job-nlp-1', 'job-nlp-v1', 'hash-v2')).toBe(true);
    expect(repository.isStale('job-nlp-1', 'job-nlp-v2', 'hash-v1')).toBe(true);
    expect(repository.listStaleByVersion('job-nlp-v2')).toEqual([
      'job-nlp-1',
      'job-nlp-2',
    ]);
  });

  it('cascades the shadow document when its job is deleted', () => {
    const value = database();
    insertJob(value);
    const repository = new JobNlpEnrichmentRepository(value);
    repository.save('job-nlp-1', enrichment());
    value.prepare('DELETE FROM jobs WHERE id = ?').run('job-nlp-1');
    expect(repository.get('job-nlp-1')).toBeNull();
  });
});
