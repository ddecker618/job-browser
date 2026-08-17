-- Employer manifest aliases (bounded seed manifest import).
--
-- Additive: exact normalized aliases used to reuse an Employer when a manifest
-- name differs from its canonical display name. Aliases are globally unique so
-- that name identity stays deterministic; lookups still prefer the canonical
-- normalized_name first.

CREATE TABLE employer_aliases (
  id TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  normalized_alias TEXT NOT NULL,
  provenance TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX employer_aliases_normalized_alias_idx
  ON employer_aliases(normalized_alias);

CREATE INDEX employer_aliases_employer_idx
  ON employer_aliases(employer_id);
