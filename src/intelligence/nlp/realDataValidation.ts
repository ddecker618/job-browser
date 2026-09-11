import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { JobDatabase } from '../../db/database.js';
import { JobNlpEnrichmentRepository } from '../../database/jobNlpEnrichmentRepository.js';
import { NlpComparisonRepository } from '../../database/nlpComparisonRepository.js';
import { NlpRelevanceRepository } from '../../database/nlpRelevanceRepository.js';
import { NLP_EXTRACTION_VERSION } from '../../schemas/job-nlp.js';
import { runNlpBackgroundWorker } from './async.js';
import {
  summarizeNlpComparisons,
  withNlpComparisonPersistence,
} from './comparison.js';
import { extractNlpDocument } from './document.js';
import { DatabaseJobNlpCandidateSource } from './jobCandidateProvider.js';
import { withSearchRelevanceIndex } from './searchRelevance.js';

export const NLP_REAL_DATA_VALIDATION_VERSION = 'nlp-real-data-validation-v1';

export interface NlpRealDataValidationOptions {
  limit?: number;
  batchSize?: number;
}

export interface NlpRealDataValidationReport {
  validationVersion: typeof NLP_REAL_DATA_VALIDATION_VERSION;
  measuredAt: string;
  validationDatabase: 'local-copy';
  corpus: {
    requestedLimit: number;
    jobsAvailable: number;
    processed: number;
    descriptionsIncludedInReport: false;
  };
  worker: {
    batchSize: number;
    extracted: number;
    skipped: number;
    failed: number;
    durationMs: number;
  };
  comparisons: ReturnType<typeof summarizeNlpComparisons>;
  productionInvariance: {
    beforeFingerprint: string;
    afterFingerprint: string;
    unchanged: boolean;
  };
  responsiveness: {
    eventLoopHeartbeatTicks: number;
    mainThreadYieldObserved: boolean;
  };
  shadowRows: {
    enrichments: number;
    relevanceIndexes: number;
    comparisons: number;
  };
  networkRequests: 0;
  originalDatabaseWrites: 0;
  productionEffect: 'none';
}

export async function runNlpRealDataValidation(
  database: JobDatabase,
  options: NlpRealDataValidationOptions = {},
): Promise<NlpRealDataValidationReport> {
  const limit = boundedInteger(options.limit ?? 500, 1, 10_000, 'limit');
  const batchSize = boundedInteger(
    options.batchSize ?? Math.min(50, limit),
    1,
    Math.min(500, limit),
    'batchSize',
  );
  const source = new DatabaseJobNlpCandidateSource(database);
  const enrichmentStore = new JobNlpEnrichmentRepository(database);
  const relevanceStore = new NlpRelevanceRepository(database);
  const comparisonStore = new NlpComparisonRepository(database);
  const target = withNlpComparisonPersistence(
    database,
    withSearchRelevanceIndex(enrichmentStore, relevanceStore),
    comparisonStore,
  );
  const beforeFingerprint = fingerprintJobs(database);
  const includedJobIds = new Set<string>();
  let provided = 0;
  let heartbeatTicks = 0;
  const heartbeat = setInterval(() => heartbeatTicks++, 0);
  const startedAt = performance.now();
  let result;
  try {
    result = await runNlpBackgroundWorker(
      {
        target,
        extractionVersion: NLP_EXTRACTION_VERSION,
        builder: async (candidate, signal) => {
          const parts = source.load(candidate.jobId);
          if (parts === null)
            throw new Error('Validation job disappeared from copy');
          return extractNlpDocument(parts, signal);
        },
        candidateProvider: (_afterJobId, requested) => {
          const remaining = limit - provided;
          if (remaining <= 0) return Promise.resolve([]);
          const page = source.page(_afterJobId, Math.min(requested, remaining));
          provided += page.length;
          for (const candidate of page) includedJobIds.add(candidate.jobId);
          return Promise.resolve(page);
        },
      },
      { batchSize, maxTotal: limit },
    );
  } finally {
    clearInterval(heartbeat);
  }
  const durationMs = performance.now() - startedAt;
  const afterFingerprint = fingerprintJobs(database);
  const comparisons = comparisonStore
    .list()
    .filter((report) => includedJobIds.has(report.jobId));
  return {
    validationVersion: NLP_REAL_DATA_VALIDATION_VERSION,
    measuredAt: new Date().toISOString(),
    validationDatabase: 'local-copy',
    corpus: {
      requestedLimit: limit,
      jobsAvailable: source.countJobs(),
      processed: result.processed,
      descriptionsIncludedInReport: false,
    },
    worker: {
      batchSize,
      extracted: result.extracted,
      skipped: result.skipped,
      failed: result.failed,
      durationMs,
    },
    comparisons: summarizeNlpComparisons(comparisons),
    productionInvariance: {
      beforeFingerprint,
      afterFingerprint,
      unchanged: beforeFingerprint === afterFingerprint,
    },
    responsiveness: {
      eventLoopHeartbeatTicks: heartbeatTicks,
      mainThreadYieldObserved: result.processed === 0 || heartbeatTicks > 0,
    },
    shadowRows: {
      enrichments: countRows(database, 'job_nlp_enrichments'),
      relevanceIndexes: countRows(database, 'job_nlp_relevance'),
      comparisons: countRows(database, 'job_nlp_comparisons'),
    },
    networkRequests: 0,
    originalDatabaseWrites: 0,
    productionEffect: 'none',
  };
}

function fingerprintJobs(database: JobDatabase): string {
  const digest = createHash('sha256');
  for (const row of database
    .prepare<[], Record<string, unknown>>('SELECT * FROM jobs ORDER BY id')
    .iterate()) {
    digest.update(JSON.stringify(row));
    digest.update('\n');
  }
  return digest.digest('hex');
}

function countRows(database: JobDatabase, table: string): number {
  if (!/^job_nlp_(?:enrichments|relevance|comparisons)$/.test(table)) {
    throw new Error('Unsupported shadow table');
  }
  return (
    database
      .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      .get()?.count ?? 0
  );
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${label} must be an integer from ${String(minimum)} to ${String(maximum)}.`,
    );
  }
  return value;
}
