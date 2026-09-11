import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type JobDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { JobNlpEnrichmentRepository } from '../src/database/jobNlpEnrichmentRepository.js';
import { NlpBackgroundWorker } from '../src/intelligence/nlp/backgroundWorker.js';
import { extractNlpDocument } from '../src/intelligence/nlp/document.js';
import { DatabaseJobNlpCandidateSource } from '../src/intelligence/nlp/jobCandidateProvider.js';
import type { AsyncWorkerContext } from '../src/intelligence/nlp/async.js';
import { NLP_EXTRACTION_VERSION } from '../src/schemas/job-nlp.js';

const databases: JobDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function insertJob(db: JobDatabase, id: string, description: string): void {
  db.prepare(
    `INSERT INTO jobs (
       id, title, normalized_title, company, normalized_company, description,
       remote_type, employment_type, source_name, source_type, first_seen_at,
       last_seen_at, active, seniority_level, status, created_at, updated_at,
       score, score_explanation
     ) VALUES (?, 'Analyst', 'analyst', 'Fixture', 'fixture', ?, 'unknown',
       'unknown', 'Fixture', 'fixture', '2026-01-01', '2026-01-01', 1,
       'unknown', 'new', '2026-01-01', '2026-01-01', 42, 'fixture score')`,
  ).run(id, description);
}

function setup(): { db: JobDatabase } {
  const db = openDatabase(':memory:');
  databases.push(db);
  runMigrations(db);
  insertJob(db, 'a-job', 'Linux required.');
  insertJob(db, 'b-job', 'Cisco networking preferred.');
  insertJob(db, 'c-job', 'Six years of IT support experience.');
  return { db };
}

function countEnrichments(db: JobDatabase): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM job_nlp_enrichments')
    .get() as { count: number };
  return row.count;
}

function workerContext(
  db: JobDatabase,
  source: DatabaseJobNlpCandidateSource,
): AsyncWorkerContext {
  return {
    target: new JobNlpEnrichmentRepository(db),
    extractionVersion: NLP_EXTRACTION_VERSION,
    builder: async (candidate, signal) => {
      const parts = source.load(candidate.jobId);
      if (parts === null) throw new Error('Job disappeared');
      return extractNlpDocument(parts, signal);
    },
    candidateProvider: (afterJobId, limit) =>
      Promise.resolve(source.page(afterJobId, limit)),
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timed out');
}

describe('DatabaseJobNlpCandidateSource (P4)', () => {
  it('pages jobs in id order with document hashes and counts staleness', () => {
    const { db } = setup();
    const source = new DatabaseJobNlpCandidateSource(db);
    expect(source.countJobs()).toBe(3);
    expect(source.countMissingOrVersionMismatch(NLP_EXTRACTION_VERSION)).toBe(
      3,
    );

    const firstPage = source.page(null, 2);
    expect(firstPage.map((candidate) => candidate.jobId)).toEqual([
      'a-job',
      'b-job',
    ]);
    expect(firstPage[0]).toBeDefined();
    expect(firstPage[0]?.sourceTextHash.length).toBe(64);

    const secondPage = source.page(firstPage.at(-1)?.jobId ?? null, 2);
    expect(secondPage.map((candidate) => candidate.jobId)).toEqual(['c-job']);

    expect(source.load('b-job')?.description).toBe(
      'Cisco networking preferred.',
    );
    expect(source.load('missing')).toBeNull();
  });

  it('returns an empty page past the end and errors on bad limits', () => {
    const { db } = setup();
    const source = new DatabaseJobNlpCandidateSource(db);
    expect(source.page('zzzz', 25)).toEqual([]);
    expect(() => source.page(null, 0)).toThrow(/positive integer/);
  });
});

describe('NlpBackgroundWorker (P4)', () => {
  it('extracts and persists a full sweep, then skips fresh rows', async () => {
    const { db } = setup();
    const source = new DatabaseJobNlpCandidateSource(db);
    const worker = new NlpBackgroundWorker(workerContext(db, source), {
      batchSize: 2,
    });

    const first = await worker.runSweepOnce();
    expect(first.processed).toBe(3);
    expect(first.extracted).toBe(3);
    expect(first.failed).toBe(0);
    expect(first.capped).toBe(false);
    expect(countEnrichments(db)).toBe(3);
    expect(source.countMissingOrVersionMismatch(NLP_EXTRACTION_VERSION)).toBe(
      0,
    );

    const second = await worker.runSweepOnce();
    expect(second.processed).toBe(3);
    expect(second.skipped).toBe(3);
    expect(second.extracted).toBe(0);
    expect(countEnrichments(db)).toBe(3);
  });

  it('caps a sweep by maxJobsPerSweep and resumes on the next sweep', async () => {
    const { db } = setup();
    const source = new DatabaseJobNlpCandidateSource(db);
    const worker = new NlpBackgroundWorker(workerContext(db, source), {
      batchSize: 2,
      maxJobsPerSweep: 2,
    });

    const first = await worker.runSweepOnce();
    expect(first.processed).toBe(2);
    expect(first.extracted).toBe(2);
    expect(first.capped).toBe(true);

    const second = await worker.runSweepOnce();
    expect(second.processed).toBe(1);
    expect(second.extracted).toBe(1);
    expect(second.capped).toBe(false);
    expect(countEnrichments(db)).toBe(3);
    expect(worker.status().totals.extracted).toBe(3);
  });

  it('keeps sweeps single-flight', async () => {
    const { db } = setup();
    const source = new DatabaseJobNlpCandidateSource(db);
    const worker = new NlpBackgroundWorker(workerContext(db, source), {
      batchSize: 2,
    });

    const first = worker.runSweepOnce();
    const second = worker.runSweepOnce();
    expect(await first).toBe(await second);
    expect(worker.status().totals.extracted).toBe(3);
  });

  it('aborts an in-flight sweep cleanly on stop', async () => {
    const { db } = setup();
    const source = new DatabaseJobNlpCandidateSource(db);
    const slowProvider = async (afterJobId: string | null, limit: number) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return source.page(afterJobId, limit);
    };
    const worker = new NlpBackgroundWorker(
      { ...workerContext(db, source), candidateProvider: slowProvider },
      { batchSize: 1 },
    );

    const running = worker.runSweepOnce();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await worker.stop();
    const summary = await running;

    expect(summary.aborted).toBe(true);
    expect(worker.status().state).toBe('stopped');
    await expect(worker.runSweepOnce()).rejects.toThrow(/stopped/);
  });

  it('starts the scheduled loop and stops it', async () => {
    const { db } = setup();
    const source = new DatabaseJobNlpCandidateSource(db);
    const worker = new NlpBackgroundWorker(workerContext(db, source), {
      batchSize: 2,
      startDelayMs: 10,
      sweepDelayMs: 60_000,
    });

    worker.start();
    await waitFor(() => worker.status().lastSweep !== null, 2000);
    expect(worker.status().totals.extracted).toBe(3);
    expect(worker.status().startedAt).not.toBeNull();

    worker.start();
    await worker.stop();
    expect(worker.status().state).toBe('stopped');
  });

  it('exposes a machine-readable status projection', async () => {
    const { db } = setup();
    const source = new DatabaseJobNlpCandidateSource(db);
    const worker = new NlpBackgroundWorker(workerContext(db, source), {
      staleHint: () =>
        source.countMissingOrVersionMismatch(NLP_EXTRACTION_VERSION),
    });

    const idle = worker.status();
    expect(idle.state).toBe('idle');
    expect(idle.staleRemainingHint).toBe(3);
    expect(idle.workerVersion).toMatch(/^async-worker/);

    await worker.runSweepOnce();
    const done = worker.status();
    expect(done.lastSweep?.extracted).toBe(3);
    expect(done.totals.processed).toBe(3);
    expect(done.staleRemainingHint).toBe(0);
    expect(done.lastFailure).toBeNull();
  });
});
