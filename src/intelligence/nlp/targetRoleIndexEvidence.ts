import type { JobDatabase } from '../../db/database.js';
import { jobNlpEnrichmentSchema } from '../../schemas/job-nlp.js';
import { documentHash, MAX_NLP_DOCUMENT_CHARACTERS } from './document.js';
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
/** Indexed skills explain already-matched roles; never widen membership.
 * Stale, corrupt, or partially updated indexes fall back to title evidence.
 */
export function targetRoleIndexEvidence(
  database: JobDatabase,
  ids: readonly string[],
): Map<string, { skill: string; evidence: string }[]> {
  const result = new Map<string, { skill: string; evidence: string }[]>();
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
      const length =
        parts.title.length +
        (parts.location?.length ?? 0) +
        (parts.description?.length ?? 0) +
        (parts.requirements?.length ?? 0) +
        (parts.preferredQualifications?.length ?? 0);
      if (length > MAX_NLP_DOCUMENT_CHARACTERS) continue;
      const parsed = jobNlpEnrichmentSchema.safeParse(
        JSON.parse(row.enrichment_json) as unknown,
      );
      const index = searchRelevanceDocumentSchema.safeParse(
        JSON.parse(row.relevance_json) as unknown,
      );
      if (
        !parsed.success ||
        !index.success ||
        parsed.data.sourceTextHash !== documentHash(parts)
      )
        continue;
      if (
        JSON.stringify(index.data) !==
        JSON.stringify(deriveSearchRelevance(parsed.data))
      )
        continue;
      const evidence = index.data.topSkills.flatMap((skill) => {
        const fact = parsed.data.facts.find(
          (f) =>
            f.category === 'skill' &&
            f.meta?.isBoilerplate !== true &&
            f.entities.some((e) => e.normalized === skill),
        );
        if (!fact) return [];
        const source = parts[fact.evidence.sourceField as keyof typeof parts];
        if (
          source == null ||
          source.slice(fact.evidence.charStart, fact.evidence.charEnd) !==
            fact.evidence.segmentText
        )
          return [];
        return [{ skill, evidence: fact.evidence.segmentText }];
      });
      if (evidence.length) result.set(row.id, evidence);
    } catch {
      /* Invalid derived evidence cannot break ordinary search. */
    }
  }
  return result;
}
