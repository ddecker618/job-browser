-- Application Event Foundation (Milestone 8.2)
--
-- Evolves the legacy `applications` aggregate and the Job-linked
-- `application_history` rows into the approved event-derived compatibility
-- model without losing any existing ID, row, or fact.
--
-- Design decisions follow DATABASE_V2.md sections 3, 4, and 9:
--
-- * `applications` remains the physical aggregate for current-state queries.
--   Its status vocabulary is widened to the canonical persistence vocabulary
--   and it gains the projection/context/legacy-provenance columns required by
--   section 3.4. SQLite cannot alter a CHECK constraint, so the table is
--   rebuilt and every column and row is copied.
-- * `application_history` becomes the physical store for ApplicationEvents
--   (section 4.1). It gains Application linkage plus resulting-status,
--   occurrence-precision, sort-value, and supersession metadata. The
--   accidental Job->history ON DELETE CASCADE is replaced by an explicitly
--   restrictive boundary (section 2.8 and 9.6).
-- * Legacy records are reconciled per the section 9.4 matrix: aggregate-only,
--   history-only, divergent, imprecise-date, generic-Interview, note-only, and
--   source-less records are linked or appended without fabricating events.
-- * The current projection is folded from the event ledger (section 4.5) in
--   the same migration through one canonical effective-event view. Every
--   rewrite finishes before insert validation, append-only triggers, and
--   integrity checks are added (section 9.6).

PRAGMA defer_foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 1. Rebuild `applications`
-- ---------------------------------------------------------------------------

CREATE TABLE applications_new (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (
    status IN (
      'applied', 'recruiter_contact', 'phone_screen', 'technical_interview',
      'manager_interview', 'final_interview', 'interview', 'offer', 'accepted',
      'rejected', 'ghosted', 'withdrawn', 'unknown_legacy_state'
    )
  ),
  applied_at TEXT,
  applied_at_precision TEXT CHECK (
    applied_at_precision IS NULL OR
    applied_at_precision IN ('exact', 'date', 'approximate', 'unknown')
  ),
  last_event_at TEXT,
  last_recorded_at TEXT,
  title_at_application TEXT,
  company_at_application TEXT,
  location_at_application TEXT,
  application_url TEXT,
  source_id TEXT,
  provider_id TEXT,
  source_label TEXT,
  notes TEXT,
  legacy_provenance TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO applications_new (
  id, job_id, status, applied_at, last_event_at, notes,
  legacy_provenance, created_at, updated_at
)
SELECT
  id, job_id, status, applied_at, last_event_at, notes,
  'legacy:pre-v2-aggregate', created_at, updated_at
FROM applications;

INSERT INTO applications_new (
  id, job_id, status, applied_at, last_event_at,
  legacy_provenance, created_at, updated_at
)
SELECT
  h.job_id,
  h.job_id,
  COALESCE(
    (
      SELECT e.event_type
        FROM application_history e
       WHERE e.job_id = h.job_id AND e.event_type <> 'note'
       ORDER BY e.occurred_at DESC, e.rowid DESC
       LIMIT 1
    ),
    'unknown_legacy_state'
  ),
  (
    SELECT MIN(e.occurred_at)
      FROM application_history e
     WHERE e.job_id = h.job_id AND e.event_type = 'applied'
  ),
  (
    SELECT MAX(e.occurred_at)
      FROM application_history e
     WHERE e.job_id = h.job_id
  ),
  'legacy:pre-v2-history-only',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (SELECT DISTINCT job_id FROM application_history) AS h
WHERE NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = h.job_id);

DROP TABLE applications;
ALTER TABLE applications_new RENAME TO applications;

-- ---------------------------------------------------------------------------
-- 2. Rebuild `application_history` into the event store
-- ---------------------------------------------------------------------------

CREATE TABLE application_history_new (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'applied', 'recruiter_contact', 'phone_screen', 'technical_interview',
      'manager_interview', 'final_interview', 'interview', 'offer', 'accepted',
      'rejected', 'ghosted', 'withdrawn', 'note', 'void',
      'legacy_state_imported', 'legacy_applied_date_imported'
    )
  ),
  resulting_status TEXT CHECK (
    resulting_status IS NULL OR resulting_status IN (
      'applied', 'recruiter_contact', 'phone_screen', 'technical_interview',
      'manager_interview', 'final_interview', 'interview', 'offer', 'accepted',
      'rejected', 'ghosted', 'withdrawn', 'unknown_legacy_state'
    )
  ),
  occurred_at TEXT,
  occurred_at_sort TEXT,
  occurrence_precision TEXT NOT NULL CHECK (
    occurrence_precision IN ('exact', 'date', 'approximate', 'unknown')
  ),
  recorded_at_sort TEXT,
  notes TEXT,
  source TEXT NOT NULL,
  metadata_json TEXT,
  supersedes_event_id TEXT REFERENCES application_history_new(id) ON DELETE RESTRICT,
  supersede_action TEXT CHECK (
    supersede_action IS NULL OR supersede_action IN ('replace', 'void')
  ),
  created_at TEXT NOT NULL,
  CHECK (
    (event_type = 'applied' AND resulting_status = 'applied') OR
    (event_type = 'recruiter_contact' AND resulting_status = 'recruiter_contact') OR
    (event_type = 'phone_screen' AND resulting_status = 'phone_screen') OR
    (event_type = 'technical_interview' AND resulting_status = 'technical_interview') OR
    (event_type = 'manager_interview' AND resulting_status = 'manager_interview') OR
    (event_type = 'final_interview' AND resulting_status = 'final_interview') OR
    (event_type = 'interview' AND resulting_status = 'interview') OR
    (event_type = 'offer' AND resulting_status = 'offer') OR
    (event_type = 'accepted' AND resulting_status = 'accepted') OR
    (event_type = 'rejected' AND resulting_status = 'rejected') OR
    (event_type = 'ghosted' AND resulting_status = 'ghosted') OR
    (event_type = 'withdrawn' AND resulting_status = 'withdrawn') OR
    (event_type = 'legacy_state_imported' AND resulting_status IS NOT NULL) OR
    (event_type IN ('note', 'void', 'legacy_applied_date_imported') AND resulting_status IS NULL)
  ),
  CHECK (
    (supersedes_event_id IS NULL AND supersede_action IS NULL AND event_type <> 'void') OR
    (supersedes_event_id IS NOT NULL AND (
      (supersede_action = 'replace' AND event_type <> 'void') OR
      (supersede_action = 'void' AND event_type = 'void')
    ))
  ),
  CHECK (supersedes_event_id IS NULL OR supersedes_event_id <> id),
  CHECK (supersedes_event_id IS NULL OR recorded_at_sort IS NOT NULL)
);

INSERT INTO application_history_new (
  id, application_id, job_id, event_type, resulting_status,
  occurred_at, occurred_at_sort, occurrence_precision, recorded_at_sort,
  notes, source, created_at
)
SELECT
  h.id,
  a.id,
  h.job_id,
  h.event_type,
  CASE h.event_type
    WHEN 'applied' THEN 'applied'
    WHEN 'interview' THEN 'interview'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'offer' THEN 'offer'
    ELSE NULL
  END,
  h.occurred_at,
  CASE
    WHEN h.occurred_at IS NULL THEN NULL
    WHEN length(h.occurred_at) = 10
      AND h.occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(h.occurred_at) IS NOT NULL
    THEN h.occurred_at || 'T00:00:00.000Z'
    WHEN datetime(h.occurred_at) IS NOT NULL
    THEN strftime('%Y-%m-%dT%H:%M:%fZ', h.occurred_at)
    ELSE NULL
  END,
  CASE
    WHEN h.occurred_at IS NULL THEN 'unknown'
    WHEN length(h.occurred_at) = 10
      AND h.occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(h.occurred_at) IS NOT NULL
    THEN 'date'
    WHEN datetime(h.occurred_at) IS NOT NULL THEN 'exact'
    ELSE 'unknown'
  END,
  CASE
    WHEN h.created_at IS NULL THEN NULL
    WHEN length(h.created_at) = 10
      AND h.created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(h.created_at) IS NOT NULL
    THEN h.created_at || 'T00:00:00.000Z'
    WHEN datetime(h.created_at) IS NOT NULL
    THEN strftime('%Y-%m-%dT%H:%M:%fZ', h.created_at)
    ELSE NULL
  END,
  h.notes,
  h.source,
  h.created_at
FROM application_history h
JOIN applications a ON a.job_id = h.job_id;

DROP TABLE application_history;
ALTER TABLE application_history_new RENAME TO application_history;

-- A target can have only one direct superseder. Combined with insert-only
-- prior-target validation below, this makes every correction chain linear and
-- acyclic while allowing a correction to supersede the current terminal.
CREATE UNIQUE INDEX application_history_one_direct_superseder_idx
  ON application_history(supersedes_event_id)
  WHERE supersedes_event_id IS NOT NULL;

-- The complete ledger remains in `application_history`. This view exposes only
-- terminal replacement facts and standalone facts; superseded ancestors and a
-- terminal Void contribute nothing to projection folds.
CREATE VIEW application_effective_events AS
SELECT h.*
FROM application_history AS h
WHERE h.event_type <> 'void'
  AND (h.supersede_action IS NULL OR h.supersede_action = 'replace')
  AND NOT EXISTS (
    SELECT 1
      FROM application_history AS superseder
     WHERE superseder.supersedes_event_id = h.id
  );

-- ---------------------------------------------------------------------------
-- 3. Reconcile legacy records (DATABASE_V2 section 9.4)
-- ---------------------------------------------------------------------------

-- Aggregate-only or note-only Applications, and records whose latest
-- status-bearing event diverges from the retained aggregate status, receive a
-- Legacy State Imported event carrying the previous aggregate's status with an
-- unknown occurrence time and migration record time. This preserves the
-- aggregated compatibility state without fabricating an occurrence.
INSERT INTO application_history (
  id, application_id, job_id, event_type, resulting_status,
  occurred_at, occurred_at_sort, occurrence_precision, recorded_at_sort,
  notes, source, metadata_json, created_at
)
SELECT
  'legacy-state:' || app.id,
  app.id,
  app.job_id,
  'legacy_state_imported',
  app.status,
  NULL,
  NULL,
  'unknown',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'Application status preserved from the pre-V2 aggregate',
  'migration',
  json_object(
    'schema_version', 1,
    'classification', app.legacy_provenance,
    'legacy_application_id', app.id,
    'legacy_status', app.status,
    'legacy_applied_at', app.applied_at,
    'legacy_last_event_at', app.last_event_at,
    'legacy_created_at', app.created_at,
    'legacy_updated_at', app.updated_at
  ),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM applications AS app
WHERE (
    app.legacy_provenance = 'legacy:pre-v2-history-only'
    AND NOT EXISTS (
      SELECT 1
        FROM application_effective_events h
       WHERE h.application_id = app.id AND h.resulting_status IS NOT NULL
    )
  ) OR (
    app.legacy_provenance = 'legacy:pre-v2-aggregate'
    AND (
      SELECT h.resulting_status
        FROM application_effective_events h
       WHERE h.application_id = app.id AND h.resulting_status IS NOT NULL
       ORDER BY COALESCE(h.occurred_at_sort, h.recorded_at_sort) DESC,
                h.recorded_at_sort DESC,
                h.id DESC
       LIMIT 1
    ) IS DISTINCT FROM app.status
  );

-- A legacy `applied_at` that no factual Applied event supports is imported as a
-- Legacy Applied Date Imported event with conservative approximate precision.
-- It never changes the current status.
INSERT INTO application_history (
  id, application_id, job_id, event_type, resulting_status,
  occurred_at, occurred_at_sort, occurrence_precision, recorded_at_sort,
  notes, source, metadata_json, created_at
)
SELECT
  'legacy-lad:' || app.id,
  app.id,
  app.job_id,
  'legacy_applied_date_imported',
  NULL,
  app.applied_at,
  CASE
    WHEN app.applied_at IS NULL THEN NULL
    WHEN length(app.applied_at) = 10
      AND app.applied_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(app.applied_at) IS NOT NULL
    THEN app.applied_at || 'T00:00:00.000Z'
    WHEN datetime(app.applied_at) IS NOT NULL
    THEN strftime('%Y-%m-%dT%H:%M:%fZ', app.applied_at)
    ELSE NULL
  END,
  CASE
    WHEN app.applied_at IS NULL THEN 'unknown'
    WHEN datetime(app.applied_at) IS NOT NULL THEN 'approximate'
    ELSE 'unknown'
  END,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'Imported legacy applied date without recorded Applied event',
  'migration',
  json_object(
    'schema_version', 1,
    'classification', 'legacy:unsupported-applied-date',
    'legacy_application_id', app.id,
    'legacy_applied_at', app.applied_at
  ),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM applications AS app
WHERE app.applied_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM application_effective_events h
     WHERE h.application_id = app.id
       AND h.event_type = 'applied'
       AND h.occurred_at = app.applied_at
  );

-- ---------------------------------------------------------------------------
-- 4. Fold the current projection from the event ledger (Section 4.5)
-- ---------------------------------------------------------------------------

UPDATE applications AS app
SET
  status = (
    SELECT h.resulting_status
      FROM application_effective_events h
     WHERE h.application_id = app.id AND h.resulting_status IS NOT NULL
     ORDER BY COALESCE(h.occurred_at_sort, h.recorded_at_sort) DESC,
              h.recorded_at_sort DESC,
              h.id DESC
     LIMIT 1
  ),
  applied_at = (
    SELECT h.occurred_at
      FROM application_effective_events h
     WHERE h.application_id = app.id
       AND h.event_type IN ('applied', 'legacy_applied_date_imported')
       AND h.occurred_at IS NOT NULL
     ORDER BY COALESCE(h.occurred_at_sort, h.recorded_at_sort),
              h.recorded_at_sort,
              h.id
     LIMIT 1
  ),
  applied_at_precision = (
    SELECT h.occurrence_precision
      FROM application_effective_events h
     WHERE h.application_id = app.id
       AND h.event_type IN ('applied', 'legacy_applied_date_imported')
       AND h.occurred_at IS NOT NULL
     ORDER BY COALESCE(h.occurred_at_sort, h.recorded_at_sort),
              h.recorded_at_sort,
              h.id
     LIMIT 1
  ),
  last_event_at = (
    SELECT MAX(h.occurred_at_sort)
      FROM application_effective_events h
     WHERE h.application_id = app.id
  ),
  last_recorded_at = (
    SELECT MAX(h.recorded_at_sort)
      FROM application_history h
     WHERE h.application_id = app.id
  ),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- ---------------------------------------------------------------------------
-- 5. Query-driven indexes (Section 8.3)
-- ---------------------------------------------------------------------------

CREATE INDEX applications_recent_activity_idx
  ON applications(COALESCE(last_recorded_at, last_event_at) DESC, id);
CREATE INDEX applications_status_activity_idx
  ON applications(status, COALESCE(last_recorded_at, last_event_at) DESC);
CREATE INDEX applications_company_activity_idx
  ON applications(company_at_application, COALESCE(last_recorded_at, last_event_at) DESC);

CREATE INDEX application_history_job_id_occurred_idx
  ON application_history(job_id, occurred_at);
CREATE INDEX application_history_application_timeline_idx
  ON application_history(application_id, occurred_at_sort, recorded_at_sort, id);
CREATE INDEX application_history_application_type_idx
  ON application_history(application_id, event_type, occurred_at_sort);
CREATE INDEX application_history_result_occurrence_idx
  ON application_history(resulting_status, occurred_at_sort, application_id);

-- ---------------------------------------------------------------------------
-- 6. Correction-chain and append-only protection (Section 4.4)
-- ---------------------------------------------------------------------------

CREATE TRIGGER application_history_validate_insert
BEFORE INSERT ON application_history
BEGIN
  SELECT RAISE(ABORT, 'Application event Job must match its parent Application')
  WHERE NOT EXISTS (
    SELECT 1
      FROM applications app
     WHERE app.id = NEW.application_id AND app.job_id = NEW.job_id
  );

  SELECT RAISE(ABORT, 'Application event cannot supersede itself')
  WHERE NEW.supersedes_event_id = NEW.id;

  SELECT RAISE(ABORT, 'Superseded event must belong to the same Application')
  WHERE NEW.supersedes_event_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
        FROM application_history target
       WHERE target.id = NEW.supersedes_event_id
         AND target.application_id = NEW.application_id
         AND target.job_id = NEW.job_id
    );

  SELECT RAISE(ABORT, 'Application event already has a direct superseder')
  WHERE NEW.supersedes_event_id IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM application_history superseder
       WHERE superseder.supersedes_event_id = NEW.supersedes_event_id
    );

  SELECT RAISE(ABORT, 'Application event cannot supersede an event recorded after it')
  WHERE NEW.supersedes_event_id IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM application_history target
       WHERE target.id = NEW.supersedes_event_id
         AND target.recorded_at_sort IS NOT NULL
         AND target.recorded_at_sort > NEW.recorded_at_sort
    );

  -- A correction with no Resulting status removes its target from the status
  -- fold. Reject it when no other effective status fact would remain.
  SELECT RAISE(ABORT, 'Application must retain an effective status-bearing event')
  WHERE NEW.supersedes_event_id IS NOT NULL
    AND NEW.resulting_status IS NULL
    AND NOT EXISTS (
      SELECT 1
        FROM application_effective_events effective
       WHERE effective.application_id = NEW.application_id
         AND effective.id <> NEW.supersedes_event_id
         AND effective.resulting_status IS NOT NULL
    );
END;

CREATE TRIGGER application_history_no_update
BEFORE UPDATE ON application_history
BEGIN
  SELECT RAISE(ABORT, 'Application events are append-only; updates are not allowed');
END;

CREATE TRIGGER application_history_no_delete
BEFORE DELETE ON application_history
BEGIN
  SELECT RAISE(ABORT, 'Application events are append-only; deletes are not allowed');
END;

PRAGMA defer_foreign_keys = OFF;

-- Guard the commit with projection, relationship, integrity, and foreign-key
-- checks. A legacy dataset that could not be reconciled must fail rather than
-- leave an incoherent schema. A failing row violates the CHECK below, which
-- aborts the surrounding migration transaction.
CREATE TABLE _v2_validation (ok INTEGER NOT NULL CHECK (ok = 0));

INSERT INTO _v2_validation (ok)
SELECT COUNT(*)
  FROM applications app
 WHERE NOT EXISTS (
   SELECT 1
     FROM application_effective_events effective
    WHERE effective.application_id = app.id
      AND effective.resulting_status IS NOT NULL
 );

INSERT INTO _v2_validation (ok)
SELECT COUNT(*)
  FROM application_history event
  JOIN applications app ON app.id = event.application_id
 WHERE app.job_id <> event.job_id;

INSERT INTO _v2_validation (ok)
SELECT COUNT(*)
  FROM pragma_integrity_check
 WHERE integrity_check <> 'ok';

INSERT INTO _v2_validation (ok)
SELECT COUNT(*)
  FROM pragma_foreign_key_check;

DROP TABLE _v2_validation;
