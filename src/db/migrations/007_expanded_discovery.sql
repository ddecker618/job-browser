ALTER TABLE runs ADD COLUMN records_rejected INTEGER NOT NULL DEFAULT 0 CHECK (records_rejected >= 0);
ALTER TABLE runs ADD COLUMN rediscoveries INTEGER NOT NULL DEFAULT 0 CHECK (rediscoveries >= 0);
ALTER TABLE runs ADD COLUMN cross_source_merges INTEGER NOT NULL DEFAULT 0 CHECK (cross_source_merges >= 0);
ALTER TABLE runs ADD COLUMN material_updates INTEGER NOT NULL DEFAULT 0 CHECK (material_updates >= 0);
ALTER TABLE runs ADD COLUMN identity_conflicts INTEGER NOT NULL DEFAULT 0 CHECK (identity_conflicts >= 0);
ALTER TABLE runs ADD COLUMN fetch_truncated INTEGER NOT NULL DEFAULT 0 CHECK (fetch_truncated IN (0, 1));
ALTER TABLE runs ADD COLUMN complete_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (complete_snapshot IN (0, 1));
ALTER TABLE runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0);

ALTER TABLE jobs ADD COLUMN last_verified_at TEXT;
ALTER TABLE jobs ADD COLUMN discovery_count INTEGER NOT NULL DEFAULT 1 CHECK (discovery_count >= 1);
ALTER TABLE jobs ADD COLUMN materially_updated_at TEXT;
ALTER TABLE jobs ADD COLUMN removed_at TEXT;
ALTER TABLE jobs ADD COLUMN provider_confidence REAL CHECK (provider_confidence IS NULL OR (provider_confidence >= 0 AND provider_confidence <= 1));

UPDATE jobs SET last_verified_at = last_seen_at WHERE last_verified_at IS NULL;

ALTER TABLE job_sources ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));
ALTER TABLE job_sources ADD COLUMN last_verified_at TEXT;
ALTER TABLE job_sources ADD COLUMN discovery_count INTEGER NOT NULL DEFAULT 1 CHECK (discovery_count >= 1);
ALTER TABLE job_sources ADD COLUMN materially_updated_at TEXT;
ALTER TABLE job_sources ADD COLUMN removed_at TEXT;
ALTER TABLE job_sources ADD COLUMN consecutive_snapshot_misses INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_snapshot_misses >= 0);
ALTER TABLE job_sources ADD COLUMN content_hash TEXT;
ALTER TABLE job_sources ADD COLUMN provider_confidence REAL CHECK (provider_confidence IS NULL OR (provider_confidence >= 0 AND provider_confidence <= 1));
ALTER TABLE job_sources ADD COLUMN last_seen_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL;

UPDATE job_sources SET last_verified_at = last_seen_at WHERE last_verified_at IS NULL;

ALTER TABLE sources ADD COLUMN archived_at TEXT;
ALTER TABLE sources ADD COLUMN last_complete_snapshot_at TEXT;

CREATE TABLE identity_conflict_diagnostics (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  provider_id TEXT,
  selected_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  conflicting_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  signal_types TEXT NOT NULL,
  external_id_hash TEXT,
  canonical_url_hash TEXT,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX identity_conflicts_run_idx ON identity_conflict_diagnostics(run_id, created_at);
CREATE INDEX identity_conflicts_source_idx ON identity_conflict_diagnostics(source_id, created_at);
CREATE INDEX runs_source_started_idx ON runs(source_id, started_at DESC);
CREATE INDEX runs_status_started_idx ON runs(status, started_at);
CREATE INDEX runs_completed_metrics_idx ON runs(completed_at, jobs_inserted, rediscoveries, cross_source_merges);
CREATE INDEX jobs_lifecycle_idx ON jobs(active, last_verified_at, removed_at);
CREATE INDEX jobs_search_identity_idx ON jobs(normalized_company, normalized_title, active);
CREATE INDEX jobs_external_identity_idx ON jobs(normalized_company, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX job_sources_source_lifecycle_idx ON job_sources(source_id, active, consecutive_snapshot_misses);
CREATE INDEX job_sources_run_idx ON job_sources(last_seen_run_id) WHERE last_seen_run_id IS NOT NULL;
CREATE INDEX job_sources_job_active_idx ON job_sources(job_id, active);
CREATE INDEX job_sources_content_hash_idx ON job_sources(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX job_sources_provider_external_idx ON job_sources(source_id, provider_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX sources_active_provider_idx ON sources(archived_at, enabled, provider_id);
CREATE INDEX sources_complete_snapshot_idx ON sources(last_complete_snapshot_at);
CREATE INDEX jobs_first_seen_id_idx ON jobs(first_seen_at DESC, id);
CREATE INDEX jobs_verified_id_idx ON jobs(last_verified_at DESC, id);
CREATE INDEX jobs_score_first_seen_id_idx ON jobs(score DESC, first_seen_at DESC, id);
CREATE INDEX jobs_active_status_idx ON jobs(active, status, id);
CREATE INDEX jobs_closing_idx ON jobs(closing_date, id) WHERE closing_date IS NOT NULL;
CREATE INDEX jobs_material_updates_idx ON jobs(materially_updated_at DESC, id)
  WHERE materially_updated_at IS NOT NULL;
CREATE INDEX jobs_recommendation_idx ON jobs(recommendation, id);
CREATE INDEX jobs_company_search_idx ON jobs(company COLLATE NOCASE, id);
CREATE INDEX jobs_location_search_idx ON jobs(location COLLATE NOCASE, id);
CREATE INDEX jobs_remote_type_idx ON jobs(remote_type, id);
CREATE INDEX job_sources_provider_job_idx ON job_sources(provider_id, job_id);
CREATE INDEX job_sources_source_job_idx ON job_sources(source_id, job_id);
