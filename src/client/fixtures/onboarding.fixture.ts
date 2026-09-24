/*
 * All values in this fixture file are fictional. They exist only to
 * exercise the onboarding contract in isolation and are not, and must
 * never be treated as, real candidate or employer data.
 */
import type {
  OnboardingPreferencesDraft,
  OnboardingPreferencesStepProps,
  OnboardingProgressSnapshot,
  OnboardingReviewItem,
  OnboardingReviewStepProps,
} from '../../models/onboarding.js';

/**
 * The reachable end state of the current onboarding flow: all five
 * ENABLED questions answered. The salary question is deferred (L1), so
 * salary stays unanswered with no amounts.
 */
export const fictionalPreferencesDraftComplete: OnboardingPreferencesDraft = {
  desiredJobTitles: ['Network Engineer', 'Cloud Support Engineer'],
  preferredLocations: [
    { city: 'Austin', state: 'TX' },
    { city: 'Remote', state: 'TX' },
  ],
  searchRadiusMiles: '50',
  secondarySearchRadiusMiles: '75',
  remotePreference: 'preferred',
  answers: {
    remotePreference: 'answered',
    desiredSalary: 'unanswered',
  },
  desiredSalary: null,
  desiredEmploymentTypes: ['full-time', 'contract'],
};

/**
 * Demonstrates the full supported contract including the deferred
 * salary question (supported, not enabled today). Kept for future use
 * when salary-period semantics are resolved (L1).
 */
export const fictionalFullContractDraft: OnboardingPreferencesDraft = {
  ...fictionalPreferencesDraftComplete,
  answers: {
    ...fictionalPreferencesDraftComplete.answers,
    desiredSalary: 'answered',
  },
  desiredSalary: {
    minimum: '70000',
    target: '85000',
    currency: 'USD',
  },
};

export const fictionalFirstTimeUserDraft: OnboardingPreferencesDraft = {
  desiredJobTitles: [],
  preferredLocations: [],
  searchRadiusMiles: '',
  secondarySearchRadiusMiles: '',
  remotePreference: null,
  answers: {
    remotePreference: 'unanswered',
    desiredSalary: 'unanswered',
  },
  desiredSalary: null,
  desiredEmploymentTypes: [],
};

/**
 * A deliberate skip recorded in a stored snapshot (L4). Not reachable
 * from the current enabled flow because salary is deferred.
 */
export const fictionalSkippedSalaryDraft: OnboardingPreferencesDraft = {
  ...fictionalFullContractDraft,
  desiredSalary: null,
  answers: {
    ...fictionalFullContractDraft.answers,
    desiredSalary: 'skipped',
  },
};

/**
 * A partial session resumed at the travel-distance question: roles and
 * location are answered, radii and everything later are still open.
 */
export const fictionalResumedProgressDraft: OnboardingPreferencesDraft = {
  desiredJobTitles: ['Network Engineer'],
  preferredLocations: [{ city: 'Austin', state: 'TX' }],
  searchRadiusMiles: '',
  secondarySearchRadiusMiles: '',
  remotePreference: null,
  answers: {
    remotePreference: 'unanswered',
    desiredSalary: 'unanswered',
  },
  desiredSalary: null,
  desiredEmploymentTypes: [],
};

export const fictionalResumedProgressSnapshot: OnboardingProgressSnapshot = {
  version: 1,
  onboardingStep: 'preferences',
  currentQuestion: 'travel-distance',
  answers: fictionalResumedProgressDraft,
};

export const fictionalCorrectedLocationDraft: OnboardingPreferencesDraft = {
  ...fictionalPreferencesDraftComplete,
  preferredLocations: [
    { city: 'Fort Worth', state: 'TX' },
    { city: 'Plano', state: 'TX' },
  ],
};

export const fictionalPreferencesDraftMissingLocation: OnboardingPreferencesDraft =
  {
    ...fictionalPreferencesDraftComplete,
    preferredLocations: [
      { city: 'Dallas', state: '' },
      { city: '', state: 'OK' },
    ],
  };

export const fictionalPreferencesDraftEmptyRoles: OnboardingPreferencesDraft = {
  ...fictionalPreferencesDraftComplete,
  desiredJobTitles: ['  ', '  '],
};

export const fictionalPreferencesDraftEmptyEmploymentTypes: OnboardingPreferencesDraft =
  {
    ...fictionalPreferencesDraftComplete,
    desiredEmploymentTypes: [],
  };

export const fictionalPreferencesDraftInvalidRadius: OnboardingPreferencesDraft =
  {
    ...fictionalPreferencesDraftComplete,
    searchRadiusMiles: '100',
    secondarySearchRadiusMiles: '50',
  };

export const fictionalPreferencesDraftInvalidSalaryRange: OnboardingPreferencesDraft =
  {
    ...fictionalFullContractDraft,
    desiredSalary: {
      minimum: '90000',
      target: '80000',
      currency: 'USD',
    },
  };

export const fictionalPreferencesSavingProps: OnboardingPreferencesStepProps = {
  value: fictionalPreferencesDraftComplete,
  errors: {},
  currentQuestion: 'employment-types',
  saving: true,
  saveError: null,
  onChange: () => undefined,
  onBack: () => undefined,
  onContinue: () => undefined,
};

export const fictionalPreferencesSaveFailureProps: OnboardingPreferencesStepProps =
  {
    value: fictionalPreferencesDraftComplete,
    errors: {},
    currentQuestion: 'employment-types',
    saving: false,
    saveError: 'Could not save preferences. Please try again.',
    onChange: () => undefined,
    onBack: () => undefined,
    onContinue: () => undefined,
  };

export const fictionalReviewItems: readonly OnboardingReviewItem[] = [
  {
    id: 'rev-1',
    field: 'skills',
    value: 'BGP configuration',
    status: 'confirmed',
    reason: null,
  },
  {
    id: 'rev-2',
    field: 'skills',
    value: 'Cisco Meraki administration',
    status: 'suggested',
    reason: 'Present in resume work history.',
  },
  {
    id: 'rev-3',
    field: 'certifications',
    value: 'CCNP Enterprise',
    status: 'confirmed',
    reason: null,
  },
  {
    id: 'rev-4',
    field: 'certifications',
    value: 'CompTIA Security+',
    status: 'unknown',
    reason: 'No evidence found.',
  },
];

export const fictionalReviewSavingProps: OnboardingReviewStepProps = {
  items: fictionalReviewItems,
  saving: true,
  saveError: null,
  onChange: () => undefined,
  onBack: () => undefined,
  onContinue: () => undefined,
};
