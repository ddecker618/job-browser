import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { runMigrations } from '../../db/migration-runner.js';
import { openDatabase } from '../../db/database.js';
import { JobNlpEnrichmentRepository } from '../../database/jobNlpEnrichmentRepository.js';
import {
  NLP_EXTRACTION_VERSION,
  type JobNlpEnrichment,
} from '../../schemas/job-nlp.js';
import { buildRequirementCoverage } from './requirementCoverage.js';
import { REQUIREMENT_COVERAGE_INTELLIGENCE_VERSION } from './requirementCoverage.js';
import {
  matchResumeEvidence,
  RESUME_EVIDENCE_MATCHING_VERSION,
  type ResumeEvidenceItem,
  type ResumeEvidenceRequirement,
} from './resumeEvidence.js';
import {
  REPROCESSING_INTELLIGENCE_VERSION,
  runReprocessingBatch,
} from './reprocessing.js';
import {
  asSegmentInputs,
  CATEGORY_CLASSIFIER_VERSION,
  classifySegment,
} from './categorizer.js';
import { REPRESENTATIVE_NLP_CORPUS } from './evaluation.js';
import type { SyntheticNlpCase } from './evaluationCorpus.js';
import { classifyStrength, STRENGTH_CLASSIFIER_VERSION } from './strength.js';
import { DEFAULT_SKILL_CATALOG, extractSkills } from './skills.js';
import { skillConcepts } from './skillNormalization.js';
import { segmentRoleDescription } from './segmenter.js';
import { extractCertifications } from './certifications.js';
import { extractClearance } from './clearance.js';
import { extractEducation } from './education.js';
import { extractExperience } from './experience.js';
import { extractLocation } from './location.js';

export const NLP_PERFORMANCE_AUDIT_VERSION = 'performance-audit-v1';

const DEFAULT_ITERATIONS = 20;
const DEFAULT_WARMUP_ITERATIONS = 3;
const REPROCESSING_CASE_COUNT = 100;

export interface PerformanceMetric {
  iterations: number;
  warmupIterations: number;
  unit: 'corpus-run' | 'batch';
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  operationsPerSecond: number;
  peakHeapDeltaBytes: number;
}

export interface DatabaseGrowthMeasurement {
  rowCount: number;
  allocatedBytesBefore: number;
  allocatedBytesAfter: number;
  allocatedBytesDelta: number;
  enrichmentJsonBytes: number;
}

export interface PerformanceAuditReport {
  auditVersion: typeof NLP_PERFORMANCE_AUDIT_VERSION;
  measuredAt: string;
  nodeVersion: string;
  platform: string;
  architecture: string;
  corpus: {
    caseCount: number;
    fingerprint: string;
  };
  cache: {
    strategy: 'stable-input-fingerprint';
    fingerprint: string;
    invalidatesOn: readonly string[];
    runtimeCacheBytes: 0;
  };
  metrics: {
    segmentation: PerformanceMetric;
    classification: PerformanceMetric;
    extraction: PerformanceMetric;
    resumeComparison: PerformanceMetric;
    reprocessing: PerformanceMetric;
  };
  coldImportMs: number | null;
  database: DatabaseGrowthMeasurement;
  embedding: {
    status: 'not-installed';
    measured: false;
    networkRequests: 0;
    note: string;
  };
  networkRequests: 0;
  productionEffect: 'none';
}

export interface PerformanceAuditOptions {
  iterations?: number;
  warmupIterations?: number;
  coldImportMs?: number | null;
  cases?: readonly SyntheticNlpCase[];
}

export function performanceInputFingerprint(
  cases: readonly SyntheticNlpCase[] = REPRESENTATIVE_NLP_CORPUS,
): string {
  const payload = JSON.stringify({
    auditVersion: NLP_PERFORMANCE_AUDIT_VERSION,
    extractionVersion: NLP_EXTRACTION_VERSION,
    categoryVersion: CATEGORY_CLASSIFIER_VERSION,
    strengthVersion: STRENGTH_CLASSIFIER_VERSION,
    reprocessingVersion: REPROCESSING_INTELLIGENCE_VERSION,
    resumeEvidenceVersion: RESUME_EVIDENCE_MATCHING_VERSION,
    coverageVersion: REQUIREMENT_COVERAGE_INTELLIGENCE_VERSION,
    catalog: DEFAULT_SKILL_CATALOG,
    cases: cases.map((item) => ({
      id: item.id,
      text: item.text,
      expectedCategories: item.expectedCategories,
      expectedStrength: item.expectedStrength,
      expectedEntities: item.expectedEntities,
    })),
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function runNlpPerformanceAudit(
  options: PerformanceAuditOptions = {},
): PerformanceAuditReport {
  const cases = options.cases ?? REPRESENTATIVE_NLP_CORPUS;
  const iterations = validatedIterations(
    options.iterations ?? DEFAULT_ITERATIONS,
  );
  const warmupIterations = validatedIterations(
    options.warmupIterations ?? DEFAULT_WARMUP_ITERATIONS,
  );
  const segments = cases.flatMap((item) =>
    asSegmentInputs([{ index: 0, text: item.text, kind: 'sentence' }]),
  );

  const segmentation = measure(iterations, warmupIterations, 'corpus-run', () =>
    cases.reduce(
      (total, item) =>
        total +
        segmentRoleDescription({
          title: 'Security Analyst',
          location: null,
          description: item.text,
          requirements: null,
          preferredQualifications: null,
        }).length,
      0,
    ),
  );
  const classification = measure(
    iterations,
    warmupIterations,
    'corpus-run',
    () =>
      segments.reduce(
        (total, segment) => total + classifySegment(segment).categories.length,
        0,
      ),
  );
  const extraction = measure(iterations, warmupIterations, 'corpus-run', () =>
    segments.reduce((total, segment) => {
      const classificationResult = classifySegment(segment);
      const strength = classifyStrength(
        segment,
        classificationResult.categories,
      );
      const skills = extractSkills(segment);
      const experience = extractExperience(segment);
      const education = extractEducation(segment);
      const certifications = extractCertifications(segment);
      const clearance = extractClearance(segment);
      const location = extractLocation(segment);
      return (
        total +
        classificationResult.categories.length +
        strength.strength.length +
        skills.mentions.length +
        experience.nestedYears.length +
        education.degrees.length +
        certifications.certifications.length +
        clearance.clearances.length +
        location.locations.length
      );
    }, 0),
  );
  const resumeComparison = measure(
    iterations,
    warmupIterations,
    'corpus-run',
    () => runResumeComparison().summary.totalRequirements,
  );
  const reprocessing = measure(iterations, warmupIterations, 'batch', () =>
    runReprocessingMeasurement(),
  );

  return {
    auditVersion: NLP_PERFORMANCE_AUDIT_VERSION,
    measuredAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    corpus: {
      caseCount: cases.length,
      fingerprint: performanceInputFingerprint(cases),
    },
    cache: {
      strategy: 'stable-input-fingerprint',
      fingerprint: performanceInputFingerprint(cases),
      invalidatesOn: [
        'NLP extraction/classifier versions',
        'reviewed skill catalog',
        'benchmark corpus text or labels',
        'benchmark harness version',
      ],
      runtimeCacheBytes: 0,
    },
    metrics: {
      segmentation,
      classification,
      extraction,
      resumeComparison,
      reprocessing,
    },
    coldImportMs: options.coldImportMs ?? null,
    database: measureDatabaseGrowth(),
    embedding: {
      status: 'not-installed',
      measured: false,
      networkRequests: 0,
      note: 'No embedding runtime, model artifact, or model acquisition path is installed.',
    },
    networkRequests: 0,
    productionEffect: 'none',
  };
}

function runResumeComparison() {
  const concepts = skillConcepts();
  const byLabel = new Map(concepts.map((concept) => [concept.label, concept]));
  const requirements: ResumeEvidenceRequirement[] = [
    {
      requirementId: 'benchmark-python',
      phrase: 'Python',
      kind: 'skill',
      targetConcept: byLabel.get('Python') ?? null,
    },
    {
      requirementId: 'benchmark-siem',
      phrase: 'SIEM',
      kind: 'skill',
      targetConcept: byLabel.get('SIEM') ?? null,
    },
    {
      requirementId: 'benchmark-azure',
      phrase: 'Azure',
      kind: 'skill',
      targetConcept: byLabel.get('Azure') ?? null,
    },
  ];
  const evidence: ResumeEvidenceItem[] = [
    {
      evidenceId: 'benchmark-python-evidence',
      kind: 'skill',
      rawLabel: 'Python',
      provenance: 'benchmark:skills',
      parserVersion: 'benchmark-parser-v1',
      normalizationVersion: 'benchmark-normalization-v1',
    },
    {
      evidenceId: 'benchmark-splunk-evidence',
      kind: 'skill',
      rawLabel: 'Splunk',
      provenance: 'benchmark:skills',
      parserVersion: 'benchmark-parser-v1',
      normalizationVersion: 'benchmark-normalization-v1',
    },
  ];
  const results = matchResumeEvidence({ requirements, evidence });
  return buildRequirementCoverage(
    results.map((result) => ({
      requirementId: result.requirementId,
      phrase: result.phrase,
      category: 'skill',
      strength: result.requirementId.endsWith('azure')
        ? 'nice-to-have'
        : result.requirementId.endsWith('siem')
          ? 'preferred'
          : 'required',
      evidence: result,
    })),
  );
}

function runReprocessingMeasurement(): number {
  const candidates = Array.from(
    { length: REPROCESSING_CASE_COUNT },
    (_, index) => ({
      jobId: `benchmark-job-${String(index).padStart(3, '0')}`,
      sourceTextHash: `benchmark-hash-${String(index)}`,
    }),
  );
  const saved = new Set<string>();
  const result = runReprocessingBatch(
    {
      isStale: (jobId) => !saved.has(jobId),
      save: (jobId) => saved.add(jobId),
    },
    candidates,
    NLP_EXTRACTION_VERSION,
    (candidate) => benchmarkEnrichment(candidate.sourceTextHash),
    { batchSize: REPROCESSING_CASE_COUNT },
  );
  return result.processedJobIds.length;
}

function measureDatabaseGrowth(): DatabaseGrowthMeasurement {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-nlp-audit-'));
  const databasePath = join(directory, 'benchmark.sqlite');
  const database = openDatabase(databasePath);
  try {
    runMigrations(database);
    const before = sqliteBytes(database);
    const insertJob = database.prepare(
      `INSERT INTO jobs (
         id, external_id, title, normalized_title, company, normalized_company,
         location, normalized_location, city, state, remote_type,
         employment_type, salary_minimum, salary_maximum, salary_text,
         description, requirements, preferred_qualifications, posting_url,
         source_name, source_type, date_posted, first_seen_at, last_seen_at,
         active, clearance_requirement, sponsorship_available,
         estimated_experience_years, seniority_level, score, recommendation,
         score_explanation, status, created_at, updated_at
       ) VALUES (?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 'unknown',
         'unknown', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'benchmark',
         'benchmark', NULL, ?, ?, 1, NULL, NULL, NULL, 'unknown', NULL, NULL,
         NULL, 'new', ?, ?)`,
    );
    for (let index = 0; index < REPROCESSING_CASE_COUNT; index += 1) {
      const jobId = `benchmark-job-${String(index).padStart(3, '0')}`;
      insertJob.run(
        jobId,
        'Benchmark role',
        'benchmark role',
        'Benchmark company',
        'benchmark company',
        '2026-09-10T00:00:00.000Z',
        '2026-09-10T00:00:00.000Z',
        '2026-09-10T00:00:00.000Z',
        '2026-09-10T00:00:00.000Z',
      );
    }
    const repository = new JobNlpEnrichmentRepository(database);
    for (let index = 0; index < REPROCESSING_CASE_COUNT; index += 1) {
      repository.save(
        `benchmark-job-${String(index).padStart(3, '0')}`,
        benchmarkEnrichment(`benchmark-hash-${String(index)}`),
      );
    }
    const after = sqliteBytes(database);
    const jsonBytes = database
      .prepare<
        [],
        { bytes: number }
      >('SELECT COALESCE(SUM(length(enrichment_json)), 0) AS bytes FROM job_nlp_enrichments')
      .get()?.bytes;
    return {
      rowCount: REPROCESSING_CASE_COUNT,
      allocatedBytesBefore: before,
      allocatedBytesAfter: after,
      allocatedBytesDelta: after - before,
      enrichmentJsonBytes: jsonBytes ?? 0,
    };
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function benchmarkEnrichment(sourceTextHash: string): JobNlpEnrichment {
  return {
    version: NLP_EXTRACTION_VERSION,
    generatedAt: '2026-09-10T00:00:00.000Z',
    sourceTextHash,
    segmentation: { segments: [], method: 'segmentation-v1' },
    facts: [],
  };
}

function sqliteBytes(database: ReturnType<typeof openDatabase>): number {
  const pageCount = database
    .prepare<[], { page_count: number }>('PRAGMA page_count')
    .get()?.page_count;
  const pageSize = database
    .prepare<[], { page_size: number }>('PRAGMA page_size')
    .get()?.page_size;
  return (pageCount ?? 0) * (pageSize ?? 0);
}

function measure(
  iterations: number,
  warmupIterations: number,
  unit: PerformanceMetric['unit'],
  operation: () => number,
): PerformanceMetric {
  for (let index = 0; index < warmupIterations; index += 1) operation();
  const samples: number[] = [];
  let peakHeapDeltaBytes = 0;
  let sink = 0;
  for (let index = 0; index < iterations; index += 1) {
    const before = process.memoryUsage().heapUsed;
    const started = performance.now();
    sink += operation();
    const elapsed = performance.now() - started;
    const after = process.memoryUsage().heapUsed;
    samples.push(elapsed);
    peakHeapDeltaBytes = Math.max(peakHeapDeltaBytes, after - before);
  }
  if (sink < 0) throw new Error('Benchmark sink became invalid');
  const ordered = [...samples].sort((left, right) => left - right);
  const totalMs = samples.reduce((total, sample) => total + sample, 0);
  return {
    iterations,
    warmupIterations,
    unit,
    p50Ms: percentile(ordered, 0.5),
    p95Ms: percentile(ordered, 0.95),
    minMs: ordered[0] ?? 0,
    maxMs: ordered.at(-1) ?? 0,
    operationsPerSecond: totalMs === 0 ? 0 : (iterations / totalMs) * 1000,
    peakHeapDeltaBytes,
  };
}

function percentile(ordered: readonly number[], fraction: number): number {
  if (ordered.length === 0) return 0;
  return (
    ordered[
      Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)
    ] ?? 0
  );
}

function validatedIterations(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('Performance audit iterations must be a positive integer');
  }
  return value;
}
