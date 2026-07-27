ALTER TABLE jobs ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1));
ALTER TABLE jobs ADD COLUMN notes TEXT;

CREATE TABLE resumes (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  parsing_status TEXT NOT NULL CHECK (parsing_status IN ('parsed', 'pending', 'failed')),
  extracted_skills_json TEXT NOT NULL DEFAULT '[]',
  extracted_certifications_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX resumes_one_default
  ON resumes(is_default)
  WHERE is_default = 1;

CREATE TABLE resume_profile_proposals (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL CHECK (field_name IN ('skills', 'certifications')),
  proposed_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE TABLE saved_filters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
