-- Derived NLP caches are invalidated whenever their source job text changes.
-- Existing cache rows predate this guarantee, so establish a trusted baseline
-- by clearing only recreatable NLP data. Production jobs are untouched.
DELETE FROM job_nlp_relevance;
DELETE FROM job_nlp_enrichments;

CREATE TRIGGER invalidate_job_nlp_cache_after_source_update
AFTER UPDATE OF title, location, description, requirements, preferred_qualifications ON jobs
WHEN NOT (
  OLD.title IS NEW.title AND
  OLD.location IS NEW.location AND
  OLD.description IS NEW.description AND
  OLD.requirements IS NEW.requirements AND
  OLD.preferred_qualifications IS NEW.preferred_qualifications
)
BEGIN
  DELETE FROM job_nlp_relevance WHERE job_id = NEW.id;
  DELETE FROM job_nlp_enrichments WHERE job_id = NEW.id;
END;
