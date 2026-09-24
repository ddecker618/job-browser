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

export function resumeOnboardingProgress(
  result: OnboardingProgressLoadResult,
  draft: OnboardingPreferencesDraft,
): {
  snapshot: OnboardingProgressSnapshot;
  question: OnboardingQuestion | null;
} {
  if (result.kind === 'valid') {
    const question = result.snapshot.currentQuestion;
    return {
      snapshot: result.snapshot,
      question:
        question === 'salary'
          ? firstUnresolvedQuestion(result.snapshot.answers)
          : question,
    };
  }
  return {
    snapshot: {
      version: 2,
      onboardingStep: 'preferences',
      currentQuestion: firstUnresolvedQuestion(draft),
      answers: draft,
      reviewItems: [],
    },
    question: firstUnresolvedQuestion(draft),
  };
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

export function currentOnboardingQuestion(
  result: OnboardingProgressLoadResult,
  draft: OnboardingPreferencesDraft,
): OnboardingQuestion | null {
  return resumeOnboardingProgress(result, draft).question;
}
