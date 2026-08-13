import { randomUUID } from 'node:crypto';

import type { JobDatabase } from '../db/database.js';
import type {
  DiscoveryOptions,
  DiscoverySummary,
  DiscoveryTrigger,
  SearchRequest,
} from '../models/discovery.js';
import type { ConfiguredSource } from '../models/source-management.js';
import type { JobProvider } from '../providers/baseProvider.js';
import { nowUtc } from '../utilities/timestamps.js';
import { JobLifecycleRepository } from '../repositories/job-lifecycle-repository.js';

export interface DiscoveryRun {
  runId: string;
  sourceId: string;
  startedAt: string;
}

export interface FailedRunDetails {
  executionTimeMs: number;
  errorMessage: string;
  stackTrace: string | null;
  htmlSnapshotPath: string | null;
}

export class DiscoveryStore {
  public constructor(private readonly database: JobDatabase) {}

  public startRun(
    provider: JobProvider,
    request: SearchRequest,
    options: DiscoveryOptions,
  ): DiscoveryRun {
    const runId = randomUUID();
    const sourceId = options.sourceId ?? `provider:${provider.id}`;
    const timestamp = nowUtc();

    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO provider_metadata (
            id, provider_id, provider_name, enabled, configuration_json,
            last_successful_run, last_failure, failure_count, created_at, updated_at,
            provider_type, capabilities_json, credential_requirement
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(provider_id) DO UPDATE SET
            provider_name = excluded.provider_name,
            provider_type = excluded.provider_type,
            capabilities_json = excluded.capabilities_json,
            updated_at = excluded.updated_at`,
        )
        .run(
          `metadata:${provider.id}`,
          provider.id,
          provider.name,
          1,
          options.configuration === undefined
            ? null
            : JSON.stringify(options.configuration),
          null,
          null,
          0,
          timestamp,
          timestamp,
          provider.type,
          JSON.stringify(provider.capabilities),
          provider.capabilities.requiresCredentials
            ? 'desktop-safe-storage'
            : null,
        );
      this.database
        .prepare(
          `INSERT INTO sources (
            id, employer, source_type, careers_url, enabled, connector,
            last_successful_run, last_failure, failure_count, created_at, updated_at,
            display_name, provider_id, configuration_json, search_criteria_json,
            configuration_status, health_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            updated_at = excluded.updated_at`,
        )
        .run(
          sourceId,
          provider.name,
          'provider',
          null,
          1,
          provider.id,
          null,
          null,
          0,
          timestamp,
          timestamp,
          provider.name,
          provider.id,
          JSON.stringify(options.configuration ?? {}),
          JSON.stringify(request),
          'valid',
          'never-run',
        );
      this.database
        .prepare(
          `INSERT INTO runs (
            id, source_id, status, started_at, completed_at, jobs_discovered,
            jobs_inserted, jobs_updated, duplicates_found, error_message, created_at,
            provider_id, search_parameters_json, execution_time_ms, jobs_failed,
            stack_trace, html_snapshot_path, trigger, requested_at,
            configuration_snapshot_json, duplicate_merges, schedule_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          sourceId,
          'running',
          timestamp,
          null,
          0,
          0,
          0,
          0,
          null,
          timestamp,
          provider.id,
          JSON.stringify(request),
          null,
          0,
          null,
          null,
          options.trigger ?? 'cli',
          timestamp,
          JSON.stringify(options.configuration ?? {}),
          0,
          null,
        );
    })();

    return { runId, sourceId, startedAt: timestamp };
  }

  public recordPreflightFailure(
    source: ConfiguredSource | null,
    requestedSourceId: string,
    trigger: DiscoveryTrigger,
    error: unknown,
  ): string {
    const runId = randomUUID();
    const timestamp = nowUtc();
    const message = error instanceof Error ? error.message : String(error);
    const stackTrace = error instanceof Error ? (error.stack ?? null) : null;

    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO runs (
            id, source_id, status, started_at, completed_at, jobs_discovered,
            jobs_inserted, jobs_updated, duplicates_found, error_message, created_at,
            provider_id, search_parameters_json, execution_time_ms, jobs_failed,
            stack_trace, html_snapshot_path, trigger, requested_at,
            configuration_snapshot_json, duplicate_merges, schedule_id
          ) VALUES (?, ?, 'failed', ?, ?, 0, 0, 0, 0, ?, ?, ?, ?, 0, 0, ?, NULL, ?, ?, ?, 0, NULL)`,
        )
        .run(
          runId,
          source?.id ?? null,
          timestamp,
          timestamp,
          message,
          timestamp,
          source?.providerId ?? null,
          source === null ? null : JSON.stringify(source.searchCriteria),
          stackTrace,
          trigger,
          timestamp,
          source === null
            ? JSON.stringify({ requestedSourceId })
            : JSON.stringify(source.configuration),
        );
      if (source !== null) {
        this.database
          .prepare(
            `UPDATE sources SET last_failure = ?, failure_count = failure_count + 1,
              updated_at = ? WHERE id = ?`,
          )
          .run(message, timestamp, source.id);
        if (source.providerId !== null) {
          this.database
            .prepare(
              `UPDATE provider_metadata SET last_failure = ?,
                failure_count = failure_count + 1, updated_at = ?
               WHERE provider_id = ?`,
            )
            .run(message, timestamp, source.providerId);
        }
      }
    })();
    return runId;
  }

  public completeRun(summary: DiscoverySummary): void {
    const completedAt = nowUtc();
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE runs SET
            status = 'succeeded', completed_at = ?, jobs_discovered = ?,
            jobs_inserted = ?, jobs_updated = ?, duplicates_found = ?,
             execution_time_ms = ?, jobs_failed = ?, duplicate_merges = ?,
             records_rejected = ?, rediscoveries = ?, cross_source_merges = ?,
             material_updates = ?, identity_conflicts = ?, fetch_truncated = ?,
             complete_snapshot = ?, retry_count = ?
           WHERE id = ?`,
        )
        .run(
          completedAt,
          summary.jobsFound,
          summary.jobsInserted,
          summary.jobsUpdated,
          summary.duplicatesDetected,
          summary.executionTimeMs,
          summary.jobsFailed,
          summary.duplicatesMerged,
          summary.recordsRejected,
          summary.rediscoveries,
          summary.crossSourceMerges,
          summary.materialUpdates,
          summary.identityConflicts,
          Number(summary.fetchTruncated),
          Number(summary.completeSnapshot),
          summary.retryCount,
          summary.runId,
        );
      this.database
        .prepare(
          `UPDATE provider_metadata SET
            last_successful_run = ?, last_failure = NULL, failure_count = 0, updated_at = ?
           WHERE provider_id = ?`,
        )
        .run(completedAt, completedAt, summary.providerId);
      this.database
        .prepare(
          `UPDATE sources SET
            last_successful_run = ?, last_failure = NULL, failure_count = 0, updated_at = ?
           WHERE id = ?`,
        )
        .run(completedAt, completedAt, summary.sourceId);
      if (summary.completeSnapshot) {
        this.reconcileCompleteSnapshot(
          summary.sourceId,
          summary.runId,
          completedAt,
        );
      }
    })();
  }

  public interruptRun(
    providerId: string,
    sourceId: string,
    runId: string,
    details: FailedRunDetails,
  ): void {
    const completedAt = nowUtc();
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE runs SET
            status = 'interrupted', completed_at = ?, error_message = ?,
            execution_time_ms = ?, stack_trace = ?, html_snapshot_path = ?
           WHERE id = ?`,
        )
        .run(
          completedAt,
          details.errorMessage,
          details.executionTimeMs,
          details.stackTrace,
          details.htmlSnapshotPath,
          runId,
        );
    })();
  }

  public failRun(
    providerId: string,
    sourceId: string,
    runId: string,
    details: FailedRunDetails,
  ): void {
    const completedAt = nowUtc();
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE runs SET
            status = 'failed', completed_at = ?, error_message = ?,
            execution_time_ms = ?, stack_trace = ?, html_snapshot_path = ?
           WHERE id = ?`,
        )
        .run(
          completedAt,
          details.errorMessage,
          details.executionTimeMs,
          details.stackTrace,
          details.htmlSnapshotPath,
          runId,
        );
      this.database
        .prepare(
          `UPDATE provider_metadata SET
            last_failure = ?, failure_count = failure_count + 1, updated_at = ?
           WHERE provider_id = ?`,
        )
        .run(details.errorMessage, completedAt, providerId);
      this.database
        .prepare(
          `UPDATE sources SET
            last_failure = ?, failure_count = failure_count + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(details.errorMessage, completedAt, sourceId);
    })();
  }

  private reconcileCompleteSnapshot(
    sourceId: string,
    runId: string,
    verifiedAt: string,
  ): void {
    this.database
      .prepare(
        `UPDATE job_sources SET consecutive_snapshot_misses = 0,
           active = active
         WHERE source_id = ? AND last_seen_run_id = ?`,
      )
      .run(sourceId, runId);
    this.database
      .prepare(
        `UPDATE job_sources SET
           consecutive_snapshot_misses = consecutive_snapshot_misses + 1,
           active = CASE WHEN consecutive_snapshot_misses + 1 >= 2 THEN 0 ELSE active END,
           lifecycle_reason = CASE
             WHEN consecutive_snapshot_misses + 1 >= 2
               AND lifecycle_reason NOT IN ('closing-date-expired', 'provider-closed')
             THEN 'snapshot-missing' ELSE lifecycle_reason END,
           removed_at = CASE WHEN consecutive_snapshot_misses + 1 >= 2
             THEN COALESCE(removed_at, ?) ELSE removed_at END
         WHERE source_id = ? AND (last_seen_run_id IS NULL OR last_seen_run_id <> ?)`,
      )
      .run(verifiedAt, sourceId, runId);
    const lifecycle = new JobLifecycleRepository(this.database);
    const affected = this.database
      .prepare<[string], { job_id: string }>(
        'SELECT DISTINCT job_id FROM job_sources WHERE source_id = ?',
      )
      .all(sourceId);
    for (const row of affected) {
      lifecycle.recomputeCanonical(row.job_id, verifiedAt);
    }
    this.database
      .prepare(
        `UPDATE sources SET last_complete_snapshot_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(verifiedAt, verifiedAt, sourceId);
  }
}
