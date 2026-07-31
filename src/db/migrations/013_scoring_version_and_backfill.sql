ALTER TABLE jobs ADD COLUMN score_version TEXT;
ALTER TABLE jobs ADD COLUMN score_input_hash TEXT;
ALTER TABLE recommendations ADD COLUMN score_version TEXT;
ALTER TABLE recommendations ADD COLUMN score_input_hash TEXT;
ALTER TABLE score_history ADD COLUMN score_version TEXT;
ALTER TABLE analysis_runs ADD COLUMN score_version TEXT;

CREATE INDEX jobs_current_score_idx
  ON jobs(score_version, eligibility_passed, score DESC);
