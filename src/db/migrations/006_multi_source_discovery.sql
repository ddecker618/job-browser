ALTER TABLE sources ADD COLUMN display_name TEXT;
ALTER TABLE sources ADD COLUMN provider_id TEXT;
ALTER TABLE sources ADD COLUMN configuration_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE sources ADD COLUMN search_criteria_json TEXT NOT NULL DEFAULT '{"query":"security","location":null,"remoteOnly":false,"limit":50}';
ALTER TABLE sources ADD COLUMN configuration_status TEXT NOT NULL DEFAULT 'unvalidated'
  CHECK (configuration_status IN ('unvalidated', 'valid', 'invalid', 'credentials-required'));
ALTER TABLE sources ADD COLUMN last_health_check_at TEXT;
ALTER TABLE sources ADD COLUMN health_status TEXT NOT NULL DEFAULT 'never-run'
  CHECK (health_status IN ('healthy', 'failed', 'never-run', 'credentials-required'));
ALTER TABLE sources ADD COLUMN health_message TEXT;

UPDATE sources SET
  display_name = employer,
  provider_id = CASE WHEN connector IS NOT NULL THEN connector ELSE NULL END;

ALTER TABLE provider_metadata ADD COLUMN provider_type TEXT NOT NULL DEFAULT 'job-board';
ALTER TABLE provider_metadata ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE provider_metadata ADD COLUMN credential_requirement TEXT;

ALTER TABLE runs ADD COLUMN trigger TEXT NOT NULL DEFAULT 'cli'
  CHECK (trigger IN ('cli', 'manual-job', 'manual-source', 'manual-all', 'scheduled'));
ALTER TABLE runs ADD COLUMN requested_at TEXT;
ALTER TABLE runs ADD COLUMN configuration_snapshot_json TEXT;
ALTER TABLE runs ADD COLUMN duplicate_merges INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_merges >= 0);
ALTER TABLE runs ADD COLUMN schedule_id TEXT;

UPDATE runs SET requested_at = started_at, duplicate_merges = duplicates_found;

ALTER TABLE jobs ADD COLUMN agency TEXT;
ALTER TABLE jobs ADD COLUMN department TEXT;
ALTER TABLE jobs ADD COLUMN grade_low TEXT;
ALTER TABLE jobs ADD COLUMN grade_high TEXT;
ALTER TABLE jobs ADD COLUMN pay_plan TEXT;
ALTER TABLE jobs ADD COLUMN appointment_type TEXT;
ALTER TABLE jobs ADD COLUMN work_schedule TEXT;
ALTER TABLE jobs ADD COLUMN telework_eligible INTEGER
  CHECK (telework_eligible IS NULL OR telework_eligible IN (0, 1));
ALTER TABLE jobs ADD COLUMN opening_date TEXT;
ALTER TABLE jobs ADD COLUMN closing_date TEXT;
ALTER TABLE jobs ADD COLUMN application_urls_json TEXT NOT NULL DEFAULT '[]';

DROP INDEX job_sources_external_id_unique;
DROP INDEX job_sources_canonical_url_unique;
DROP INDEX job_sources_job_id_idx;
DROP INDEX job_sources_provider_id_idx;

CREATE TABLE job_sources_new (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  external_id TEXT,
  posting_url TEXT,
  canonical_posting_url TEXT,
  raw_data_json TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  provider_id TEXT
);

INSERT INTO job_sources_new (
  id, job_id, source_id, external_id, posting_url, canonical_posting_url,
  raw_data_json, first_seen_at, last_seen_at, provider_id
)
SELECT id, job_id, source_id, external_id, posting_url, canonical_posting_url,
       raw_data_json, first_seen_at, last_seen_at, provider_id
FROM job_sources;

DROP TABLE job_sources;
ALTER TABLE job_sources_new RENAME TO job_sources;

CREATE UNIQUE INDEX job_sources_external_id_unique
  ON job_sources(source_id, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX job_sources_canonical_url_unique
  ON job_sources(source_id, canonical_posting_url)
  WHERE canonical_posting_url IS NOT NULL;
CREATE INDEX job_sources_canonical_url_lookup
  ON job_sources(canonical_posting_url)
  WHERE canonical_posting_url IS NOT NULL;
CREATE INDEX job_sources_job_id_idx ON job_sources(job_id);
CREATE INDEX job_sources_provider_id_idx ON job_sources(provider_id);

CREATE TABLE source_schedules (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE REFERENCES sources(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  cadence TEXT NOT NULL DEFAULT 'manual'
    CHECK (cadence IN ('manual', 'every-6-hours', 'every-12-hours', 'every-24-hours', 'daily')),
  daily_local_time TEXT CHECK (daily_local_time IS NULL OR daily_local_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  next_run_at TEXT,
  last_due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX source_schedules_due_idx ON source_schedules(enabled, next_run_at);

CREATE TABLE discovery_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  scheduler_enabled INTEGER NOT NULL DEFAULT 0 CHECK (scheduler_enabled IN (0, 1)),
  minimum_interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK (minimum_interval_minutes >= 360),
  last_evaluated_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO discovery_settings (
  id, scheduler_enabled, minimum_interval_minutes, last_evaluated_at, updated_at
) VALUES ('default', 0, 360, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE job_observations (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  provider_id TEXT,
  external_id TEXT,
  posting_url TEXT,
  application_urls_json TEXT NOT NULL DEFAULT '[]',
  raw_data_json TEXT,
  observed_at TEXT NOT NULL
);

CREATE INDEX job_observations_job_idx ON job_observations(job_id, observed_at);
CREATE INDEX job_observations_source_idx ON job_observations(source_id, observed_at);
CREATE INDEX runs_trigger_idx ON runs(trigger, started_at);
CREATE INDEX sources_provider_idx ON sources(provider_id, enabled);
