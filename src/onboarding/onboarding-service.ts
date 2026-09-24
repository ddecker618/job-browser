import type { CandidateProfile } from '../schemas/candidate-profile.js';
import type {
  OnboardingPreferencesDraft,
  OnboardingProgressSnapshot,
  OnboardingQuestion,
  OnboardingReviewItem,
  OnboardingValidatedPreferences,
} from '../models/onboarding.js';
import {
  firstUnresolvedQuestion,
  mergePreferencesIntoProfile,
} from '../schemas/onboarding.js';
import {
  loadOnboardingProgress,
  resetOnboardingProgress,
  type OnboardingProgressLoadResult,
  type OnboardingProgressStore,
} from '../repositories/onboarding-repository.js';
import { saveUnifiedProfilePreferences } from '../preferences/profilePreferencesRuntime.js';
import type { LegacyPreferences } from '../preferences/profilePreferencesAdapters.js';

export function restoreOnboardingProgress(
  store: OnboardingProgressStore,
  profileId: string,
): OnboardingProgressLoadResult {
  return loadOnboardingProgress(store, profileId);
}

/**
 * Blocked/error resume states returned to the integration layer.
 * These carry the original error or version information so the
 * integration layer can surface, report, or reset the stored progress
 * rather than treating it as a missing first-run record.
 */
export type OnboardingResumeBlock =
  | { kind: 'blocked-malformed'; error: Error }
  | { kind: 'blocked-unsupported-version'; version: number }
  | { kind: 'blocked-storage-failure'; error: Error };

export interface OnboardingReadyResume {
  readonly kind: 'ready';
  /** Whether the snapshot came from storage or was freshly minted. */
  readonly source: 'stored' | 'fresh';
  readonly snapshot: OnboardingProgressSnapshot;
  readonly question: OnboardingQuestion | null;
}

/**
 * Discriminated resume result returned to the integration layer.
 *
 * - `ready` (source `'stored'`) preserves the stored snapshot version
 *   and recovers a stored disabled `salary` position to the first
 *   enabled unresolved question without rewriting storage.
 * - `ready` (source `'fresh'`) is **only** produced from a `missing`
 *   load result and mints a new version-2 snapshot from the supplied
 *   draft.
 * - The three `blocked-*` variants preserve the original
 *   `error`/`version` so the integration layer can distinguish
 *   corruption, incompatibility, and storage failure from a normal
 *   first-run session.
 */
export type OnboardingResumeResult =
  | OnboardingReadyResume
  | OnboardingResumeBlock;

export interface OnboardingReadyResumeQuestion {
  readonly kind: 'ready';
  readonly source: 'stored' | 'fresh';
  readonly question: OnboardingQuestion | null;
}

/**
 * Question-only discriminated resume result. `null` only appears on the
 * `ready` branch (a legitimate completed-step value); the `blocked-*`
 * branches never collapse to `null`.
 */
export type OnboardingResumeQuestion =
  | OnboardingReadyResumeQuestion
  | OnboardingResumeBlock;

/**
 * Resume an onboarding session from a `load` result.
 *
 * Only a `missing` load is allowed to mint a fresh version-2 snapshot
 * from the supplied draft. `valid` resumes the stored snapshot and
 * recovers a stored disabled `salary` position without mutating the
 * stored row. `malformed`, `unsupported-version`, and `storage-failure`
 * are returned as blocked states with the original error/version
 * preserved — they must never be presented as a normal first-run
 * session.
 */
export function resumeOnboardingProgress(
  result: OnboardingProgressLoadResult,
  draft: OnboardingPreferencesDraft,
): OnboardingResumeResult {
  if (result.kind === 'valid') {
    const stored = result.snapshot;
    const recoveredQuestion: OnboardingQuestion | null =
      stored.currentQuestion === 'salary'
        ? firstUnresolvedQuestion(stored.answers)
        : stored.currentQuestion;
    return {
      kind: 'ready',
      source: 'stored',
      snapshot: stored,
      question: recoveredQuestion,
    };
  }
  if (result.kind === 'missing') {
    const question = firstUnresolvedQuestion(draft);
    return {
      kind: 'ready',
      source: 'fresh',
      snapshot: {
        version: 2,
        onboardingStep: 'preferences',
        currentQuestion: question,
        answers: draft,
        reviewItems: [],
      },
      question,
    };
  }
  if (result.kind === 'malformed') {
    return { kind: 'blocked-malformed', error: result.error };
  }
  if (result.kind === 'unsupported-version') {
    return { kind: 'blocked-unsupported-version', version: result.version };
  }
  return { kind: 'blocked-storage-failure', error: result.error };
}

export function reviewItemsFromProgress(
  result: OnboardingProgressLoadResult,
): readonly OnboardingReviewItem[] {
  if (result.kind !== 'valid' || result.snapshot.version !== 2) return [];
  return result.snapshot.reviewItems;
}

export function applyConfirmedReviewItems(
  profile: CandidateProfile,
  items: readonly OnboardingReviewItem[],
): CandidateProfile {
  const skills = new Set(profile.skills);
  const certifications = new Set(profile.certifications);
  for (const item of items) {
    if (item.status !== 'confirmed' || item.value.trim() === '') continue;
    if (item.field === 'skills') skills.add(item.value.trim());
    else certifications.add(item.value.trim());
  }
  return {
    ...profile,
    skills: [...skills],
    certifications: [...certifications],
  };
}

export interface CompleteOnboardingOptions {
  profilePreferencesPath: string;
  profilePreferences: LegacyPreferences;
  preferences: OnboardingValidatedPreferences;
  reviewItems: readonly OnboardingReviewItem[];
  /**
   * The profile id whose onboarding progress key must be cleared on
   * completion. Passed explicitly so the storage key never has to be
   * inferred from a possibly replaced or stale `CandidateProfile`.
   */
  profileId: string;
}

export function completeOnboarding(
  store: OnboardingProgressStore,
  options: CompleteOnboardingOptions,
): CandidateProfile {
  const merged = mergePreferencesIntoProfile(
    options.profilePreferences.candidateProfile,
    options.preferences,
  );
  const nextProfile = applyConfirmedReviewItems(merged, options.reviewItems);
  saveUnifiedProfilePreferences(options.profilePreferencesPath, {
    ...options.profilePreferences,
    candidateProfile: nextProfile,
  });
  resetOnboardingProgress(store, options.profileId);
  return nextProfile;
}

/**
 * Question-only resume helper. Returns a discriminated result so the
 * integration layer can switch exhaustively on `kind`. Blocked/error
 * states are surfaced verbatim and never collapsed to `null` (a
 * legitimate completed-step value).
 */
export function currentOnboardingQuestion(
  result: OnboardingProgressLoadResult,
  draft: OnboardingPreferencesDraft,
): OnboardingResumeQuestion {
  const resumed = resumeOnboardingProgress(result, draft);
  if (resumed.kind === 'ready') {
    return {
      kind: 'ready',
      source: resumed.source,
      question: resumed.question,
    };
  }
  return resumed;
}
