-- Manual job availability overrides.
--
-- user_removed is a durable user-level suppression marker. It differs from
-- provider lifecycle evidence: a user-removed job stays out of the current
-- list even if a provider re-lists it, until the user restores it.
--
-- The existing lifecycle_reason/removed_at columns are reused; recomputeCanonical
-- honors user_removed so provider observations cannot silently resurrect a job
-- the user removed (see sprint: manual removal persistence + rediscovery resumption).

ALTER TABLE jobs ADD COLUMN user_removed INTEGER NOT NULL DEFAULT 0
  CHECK (user_removed IN (0, 1));

CREATE INDEX jobs_user_removed_idx ON jobs(user_removed, active, lifecycle_reason);