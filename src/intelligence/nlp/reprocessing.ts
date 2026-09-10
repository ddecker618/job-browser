import type { JobNlpEnrichment } from '../../schemas/job-nlp.js';

// ---------------------------------------------------------------------------
// Stage 14 - invalidation and reprocessing.
//
// Reprocessing is bounded and cursor-based. Each save is independent, so a
// completed job remains persisted if a later candidate fails or the process
// exits. Fresh rows are skipped, making retries idempotent. No job lifecycle or
// production score field is present in this API by design.
// ---------------------------------------------------------------------------

export const REPROCESSING_INTELLIGENCE_VERSION = 'reprocessing-v1';

export interface ReprocessingCandidate {
  jobId: string;
  sourceTextHash: string;
}

export interface NlpPersistenceTarget {
  isStale(
    jobId: string,
    extractionVersion: string,
    sourceTextHash: string,
  ): boolean;
  save(jobId: string, enrichment: JobNlpEnrichment): void;
}

export interface ReprocessingOptions {
  batchSize?: number;
  afterJobId?: string | null;
}

export interface ReprocessingPlan {
  candidates: ReprocessingCandidate[];
  skippedJobIds: string[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ReprocessingFailure {
  jobId: string;
  error: string;
}

export interface ReprocessingBatchResult extends ReprocessingPlan {
  processedJobIds: string[];
  failures: ReprocessingFailure[];
  reprocessingVersion: typeof REPROCESSING_INTELLIGENCE_VERSION;
}

export type BuildNlpEnrichment = (
  candidate: ReprocessingCandidate,
) => JobNlpEnrichment;

const DEFAULT_BATCH_SIZE = 50;

export function planReprocessing(
  target: NlpPersistenceTarget,
  candidates: readonly ReprocessingCandidate[],
  extractionVersion: string,
  options: ReprocessingOptions = {},
): ReprocessingPlan {
  const batchSize = validatedBatchSize(options.batchSize);
  const afterJobId = options.afterJobId ?? null;
  const ordered = uniqueCandidates(candidates).filter(
    (candidate) => afterJobId === null || candidate.jobId > afterJobId,
  );
  const batch = ordered.slice(0, batchSize);
  const stale: ReprocessingCandidate[] = [];
  const skippedJobIds: string[] = [];

  for (const candidate of batch) {
    if (
      target.isStale(
        candidate.jobId,
        extractionVersion,
        candidate.sourceTextHash,
      )
    ) {
      stale.push(candidate);
    } else {
      skippedJobIds.push(candidate.jobId);
    }
  }

  return {
    candidates: stale,
    skippedJobIds,
    nextCursor: batch.at(-1)?.jobId ?? afterJobId,
    hasMore: ordered.length > batch.length,
  };
}

export function runReprocessingBatch(
  target: NlpPersistenceTarget,
  candidates: readonly ReprocessingCandidate[],
  extractionVersion: string,
  build: BuildNlpEnrichment,
  options: ReprocessingOptions = {},
): ReprocessingBatchResult {
  const plan = planReprocessing(target, candidates, extractionVersion, options);
  const processedJobIds: string[] = [];
  const failures: ReprocessingFailure[] = [];

  for (const candidate of plan.candidates) {
    try {
      const enrichment = build(candidate);
      if (enrichment.version !== extractionVersion) {
        throw new Error(
          `Builder returned ${enrichment.version}; expected ${extractionVersion}`,
        );
      }
      if (enrichment.sourceTextHash !== candidate.sourceTextHash) {
        throw new Error(
          `Builder returned source hash ${enrichment.sourceTextHash}; expected ${candidate.sourceTextHash}`,
        );
      }
      target.save(candidate.jobId, enrichment);
      processedJobIds.push(candidate.jobId);
    } catch (error) {
      failures.push({
        jobId: candidate.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ...plan,
    processedJobIds,
    failures,
    reprocessingVersion: REPROCESSING_INTELLIGENCE_VERSION,
  };
}

function uniqueCandidates(
  candidates: readonly ReprocessingCandidate[],
): ReprocessingCandidate[] {
  const ordered = [...candidates].sort((left, right) => {
    const byJob = left.jobId.localeCompare(right.jobId);
    return byJob !== 0
      ? byJob
      : left.sourceTextHash.localeCompare(right.sourceTextHash);
  });
  const unique: ReprocessingCandidate[] = [];
  for (const candidate of ordered) {
    if (unique.at(-1)?.jobId === candidate.jobId) continue;
    unique.push(candidate);
  }
  return unique;
}

function validatedBatchSize(value: number | undefined): number {
  const batchSize = value ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('Reprocessing batchSize must be a positive integer');
  }
  return batchSize;
}
