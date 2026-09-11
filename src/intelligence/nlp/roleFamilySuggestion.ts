import {
  matchRoleShadow,
  ROLE_MATCHING_INTELLIGENCE_VERSION,
  type RoleMatchingInput,
  type RoleMatchingOptions,
  type RoleMatchingResult,
} from './roleMatching.js';
import type { SearchProfile } from '../../config/search-profile.js';
import type { NlpConflictState } from '../../schemas/job-nlp.js';

// ---------------------------------------------------------------------------
// P7 - production role family suggestion.
//
// Promotes role family matching to a production-facing suggestion ONLY where
// the shadow matcher reconciles with the app's deterministic title matching
// (agreement state). In agreement the suggested family is surfaced with the
// evidence that produced it. Conflict, nlp-only, and unknown states never
// surface an NLP suggestion; deterministic-only surfaces the app's structured
// family clearly labeled as deterministic (no NLP claim). The projection is
// read-time only, never persists, and never feeds a decide path: it is a
// suggestion, not a gate.
//
// Safety constraints honored here:
//   - abstain/conflict behavior is identical to the shadow matcher;
//   - never changes score, eligibility, ranking, filtering, or lifecycle;
//   - the suggested family is always reconciled with deterministic authority.
// ---------------------------------------------------------------------------

export const ROLE_FAMILY_SUGGESTION_VERSION = 'role-family-suggestion-v1';

export interface RoleFamilySuggestion {
  suggestionVersion: typeof ROLE_FAMILY_SUGGESTION_VERSION;
  roleMatchingVersion: typeof ROLE_MATCHING_INTELLIGENCE_VERSION;
  jobId: string;
  title: string;
  state: NlpConflictState;
  nlpAbstained: boolean;
  suggestedFamilyKey: string | null;
  suggestedDisplayName: string | null;
  suggestedSource: 'nlp-reconciled' | 'deterministic' | null;
  reason: string | null;
  evidence: {
    deterministicFamilyKeys: string[];
    shadowFamilyKey: string | null;
    matchedTitle: string | null;
    similarity: number | null;
    margin: number | null;
    decision: string | null;
    matchedTokens: string[];
  };
  authority: {
    gate: 'never';
    score: 'deterministic-unaffected';
    ranking: 'deterministic-unaffected';
    eligibility: 'deterministic-unaffected';
    lifecycle: 'deterministic-unaffected';
  };
}

const AGREEMENT_REASON =
  'Recommended: role matching agrees with the structured job title record.';
const DETERMINISTIC_ONLY_REASON =
  'Deterministic title matching only; no NLP role claim is surfaced.';
const CONFLICT_REASON =
  'NLP role suggestion differs from deterministic title matching; the deterministic record stays authoritative and no NLP claim is surfaced.';
const NLP_ONLY_REASON =
  'Only a tentative NLP role suggestion exists with no structured counterpart; no NLP claim is surfaced.';
const UNKNOWN_REASON =
  'Neither deterministic title matching nor the shadow matcher produced a family.';

export function projectRoleFamilySuggestion(
  jobId: string,
  input: RoleMatchingInput,
  options: RoleMatchingOptions = {},
): RoleFamilySuggestion {
  if (jobId.trim().length === 0) {
    throw new Error('Role family suggestion jobId must not be empty');
  }
  const shadow = matchRoleShadow(input, options);
  const top = shadow.candidates[0];
  const suggested = suggestionFor(shadow, input.profile);

  return {
    suggestionVersion: ROLE_FAMILY_SUGGESTION_VERSION,
    roleMatchingVersion: ROLE_MATCHING_INTELLIGENCE_VERSION,
    jobId,
    title: input.title,
    state: shadow.reconciliation.state,
    nlpAbstained: top?.decision === 'abstained',
    suggestedFamilyKey: suggested?.familyKey ?? null,
    suggestedDisplayName: suggested?.displayName ?? null,
    suggestedSource: suggested?.source ?? null,
    reason: suggested?.reason ?? reasonFor(shadow.reconciliation.state),
    evidence: {
      deterministicFamilyKeys: shadow.reconciliation.deterministicFamilyKeys,
      shadowFamilyKey: shadow.reconciliation.shadowFamilyKey,
      matchedTitle: top?.matchedTitle ?? null,
      similarity: top?.similarity ?? null,
      margin: top?.margin ?? null,
      decision: top?.decision ?? null,
      matchedTokens: top?.matchedTokens ?? [],
    },
    authority: {
      gate: 'never',
      score: 'deterministic-unaffected',
      ranking: 'deterministic-unaffected',
      eligibility: 'deterministic-unaffected',
      lifecycle: 'deterministic-unaffected',
    },
  };
}

interface RoleFamilySuggestionPart {
  familyKey: string;
  displayName: string;
  source: 'nlp-reconciled' | 'deterministic';
  reason: string;
}

function suggestionFor(
  shadow: RoleMatchingResult,
  profile: SearchProfile,
): RoleFamilySuggestionPart | null {
  if (shadow.reconciliation.state === 'agreement') {
    const key = shadow.reconciliation.shadowFamilyKey;
    if (key === null) return null;
    return {
      familyKey: key,
      displayName: familyByKey(profile, key)?.displayName ?? key,
      source: 'nlp-reconciled',
      reason: AGREEMENT_REASON,
    };
  }
  if (shadow.reconciliation.state === 'deterministic-only') {
    const key = shadow.reconciliation.deterministicFamilyKeys[0];
    if (key === undefined) return null;
    return {
      familyKey: key,
      displayName: familyByKey(profile, key)?.displayName ?? key,
      source: 'deterministic',
      reason: DETERMINISTIC_ONLY_REASON,
    };
  }
  return null;
}

function reasonFor(state: NlpConflictState): string | null {
  switch (state) {
    case 'conflict':
      return CONFLICT_REASON;
    case 'nlp-only':
      return NLP_ONLY_REASON;
    case 'unknown':
      return UNKNOWN_REASON;
    default:
      return null;
  }
}

function familyByKey(
  profile: SearchProfile,
  key: string,
): SearchProfile['families'][number] | undefined {
  return profile.families.find((family) => family.key === key);
}
