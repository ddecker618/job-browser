import { z } from 'zod';

import type { JobDatabase } from '../../db/database.js';
import type {
  JobNlpEnrichment,
  NlpConflictState,
} from '../../schemas/job-nlp.js';
import type { NlpPersistenceTarget } from './reprocessing.js';
import {
  projectJobIntelligence,
  type JobIntelligenceDeterministicSide,
} from './projection.js';

export const NLP_COMPARISON_VERSION = 'nlp-comparison-v1';
const CAPABILITIES = ['clearance', 'work-arrangement', 'experience'] as const;
export type NlpComparisonCapability = (typeof CAPABILITIES)[number];

const resultSchema = z.strictObject({
  comparisonVersion: z.literal(NLP_COMPARISON_VERSION),
  jobId: z.string().min(1),
  sourceTextHash: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().min(1),
  capabilities: z.array(
    z.strictObject({
      capability: z.enum(CAPABILITIES),
      state: z.enum([
        'agreement',
        'conflict',
        'deterministic-only',
        'nlp-only',
        'unknown',
      ]),
      deterministicValue: z.string().nullable(),
      nlpValues: z.array(z.string()),
      evidence: z.array(z.string()),
    }),
  ),
  authority: z.strictObject({
    score: z.literal('unchanged'),
    eligibility: z.literal('unchanged'),
    ranking: z.literal('unchanged'),
  }),
});

export type NlpComparisonReport = z.infer<typeof resultSchema>;

export function buildNlpComparisonReport(
  jobId: string,
  enrichment: JobNlpEnrichment,
  deterministic: JobIntelligenceDeterministicSide,
): NlpComparisonReport {
  const projection = projectJobIntelligence(jobId, enrichment, deterministic);
  const capabilities = CAPABILITIES.map((capability) => {
    const facts = projection.requirementFacts.filter(
      (fact) => fact.category === capability,
    );
    const deterministicValue = deterministicValueFor(capability, deterministic);
    return {
      capability,
      state: combinedState(
        facts.map((fact) => fact.deterministic.state),
        deterministicValue,
      ),
      deterministicValue,
      nlpValues: [
        ...new Set(
          facts.flatMap((fact) =>
            fact.entities.map((entity) => entity.normalized),
          ),
        ),
      ],
      evidence: facts.map((fact) => fact.evidence.segmentText),
    };
  });
  return resultSchema.parse({
    comparisonVersion: NLP_COMPARISON_VERSION,
    jobId,
    sourceTextHash: enrichment.sourceTextHash,
    generatedAt: enrichment.generatedAt,
    capabilities,
    authority: {
      score: 'unchanged',
      eligibility: 'unchanged',
      ranking: 'unchanged',
    },
  });
}

export function summarizeNlpComparisons(
  reports: readonly NlpComparisonReport[],
) {
  const rows = reports.flatMap((report) => report.capabilities);
  const byState = {
    agreement: rows.filter((row) => row.state === 'agreement').length,
    conflict: rows.filter((row) => row.state === 'conflict').length,
    deterministicOnly: rows.filter((row) => row.state === 'deterministic-only')
      .length,
    nlpOnly: rows.filter((row) => row.state === 'nlp-only').length,
    unknown: rows.filter((row) => row.state === 'unknown').length,
  };
  return {
    jobs: reports.length,
    comparisons: rows.length,
    byState,
    agreementRate: rate(byState.agreement, rows.length),
    conflictRate: rate(byState.conflict, rows.length),
  };
}

export interface NlpComparisonStore {
  save(report: NlpComparisonReport): void;
  get(jobId: string): NlpComparisonReport | null;
  isStale(jobId: string, sourceTextHash: string): boolean;
}

export function withNlpComparisonPersistence(
  database: JobDatabase,
  target: NlpPersistenceTarget,
  store: NlpComparisonStore,
): NlpPersistenceTarget {
  return {
    isStale(jobId, extractionVersion, sourceTextHash) {
      return (
        target.isStale(jobId, extractionVersion, sourceTextHash) ||
        store.isStale(jobId, sourceTextHash)
      );
    },
    save(jobId, enrichment) {
      target.save(jobId, enrichment);
      const deterministic = loadDeterministicSide(database, jobId);
      if (deterministic)
        store.save(buildNlpComparisonReport(jobId, enrichment, deterministic));
    },
  };
}

export function loadDeterministicSide(
  database: JobDatabase,
  jobId: string,
): JobIntelligenceDeterministicSide | null {
  const row = database
    .prepare<
      [string],
      {
        clearance_requirement: string | null;
        remote_type: string | null;
        location: string | null;
        estimated_experience_years: number | null;
      }
    >(
      `SELECT clearance_requirement, remote_type, location, estimated_experience_years
         FROM jobs WHERE id=?`,
    )
    .get(jobId);
  return row
    ? {
        clearanceRequirement: row.clearance_requirement,
        remoteType: row.remote_type,
        location: row.location,
        estimatedExperienceYears: row.estimated_experience_years,
      }
    : null;
}

export function parseNlpComparison(value: unknown): NlpComparisonReport {
  return resultSchema.parse(value);
}

function deterministicValueFor(
  capability: NlpComparisonCapability,
  deterministic: JobIntelligenceDeterministicSide,
): string | null {
  switch (capability) {
    case 'clearance':
      return deterministic.clearanceRequirement;
    case 'work-arrangement':
      return deterministic.remoteType;
    case 'experience':
      return deterministic.estimatedExperienceYears === null
        ? null
        : String(deterministic.estimatedExperienceYears);
  }
}

function combinedState(
  states: readonly NlpConflictState[],
  deterministicValue: string | null,
): NlpConflictState {
  if (states.includes('conflict')) return 'conflict';
  if (states.includes('agreement')) return 'agreement';
  if (states.includes('nlp-only') || states.includes('unknown'))
    return 'nlp-only';
  return deterministicValue === null ? 'unknown' : 'deterministic-only';
}

function rate(value: number, total: number): number {
  return total === 0 ? 0 : value / total;
}
