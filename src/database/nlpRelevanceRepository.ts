import type { JobDatabase } from '../db/database.js';
import {
  searchRelevanceDocumentSchema,
  type SearchRelevanceDocument,
} from '../intelligence/nlp/searchRelevance.js';
import { nowUtc } from '../utilities/timestamps.js';

interface RelevanceJsonRow {
  relevance_json: string;
}

export class NlpRelevanceRepository {
  public constructor(private readonly database: JobDatabase) {}

  public save(jobId: string, document: SearchRelevanceDocument): void {
    const validated = searchRelevanceDocumentSchema.parse(document);
    const timestamp = nowUtc();
    this.database
      .prepare(
        `INSERT INTO job_nlp_relevance (
           job_id, relevance_index_version, relevance_score, relevance_json, updated_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET
           relevance_index_version = excluded.relevance_index_version,
           relevance_score = excluded.relevance_score,
           relevance_json = excluded.relevance_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        jobId,
        validated.indexVersion,
        validated.score,
        JSON.stringify(validated),
        timestamp,
      );
  }

  public get(jobId: string): SearchRelevanceDocument | null {
    const row = this.database
      .prepare<
        [string],
        RelevanceJsonRow
      >('SELECT relevance_json FROM job_nlp_relevance WHERE job_id = ?')
      .get(jobId);
    if (row === undefined) return null;
    return searchRelevanceDocumentSchema.parse(
      JSON.parse(row.relevance_json) as unknown,
    );
  }
}
