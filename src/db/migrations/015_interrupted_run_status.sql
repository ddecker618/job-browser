-- Allow runs.status = 'interrupted' so a discovery stopped mid-run by the app
-- shutting down is recorded as a distinct non-failure state instead of 'failed'.
--
-- SQLite cannot alter a CHECK constraint, so the runs table is rebuilt. Because
-- other tables reference runs (job_sources.last_seen_run_id,
-- job_observations.run_id, identity_conflict_diagnostics.run_id), the rebuild's
-- implicit DELETE would null those columns via ON DELETE SET NULL; the linkage is
-- backed up first and restored afterward.

CREATE TABLE _runs_fk_backup (
  child_table TEXT NOT NULL,
  child_id TEXT NOT NULL,
  run_id TEXT,
  PRIMARY KEY (child_table, child_id)
);

INSERT INTO _runs_fk_backup (child_table, child_id, run_id)
SELECT 'job_observations', id, run_id
FROM job_observations
WHERE run_id IS NOT NULL;

INSERT INTO _runs_fk_backup (child_table, child_id, run_id)
SELECT 'identity_conflict_diagnostics', id, run_id
FROM identity_conflict_diagnostics
WHERE run_id IS NOT NULL;

INSERT INTO _runs_fk_backup (child_table, child_id, run_id)
SELECT 'job_sources', id, last_seen_run_id
FROM job_sources
WHERE last_seen_run_id IS NOT NULL;

PRAGMA defer_foreign_keys = ON;

CREATE TABLE runs_new (
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'interrupted')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  jobs_discovered INTEGER NOT NULL DEFAULT 0 CHECK (jobs_discovered >= 0),
  jobs_inserted INTEGER NOT NULL DEFAULT 0 CHECK (jobs_inserted >= 0),
  jobs_updated INTEGER NOT NULL DEFAULT 0 CHECK (jobs_updated >= 0),
  duplicates_found INTEGER NOT NULL DEFAULT 0 CHECK (duplicates_found >= 0),
  error_message TEXT,
  created_at TEXT NOT NULL,
  provider_id TEXT,
  search_parameters_json TEXT,
  execution_time_ms INTEGER CHECK (execution_time_ms IS NULL OR execution_time_ms >= 0),
  jobs_failed INTEGER NOT NULL DEFAULT 0 CHECK (jobs_failed >= 0),
  stack_trace TEXT,
  html_snapshot_path TEXT,
  trigger TEXT NOT NULL DEFAULT 'cli'
    CHECK (trigger IN ('cli', 'manual-job', 'manual-source', 'manual-all', 'scheduled')),
  requested_at TEXT,
  configuration_snapshot_json TEXT,
  duplicate_merges INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_merges >= 0),
  schedule_id TEXT,
  records_rejected INTEGER NOT NULL DEFAULT 0 CHECK (records_rejected >= 0),
  rediscoveries INTEGER NOT NULL DEFAULT 0 CHECK (rediscoveries >= 0),
  cross_source_merges INTEGER NOT NULL DEFAULT 0 CHECK (cross_source_merges >= 0),
  material_updates INTEGER NOT NULL DEFAULT 0 CHECK (material_updates >= 0),
  identity_conflicts INTEGER NOT NULL DEFAULT 0 CHECK (identity_conflicts >= 0),
  fetch_truncated INTEGER NOT NULL DEFAULT 0 CHECK (fetch_truncated IN (0, 1)),
  complete_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (complete_snapshot IN (0, 1)),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0)
);

INSERT INTO runs_new (
  id, source_id, status, started_at, completed_at, jobs_discovered,
  jobs_inserted, jobs_updated, duplicates_found, error_message, created_at,
  provider_id, search_parameters_json, execution_time_ms, jobs_failed,
  stack_trace, html_snapshot_path, trigger, requested_at,
  configuration_snapshot_json, duplicate_merges, schedule_id, records_rejected,
  rediscoveries, cross_source_merges, material_updates, identity_conflicts,
  fetch_truncated, complete_snapshot, retry_count
)
SELECT
  id, source_id, status, started_at, completed_at, jobs_discovered,
  jobs_inserted, jobs_updated, duplicates_found, error_message, created_at,
  provider_id, search_parameters_json, execution_time_ms, jobs_failed,
  stack_trace, html_snapshot_path, trigger, requested_at,
  configuration_snapshot_json, duplicate_merges, schedule_id, records_rejected,
  rediscoveries, cross_source_merges, material_updates, identity_conflicts,
  fetch_truncated, complete_snapshot, retry_count
FROM runs;

DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;

CREATE INDEX runs_provider_id_idx ON runs(provider_id, started_at);
CREATE INDEX runs_trigger_idx ON runs(trigger, started_at);
CREATE INDEX runs_source_started_idx ON runs(source_id, started_at DESC);
CREATE INDEX runs_status_started_idx ON runs(status, started_at);
CREATE INDEX runs_completed_metrics_idx
  ON runs(completed_at, jobs_inserted, rediscoveries, cross_source_merges);

PRAGMA defer_foreign_keys = OFF;

UPDATE job_observations SET run_id = (
  SELECT run_id FROM _runs_fk_backup
  WHERE child_table = 'job_observations' AND child_id = job_observations.id
) WHERE EXISTS (
  SELECT 1 FROM _runs_fk_backup
  WHERE child_table = 'job_observations' AND child_id = job_observations.id
);

UPDATE identity_conflict_diagnostics SET run_id = (
  SELECT run_id FROM _runs_fk_backup
  WHERE child_table = 'identity_conflict_diagnostics'
    AND child_id = identity_conflict_diagnostics.id
) WHERE EXISTS (
  SELECT 1 FROM _runs_fk_backup
  WHERE child_table = 'identity_conflict_diagnostics'
    AND child_id = identity_conflict_diagnostics.id
);

UPDATE job_sources SET last_seen_run_id = (
  SELECT run_id FROM _runs_fk_backup
  WHERE child_table = 'job_sources' AND child_id = job_sources.id
) WHERE EXISTS (
  SELECT 1 FROM _runs_fk_backup
  WHERE child_table = 'job_sources' AND child_id = job_sources.id
);

-- Reclassify runs that were previously marked failed only because the app
-- stopped mid-discovery so existing history reflects the non-failure state.
UPDATE runs SET status = 'interrupted'
 WHERE status = 'failed'
   AND error_message = 'Discovery was interrupted when Job Browser stopped';

DROP TABLE _runs_fk_backup;
