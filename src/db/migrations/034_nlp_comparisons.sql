CREATE TABLE job_nlp_comparisons (
  job_id TEXT PRIMARY KEY,
  comparison_version TEXT NOT NULL,
  source_text_hash TEXT NOT NULL CHECK(length(source_text_hash) = 64),
  comparison_json TEXT NOT NULL CHECK(json_valid(comparison_json)),
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX idx_job_nlp_comparisons_version
  ON job_nlp_comparisons(comparison_version, job_id);

CREATE TRIGGER invalidate_job_nlp_comparison_after_source_update
AFTER UPDATE OF title, location, description, requirements, preferred_qualifications ON jobs
WHEN NOT (
  OLD.title IS NEW.title AND
  OLD.location IS NEW.location AND
  OLD.description IS NEW.description AND
  OLD.requirements IS NEW.requirements AND
  OLD.preferred_qualifications IS NEW.preferred_qualifications
)
BEGIN
  DELETE FROM job_nlp_comparisons WHERE job_id = NEW.id;
END;
