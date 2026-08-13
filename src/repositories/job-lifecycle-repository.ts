import type { JobDatabase } from '../db/database.js';
import {
  lifecycleFromEvidence,
  type ClosingDatePrecision,
  type ProviderLifecycleStatus,
} from '../domain/job-lifecycle.js';
import { nowUtc } from '../utilities/timestamps.js';

interface SourceEvidenceRow {
  id: string;
  job_id: string;
  closing_date: string | null;
  closing_date_precision: ClosingDatePrecision | null;
  provider_lifecycle_status: ProviderLifecycleStatus;
}

export class JobLifecycleRepository {
  public constructor(private readonly database: JobDatabase) {}

  public reconcileKnownClosures(
    asOf = nowUtc(),
    limit = 500,
  ): { checked: number; changed: number } {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError('Lifecycle reconciliation limit must be 1 through 1000');
    }
    const rows = this.database
      .prepare<[string, string, string, string, number], SourceEvidenceRow>(
        `SELECT id, job_id, closing_date, closing_date_precision,
                provider_lifecycle_status
           FROM job_sources
          WHERE (provider_lifecycle_status = 'closed' AND active = 1)
             OR (closing_date_precision = 'instant' AND (
                   (active = 1 AND closing_date <= ?)
                OR (active = 0 AND lifecycle_reason = 'closing-date-expired' AND closing_date > ?)
             ))
             OR (closing_date_precision = 'date' AND (
                   (active = 1 AND substr(closing_date, 1, 10) < substr(?, 1, 10))
                OR (active = 0 AND lifecycle_reason = 'closing-date-expired'
                    AND substr(closing_date, 1, 10) >= substr(?, 1, 10))
             ))
          ORDER BY COALESCE(closing_date, ''), id
          LIMIT ?`,
      )
      .all(asOf, asOf, asOf, asOf, limit);
    let changed = 0;
    this.database.transaction(() => {
      const affected = new Set<string>();
      for (const row of rows) {
        const lifecycle = lifecycleFromEvidence(
          {
            closingDate: row.closing_date,
            closingDatePrecision: row.closing_date_precision,
            providerLifecycleStatus: row.provider_lifecycle_status,
          },
          asOf,
        );
        const result = this.database
          .prepare(
            `UPDATE job_sources SET active = ?, lifecycle_reason = ?,
               removed_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(removed_at, ?) END
             WHERE id = ? AND (active <> ? OR lifecycle_reason <> ?)`,
          )
          .run(
            Number(lifecycle.active),
            lifecycle.reason,
            Number(lifecycle.active),
            asOf,
            row.id,
            Number(lifecycle.active),
            lifecycle.reason,
          );
        if (result.changes > 0) {
          changed += 1;
          affected.add(row.job_id);
        }
      }
      for (const jobId of affected) this.recomputeCanonical(jobId, asOf);
    })();
    return { checked: rows.length, changed };
  }

  public recomputeCanonical(jobId: string, changedAt = nowUtc()): void {
    this.database
      .prepare(
        `UPDATE jobs SET
           active = CASE WHEN EXISTS (
             SELECT 1 FROM job_sources WHERE job_sources.job_id = jobs.id AND active = 1
           ) THEN 1 ELSE 0 END,
           lifecycle_reason = CASE
             WHEN EXISTS (
               SELECT 1 FROM job_sources WHERE job_sources.job_id = jobs.id AND active = 1
             ) THEN 'active'
             WHEN EXISTS (
               SELECT 1 FROM job_sources WHERE job_sources.job_id = jobs.id
                 AND lifecycle_reason = 'unknown'
             ) THEN 'unknown'
             WHEN EXISTS (
               SELECT 1 FROM job_sources WHERE job_sources.job_id = jobs.id
                 AND lifecycle_reason = 'snapshot-missing'
             ) THEN 'snapshot-missing'
             WHEN EXISTS (
               SELECT 1 FROM job_sources WHERE job_sources.job_id = jobs.id
                 AND lifecycle_reason = 'provider-closed'
             ) THEN 'provider-closed'
             ELSE 'closing-date-expired'
           END,
           removed_at = CASE WHEN EXISTS (
             SELECT 1 FROM job_sources WHERE job_sources.job_id = jobs.id AND active = 1
           ) THEN NULL ELSE COALESCE(removed_at, ?) END
         WHERE id = ?`,
      )
      .run(changedAt, jobId);
  }
}
