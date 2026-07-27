ALTER TABLE jobs ADD COLUMN fingerprint TEXT;

CREATE UNIQUE INDEX jobs_fingerprint_unique
  ON jobs(fingerprint)
  WHERE fingerprint IS NOT NULL;

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('applied', 'interview', 'rejected', 'offer')),
  applied_at TEXT,
  last_event_at TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO applications (
  id, job_id, status, applied_at, last_event_at, notes, created_at, updated_at
)
SELECT
  id, id, status,
  CASE WHEN status = 'applied' THEN first_seen_at ELSE NULL END,
  updated_at, 'Migrated from existing job status', created_at, updated_at
FROM jobs
WHERE status IN ('applied', 'interview', 'rejected', 'offer');

CREATE TABLE provider_metadata (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL UNIQUE,
  provider_name TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  configuration_json TEXT,
  last_successful_run TEXT,
  last_failure TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE runs ADD COLUMN provider_id TEXT;
ALTER TABLE runs ADD COLUMN search_parameters_json TEXT;
ALTER TABLE runs ADD COLUMN execution_time_ms INTEGER CHECK (execution_time_ms IS NULL OR execution_time_ms >= 0);
ALTER TABLE runs ADD COLUMN jobs_failed INTEGER NOT NULL DEFAULT 0 CHECK (jobs_failed >= 0);
ALTER TABLE runs ADD COLUMN stack_trace TEXT;
ALTER TABLE runs ADD COLUMN html_snapshot_path TEXT;

ALTER TABLE job_sources ADD COLUMN provider_id TEXT;

CREATE INDEX runs_provider_id_idx ON runs(provider_id, started_at);
CREATE INDEX job_sources_provider_id_idx ON job_sources(provider_id);
