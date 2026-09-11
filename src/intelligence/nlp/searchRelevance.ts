import { z } from 'zod';
import type { JobNlpEnrichment } from '../../schemas/job-nlp.js';
import type { NlpPersistenceTarget } from './reprocessing.js';

// ---------------------------------------------------------------------------
// P6 - additive NLP search relevance index (ENRICHMENT level).
//
// Derives a compact, deterministic relevance document from the stored
// enrichment envelope (canonical skills, clearance/certification/education
// signals) and a bounded 0..1 score. This is used solely as a ranking
// tie-break inside JobSearchRepository behind an off-by-default flag; it
// never changes the production result set, the sort-key logic, filter
// semantics, or any score/eligibility/lifecycle column.
// ---------------------------------------------------------------------------

export const SEARCH_RELEVANCE_INDEX_VERSION = 'job-search-relevance-v1';

const MAX_CANONICAL_SKILLS = 8;
const MAX_SIGNALS = 5;

export interface SearchRelevanceSignals {
  clearances: string[];
  certifications: string[];
  educationLevels: string[];
}

export interface SearchRelevanceDocument {
  indexVersion: typeof SEARCH_RELEVANCE_INDEX_VERSION;
  skillCount: number;
  canonicalSkills: string[];
  topSkills: string[];
  signals: SearchRelevanceSignals;
  score: number;
}

export const searchRelevanceDocumentSchema: z.ZodType<SearchRelevanceDocument> =
  z.object({
    indexVersion: z.literal(SEARCH_RELEVANCE_INDEX_VERSION),
    skillCount: z.number().int().nonnegative(),
    canonicalSkills: z.array(z.string()),
    topSkills: z.array(z.string()),
    signals: z.object({
      clearances: z.array(z.string()),
      certifications: z.array(z.string()),
      educationLevels: z.array(z.string()),
    }),
    score: z.number().min(0).max(1),
  });

export function deriveSearchRelevance(
  enrichment: JobNlpEnrichment,
): SearchRelevanceDocument {
  const skillFrequency = new Map<string, number>();
  const clearances = new Set<string>();
  const certifications = new Set<string>();
  const educationLevels = new Set<string>();

  for (const fact of enrichment.facts) {
    if (fact.meta?.isBoilerplate === true) continue;
    for (const entity of fact.entities) {
      const value = entity.normalized.trim();
      if (value.length === 0) continue;
      if (fact.category === 'skill') {
        skillFrequency.set(value, (skillFrequency.get(value) ?? 0) + 1);
      } else if (fact.category === 'clearance') {
        clearances.add(value);
      } else if (fact.category === 'certification') {
        certifications.add(value);
      } else if (fact.category === 'education') {
        educationLevels.add(value);
      }
    }
  }

  const byFrequencyThenAlpha = (left: string, right: string): number =>
    (skillFrequency.get(right) ?? 0) - (skillFrequency.get(left) ?? 0) ||
    left.localeCompare(right);
  const canonicalSkills = [...skillFrequency.keys()].sort(byFrequencyThenAlpha);
  const topSkills = canonicalSkills.slice(0, MAX_CANONICAL_SKILLS);

  const orderedClearances = [...clearances].sort();
  const orderedCertifications = [...certifications].sort();
  const orderedEducation = [...educationLevels].sort();

  const skillScore = Math.min(1, canonicalSkills.length / MAX_CANONICAL_SKILLS);
  const signalCount = Math.min(
    MAX_SIGNALS,
    orderedClearances.slice(0, 2).length +
      orderedCertifications.length +
      orderedEducation.length,
  );
  const signalScore = signalCount / MAX_SIGNALS;
  const score =
    Math.round((0.5 * skillScore + 0.5 * signalScore) * 1000) / 1000;

  return {
    indexVersion: SEARCH_RELEVANCE_INDEX_VERSION,
    skillCount: canonicalSkills.length,
    canonicalSkills,
    topSkills,
    signals: {
      clearances: orderedClearances,
      certifications: orderedCertifications,
      educationLevels: orderedEducation,
    },
    score,
  };
}

export interface SearchRelevanceStore {
  save(jobId: string, document: SearchRelevanceDocument): void;
  get(jobId: string): SearchRelevanceDocument | null;
}

// Composite persistence target used by the background worker: saving an
// enrichment also refreshes the derived relevance index for the same job.
export function withSearchRelevanceIndex(
  enrichmentTarget: NlpPersistenceTarget,
  relevanceStore: SearchRelevanceStore,
): NlpPersistenceTarget {
  return {
    save(jobId: string, enrichment: JobNlpEnrichment): void {
      enrichmentTarget.save(jobId, enrichment);
      relevanceStore.save(jobId, deriveSearchRelevance(enrichment));
    },
    isStale: (jobId, extractionVersion, sourceTextHash) =>
      enrichmentTarget.isStale(jobId, extractionVersion, sourceTextHash),
  };
}
