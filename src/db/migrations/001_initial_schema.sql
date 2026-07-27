CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  employer TEXT NOT NULL,
  source_type TEXT NOT NULL,
  careers_url TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  connector TEXT,
  last_successful_run TEXT,
  last_failure TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  jobs_discovered INTEGER NOT NULL DEFAULT 0 CHECK (jobs_discovered >= 0),
  jobs_inserted INTEGER NOT NULL DEFAULT 0 CHECK (jobs_inserted >= 0),
  jobs_updated INTEGER NOT NULL DEFAULT 0 CHECK (jobs_updated >= 0),
  duplicates_found INTEGER NOT NULL DEFAULT 0 CHECK (duplicates_found >= 0),
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  company TEXT NOT NULL,
  normalized_company TEXT NOT NULL,
  location TEXT,
  normalized_location TEXT,
  city TEXT,
  state TEXT,
  remote_type TEXT NOT NULL CHECK (remote_type IN ('onsite', 'hybrid', 'remote', 'unknown')),
  employment_type TEXT NOT NULL CHECK (employment_type IN ('full-time', 'part-time', 'contract', 'temporary', 'internship', 'unknown')),
  salary_minimum REAL CHECK (salary_minimum IS NULL OR salary_minimum >= 0),
  salary_maximum REAL CHECK (salary_maximum IS NULL OR salary_maximum >= 0),
  salary_text TEXT,
  description TEXT,
  requirements TEXT,
  preferred_qualifications TEXT,
  posting_url TEXT,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  date_posted TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  clearance_requirement TEXT,
  sponsorship_available INTEGER CHECK (sponsorship_available IS NULL OR sponsorship_available IN (0, 1)),
  estimated_experience_years REAL CHECK (estimated_experience_years IS NULL OR estimated_experience_years >= 0),
  seniority_level TEXT NOT NULL CHECK (seniority_level IN ('entry', 'junior', 'mid', 'senior', 'lead', 'manager', 'director', 'executive', 'unknown')),
  score REAL CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  recommendation TEXT,
  score_explanation TEXT,
  status TEXT NOT NULL CHECK (status IN ('new', 'review', 'recommended', 'applied', 'ignored', 'rejected', 'interview', 'offer', 'expired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (salary_minimum IS NULL OR salary_maximum IS NULL OR salary_maximum >= salary_minimum),
  CHECK (score IS NULL OR score_explanation IS NOT NULL)
);

CREATE INDEX jobs_normalized_identity_idx
  ON jobs(normalized_company, normalized_title, normalized_location);
CREATE INDEX jobs_status_idx ON jobs(status);

CREATE TABLE job_sources (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  external_id TEXT,
  posting_url TEXT,
  canonical_posting_url TEXT,
  raw_data_json TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE UNIQUE INDEX job_sources_external_id_unique
  ON job_sources(source_id, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX job_sources_canonical_url_unique
  ON job_sources(canonical_posting_url)
  WHERE canonical_posting_url IS NOT NULL;
CREATE INDEX job_sources_job_id_idx ON job_sources(job_id);

CREATE TABLE job_status_history (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  previous_status TEXT CHECK (previous_status IS NULL OR previous_status IN ('new', 'review', 'recommended', 'applied', 'ignored', 'rejected', 'interview', 'offer', 'expired')),
  new_status TEXT NOT NULL CHECK (new_status IN ('new', 'review', 'recommended', 'applied', 'ignored', 'rejected', 'interview', 'offer', 'expired')),
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  reason TEXT
);

CREATE INDEX job_status_history_job_id_idx
  ON job_status_history(job_id, changed_at);

CREATE TABLE application_history (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('applied', 'interview', 'rejected', 'offer', 'note')),
  occurred_at TEXT NOT NULL,
  notes TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX application_history_job_id_idx
  ON application_history(job_id, occurred_at);
