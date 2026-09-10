import {
  familiesForJobTitle,
  type SearchProfile,
} from '../../config/search-profile.js';
import { type NlpConflictState } from '../../schemas/job-nlp.js';
import { normalizeText } from '../../utilities/normalization.js';

// ---------------------------------------------------------------------------
// Stage 20 - semantic role matching shadow mode.
//
// This is the adapter boundary and deterministic fallback, not an embedding
// runtime. It compares configured role-family titles with normalized tokens,
// reports abstention on weak/ambiguous matches, and never changes production
// search, scoring, eligibility, ranking, or lifecycle behavior.
// ---------------------------------------------------------------------------

export const ROLE_MATCHING_INTELLIGENCE_VERSION = 'role-matching-v1';

export type RoleMatchDecision = 'suggested' | 'abstained' | 'rejected';

export interface RoleMatchingOptions {
  minimumSimilarity?: number;
  minimumMargin?: number;
  maximumCandidates?: number;
}

export interface RoleMatchingInput {
  title: string;
  profile: SearchProfile;
  contextText?: string;
  deterministicFamilyKeys?: readonly string[];
}

export interface RoleMatchingPersistenceTarget {
  save(jobId: string, result: RoleMatchingResult): void;
}

export interface RoleMatchCandidate {
  familyKey: string;
  displayName: string;
  matchedTitle: string;
  similarity: number;
  margin: number | null;
  threshold: number;
  decision: RoleMatchDecision;
  matchedTokens: string[];
  method: 'deterministic-fallback';
  version: typeof ROLE_MATCHING_INTELLIGENCE_VERSION;
  explanation: string;
}

export interface RoleMatchingReconciliation {
  state: NlpConflictState;
  deterministicFamilyKeys: string[];
  shadowFamilyKey: string | null;
  note: string;
}

export interface RoleMatchingResult {
  method: 'deterministic-fallback';
  version: typeof ROLE_MATCHING_INTELLIGENCE_VERSION;
  inputTokenCount: number;
  contextTokenCount: number;
  candidates: RoleMatchCandidate[];
  suggestedFamilyKey: string | null;
  reconciliation: RoleMatchingReconciliation;
  thresholds: {
    minimumSimilarity: number;
    minimumMargin: number;
    maximumCandidates: number;
  };
}

export function runRoleMatchingShadow(
  jobId: string,
  input: RoleMatchingInput,
  target: RoleMatchingPersistenceTarget,
  options: RoleMatchingOptions = {},
): RoleMatchingResult {
  if (jobId.trim().length === 0) {
    throw new Error('Role matching jobId must not be empty');
  }
  const result = matchRoleShadow(input, options);
  target.save(jobId, result);
  return result;
}

const DEFAULT_MINIMUM_SIMILARITY = 0.45;
const DEFAULT_MINIMUM_MARGIN = 0.1;
const DEFAULT_MAXIMUM_CANDIDATES = 5;
const ROLE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'job',
  'position',
  'role',
]);

export function matchRoleShadow(
  input: RoleMatchingInput,
  options: RoleMatchingOptions = {},
): RoleMatchingResult {
  const thresholds = validatedOptions(options);
  const titleTokens = roleTokens(input.title);
  const contextTokens = roleTokens(input.contextText ?? '');
  const families = uniqueEnabledFamilies(input.profile);
  const scored = families
    .map((family) =>
      scoreFamily(
        family.key,
        family.displayName,
        family.titles,
        input.title,
        titleTokens,
        contextTokens,
        thresholds.minimumSimilarity,
      ),
    )
    .sort(compareCandidates);
  const top = scored[0];
  const runnerUp = scored[1];
  const topMargin =
    top === undefined
      ? 0
      : runnerUp === undefined
        ? top.similarity
        : top.similarity - runnerUp.similarity;
  const topDecision = decide(top?.similarity ?? 0, topMargin, thresholds);
  const candidates = scored
    .slice(0, thresholds.maximumCandidates)
    .map((candidate, index) => ({
      ...candidate,
      margin: index === 0 ? topMargin : null,
      decision: index === 0 ? topDecision : ('rejected' as const),
    }));
  const suggestedFamilyKey =
    topDecision === 'suggested' ? (top?.familyKey ?? null) : null;
  const deterministicFamilyKeys = [
    ...(input.deterministicFamilyKeys ??
      familiesForJobTitle(input.title, input.profile)),
  ];
  const reconciliation = reconcileRoleMatch(
    deterministicFamilyKeys,
    suggestedFamilyKey,
  );

  return {
    method: 'deterministic-fallback',
    version: ROLE_MATCHING_INTELLIGENCE_VERSION,
    inputTokenCount: titleTokens.length,
    contextTokenCount: contextTokens.length,
    candidates,
    suggestedFamilyKey,
    reconciliation,
    thresholds,
  };
}

interface ScoredCandidate {
  familyKey: string;
  displayName: string;
  matchedTitle: string;
  similarity: number;
  threshold: number;
  matchedTokens: string[];
  method: 'deterministic-fallback';
  version: typeof ROLE_MATCHING_INTELLIGENCE_VERSION;
  explanation: string;
}

function uniqueEnabledFamilies(
  profile: SearchProfile,
): SearchProfile['families'] {
  const families = new Map<string, SearchProfile['families'][number]>();
  for (const family of profile.families) {
    if (family.enabled && !families.has(family.key))
      families.set(family.key, family);
  }
  return [...families.values()];
}

function scoreFamily(
  familyKey: string,
  displayName: string,
  titles: readonly string[],
  sourceTitle: string,
  titleTokens: readonly string[],
  contextTokens: readonly string[],
  threshold: number,
): ScoredCandidate {
  const scoredTitles = titles
    .map((title) => scoreTitle(title, sourceTitle, titleTokens, contextTokens))
    .sort(
      (left, right) =>
        right.similarity - left.similarity ||
        Number(right.exactTitle) - Number(left.exactTitle) ||
        left.title.localeCompare(right.title),
    );
  const best = scoredTitles[0] ?? {
    title: familyKey,
    similarity: 0,
    matchedTokens: [],
    exactTitle: false,
  };
  return {
    familyKey,
    displayName,
    matchedTitle: best.title,
    similarity: best.similarity,
    threshold,
    matchedTokens: best.matchedTokens,
    method: 'deterministic-fallback',
    version: ROLE_MATCHING_INTELLIGENCE_VERSION,
    explanation:
      best.similarity >= threshold
        ? `Configured title overlap with ${String(best.matchedTokens.length)} shared token(s).`
        : 'No configured title overlap cleared the suggestion threshold.',
  };
}

function scoreTitle(
  title: string,
  sourceTitle: string,
  titleTokens: readonly string[],
  contextTokens: readonly string[],
): {
  title: string;
  similarity: number;
  matchedTokens: string[];
  exactTitle: boolean;
} {
  const aliasTokens = roleTokens(title);
  const titleOverlap = overlapScore(titleTokens, aliasTokens);
  const contextOverlap =
    contextTokens.length === 0
      ? titleOverlap
      : overlapScore(contextTokens, aliasTokens);
  const exactPhrase =
    normalizeText(titleTokens.join(' ')) ===
    normalizeText(aliasTokens.join(' '));
  const similarity = exactPhrase
    ? 1
    : Math.min(1, titleOverlap * 0.8 + contextOverlap * 0.2);
  const matchedTokens = [
    ...new Set(intersect(titleTokens, aliasTokens)),
  ].sort();
  return {
    title,
    similarity,
    matchedTokens,
    exactTitle: normalizeText(title) === normalizeText(sourceTitle),
  };
}

function overlapScore(
  left: readonly string[],
  right: readonly string[],
): number {
  if (left.length === 0 || right.length === 0) return 0;
  const intersection = intersect(left, right).length;
  const union = new Set([...left, ...right]).size;
  const overlap = intersection / Math.min(left.length, right.length);
  const jaccard = intersection / union;
  return overlap * 0.6 + jaccard * 0.4;
}

function intersect(
  left: readonly string[],
  right: readonly string[],
): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((token) => rightSet.has(token));
}

function roleTokens(value: string): string[] {
  const expanded = normalizeText(value)
    .replace(/\bcybersecurity\b/g, 'cyber security')
    .replace(/\bdevops\b/g, 'dev ops');
  return [
    ...new Set(
      expanded
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 1 && !ROLE_STOP_WORDS.has(token)),
    ),
  ];
}

function compareCandidates(
  left: ScoredCandidate,
  right: ScoredCandidate,
): number {
  return (
    right.similarity - left.similarity ||
    left.familyKey.localeCompare(right.familyKey)
  );
}

function decide(
  similarity: number,
  margin: number,
  thresholds: Required<RoleMatchingOptions>,
): RoleMatchDecision {
  if (similarity < thresholds.minimumSimilarity) return 'rejected';
  if (margin < thresholds.minimumMargin) return 'abstained';
  return 'suggested';
}

function reconcileRoleMatch(
  deterministicFamilyKeys: readonly string[],
  suggestedFamilyKey: string | null,
): RoleMatchingReconciliation {
  const deterministic = [...new Set(deterministicFamilyKeys)];
  if (deterministic.length === 0 && suggestedFamilyKey === null) {
    return {
      state: 'unknown',
      deterministicFamilyKeys: deterministic,
      shadowFamilyKey: null,
      note: 'Neither deterministic title matching nor the shadow fallback produced a family.',
    };
  }
  if (deterministic.length === 0) {
    return {
      state: 'nlp-only',
      deterministicFamilyKeys: deterministic,
      shadowFamilyKey: suggestedFamilyKey,
      note: 'Only the shadow role suggestion is present; deterministic authority is unchanged.',
    };
  }
  if (suggestedFamilyKey === null) {
    return {
      state: 'deterministic-only',
      deterministicFamilyKeys: deterministic,
      shadowFamilyKey: null,
      note: 'Only deterministic title matching is present; preserve it as authoritative.',
    };
  }
  if (deterministic.includes(suggestedFamilyKey)) {
    return {
      state: 'agreement',
      deterministicFamilyKeys: deterministic,
      shadowFamilyKey: suggestedFamilyKey,
      note: 'The shadow suggestion agrees with a deterministic family match.',
    };
  }
  return {
    state: 'conflict',
    deterministicFamilyKeys: deterministic,
    shadowFamilyKey: suggestedFamilyKey,
    note: 'The shadow suggestion differs from deterministic title matching; no production value changes.',
  };
}

function validatedOptions(
  options: RoleMatchingOptions,
): Required<RoleMatchingOptions> {
  const values = {
    minimumSimilarity: options.minimumSimilarity ?? DEFAULT_MINIMUM_SIMILARITY,
    minimumMargin: options.minimumMargin ?? DEFAULT_MINIMUM_MARGIN,
    maximumCandidates: options.maximumCandidates ?? DEFAULT_MAXIMUM_CANDIDATES,
  };
  if (
    !Number.isFinite(values.minimumSimilarity) ||
    values.minimumSimilarity < 0 ||
    values.minimumSimilarity > 1
  ) {
    throw new Error('Role matching minimumSimilarity must be between 0 and 1');
  }
  if (
    !Number.isFinite(values.minimumMargin) ||
    values.minimumMargin < 0 ||
    values.minimumMargin > 1
  ) {
    throw new Error('Role matching minimumMargin must be between 0 and 1');
  }
  if (
    !Number.isInteger(values.maximumCandidates) ||
    values.maximumCandidates < 1
  ) {
    throw new Error(
      'Role matching maximumCandidates must be a positive integer',
    );
  }
  return values;
}
