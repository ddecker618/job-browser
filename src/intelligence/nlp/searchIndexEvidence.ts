import type { JobDatabase } from '../../db/database.js';
import { jobNlpEnrichmentSchema } from '../../schemas/job-nlp.js';
import { redactSensitiveText } from './inspector.js';
import { documentHash, MAX_NLP_DOCUMENT_CHARACTERS } from './document.js';
import { normalizeSkillPhrase } from './skillNormalization.js';
import {
  deriveSearchRelevance,
  searchRelevanceDocumentSchema,
} from './searchRelevance.js';

interface IndexedRow {
  id: string;
  title: string;
  location: string | null;
  description: string | null;
  requirements: string | null;
  preferred_qualifications: string | null;
  enrichment_json: string;
  relevance_json: string;
}

export interface SearchIndexEvidenceSpan {
  category: string;
  label: string;
  evidence: string;
  sourceField: string;
  charStart: number;
  charEnd: number;
}

export interface ValidatedSearchIndexEvidence {
  score: number;
  indexVersion: string;
  sourceTextHash: string;
  evidence: SearchIndexEvidenceSpan[];
}

/** Returns only indexes that reproduce from the current job text and whose
 * evidence spans still resolve exactly. Invalid rows never become UI claims. */
export function validatedSearchIndexEvidence(
  database: JobDatabase,
  ids: readonly string[],
): Map<string, ValidatedSearchIndexEvidence> {
  const result = new Map<string, ValidatedSearchIndexEvidence>();
  if (ids.length === 0) return result;
  const rows = database
    .prepare<
      unknown[],
      IndexedRow
    >('SELECT j.id,j.title,j.location,j.description,j.requirements,j.preferred_qualifications,e.enrichment_json,r.relevance_json FROM jobs j JOIN job_nlp_enrichments e ON e.job_id=j.id JOIN job_nlp_relevance r ON r.job_id=j.id WHERE j.id IN (' + ids.map(() => '?').join(',') + ')')
    .all(...ids);
  for (const row of rows) {
    try {
      const parts = {
        title: row.title,
        location: row.location,
        description: row.description,
        requirements: row.requirements,
        preferredQualifications: row.preferred_qualifications,
      };
      const length = Object.values(parts).reduce(
        (total, value) => total + (value?.length ?? 0),
        0,
      );
      if (length > MAX_NLP_DOCUMENT_CHARACTERS) continue;
      const enrichment = jobNlpEnrichmentSchema.safeParse(
        JSON.parse(row.enrichment_json) as unknown,
      );
      const index = searchRelevanceDocumentSchema.safeParse(
        JSON.parse(row.relevance_json) as unknown,
      );
      const currentHash = documentHash(parts);
      if (
        !enrichment.success ||
        !index.success ||
        enrichment.data.sourceTextHash !== currentHash ||
        index.data.sourceTextHash !== currentHash ||
        JSON.stringify(index.data) !==
          JSON.stringify(deriveSearchRelevance(enrichment.data))
      )
        continue;
      const evidence: SearchIndexEvidenceSpan[] = [];
      for (const fact of enrichment.data.facts) {
        if (fact.meta?.isBoilerplate === true) continue;
        const source = parts[fact.evidence.sourceField as keyof typeof parts];
        if (
          source == null ||
          source.slice(fact.evidence.charStart, fact.evidence.charEnd) !==
            fact.evidence.segmentText
        )
          continue;
        const labels = fact.entities.flatMap((entity) => {
          if (fact.category === 'skill') {
            const canonical = normalizeSkillPhrase(entity.raw).conceptLabel;
            return canonical !== null &&
              index.data.topSkills.includes(canonical)
              ? [canonical]
              : [];
          }
          const signal =
            fact.category === 'clearance'
              ? index.data.signals.clearances
              : fact.category === 'certification'
                ? index.data.signals.certifications
                : fact.category === 'education'
                  ? index.data.signals.educationLevels
                  : [];
          return signal.includes(entity.normalized) ? [entity.normalized] : [];
        });
        for (const label of labels) {
          evidence.push({
            category: fact.category,
            label,
            evidence: redactSensitiveText(fact.evidence.segmentText).value,
            sourceField: fact.evidence.sourceField,
            charStart: fact.evidence.charStart,
            charEnd: fact.evidence.charEnd,
          });
        }
      }
      if (evidence.length === 0 && index.data.score > 0) continue;
      result.set(row.id, {
        score: index.data.score,
        indexVersion: index.data.indexVersion,
        sourceTextHash: currentHash,
        evidence: evidence.slice(0, 8),
      });
    } catch {
      continue;
    }
  }
  return result;
}
