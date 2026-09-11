import { describe, expect, it } from 'vitest';
import type {
  JobNlpEnrichment,
  NLP_EXTRACTION_VERSION,
} from '../src/schemas/job-nlp.js';
import type {
  NlpPersistenceTarget,
  ReprocessingCandidate,
} from '../src/intelligence/nlp/reprocessing.js';
import {
  runNlpWorkerBatch,
  runNlpBackgroundWorker,
} from '../src/intelligence/nlp/async.js';

function fakeEnrichment(
  hash: string,
  version: typeof NLP_EXTRACTION_VERSION = 'job-nlp-v1',
): JobNlpEnrichment {
  return {
    version,
    generatedAt: '2026-09-10T00:00:00.000Z',
    sourceTextHash: hash,
    segmentation: { segments: [], method: 'segmentation-v1' },
    facts: [],
  };
}

function memoryTarget(): NlpPersistenceTarget & {
  saved: Map<string, JobNlpEnrichment>;
  stale: Set<string>;
} {
  const saved = new Map<string, JobNlpEnrichment>();
  const stale = new Set<string>();
  return {
    saved,
    stale,
    isStale(jobId, extractionVersion, sourceTextHash) {
      if (!stale.has(jobId)) return false;
      const existing = saved.get(jobId);
      if (!existing) return true;
      return (
        existing.version !== extractionVersion ||
        existing.sourceTextHash !== sourceTextHash
      );
    },
    save(jobId, enrichment) {
      saved.set(jobId, enrichment);
    },
  };
}

const V1 = 'job-nlp-v1';
const JOB_A = 'job-a';
const JOB_B = 'job-b';
const JOB_C = 'job-c';

describe('NLP async worker (P3b)', () => {
  it('processes a bounded batch, saves non-stale results, and reports counts', async () => {
    const target = memoryTarget();
    target.stale.add(JOB_A);
    target.stale.add(JOB_B);
    target.stale.add(JOB_C);

    const candidates: ReprocessingCandidate[] = [
      { jobId: JOB_A, sourceTextHash: 'hash-a' },
      { jobId: JOB_B, sourceTextHash: 'hash-b' },
      { jobId: JOB_C, sourceTextHash: 'hash-c' },
    ];

    const result = await runNlpWorkerBatch(
      target,
      candidates,
      V1,
      (candidate) => Promise.resolve(fakeEnrichment(candidate.sourceTextHash)),
      { batchSize: 50 },
    );

    expect(result.extracted).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.processed).toBe(3);
    expect(target.saved.size).toBe(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('skips fresh candidates and reports all-skipped on a retry', async () => {
    const target = memoryTarget();
    target.stale.add(JOB_A);
    target.stale.add(JOB_B);

    const candidates: ReprocessingCandidate[] = [
      { jobId: JOB_A, sourceTextHash: 'hash-a' },
      { jobId: JOB_B, sourceTextHash: 'hash-b' },
    ];

    const first = await runNlpWorkerBatch(
      target,
      candidates,
      V1,
      (candidate) => Promise.resolve(fakeEnrichment(candidate.sourceTextHash)),
      { batchSize: 50 },
    );
    expect(first.extracted).toBe(2);
    expect(first.skipped).toBe(0);

    const second = await runNlpWorkerBatch(
      target,
      candidates,
      V1,
      (candidate) => Promise.resolve(fakeEnrichment(candidate.sourceTextHash)),
      { batchSize: 50 },
    );
    expect(second.extracted).toBe(0);
    expect(second.skipped).toBe(2);
  });

  it('counts a failed builder without halting the batch', async () => {
    const target = memoryTarget();
    target.stale.add(JOB_A);
    target.stale.add(JOB_B);
    target.stale.add(JOB_C);

    const candidates: ReprocessingCandidate[] = [
      { jobId: JOB_A, sourceTextHash: 'hash-a' },
      { jobId: JOB_B, sourceTextHash: 'hash-b' },
      { jobId: JOB_C, sourceTextHash: 'hash-c' },
    ];

    let callCount = 0;
    const result = await runNlpWorkerBatch(
      target,
      candidates,
      V1,
      (candidate) => {
        callCount++;
        if (candidate.jobId === JOB_B) {
          return Promise.reject(new Error('extraction failed'));
        }
        return Promise.resolve(fakeEnrichment(candidate.sourceTextHash));
      },
      { batchSize: 50 },
    );

    expect(callCount).toBe(3);
    expect(result.extracted).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failedJobIds).toEqual([JOB_B]);
    expect(target.saved.has(JOB_B)).toBe(false);
  });

  it('aborts cleanly when the abort signal is already set', async () => {
    const target = memoryTarget();
    target.stale.add(JOB_A);
    target.stale.add(JOB_B);

    const candidates: ReprocessingCandidate[] = [
      { jobId: JOB_A, sourceTextHash: 'hash-a' },
      { jobId: JOB_B, sourceTextHash: 'hash-b' },
    ];

    const controller = new AbortController();
    controller.abort();

    await expect(
      runNlpWorkerBatch(
        target,
        candidates,
        V1,
        (candidate) =>
          Promise.resolve(fakeEnrichment(candidate.sourceTextHash)),
        { abortSignal: controller.signal },
      ),
    ).rejects.toThrow();
  });

  it('fires onBatchComplete with cumulative counts', async () => {
    const target = memoryTarget();
    target.stale.add(JOB_A);
    target.stale.add(JOB_B);

    const candidates: ReprocessingCandidate[] = [
      { jobId: JOB_A, sourceTextHash: 'hash-a' },
      { jobId: JOB_B, sourceTextHash: 'hash-b' },
    ];

    const batches: { extracted: number; processed: number }[] = [];
    await runNlpWorkerBatch(
      target,
      candidates,
      V1,
      (candidate) => Promise.resolve(fakeEnrichment(candidate.sourceTextHash)),
      {
        onBatchComplete: (progress) =>
          batches.push({
            extracted: progress.batchExtracted,
            processed: progress.processed,
          }),
      },
    );

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual({ extracted: 2, processed: 2 });
  });

  it('pages through candidates via the provider in the full worker', async () => {
    const target = memoryTarget();
    target.stale.add('p1');
    target.stale.add('p2');
    target.stale.add('p3');

    const allCandidates: ReprocessingCandidate[] = [
      { jobId: 'p1', sourceTextHash: 'h1' },
      { jobId: 'p2', sourceTextHash: 'h2' },
      { jobId: 'p3', sourceTextHash: 'h3' },
    ];

    let pageCall = 0;
    const provider = (afterJobId: string | null, limit: number) => {
      pageCall++;
      const after = afterJobId ?? '';
      return Promise.resolve(
        allCandidates
          .filter((c) => c.jobId > after)
          .slice(0, Math.min(limit, 2)),
      );
    };

    const result = await runNlpBackgroundWorker(
      {
        target,
        extractionVersion: V1,
        builder: (candidate) =>
          Promise.resolve(fakeEnrichment(candidate.sourceTextHash)),
        candidateProvider: provider,
      },
      { batchSize: 2 },
    );

    expect(pageCall).toBeGreaterThanOrEqual(2);
    expect(result.extracted).toBe(3);
    expect(result.processed).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  it('enforces maxTotal across pages', async () => {
    const target = memoryTarget();
    for (const id of ['p1', 'p2', 'p3']) target.stale.add(id);

    const allCandidates: ReprocessingCandidate[] = ['p1', 'p2', 'p3'].map(
      (jobId, index) => ({ jobId, sourceTextHash: 'h' + String(index) }),
    );
    const provider = (afterJobId: string | null, limit: number) => {
      const after = afterJobId ?? '';
      return Promise.resolve(
        allCandidates.filter((c) => c.jobId > after).slice(0, limit),
      );
    };

    const result = await runNlpBackgroundWorker(
      {
        target,
        extractionVersion: V1,
        builder: (candidate) =>
          Promise.resolve(fakeEnrichment(candidate.sourceTextHash)),
        candidateProvider: provider,
      },
      { batchSize: 2, maxTotal: 2 },
    );

    expect(result.processed).toBe(2);
    expect(result.extracted).toBe(2);
    expect(result.hasMore).toBe(true);
  });
});
