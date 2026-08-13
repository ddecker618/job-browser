-- Preserve explicit source-level lifecycle evidence without manufacturing legacy closure facts.

ALTER TABLE jobs ADD COLUMN lifecycle_reason TEXT NOT NULL DEFAULT 'unknown'
  CHECK (lifecycle_reason IN ('active', 'snapshot-missing', 'closing-date-expired', 'provider-closed', 'unknown'));

ALTER TABLE job_sources ADD COLUMN lifecycle_reason TEXT NOT NULL DEFAULT 'unknown'
  CHECK (lifecycle_reason IN ('active', 'snapshot-missing', 'closing-date-expired', 'provider-closed', 'unknown'));
ALTER TABLE job_sources ADD COLUMN closing_date TEXT;
ALTER TABLE job_sources ADD COLUMN closing_date_precision TEXT
  CHECK (closing_date_precision IS NULL OR closing_date_precision IN ('date', 'instant'));
ALTER TABLE job_sources ADD COLUMN provider_lifecycle_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (provider_lifecycle_status IN ('open', 'closed', 'unknown'));

ALTER TABLE job_observations ADD COLUMN closing_date TEXT;
ALTER TABLE job_observations ADD COLUMN closing_date_precision TEXT
  CHECK (closing_date_precision IS NULL OR closing_date_precision IN ('date', 'instant'));
ALTER TABLE job_observations ADD COLUMN provider_lifecycle_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (provider_lifecycle_status IN ('open', 'closed', 'unknown'));

-- Existing active projections are truthful, but existing inactive causes and date authority are unknown.
UPDATE jobs SET lifecycle_reason = 'active' WHERE active = 1;
UPDATE job_sources SET lifecycle_reason = 'active' WHERE active = 1;

CREATE INDEX jobs_current_lifecycle_idx ON jobs(active, lifecycle_reason, status, id);
CREATE INDEX job_sources_expiry_reconciliation_idx
  ON job_sources(active, closing_date, closing_date_precision)
  WHERE closing_date IS NOT NULL AND closing_date_precision IS NOT NULL;
CREATE INDEX job_sources_provider_lifecycle_idx
  ON job_sources(provider_lifecycle_status, active)
  WHERE provider_lifecycle_status = 'closed';
