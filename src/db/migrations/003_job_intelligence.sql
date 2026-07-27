CREATE TABLE candidate_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  configuration_json TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE analysis_runs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  jobs_analyzed INTEGER NOT NULL DEFAULT 0 CHECK (jobs_analyzed >= 0),
  error_message TEXT
);

CREATE TABLE recommendations (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  overall_score REAL NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  category_scores_json TEXT NOT NULL,
  recommendation_status TEXT NOT NULL CHECK (recommendation_status IN ('Apply Immediately', 'Strong Match', 'Possible Match', 'Weak Match', 'Already Applied', 'Expired', 'Hidden')),
  explanations_json TEXT NOT NULL,
  missing_qualifications_json TEXT NOT NULL,
  analyzed_at TEXT NOT NULL,
  UNIQUE(job_id, profile_id)
);

CREATE TABLE score_history (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  overall_score REAL NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  category_scores_json TEXT NOT NULL,
  recommendation_status TEXT NOT NULL,
  analyzed_at TEXT NOT NULL
);

CREATE INDEX score_history_job_profile_idx
  ON score_history(job_id, profile_id, analyzed_at);

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE
);

CREATE TABLE job_skills (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
  frequency INTEGER NOT NULL CHECK (frequency > 0),
  PRIMARY KEY(job_id, skill_id)
);

CREATE TABLE certifications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE
);

CREATE TABLE job_certifications (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  certification_id TEXT NOT NULL REFERENCES certifications(id) ON DELETE RESTRICT,
  PRIMARY KEY(job_id, certification_id)
);

CREATE TABLE analytics (
  id TEXT PRIMARY KEY,
  analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE RESTRICT,
  metric_name TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_value REAL NOT NULL,
  details_json TEXT,
  generated_at TEXT NOT NULL
);

CREATE INDEX analytics_run_metric_idx
  ON analytics(analysis_run_id, metric_name, metric_value DESC);
