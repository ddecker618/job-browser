ALTER TABLE jobs ADD COLUMN verification_status TEXT;
ALTER TABLE jobs ADD COLUMN eligibility_passed INTEGER;
ALTER TABLE jobs ADD COLUMN eligibility_rejection TEXT;
ALTER TABLE jobs ADD COLUMN work_arrangement TEXT;
ALTER TABLE jobs ADD COLUMN illinois_eligibility TEXT;
ALTER TABLE jobs ADD COLUMN schedule_classification TEXT;
ALTER TABLE jobs ADD COLUMN verified_at TEXT;

CREATE TABLE recommendations_v2 (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  overall_score REAL NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  category_scores_json TEXT NOT NULL,
  recommendation_status TEXT NOT NULL CHECK (recommendation_status IN ('Verified Match', 'Apply Immediately', 'Strong Match', 'Possible Match', 'Weak Match', 'Hard No', 'Needs Review', 'Already Applied', 'Expired', 'Hidden')),
  explanations_json TEXT NOT NULL,
  missing_qualifications_json TEXT NOT NULL,
  analyzed_at TEXT NOT NULL,
  UNIQUE(job_id, profile_id)
);

INSERT INTO recommendations_v2 SELECT * FROM recommendations;
DROP TABLE recommendations;
ALTER TABLE recommendations_v2 RENAME TO recommendations;
