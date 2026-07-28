-- Merge duplicate sources sharing the same provider_id.
-- Keeps the source with the fixed 'provider:<provider_id>' pattern (e.g. 'provider:indeed'),
-- falling back to the most recently created source.

-- Strategy:
-- 1. Identify groups where the same provider_id appears on >1 source row
-- 2. Choose a keeper per group (fixed ID wins, else most recently created)
-- 3. Drop unique indexes, reparent all FK references, deduplicate, recreate indexes
-- 4. Drop the now-orphaned source rows

CREATE TEMP TABLE __dup_sources AS
WITH provider_dups AS (
  SELECT provider_id
  FROM sources
  WHERE provider_id IS NOT NULL
  GROUP BY provider_id
  HAVING COUNT(*) > 1
)
SELECT
  s.id AS remove_id,
  COALESCE(
    (SELECT id FROM sources WHERE provider_id = s.provider_id AND id = 'provider:' || provider_id LIMIT 1),
    (SELECT id FROM sources WHERE provider_id = s.provider_id ORDER BY created_at DESC LIMIT 1)
  ) AS keep_id
FROM sources s
JOIN provider_dups pd ON pd.provider_id = s.provider_id
WHERE s.id != COALESCE(
    (SELECT id FROM sources WHERE provider_id = s.provider_id AND id = 'provider:' || provider_id LIMIT 1),
    (SELECT id FROM sources WHERE provider_id = s.provider_id ORDER BY created_at DESC LIMIT 1)
  );

-- Disable unique partial indexes that would block reparenting
DROP INDEX IF EXISTS job_sources_external_id_unique;
DROP INDEX IF EXISTS job_sources_canonical_url_unique;

-- Reparent identity_conflict_diagnostics
UPDATE identity_conflict_diagnostics
SET source_id = (SELECT keep_id FROM __dup_sources WHERE remove_id = source_id)
WHERE source_id IN (SELECT remove_id FROM __dup_sources);

-- Reparent runs
UPDATE runs
SET source_id = (SELECT keep_id FROM __dup_sources WHERE remove_id = source_id)
WHERE source_id IN (SELECT remove_id FROM __dup_sources);

-- Reparent job_observations
UPDATE job_observations
SET source_id = (SELECT keep_id FROM __dup_sources WHERE remove_id = source_id)
WHERE source_id IN (SELECT remove_id FROM __dup_sources);

-- Reparent job_sources
UPDATE job_sources
SET source_id = (SELECT keep_id FROM __dup_sources WHERE remove_id = source_id)
WHERE source_id IN (SELECT remove_id FROM __dup_sources);

-- Deduplicate rows that now share the same (source_id, external_id) after reparenting.
-- Keep the earliest (first-created) row for each unique combination.
DELETE FROM job_sources
WHERE source_id IN (SELECT keep_id FROM __dup_sources)
AND external_id IS NOT NULL
AND id NOT IN (
  SELECT MIN(id) FROM job_sources
  WHERE external_id IS NOT NULL
  AND source_id IN (SELECT keep_id FROM __dup_sources)
  GROUP BY source_id, external_id
);

-- Deduplicate rows that now share the same (source_id, canonical_posting_url).
DELETE FROM job_sources
WHERE source_id IN (SELECT keep_id FROM __dup_sources)
AND canonical_posting_url IS NOT NULL
AND id NOT IN (
  SELECT MIN(id) FROM job_sources
  WHERE canonical_posting_url IS NOT NULL
  AND source_id IN (SELECT keep_id FROM __dup_sources)
  GROUP BY source_id, canonical_posting_url
);

-- Recreate unique indexes
CREATE UNIQUE INDEX job_sources_external_id_unique
  ON job_sources(source_id, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX job_sources_canonical_url_unique
  ON job_sources(source_id, canonical_posting_url)
  WHERE canonical_posting_url IS NOT NULL;

-- Delete duplicate sources (source_schedules are cascade-deleted)
DELETE FROM sources WHERE id IN (SELECT remove_id FROM __dup_sources);

DROP TABLE __dup_sources;
