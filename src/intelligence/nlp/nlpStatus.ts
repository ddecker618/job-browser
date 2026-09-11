import type { JobDatabase } from '../../db/database.js';
import type { NlpWorkerStatus } from './backgroundWorker.js';
import { readNlpCapabilityFlags } from './capabilityFlags.js';
import { NLP_DOCUMENT_VERSION } from './document.js';
import { SEARCH_RELEVANCE_INDEX_VERSION } from './searchRelevance.js';
import { NLP_EXTRACTION_VERSION } from '../../schemas/job-nlp.js';
import { NLP_COMPARISON_VERSION } from './comparison.js';

export const NLP_STATUS_VERSION = 'nlp-status-v1';

export interface NlpStatusProjection {
  statusVersion: typeof NLP_STATUS_VERSION;
  worker: NlpWorkerStatus | null;
  extractionVersion: string;
  documentVersion: string;
  relevanceVersion: string;
  comparisonVersion: string;
  flags: ReturnType<typeof readNlpCapabilityFlags>;
  counts: {
    jobs: number;
    analyzed: number;
    currentEnrichments: number;
    currentRelevanceIndexes: number;
    currentComparisons: number;
  };
  lastSuccessAt: string | null;
  lastFailure: string | null;
  state: 'disabled' | 'ready' | 'degraded' | 'processing';
  notice: 'Not used for scoring or eligibility.';
}

export function projectNlpStatus(
  database: JobDatabase,
  worker: NlpWorkerStatus | null,
): NlpStatusProjection {
  const flags = readNlpCapabilityFlags(database);
  const counts = database
    .prepare<
      [string, string, string, string],
      {
        jobs: number;
        analyzed: number;
        current_enrichments: number;
        current_relevance: number;
        current_comparisons: number;
      }
    >(
      `
      SELECT
        (SELECT COUNT(*) FROM jobs) AS jobs,
        (SELECT COUNT(*) FROM job_nlp_enrichments) AS analyzed,
        (SELECT COUNT(*) FROM job_nlp_enrichments WHERE extraction_version=?) AS current_enrichments,
        (SELECT COUNT(*) FROM job_nlp_relevance WHERE relevance_index_version=?) AS current_relevance,
        (SELECT COUNT(*) FROM job_nlp_comparisons AS c
          JOIN job_nlp_enrichments AS e ON e.job_id=c.job_id
           AND e.source_text_hash=c.source_text_hash
         WHERE c.comparison_version=? AND e.extraction_version=?) AS current_comparisons
    `,
    )
    .get(
      NLP_EXTRACTION_VERSION,
      SEARCH_RELEVANCE_INDEX_VERSION,
      NLP_COMPARISON_VERSION,
      NLP_EXTRACTION_VERSION,
    );
  const anyEnabled = Object.entries(flags).some(
    ([key, value]) => key !== 'version' && value === true,
  );
  const lastFailure =
    worker?.lastFailure ??
    (worker?.lastSweep && worker.lastSweep.failed > 0
      ? String(worker.lastSweep.failed) +
        ' job intelligence item(s) failed in the last sweep. Deterministic behavior remains active.'
      : null);
  const state =
    lastFailure !== null
      ? 'degraded'
      : worker?.state === 'running'
        ? 'processing'
        : anyEnabled
          ? 'ready'
          : 'disabled';
  return {
    statusVersion: NLP_STATUS_VERSION,
    worker,
    extractionVersion: NLP_EXTRACTION_VERSION,
    documentVersion: NLP_DOCUMENT_VERSION,
    relevanceVersion: SEARCH_RELEVANCE_INDEX_VERSION,
    comparisonVersion: NLP_COMPARISON_VERSION,
    flags,
    counts: {
      jobs: counts?.jobs ?? 0,
      analyzed: counts?.analyzed ?? 0,
      currentEnrichments: counts?.current_enrichments ?? 0,
      currentRelevanceIndexes: counts?.current_relevance ?? 0,
      currentComparisons: counts?.current_comparisons ?? 0,
    },
    lastSuccessAt: worker?.lastSweep?.finishedAt ?? null,
    lastFailure,
    state,
    notice: 'Not used for scoring or eligibility.',
  };
}
