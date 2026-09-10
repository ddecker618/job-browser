import { describe, expect, it } from 'vitest';

import {
  REPROCESSING_INTELLIGENCE_VERSION,
  planReprocessing,
  runReprocessingBatch,
  type NlpPersistenceTarget,
  type ReprocessingCandidate,
} from '../src/intelligence/nlp/reprocessing.js';
import type { JobNlpEnrichment } from '../src/schemas/job-nlp.js';

function enrichment(sourceTextHash: string): JobNlpEnrichment {
  return {
    version: 'job-nlp-v1',
    generatedAt: '2026-01-02T00:00:00.000Z',
    sourceTextHash,
    segmentation: { segments: [], method: 'segmentation-v1' },
    facts: [],
  };
}

class MemoryTarget implements NlpPersistenceTarget {
  public readonly rows = new Map<string, JobNlpEnrichment>();

  public isStale(
    jobId: string,
    extractionVersion: string,
    sourceTextHash: string,
  ): boolean {
    const row = this.rows.get(jobId);
    if (row === undefined) return true;
    return (
      row.version !== extractionVersion || row.sourceTextHash !== sourceTextHash
    );
  }

  public save(jobId: string, document: JobNlpEnrichment): void {
    this.rows.set(jobId, document);
  }
}

function candidate(
  jobId: string,
  sourceTextHash = `${jobId}-hash`,
): ReprocessingCandidate {
  return { jobId, sourceTextHash };
}

describe('NLP reprocessing - planning', () => {
  it('sorts, deduplicates, bounds, and resumes with a cursor', () => {
    const target = new MemoryTarget();
    target.rows.set('job-a', enrichment('job-a-hash'));
    const plan = planReprocessing(
      target,
      [
        candidate('job-c'),
        candidate('job-a'),
        candidate('job-b'),
        candidate('job-b'),
      ],
      'job-nlp-v1',
      { batchSize: 2 },
    );
    expect(plan.candidates.map((item) => item.jobId)).toEqual(['job-b']);
    expect(plan.skippedJobIds).toEqual(['job-a']);
    expect(plan.nextCursor).toBe('job-b');
    expect(plan.hasMore).toBe(true);

    const resumed = planReprocessing(
      target,
      [candidate('job-c'), candidate('job-a'), candidate('job-b')],
      'job-nlp-v1',
      { batchSize: 2, afterJobId: plan.nextCursor },
    );
    expect(resumed.candidates.map((item) => item.jobId)).toEqual(['job-c']);
    expect(resumed.hasMore).toBe(false);
  });

  it('skips a fresh row and marks a changed hash stale', () => {
    const target = new MemoryTarget();
    target.rows.set('job-a', enrichment('job-a-hash'));
    target.rows.set('job-b', enrichment('old-hash'));
    const plan = planReprocessing(
      target,
      [candidate('job-a'), candidate('job-b')],
      'job-nlp-v1',
    );
    expect(plan.skippedJobIds).toEqual(['job-a']);
    expect(plan.candidates.map((item) => item.jobId)).toEqual(['job-b']);
  });

  it('rejects invalid batch sizes', () => {
    expect(() =>
      planReprocessing(new MemoryTarget(), [], 'job-nlp-v1', { batchSize: 0 }),
    ).toThrow('positive integer');
  });
});

describe('NLP reprocessing - execution safety', () => {
  it('processes stale jobs and becomes idempotent on retry', () => {
    const target = new MemoryTarget();
    const candidates = [candidate('job-a'), candidate('job-b')];
    let builds = 0;
    const build = (item: ReprocessingCandidate): JobNlpEnrichment => {
      builds += 1;
      return enrichment(item.sourceTextHash);
    };

    const first = runReprocessingBatch(target, candidates, 'job-nlp-v1', build);
    const second = runReprocessingBatch(
      target,
      candidates,
      'job-nlp-v1',
      build,
    );
    expect(first.processedJobIds).toEqual(['job-a', 'job-b']);
    expect(second.processedJobIds).toEqual([]);
    expect(second.skippedJobIds).toEqual(['job-a', 'job-b']);
    expect(builds).toBe(2);
  });

  it('keeps earlier saves when a later builder fails', () => {
    const target = new MemoryTarget();
    const result = runReprocessingBatch(
      target,
      [candidate('job-a'), candidate('job-b'), candidate('job-c')],
      'job-nlp-v1',
      (item) => {
        if (item.jobId === 'job-b') throw new Error('synthetic failure');
        return enrichment(item.sourceTextHash);
      },
    );
    expect(result.processedJobIds).toEqual(['job-a', 'job-c']);
    expect(result.failures).toEqual([
      { jobId: 'job-b', error: 'synthetic failure' },
    ]);
    expect([...target.rows.keys()]).toEqual(['job-a', 'job-c']);
  });

  it('rejects a builder result with a mismatched version or source hash', () => {
    const target = new MemoryTarget();
    const wrongHash = runReprocessingBatch(
      target,
      [candidate('job-a')],
      'job-nlp-v1',
      () => enrichment('different-hash'),
    );
    expect(wrongHash.processedJobIds).toEqual([]);
    expect(wrongHash.failures[0]?.error).toContain('source hash');
    expect(target.rows).toHaveLength(0);
  });

  it('does not expose archive or production-score operations', () => {
    const target = new MemoryTarget();
    const result = runReprocessingBatch(
      target,
      [candidate('job-a')],
      'job-nlp-v1',
      (item) => enrichment(item.sourceTextHash),
    );
    expect(result.reprocessingVersion).toBe(REPROCESSING_INTELLIGENCE_VERSION);
    expect(result).not.toHaveProperty('archive');
    expect(result).not.toHaveProperty('score');
    expect(result).not.toHaveProperty('eligibility');
  });
});
