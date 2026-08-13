-- Company Identity Foundation (Milestone 8.6)
-- Additive exact-normalized identity and auditable Job/Application assignments.

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  resolver_version TEXT NOT NULL CHECK (resolver_version = 'company-exact-v1'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX companies_normalized_key_idx ON companies(normalized_key);

ALTER TABLE jobs ADD COLUMN company_id TEXT REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE applications ADD COLUMN company_id TEXT REFERENCES companies(id) ON DELETE RESTRICT;

CREATE TABLE job_company_assignments (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  company_id TEXT REFERENCES companies(id) ON DELETE RESTRICT,
  original_company_text TEXT NOT NULL,
  normalized_key TEXT,
  result TEXT NOT NULL CHECK (result IN ('resolved', 'ineligible', 'conflict')),
  resolver_method TEXT NOT NULL,
  resolver_version TEXT NOT NULL CHECK (resolver_version = 'company-exact-v1'),
  assigned_at TEXT NOT NULL
);

CREATE INDEX job_company_assignments_job_idx
  ON job_company_assignments(job_id, assigned_at, id);

CREATE TABLE application_company_assignments (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  company_id TEXT REFERENCES companies(id) ON DELETE RESTRICT,
  original_company_text TEXT,
  normalized_key TEXT,
  result TEXT NOT NULL CHECK (result IN ('resolved', 'ineligible', 'conflict')),
  resolver_method TEXT NOT NULL,
  resolver_version TEXT NOT NULL CHECK (resolver_version = 'company-exact-v1'),
  assigned_at TEXT NOT NULL
);

CREATE INDEX application_company_assignments_application_idx
  ON application_company_assignments(application_id, assigned_at, id);

CREATE TRIGGER job_company_assignments_no_update
BEFORE UPDATE ON job_company_assignments
BEGIN
  SELECT RAISE(ABORT, 'Job Company assignments are append-only');
END;

CREATE TRIGGER application_company_assignments_no_update
BEFORE UPDATE ON application_company_assignments
BEGIN
  SELECT RAISE(ABORT, 'Application Company assignments are append-only');
END;

-- Existing jobs already carry the compatible exact-normalized key. Select the
-- earliest retained Job text deterministically as the canonical display name.
INSERT INTO companies (
  id, canonical_name, normalized_key, resolver_version, created_at, updated_at
)
SELECT
  'company-exact-v1:' || ranked.normalized_company,
  trim(ranked.company),
  ranked.normalized_company,
  'company-exact-v1',
  ranked.created_at,
  ranked.created_at
FROM (
  SELECT jobs.*,
         ROW_NUMBER() OVER (
           PARTITION BY normalized_company ORDER BY created_at, id
         ) AS company_rank
  FROM jobs
  WHERE normalized_company NOT IN (
    '', 'unknown', 'unknown company', 'n/a', 'na', 'not specified',
    'confidential', 'confidential company', 'company confidential',
    'undisclosed', 'various', 'multiple companies'
  )
) AS ranked
WHERE ranked.company_rank = 1;

UPDATE jobs
SET company_id = 'company-exact-v1:' || normalized_company
WHERE normalized_company NOT IN (
  '', 'unknown', 'unknown company', 'n/a', 'na', 'not specified',
  'confidential', 'confidential company', 'company confidential',
  'undisclosed', 'various', 'multiple companies'
);

INSERT INTO job_company_assignments (
  id, job_id, company_id, original_company_text, normalized_key, result,
  resolver_method, resolver_version, assigned_at
)
SELECT
  'job-company:migration:' || id,
  id,
  company_id,
  company,
  CASE WHEN company_id IS NULL THEN NULL ELSE normalized_company END,
  CASE WHEN company_id IS NULL THEN 'ineligible' ELSE 'resolved' END,
  'migration-exact',
  'company-exact-v1',
  updated_at
FROM jobs;

-- Applications resolve from immutable copied context. Legacy rows without that
-- context may use the current Job key only with explicit migration provenance.
WITH RECURSIVE application_keys(application_id, normalized_key) AS (
  SELECT id,
         lower(trim(replace(replace(replace(company_at_application, char(9), ' '), char(10), ' '), char(13), ' ')))
  FROM applications
  WHERE company_at_application IS NOT NULL
  UNION ALL
  SELECT application_id, replace(normalized_key, '  ', ' ')
  FROM application_keys
  WHERE instr(normalized_key, '  ') > 0
), collapsed_application_keys AS (
  SELECT application_id, normalized_key
  FROM application_keys
  WHERE instr(normalized_key, '  ') = 0
)
UPDATE applications
SET company_id = (
  SELECT companies.id
  FROM companies
  JOIN collapsed_application_keys
    ON collapsed_application_keys.normalized_key = companies.normalized_key
  WHERE collapsed_application_keys.application_id = applications.id
)
WHERE company_at_application IS NOT NULL;

UPDATE applications
SET company_id = (SELECT jobs.company_id FROM jobs WHERE jobs.id = applications.job_id)
WHERE company_at_application IS NULL;

WITH RECURSIVE application_keys(application_id, normalized_key) AS (
  SELECT id,
         lower(trim(replace(replace(replace(company_at_application, char(9), ' '), char(10), ' '), char(13), ' ')))
  FROM applications
  WHERE company_at_application IS NOT NULL
  UNION ALL
  SELECT application_id, replace(normalized_key, '  ', ' ')
  FROM application_keys
  WHERE instr(normalized_key, '  ') > 0
), collapsed_application_keys AS (
  SELECT application_id, normalized_key
  FROM application_keys
  WHERE instr(normalized_key, '  ') = 0
)
INSERT INTO application_company_assignments (
  id, application_id, company_id, original_company_text, normalized_key, result,
  resolver_method, resolver_version, assigned_at
)
SELECT
  'application-company:migration:' || applications.id,
  applications.id,
  applications.company_id,
  applications.company_at_application,
  CASE
    WHEN applications.company_at_application IS NOT NULL
      THEN (
        SELECT normalized_key FROM collapsed_application_keys
        WHERE application_id = applications.id
      )
    WHEN applications.company_id IS NOT NULL
      THEN (SELECT normalized_key FROM companies WHERE id = applications.company_id)
    ELSE NULL
  END,
  CASE WHEN applications.company_id IS NULL THEN 'ineligible' ELSE 'resolved' END,
  CASE
    WHEN applications.company_at_application IS NULL
      THEN 'migration-current-job-context'
    ELSE 'migration-exact'
  END,
  'company-exact-v1',
  applications.updated_at
FROM applications;

CREATE TEMP TABLE _company_identity_validation (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO _company_identity_validation(valid)
SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1 FROM jobs
    WHERE company_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM companies WHERE companies.id = jobs.company_id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM applications
    WHERE company_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM companies WHERE companies.id = applications.company_id)
  )
THEN 1 ELSE 0 END;

DROP TABLE _company_identity_validation;
