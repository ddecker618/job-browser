import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { JobDatabase } from '../../db/database.js';
import {
  NLP_EXTRACTION_VERSION,
  type JobNlpEnrichment,
} from '../../schemas/job-nlp.js';
import { runNlpWorkerBatch } from './async.js';
import {
  documentHash,
  extractNlpDocument,
  MAX_NLP_DOCUMENT_CHARACTERS,
} from './document.js';
import type {
  NlpPersistenceTarget,
  ReprocessingCandidate,
} from './reprocessing.js';
import type { RoleDescriptionParts } from './segmenter.js';

export const LOCAL_PRODUCTION_LOAD_AUDIT_VERSION =
  'local-production-load-audit-v1';

interface CorpusRow {
  id: string;
  title: string;
  location: string | null;
  description: string | null;
  requirements: string | null;
  preferred_qualifications: string | null;
}

export interface LocalProductionLoadAuditOptions {
  limit?: number;
  batchSize?: number;
}

export interface LocalProductionLoadAuditReport {
  auditVersion: typeof LOCAL_PRODUCTION_LOAD_AUDIT_VERSION;
  measuredAt: string;
  platform: string;
  architecture: string;
  corpus: {
    copiedInMemory: true;
    caseCount: number;
    sourceCharacterCount: number;
    fingerprint: string;
    descriptionsIncludedInReport: false;
  };
  worker: {
    batchSize: number;
    batchCount: number;
    p50BatchMs: number;
    p95BatchMs: number;
    totalMs: number;
    extracted: number;
    failed: number;
  };
  cache: {
    strategy: 'content-hash-and-extraction-version';
    retrySkipped: number;
    retryExtracted: number;
  };
  responsiveness: {
    eventLoopHeartbeatTicks: number;
    mainThreadYieldObserved: boolean;
  };
  peakHeapDeltaBytes: number;
  networkRequests: 0;
  sourceDatabaseWrites: 0;
  productionEffect: 'none';
}

export async function runLocalProductionLoadAudit(
  database: JobDatabase,
  options: LocalProductionLoadAuditOptions = {},
): Promise<LocalProductionLoadAuditReport> {
  const limit = boundedInteger(options.limit ?? 500, 1, 10_000, 'limit');
  const batchSize = boundedInteger(
    options.batchSize ?? 50,
    1,
    500,
    'batchSize',
  );
  const rows = database
    .prepare<[number, number], CorpusRow>(
      `SELECT id, title, location, description, requirements,
              preferred_qualifications
         FROM jobs
        WHERE LENGTH(title) + LENGTH(COALESCE(location, '')) +
              LENGTH(COALESCE(description, '')) +
              LENGTH(COALESCE(requirements, '')) +
              LENGTH(COALESCE(preferred_qualifications, '')) <= ?
          AND LENGTH(TRIM(COALESCE(description, ''))) > 0
        ORDER BY id
        LIMIT ?`,
    )
    .all(MAX_NLP_DOCUMENT_CHARACTERS, limit);
  const corpus = rows.map((row) => ({
    jobId: row.id,
    parts: {
      title: row.title,
      location: row.location,
      description: row.description,
      requirements: row.requirements,
      preferredQualifications: row.preferred_qualifications,
    } satisfies RoleDescriptionParts,
  }));
  const sourceCharacterCount = corpus.reduce(
    (total, item) => total + characterCount(item.parts),
    0,
  );
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify(
        corpus.map((item) => [item.jobId, documentHash(item.parts)]),
      ),
    )
    .digest('hex');
  const byJobId = new Map(corpus.map((item) => [item.jobId, item.parts]));
  const candidates: ReprocessingCandidate[] = corpus.map((item) => ({
    jobId: item.jobId,
    sourceTextHash: documentHash(item.parts),
  }));
  const target = memoryTarget();
  const heapBefore = process.memoryUsage().heapUsed;
  let heartbeatTicks = 0;
  const heartbeat = setInterval(() => heartbeatTicks++, 0);
  const startedAt = performance.now();
  const batchDurations: number[] = [];
  let extracted = 0;
  let failed = 0;
  try {
    for (let offset = 0; offset < candidates.length; offset += batchSize) {
      const batch = candidates.slice(offset, offset + batchSize);
      const batchStartedAt = performance.now();
      const result = await runNlpWorkerBatch(
        target,
        batch,
        NLP_EXTRACTION_VERSION,
        async (candidate, signal) => {
          const parts = byJobId.get(candidate.jobId);
          if (!parts) throw new Error('Copied corpus entry is missing.');
          return extractNlpDocument(parts, signal);
        },
        { batchSize: batch.length },
      );
      batchDurations.push(performance.now() - batchStartedAt);
      extracted += result.extracted;
      failed += result.failed;
    }
  } finally {
    clearInterval(heartbeat);
  }
  const totalMs = performance.now() - startedAt;
  let retrySkipped = 0;
  let retryExtracted = 0;
  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    const result = await runNlpWorkerBatch(
      target,
      batch,
      NLP_EXTRACTION_VERSION,
      () => Promise.reject(new Error('Fresh cache entry was rebuilt.')),
      { batchSize: batch.length },
    );
    retrySkipped += result.skipped;
    retryExtracted += result.extracted;
  }
  const heapAfter = process.memoryUsage().heapUsed;

  return {
    auditVersion: LOCAL_PRODUCTION_LOAD_AUDIT_VERSION,
    measuredAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    corpus: {
      copiedInMemory: true,
      caseCount: corpus.length,
      sourceCharacterCount,
      fingerprint,
      descriptionsIncludedInReport: false,
    },
    worker: {
      batchSize,
      batchCount: batchDurations.length,
      p50BatchMs: percentile(batchDurations, 0.5),
      p95BatchMs: percentile(batchDurations, 0.95),
      totalMs,
      extracted,
      failed,
    },
    cache: {
      strategy: 'content-hash-and-extraction-version',
      retrySkipped,
      retryExtracted,
    },
    responsiveness: {
      eventLoopHeartbeatTicks: heartbeatTicks,
      mainThreadYieldObserved: corpus.length === 0 || heartbeatTicks > 0,
    },
    peakHeapDeltaBytes: Math.max(0, heapAfter - heapBefore),
    networkRequests: 0,
    sourceDatabaseWrites: 0,
    productionEffect: 'none',
  };
}

function memoryTarget(): NlpPersistenceTarget {
  const saved = new Map<string, JobNlpEnrichment>();
  return {
    isStale(jobId, extractionVersion, sourceTextHash) {
      const existing = saved.get(jobId);
      return (
        existing?.version !== extractionVersion ||
        existing.sourceTextHash !== sourceTextHash
      );
    },
    save(jobId, enrichment) {
      saved.set(jobId, enrichment);
    },
  };
}

function characterCount(parts: RoleDescriptionParts): number {
  return (
    parts.title.length +
    (parts.location?.length ?? 0) +
    (parts.description?.length ?? 0) +
    (parts.requirements?.length ?? 0) +
    (parts.preferredQualifications?.length ?? 0)
  );
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new RangeError(
      `${label} must be an integer from ${String(minimum)} to ${String(maximum)}.`,
    );
  return value;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1] ?? 0;
}
