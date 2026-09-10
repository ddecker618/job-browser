import type { JobDatabase } from '../db/database.js';
import {
  jobNlpEnrichmentSchema,
  type JobNlpEnrichment,
} from '../schemas/job-nlp.js';
import { nowUtc } from '../utilities/timestamps.js';

interface EnrichmentRow {
  enrichment_json: string;
}

interface EnrichmentVersionRow {
  job_id: string;
}

export class JobNlpEnrichmentRepository {
  public constructor(private readonly database: JobDatabase) {}

  public save(jobId: string, enrichment: JobNlpEnrichment): void {
    const validated = jobNlpEnrichmentSchema.parse(enrichment);
    const timestamp = nowUtc();
    this.database
      .prepare(
        `INSERT INTO job_nlp_enrichments (
           job_id, extraction_version, source_text_hash, enrichment_json,
           generated_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET
           extraction_version = excluded.extraction_version,
           source_text_hash = excluded.source_text_hash,
           enrichment_json = excluded.enrichment_json,
           generated_at = excluded.generated_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        jobId,
        validated.version,
        validated.sourceTextHash,
        JSON.stringify(validated),
        validated.generatedAt,
        timestamp,
        timestamp,
      );
  }

  public get(jobId: string): JobNlpEnrichment | null {
    const row = this.database
      .prepare<
        [string],
        EnrichmentRow
      >('SELECT enrichment_json FROM job_nlp_enrichments WHERE job_id = ?')
      .get(jobId);
    if (row === undefined) return null;
    return jobNlpEnrichmentSchema.parse(
      JSON.parse(row.enrichment_json) as unknown,
    );
  }

  public isStale(
    jobId: string,
    extractionVersion: string,
    sourceTextHash: string,
  ): boolean {
    const row = this.database
      .prepare<
        [string],
        { extraction_version: string; source_text_hash: string }
      >(
        `SELECT extraction_version, source_text_hash
           FROM job_nlp_enrichments
          WHERE job_id = ?`,
      )
      .get(jobId);
    if (row === undefined) return true;
    return (
      row.extraction_version !== extractionVersion ||
      row.source_text_hash !== sourceTextHash
    );
  }

  public listStaleByVersion(extractionVersion: string): string[] {
    return this.database
      .prepare<[string], EnrichmentVersionRow>(
        `SELECT job_id
           FROM job_nlp_enrichments
          WHERE extraction_version <> ?
          ORDER BY job_id`,
      )
      .all(extractionVersion)
      .map((row) => row.job_id);
  }
}
