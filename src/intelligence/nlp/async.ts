import {
  NLP_EXTRACTION_VERSION,
  type JobNlpEnrichment,
} from '../../schemas/job-nlp.js';
import {
  type NlpPersistenceTarget,
  type ReprocessingCandidate,
  planReprocessing,
} from './reprocessing.js';

// ---------------------------------------------------------------------------
// P3b - async background enrichment worker.
//
// Bounded, abortable, per-job deadline, single-flight, stale-only. The worker
// never writes to the jobs table and never touches production scoring,
// eligibility, ranking, filtering, or lifecycle fields.
// ---------------------------------------------------------------------------

export const ASYNC_WORKER_VERSION = 'async-worker-v1';

export type AsyncWorkerCandidateProvider = (
  afterJobId: string | null,
  limit: number,
) => Promise<ReprocessingCandidate[]>;

export interface AsyncWorkerOptions {
  batchSize?: number;
  maxTotal?: number;
  timeoutPerJobMs?: number;
  abortSignal?: AbortSignal;
  onBatchComplete?: (progress: AsyncWorkerProgress) => void;
}

export interface AsyncWorkerProgress {
  processed: number;
  extracted: number;
  skipped: number;
  failed: number;
  hasMore: boolean;
  lastJobId: string | null;
  batchExtracted: number;
  batchSkipped: number;
  batchFailed: number;
}

export interface AsyncWorkerResult extends AsyncWorkerProgress {
  durationMs: number;
  failedJobIds: string[];
}

type AsyncBuilder = (
  candidate: ReprocessingCandidate,
  signal: AbortSignal,
) => Promise<JobNlpEnrichment>;

export async function runNlpWorkerBatch(
  target: NlpPersistenceTarget,
  candidates: readonly ReprocessingCandidate[],
  extractionVersion: string,
  builder: AsyncBuilder,
  options: AsyncWorkerOptions = {},
): Promise<AsyncWorkerResult> {
  const batchSize = options.batchSize ?? 50;
  const timeoutPerJobMs = options.timeoutPerJobMs ?? 20_000;
  const abortSignal = options.abortSignal ?? null;
  const startTime = Date.now();

  const failedJobIds: string[] = [];
  let processed = 0;
  let extracted = 0;
  let skipped = 0;
  let failed = 0;

  const plan = planReprocessing(target, candidates, extractionVersion, {
    batchSize,
  });
  const allSkipped = [...plan.skippedJobIds];
  skipped += allSkipped.length;
  processed += allSkipped.length;

  for (const candidate of plan.candidates) {
    abortSignal?.throwIfAborted();

    const jobAbort = AbortSignal.timeout(timeoutPerJobMs);
    const combined = AbortSignal.any(
      abortSignal ? [abortSignal, jobAbort] : [jobAbort],
    );

    try {
      const enrichment = await builder(candidate, combined);
      if (enrichment.version !== extractionVersion) {
        throw new Error(
          `Builder returned ${enrichment.version}; expected ${extractionVersion}`,
        );
      }
      if (enrichment.sourceTextHash !== candidate.sourceTextHash) {
        throw new Error(
          `Builder returned hash ${enrichment.sourceTextHash}; expected ${candidate.sourceTextHash}`,
        );
      }
      target.save(candidate.jobId, enrichment);
      extracted++;
    } catch (error) {
      if (combined.aborted && abortSignal?.aborted) throw error;
      failed++;
      failedJobIds.push(candidate.jobId);
    } finally {
      processed++;
    }
  }

  const result: AsyncWorkerResult = {
    processed,
    extracted,
    skipped,
    failed,
    hasMore: plan.hasMore,
    lastJobId: plan.nextCursor ?? null,
    durationMs: Date.now() - startTime,
    failedJobIds,
    batchExtracted: extracted,
    batchSkipped: skipped,
    batchFailed: failed,
  };

  options.onBatchComplete?.({
    processed: result.processed,
    extracted: result.extracted,
    skipped: result.skipped,
    failed: result.failed,
    hasMore: result.hasMore,
    lastJobId: result.lastJobId,
    batchExtracted: result.batchExtracted,
    batchSkipped: result.batchSkipped,
    batchFailed: result.batchFailed,
  });

  return result;
}

export interface AsyncWorkerContext {
  target: NlpPersistenceTarget;
  extractionVersion: string;
  builder: AsyncBuilder;
  candidateProvider: AsyncWorkerCandidateProvider;
}

export async function runNlpBackgroundWorker(
  context: AsyncWorkerContext,
  options: AsyncWorkerOptions = {},
): Promise<AsyncWorkerResult> {
  const {
    target,
    extractionVersion = NLP_EXTRACTION_VERSION,
    builder,
    candidateProvider,
  } = context;
  const batchSize = options.batchSize ?? 50;
  const maxTotal = options.maxTotal ?? Number.POSITIVE_INFINITY;
  const abortSignal = options.abortSignal ?? null;
  const startTime = Date.now();

  let totalProcessed = 0;
  let totalExtracted = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let lastJobId: string | null = null;
  let hasMore = true;
  const allFailedJobIds: string[] = [];

  while (hasMore && totalProcessed < maxTotal) {
    abortSignal?.throwIfAborted();

    const pageCandidates = await candidateProvider(lastJobId, batchSize);
    if (pageCandidates.length === 0) break;

    const pageResult = await runNlpWorkerBatch(
      target,
      pageCandidates,
      extractionVersion,
      builder,
      {
        batchSize,
        ...(options.timeoutPerJobMs !== undefined
          ? { timeoutPerJobMs: options.timeoutPerJobMs }
          : {}),
        ...(abortSignal !== null ? { abortSignal } : {}),
      },
    );

    totalProcessed += pageResult.processed;
    totalExtracted += pageResult.extracted;
    totalSkipped += pageResult.skipped;
    totalFailed += pageResult.failed;
    allFailedJobIds.push(...pageResult.failedJobIds);
    hasMore = pageCandidates.length === batchSize;
    lastJobId = pageResult.lastJobId;

    options.onBatchComplete?.({
      processed: totalProcessed,
      extracted: totalExtracted,
      skipped: totalSkipped,
      failed: totalFailed,
      hasMore,
      lastJobId,
      batchExtracted: pageResult.batchExtracted,
      batchSkipped: pageResult.batchSkipped,
      batchFailed: pageResult.batchFailed,
    });

    if (totalProcessed >= maxTotal) break;
  }

  return {
    processed: totalProcessed,
    extracted: totalExtracted,
    skipped: totalSkipped,
    failed: totalFailed,
    hasMore,
    lastJobId,
    durationMs: Date.now() - startTime,
    failedJobIds: allFailedJobIds,
    batchExtracted: 0,
    batchSkipped: 0,
    batchFailed: 0,
  };
}
