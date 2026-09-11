import type { JobDatabase } from '../../db/database.js';
import { documentHash } from './document.js';
import type { ReprocessingCandidate } from './reprocessing.js';
import type { RoleDescriptionParts } from './segmenter.js';

// ---------------------------------------------------------------------------
// P4 - database-backed candidate source for the background NLP worker.
//
// Reads only the NLP-relevant posting fields from the jobs table. It never
// writes to the jobs table and never touches scoring, eligibility, ranking,
// filtering, or lifecycle columns.
// ---------------------------------------------------------------------------

interface JobNlpPartsRow {
  id: string;
  title: string | null;
  location: string | null;
  description: string | null;
  requirements: string | null;
  preferred_qualifications: string | null;
}

interface CountRow {
  count: number;
}

export interface JobNlpCandidateSource {
  page(afterJobId: string | null, limit: number): ReprocessingCandidate[];
  load(jobId: string): RoleDescriptionParts | null;
  countJobs(): number;
  countMissingOrVersionMismatch(extractionVersion: string): number;
}

export class DatabaseJobNlpCandidateSource implements JobNlpCandidateSource {
  public constructor(private readonly database: JobDatabase) {}

  public page(
    afterJobId: string | null,
    limit: number,
  ): ReprocessingCandidate[] {
    validateLimit(limit);
    const rows =
      afterJobId === null
        ? this.database
            .prepare<[number], JobNlpPartsRow>(
              `SELECT id, title, location, description, requirements, preferred_qualifications
                 FROM jobs
                ORDER BY id COLLATE BINARY
                LIMIT ?`,
            )
            .all(limit)
        : this.database
            .prepare<[string, number], JobNlpPartsRow>(
              `SELECT id, title, location, description, requirements, preferred_qualifications
                 FROM jobs
                WHERE id > ?
                ORDER BY id COLLATE BINARY
                LIMIT ?`,
            )
            .all(afterJobId, limit);
    return rows.map((row) => ({
      jobId: row.id,
      sourceTextHash: documentHash(partsFromRow(row)),
    }));
  }

  public load(jobId: string): RoleDescriptionParts | null {
    const row = this.database
      .prepare<[string], JobNlpPartsRow>(
        `SELECT id, title, location, description, requirements, preferred_qualifications
           FROM jobs
          WHERE id = ?`,
      )
      .get(jobId);
    return row === undefined ? null : partsFromRow(row);
  }

  public countJobs(): number {
    const row = this.database
      .prepare<[], CountRow>('SELECT COUNT(*) AS count FROM jobs')
      .get();
    return row?.count ?? 0;
  }

  public countMissingOrVersionMismatch(extractionVersion: string): number {
    const missing = this.database
      .prepare<[], CountRow>(
        `SELECT COUNT(*) AS count
           FROM jobs AS j
           LEFT JOIN job_nlp_enrichments AS e ON e.job_id = j.id
          WHERE e.job_id IS NULL`,
      )
      .get();
    const mismatched = this.database
      .prepare<[string], CountRow>(
        `SELECT COUNT(*) AS count
           FROM job_nlp_enrichments
          WHERE extraction_version <> ?`,
      )
      .get(extractionVersion);
    return (missing?.count ?? 0) + (mismatched?.count ?? 0);
  }
}

function partsFromRow(row: JobNlpPartsRow): RoleDescriptionParts {
  return {
    title: row.title ?? '',
    location: row.location,
    description: row.description,
    requirements: row.requirements,
    preferredQualifications: row.preferred_qualifications,
  };
}

function validateLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Candidate page limit must be a positive integer');
  }
}
