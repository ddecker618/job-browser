import { normalizeText } from '../../utilities/normalization.js';

import {
  DEFAULT_JOB_TYPE_CATALOG,
  JOB_TYPE_STRIP_WORDS,
  JOB_TYPE_TAXONOMY_VERSION,
  jobTypeAliasIndex,
  jobTypeTaxonomyContentHash,
  type JobTypeCatalogEntry,
  type JobTypeRelationship,
} from './jobTypeTaxonomy.js';

// ---------------------------------------------------------------------------
// P37 shadow - deterministic job-type / occupation title classifier.
//
// This is the adapter boundary and the deterministic fallback, not an
// embedding runtime. The classifier:
//
//   1. lowercases and normalizes the input title,
//   2. tokenizes it into a deduplicated token list,
//   3. strips role-prefix (senior/junior/lead/principal/...), employment-
//      type (contract/temp/...), and generic noise (job/position/...)
//      words,
//   4. looks the resulting token string up in the curated alias index,
//      and
//   5. emits `EXACT` (matches the canonical label verbatim) or
//      `CANONICAL_ALIAS` (matches a curated alias) on a hit, and
//      `UNRELATED` / `UNKNOWN` otherwise.
//
// Determinism: the same title and the same catalog always yield the same
// payload, including the catalog hash. Editing the catalog without
// bumping `JOB_TYPE_TAXONOMY_VERSION` is a fail-closed authoring error
// caught by `tests/job-nlp-job-type-taxonomy.test.ts`.
//
// No production path imports this module. `productionEffect: 'none'`.
// Scoring, eligibility, ranking, filtering, lifecycle, status, archive,
// removal, and hard-gate behaviors are not influenced by any output of
// this classifier. SCORING and HARD_GATE remain not authorized.
// ---------------------------------------------------------------------------

export const JOB_TYPE_NORMALIZATION_VERSION = 'job-type-normalization-v1';

export const JOB_TYPE_NORMALIZATION_METHOD = 'deterministic-fallback' as const;

export interface JobTypeNormalizationInput {
  title: string;
  context?: string;
  catalog?: readonly JobTypeCatalogEntry[];
}

export interface JobTypeNormalizationResult {
  method: typeof JOB_TYPE_NORMALIZATION_METHOD;
  version: typeof JOB_TYPE_NORMALIZATION_VERSION;
  taxonomyVersion: typeof JOB_TYPE_TAXONOMY_VERSION;
  catalogHash: string;
  title: string;
  normalizedTitle: string;
  strippedTokens: readonly string[];
  inputHadAliasesAfterStrip: boolean;
  conceptKey: string | null;
  conceptLabel: string | null;
  matchedAlias: string | null;
  relationship: JobTypeRelationship;
  score: number;
  abstained: boolean;
  abstentionReason: string | null;
  explanation: string;
}

function tokenize(value: string): string[] {
  if (!value) return [];
  const lowered = normalizeJobTypeAliasInternal(value);
  if (lowered.length === 0) return [];
  return [...new Set(lowered.split(' ').filter((token) => token.length > 0))];
}

function normalizeJobTypeAliasInternal(value: string): string {
  return value
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function stripIrrelevant(tokens: readonly string[]): string[] {
  const stripped: string[] = [];
  for (const token of tokens) {
    if (JOB_TYPE_STRIP_WORDS.has(token)) continue;
    stripped.push(token);
  }
  return stripped;
}

function aliasKey(tokens: readonly string[]): string {
  return tokens.join(' ');
}

export function normalizeJobTitle(
  input: JobTypeNormalizationInput,
): JobTypeNormalizationResult {
  const catalog = input.catalog ?? DEFAULT_JOB_TYPE_CATALOG;
  const rawTitle = input.title;
  const normalizedTitle = normalizeText(rawTitle);
  const baseTokens = tokenize(rawTitle);
  const strippedTokens = stripIrrelevant(baseTokens);
  const strippedKey = aliasKey(strippedTokens);
  const catalogHash = jobTypeTaxonomyContentHash(catalog);
  const aliasIndex = jobTypeAliasIndex(catalog);

  if (strippedKey.length === 0) {
    return {
      method: JOB_TYPE_NORMALIZATION_METHOD,
      version: JOB_TYPE_NORMALIZATION_VERSION,
      taxonomyVersion: JOB_TYPE_TAXONOMY_VERSION,
      catalogHash,
      title: rawTitle,
      normalizedTitle,
      strippedTokens,
      inputHadAliasesAfterStrip: false,
      conceptKey: null,
      conceptLabel: null,
      matchedAlias: null,
      relationship: 'UNKNOWN',
      score: 0,
      abstained: true,
      abstentionReason:
        rawTitle.trim().length === 0
          ? 'empty-title-input'
          : 'no-tokens-after-stripping-role-prefix-and-noise-words',
      explanation:
        rawTitle.trim().length === 0
          ? 'Title input is empty; no occupation can be claimed.'
          : 'After stripping seniority, employment-type, and generic words, no token remains to compare against the curated alias set; abstained.',
    };
  }

  const aliasHit = aliasIndex.get(strippedKey);

  if (aliasHit !== undefined) {
    const concept = catalog.find((entry) => entry.key === aliasHit.key);
    const conceptLabel = concept?.label ?? null;
    const matchedCanonicalLabel =
      concept !== undefined && normalizeText(concept.label) === strippedKey;
    const relationship: JobTypeRelationship = matchedCanonicalLabel
      ? 'EXACT'
      : 'CANONICAL_ALIAS';
    return {
      method: JOB_TYPE_NORMALIZATION_METHOD,
      version: JOB_TYPE_NORMALIZATION_VERSION,
      taxonomyVersion: JOB_TYPE_TAXONOMY_VERSION,
      catalogHash,
      title: rawTitle,
      normalizedTitle,
      strippedTokens,
      inputHadAliasesAfterStrip: true,
      conceptKey: concept?.key ?? null,
      conceptLabel,
      matchedAlias: aliasHit.matchedAlias,
      relationship,
      score: relationship === 'EXACT' ? 1 : 0.95,
      abstained: false,
      abstentionReason: null,
      explanation:
        relationship === 'EXACT'
          ? `Title after stripping seniority/employment-type/generic words equals the canonical label "${conceptLabel ?? ''}".`
          : `Title after stripping seniority/employment-type/generic words equals a reviewed alias "${aliasHit.matchedAlias}" of "${conceptLabel ?? ''}".`,
    };
  }

  return {
    method: JOB_TYPE_NORMALIZATION_METHOD,
    version: JOB_TYPE_NORMALIZATION_VERSION,
    taxonomyVersion: JOB_TYPE_TAXONOMY_VERSION,
    catalogHash,
    title: rawTitle,
    normalizedTitle,
    strippedTokens,
    inputHadAliasesAfterStrip: false,
    conceptKey: null,
    conceptLabel: null,
    matchedAlias: null,
    relationship: 'UNRELATED',
    score: 0,
    abstained: true,
    abstentionReason: 'no-reviewed-alias-matched',
    explanation:
      'No reviewed alias in the curated catalog matched the title after stripping seniority, employment-type, and generic words; no occupation is claimed.',
  };
}
