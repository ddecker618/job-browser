-- Structured role details.
--
-- role_details_json is a versioned, evidence-backed RoleDetails document
-- produced by the deterministic role-details extractor (see
-- src/intelligence/roleDetailsExtractor.ts). It normalizes retained job
-- evidence (workplace, locations, clearance, education, experience, skills,
-- certifications, technologies, citizenship, travel, schedule, contingent
-- conditions) for Job Detail, eligibility, scoring, filtering, Discovery, and
-- analytics.
--
-- The embedded ROLE_DETAILS_VERSION is validated at write/read time so stale
-- or schema-mismatched payloads are never served to the UI. Original evidence
-- text is never rewritten; this column is a derived projection.

ALTER TABLE jobs ADD COLUMN role_details_json TEXT;
