import type { EmploymentType } from '../domain/job.js';
import type { CandidateProfile } from '../schemas/candidate-profile.js';

export interface OnboardingLocationDraft {
  city: string;
  state: string;
}

export interface OnboardingSalaryDraft {
  minimum: string;
  target: string;
  currency: string;
}

export type RemotePreference = CandidateProfile['remotePreference'];

export type OnboardingQuestionState = 'unanswered' | 'answered' | 'skipped';

export interface OnboardingAnswerStates {
  remotePreference: OnboardingQuestionState;
  desiredSalary: OnboardingQuestionState;
}

export interface OnboardingPreferencesDraft {
  desiredJobTitles: string[];
  preferredLocations: OnboardingLocationDraft[];
  searchRadiusMiles: string;
  secondarySearchRadiusMiles: string;
  remotePreference: RemotePreference | null;
  answers: OnboardingAnswerStates;
  desiredSalary: OnboardingSalaryDraft | null;
  desiredEmploymentTypes: EmploymentType[];
}

export type OnboardingValidatedPreferences = Pick<
  CandidateProfile,
  | 'preferredLocations'
  | 'searchRadiusMiles'
  | 'secondarySearchRadiusMiles'
  | 'remotePreference'
  | 'desiredSalary'
  | 'desiredJobTitles'
  | 'desiredEmploymentTypes'
>;

export interface OnboardingLocationErrorEntry {
  index: number;
  city?: string;
  state?: string;
}

export interface OnboardingLocationErrors {
  empty: boolean;
  entries: OnboardingLocationErrorEntry[];
}

export interface OnboardingSalaryErrors {
  minimum?: string;
  target?: string;
  currency?: string;
}

export interface OnboardingFieldErrors {
  desiredJobTitles?: string;
  preferredLocations?: OnboardingLocationErrors;
  searchRadiusMiles?: string;
  secondarySearchRadiusMiles?: string;
  remotePreference?: string;
  desiredSalary?: OnboardingSalaryErrors;
  desiredEmploymentTypes?: string;
}

export interface OnboardingSaveState {
  saving: boolean;
  saveError: string | null;
}

/**
 * Contract for the preferences step. The parent owns the draft, the
 * current-question position, navigation and saving; the component never
 * saves, navigates or invents a value on its own.
 * - onChange: parent applies the updated draft WITHOUT advancing.
 * - onContinue: parent validates the current question and, if valid,
 *   advances to the next enabled question. On the final enabled
 *   question it requests final validation and saving instead.
 * - onBack: parent moves backward one enabled question while preserving
 *   all answers.
 * The parent restores currentQuestion from the progress snapshot when a
 * session resumes.
 */
export interface OnboardingPreferencesStepProps extends OnboardingSaveState {
  value: OnboardingPreferencesDraft;
  errors: OnboardingFieldErrors;
  currentQuestion: OnboardingQuestion;
  onChange: (next: OnboardingPreferencesDraft) => void;
  onBack: () => void;
  onContinue: () => void;
}

export type OnboardingReviewStatus = 'confirmed' | 'suggested' | 'unknown';

export interface OnboardingReviewItem {
  id: string;
  field: 'skills' | 'certifications';
  value: string;
  status: OnboardingReviewStatus;
  reason: string | null;
}

export interface OnboardingReviewStepProps extends OnboardingSaveState {
  items: readonly OnboardingReviewItem[];
  onChange: (next: readonly OnboardingReviewItem[]) => void;
  onBack: () => void;
  onContinue: () => void;
}

export type OnboardingStep =
  | 'experience'
  | 'preferences'
  | 'review'
  | 'search-plan';

export type OnboardingQuestion =
  | 'desired-work'
  | 'location'
  | 'travel-distance'
  | 'remote-work'
  | 'employment-types'
  | 'salary';

/**
 * Questions the current onboarding UI actually walks through. The salary
 * question is supported by the contract but deferred (L1) until salary
 * period semantics are resolved, so it is excluded here.
 */
export type OnboardingEnabledQuestion = Exclude<OnboardingQuestion, 'salary'>;

export interface OnboardingProgressSnapshotV1 {
  version: 1;
  onboardingStep: OnboardingStep;
  currentQuestion: OnboardingQuestion | null;
  answers: OnboardingPreferencesDraft;
}

export interface OnboardingProgressSnapshotV2 extends Omit<
  OnboardingProgressSnapshotV1,
  'version'
> {
  version: 2;
  reviewItems: readonly OnboardingReviewItem[];
}

export type OnboardingProgressSnapshot =
  | OnboardingProgressSnapshotV1
  | OnboardingProgressSnapshotV2;

export type PreferencesConversionResult =
  | { ok: true; value: OnboardingValidatedPreferences }
  | { ok: false; errors: OnboardingFieldErrors };
