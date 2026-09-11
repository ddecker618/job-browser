import type { JobDatabase } from '../db/database.js';
import {
  NLP_COMPARISON_VERSION,
  parseNlpComparison,
  type NlpComparisonReport,
  type NlpComparisonStore,
} from '../intelligence/nlp/comparison.js';
import { nowUtc } from '../utilities/timestamps.js';

export class NlpComparisonRepository implements NlpComparisonStore {
  public constructor(private readonly database: JobDatabase) {}

  public save(report: NlpComparisonReport): void {
    const validated = parseNlpComparison(report);
    const timestamp = nowUtc();
    this.database
      .prepare(
        `
      INSERT INTO job_nlp_comparisons (
        job_id, comparison_version, source_text_hash, comparison_json,
        generated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        comparison_version=excluded.comparison_version,
        source_text_hash=excluded.source_text_hash,
        comparison_json=excluded.comparison_json,
        generated_at=excluded.generated_at,
        updated_at=excluded.updated_at
    `,
      )
      .run(
        validated.jobId,
        validated.comparisonVersion,
        validated.sourceTextHash,
        JSON.stringify(validated),
        validated.generatedAt,
        timestamp,
        timestamp,
      );
  }

  public get(jobId: string): NlpComparisonReport | null {
    const row = this.database
      .prepare<
        [string],
        { comparison_json: string }
      >('SELECT comparison_json FROM job_nlp_comparisons WHERE job_id=?')
      .get(jobId);
    if (!row) return null;
    return parseNlpComparison(JSON.parse(row.comparison_json) as unknown);
  }

  public isStale(jobId: string, sourceTextHash: string): boolean {
    const row = this.database
      .prepare<
        [string],
        { comparison_version: string; source_text_hash: string }
      >('SELECT comparison_version, source_text_hash FROM job_nlp_comparisons WHERE job_id=?')
      .get(jobId);
    return (
      row?.comparison_version !== NLP_COMPARISON_VERSION ||
      row.source_text_hash !== sourceTextHash
    );
  }

  public list(): NlpComparisonReport[] {
    return this.database
      .prepare<[], { comparison_json: string }>(
        'SELECT comparison_json FROM job_nlp_comparisons ORDER BY job_id',
      )
      .all()
      .map((row) =>
        parseNlpComparison(JSON.parse(row.comparison_json) as unknown),
      );
  }
}
