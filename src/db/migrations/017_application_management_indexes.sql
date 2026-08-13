-- Milestone 8.3 Application management query and immutability support.

DROP INDEX applications_recent_activity_idx;
DROP INDEX applications_status_activity_idx;
DROP INDEX applications_company_activity_idx;
DROP INDEX application_history_application_timeline_idx;

CREATE INDEX applications_recent_activity_idx
  ON applications(last_recorded_at DESC, id);
CREATE INDEX applications_status_activity_idx
  ON applications(status, last_recorded_at DESC, id);
CREATE INDEX applications_company_activity_idx
  ON applications(company_at_application COLLATE NOCASE, last_recorded_at DESC, id);

CREATE INDEX application_history_application_timeline_idx
  ON application_history(
    application_id,
    COALESCE(occurred_at_sort, recorded_at_sort),
    recorded_at_sort,
    id
  );

CREATE TRIGGER applications_immutable_identity_and_context
BEFORE UPDATE OF
  id,
  job_id,
  title_at_application,
  company_at_application,
  location_at_application,
  application_url,
  source_id,
  provider_id,
  source_label
ON applications
WHEN NEW.id IS NOT OLD.id
  OR NEW.job_id IS NOT OLD.job_id
  OR NEW.title_at_application IS NOT OLD.title_at_application
  OR NEW.company_at_application IS NOT OLD.company_at_application
  OR NEW.location_at_application IS NOT OLD.location_at_application
  OR NEW.application_url IS NOT OLD.application_url
  OR NEW.source_id IS NOT OLD.source_id
  OR NEW.provider_id IS NOT OLD.provider_id
  OR NEW.source_label IS NOT OLD.source_label
BEGIN
  SELECT RAISE(ABORT, 'Application identity and copied context are immutable');
END;

CREATE TRIGGER application_history_user_metadata_definition
BEFORE INSERT ON application_history
WHEN NEW.source = 'user'
BEGIN
  SELECT RAISE(ABORT, 'User Application events require application-event-v1 metadata')
  WHERE NEW.metadata_json IS NULL
    OR json_valid(NEW.metadata_json) = 0
    OR CASE
      WHEN json_valid(NEW.metadata_json) = 1
      THEN json_type(NEW.metadata_json, '$.definition') IS NOT 'text'
        OR json_extract(NEW.metadata_json, '$.definition') <> 'application-event-v1'
      ELSE 1
    END;
END;
