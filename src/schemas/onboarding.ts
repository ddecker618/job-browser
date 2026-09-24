import { z } from 'zod';

import type {
  OnboardingEnabledQuestion,
  OnboardingFieldErrors,
  OnboardingPreferencesDraft,
  OnboardingQuestion,
  OnboardingSalaryErrors,
  OnboardingProgressSnapshot,
  OnboardingStep,
  OnboardingValidatedPreferences,
  PreferencesConversionResult,
} from '../models/onboarding.js';
import { EMPLOYMENT_TYPES } from '../domain/job.js';
import {
  candidateProfileSchema,
  type CandidateProfile,
} from './candidate-profile.js';

const candidateShape = candidateProfileSchema.shape;

export const onboardingSalaryDraftSchema = z.strictObject({
  minimum: z.string(),
  target: z.string(),
  currency: z.string(),
});

export const onboardingLocationDraftSchema = z.strictObject({
  city: z.string(),
  state: z.string(),
});

export const onboardingAnswerStatesSchema = z.strictObject({
  remotePreference: z.enum(['unanswered', 'answered', 'skipped']),
  desiredSalary: z.enum(['unanswered', 'answered', 'skipped']),
});

export const onboardingPreferencesDraftSchema = z.strictObject({
  desiredJobTitles: z.array(z.string()),
  preferredLocations: z.array(onboardingLocationDraftSchema),
  searchRadiusMiles: z.string(),
  secondarySearchRadiusMiles: z.string(),
  remotePreference: candidateShape.remotePreference.nullable(),
  answers: onboardingAnswerStatesSchema,
  desiredSalary: onboardingSalaryDraftSchema.nullable(),
  desiredEmploymentTypes: z.array(z.enum(EMPLOYMENT_TYPES)),
});

export const onboardingValidatedPreferencesSchema = z
  .strictObject({
    preferredLocations: candidateShape.preferredLocations,
    searchRadiusMiles: candidateShape.searchRadiusMiles,
    secondarySearchRadiusMiles: candidateShape.secondarySearchRadiusMiles,
    remotePreference: candidateShape.remotePreference,
    desiredSalary: candidateShape.desiredSalary,
    desiredJobTitles: candidateShape.desiredJobTitles,
    desiredEmploymentTypes: candidateShape.desiredEmploymentTypes,
  })
  .refine(
    (prefs) => prefs.secondarySearchRadiusMiles >= prefs.searchRadiusMiles,
    {
      message: 'Secondary radius cannot be smaller than primary radius',
      path: ['secondarySearchRadiusMiles'],
    },
  );

const onboardingStepSchema = z.enum([
  'experience',
  'preferences',
  'review',
  'search-plan',
]);

const onboardingQuestionSchema = z
  .enum([
    'desired-work',
    'location',
    'travel-distance',
    'remote-work',
    'employment-types',
    'salary',
  ])
  .nullable();

const onboardingReviewItemSchema = z.strictObject({
  id: z.string().min(1),
  field: z.enum(['skills', 'certifications']),
  value: z.string(),
  status: z.enum(['confirmed', 'suggested', 'unknown']),
  reason: z.string().nullable(),
});

export const onboardingProgressSnapshotV1Schema = z.strictObject({
  version: z.literal(1),
  onboardingStep: onboardingStepSchema,
  currentQuestion: onboardingQuestionSchema,
  answers: onboardingPreferencesDraftSchema,
});

export const onboardingProgressSnapshotV2Schema = z.strictObject({
  version: z.literal(2),
  onboardingStep: onboardingStepSchema,
  currentQuestion: onboardingQuestionSchema,
  answers: onboardingPreferencesDraftSchema,
  reviewItems: z.array(onboardingReviewItemSchema),
});

export const onboardingProgressSnapshotSchema = z.union([
  onboardingProgressSnapshotV1Schema,
  onboardingProgressSnapshotV2Schema,
]);

export const ONBOARDING_QUESTION_SEQUENCE: readonly OnboardingQuestion[] = [
  'desired-work',
  'location',
  'travel-distance',
  'remote-work',
  'employment-types',
  'salary',
];

export const ONBOARDING_ENABLED_QUESTION_SEQUENCE: readonly OnboardingEnabledQuestion[] =
  [
    'desired-work',
    'location',
    'travel-distance',
    'remote-work',
    'employment-types',
  ];

export const ONBOARDING_REQUIRED_QUESTIONS: readonly OnboardingQuestion[] = [
  'desired-work',
  'location',
  'travel-distance',
  'remote-work',
  'employment-types',
];

export const ONBOARDING_OPTIONAL_QUESTIONS: readonly OnboardingQuestion[] = [
  'salary',
];

const NON_EMPTY_LOCATION = 'Enter a city or state for every location.';
const RADIUS_REQUIRED = 'Enter a search radius in whole miles.';
const RADIUS_NUMBER = 'Enter a whole number greater than zero.';
const RADIUS_RELATIONSHIP =
  'Secondary radius cannot be smaller than primary radius.';
const ROLE_REQUIRED = 'Add at least one desired role.';
const EMPLOYMENT_TYPE_REQUIRED = 'Select at least one desired employment type.';
const REMOTE_REQUIRED = 'Choose a remote-work option before continuing.';
const SALARY_TARGET_REQUIRED =
  'Enter a target amount, or clear both to leave salary unset.';
const SALARY_MINIMUM_REQUIRED =
  'Enter a minimum amount, or clear both to leave salary unset.';
const SALARY_INCONSISTENT_STATE =
  'Salary is skipped or undecided. Clear the amounts or choose to include a salary.';
const SALARY_RANGE = 'Target salary cannot be below minimum salary.';
const CURRENCY_REQUIRED = 'Enter a 3-letter currency code such as USD.';
const CURRENCY_LENGTH = 'Currency must be a 3-letter code such as USD.';

// Accepted decimal syntax: digits with an optional decimal part. No sign,
// no exponent, no hex, no separators, no leading/trailing dot. Blank stays
// distinct from zero; "0" is an explicit amount. See decision D1a/D1b.
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

export function parseAmountText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!DECIMAL_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function parseRadiusMiles(text: string): number | null {
  const parsed = parseAmountText(text);
  if (parsed === null) return null;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function trimmedNonEmpty(lines: readonly string[]): string[] {
  return lines.map((line) => line.trim()).filter((line) => line !== '');
}

function mergeErrors(
  target: OnboardingFieldErrors,
  ...parts: OnboardingFieldErrors[]
): OnboardingFieldErrors {
  for (const part of parts) {
    if (part.desiredJobTitles !== undefined) {
      target.desiredJobTitles = part.desiredJobTitles;
    }
    if (part.preferredLocations !== undefined) {
      target.preferredLocations = part.preferredLocations;
    }
    if (part.searchRadiusMiles !== undefined) {
      target.searchRadiusMiles = part.searchRadiusMiles;
    }
    if (part.secondarySearchRadiusMiles !== undefined) {
      target.secondarySearchRadiusMiles = part.secondarySearchRadiusMiles;
    }
    if (part.remotePreference !== undefined) {
      target.remotePreference = part.remotePreference;
    }
    if (part.desiredSalary !== undefined) {
      target.desiredSalary = part.desiredSalary;
    }
    if (part.desiredEmploymentTypes !== undefined) {
      target.desiredEmploymentTypes = part.desiredEmploymentTypes;
    }
  }
  return target;
}

function desiredWorkErrors(
  draft: OnboardingPreferencesDraft,
): OnboardingFieldErrors {
  if (trimmedNonEmpty(draft.desiredJobTitles).length === 0) {
    return { desiredJobTitles: ROLE_REQUIRED };
  }
  return {};
}

function locationErrors(
  draft: OnboardingPreferencesDraft,
): OnboardingFieldErrors {
  if (draft.preferredLocations.length === 0) {
    return { preferredLocations: { empty: true, entries: [] } };
  }
  const entries = draft.preferredLocations.flatMap((location, index) => {
    const city = location.city.trim();
    const state = location.state.trim();
    if (city !== '' && state !== '') {
      return [];
    }
    const entry: {
      index: number;
      city?: string;
      state?: string;
    } = { index };
    if (city === '') entry.city = NON_EMPTY_LOCATION;
    if (state === '') entry.state = NON_EMPTY_LOCATION;
    return [entry];
  });
  if (entries.length === 0) return {};
  return { preferredLocations: { empty: false, entries } };
}

function travelDistanceErrors(
  draft: OnboardingPreferencesDraft,
): OnboardingFieldErrors {
  const errors: OnboardingFieldErrors = {};
  const primaryBlank = draft.searchRadiusMiles.trim() === '';
  const secondaryBlank = draft.secondarySearchRadiusMiles.trim() === '';
  if (primaryBlank) {
    errors.searchRadiusMiles = RADIUS_REQUIRED;
  } else if (parseRadiusMiles(draft.searchRadiusMiles) === null) {
    errors.searchRadiusMiles = RADIUS_NUMBER;
  }
  if (secondaryBlank) {
    errors.secondarySearchRadiusMiles = RADIUS_REQUIRED;
  } else if (parseRadiusMiles(draft.secondarySearchRadiusMiles) === null) {
    errors.secondarySearchRadiusMiles = RADIUS_NUMBER;
  }
  const primary = parseRadiusMiles(draft.searchRadiusMiles);
  const secondary = parseRadiusMiles(draft.secondarySearchRadiusMiles);
  if (primary !== null && secondary !== null && secondary < primary) {
    errors.secondarySearchRadiusMiles = RADIUS_RELATIONSHIP;
  }
  return errors;
}

function remoteWorkErrors(
  draft: OnboardingPreferencesDraft,
): OnboardingFieldErrors {
  if (
    draft.answers.remotePreference !== 'answered' ||
    draft.remotePreference === null
  ) {
    return { remotePreference: REMOTE_REQUIRED };
  }
  return {};
}

function employmentTypesErrors(
  draft: OnboardingPreferencesDraft,
): OnboardingFieldErrors {
  if (draft.desiredEmploymentTypes.length === 0) {
    return { desiredEmploymentTypes: EMPLOYMENT_TYPE_REQUIRED };
  }
  return {};
}

function salaryErrors(
  draft: OnboardingPreferencesDraft,
): OnboardingFieldErrors {
  const { desiredSalary, answers } = draft;
  if (answers.desiredSalary !== 'answered') {
    const minimumPresent =
      desiredSalary !== null && desiredSalary.minimum.trim() !== '';
    const targetPresent =
      desiredSalary !== null && desiredSalary.target.trim() !== '';
    if (!minimumPresent && !targetPresent) {
      return {};
    }
    const salary: OnboardingSalaryErrors = {};
    if (minimumPresent) salary.minimum = SALARY_INCONSISTENT_STATE;
    if (targetPresent) salary.target = SALARY_INCONSISTENT_STATE;
    return { desiredSalary: salary };
  }
  if (desiredSalary === null) {
    return {
      desiredSalary: {
        minimum: SALARY_MINIMUM_REQUIRED,
        target: SALARY_TARGET_REQUIRED,
      },
    };
  }
  const minimumText = desiredSalary.minimum.trim();
  const targetText = desiredSalary.target.trim();
  const currency = desiredSalary.currency.trim();

  const salary: OnboardingSalaryErrors = {};
  const minimum = parseAmountText(minimumText);
  const target = parseAmountText(targetText);

  if (minimumText === '') {
    salary.minimum = SALARY_MINIMUM_REQUIRED;
  } else if (minimum === null) {
    salary.minimum = 'Enter a number in the accepted format.';
  }
  if (targetText === '') {
    salary.target = SALARY_TARGET_REQUIRED;
  } else if (target === null) {
    salary.target = 'Enter a number in the accepted format.';
  }
  if (minimum !== null && target !== null && target < minimum) {
    salary.target = SALARY_RANGE;
  }
  if (currency === '') {
    salary.currency = CURRENCY_REQUIRED;
  } else if (currency.length !== 3) {
    salary.currency = CURRENCY_LENGTH;
  }
  return salary.minimum !== undefined ||
    salary.target !== undefined ||
    salary.currency !== undefined
    ? { desiredSalary: salary }
    : {};
}

function hasErrors(errors: OnboardingFieldErrors): boolean {
  return (
    errors.desiredJobTitles !== undefined ||
    errors.preferredLocations !== undefined ||
    errors.searchRadiusMiles !== undefined ||
    errors.secondarySearchRadiusMiles !== undefined ||
    errors.remotePreference !== undefined ||
    errors.desiredSalary !== undefined ||
    errors.desiredEmploymentTypes !== undefined
  );
}

const QUESTION_VALIDATORS: Record<
  OnboardingQuestion,
  (draft: OnboardingPreferencesDraft) => OnboardingFieldErrors
> = {
  'desired-work': desiredWorkErrors,
  location: locationErrors,
  'travel-distance': travelDistanceErrors,
  'remote-work': remoteWorkErrors,
  'employment-types': employmentTypesErrors,
  salary: salaryErrors,
};

export function validateQuestion(
  draft: OnboardingPreferencesDraft,
  question: OnboardingQuestion,
): OnboardingFieldErrors {
  return QUESTION_VALIDATORS[question](draft);
}

/**
 * Validates the questions in the given sequence. Defaults to the
 * enabled sequence, which omits the deferred salary question (L1), so a
 * salary block that is inconsistent with its answer state is only
 * reported here when the full ONBOARDING_QUESTION_SEQUENCE is passed.
 */
export function validatePreferencesDraft(
  draft: OnboardingPreferencesDraft,
  sequence: readonly OnboardingQuestion[] = ONBOARDING_ENABLED_QUESTION_SEQUENCE,
): OnboardingFieldErrors {
  const errors: OnboardingFieldErrors = {};
  for (const question of sequence) {
    mergeErrors(errors, QUESTION_VALIDATORS[question](draft));
  }
  return errors;
}

export function firstUnresolvedQuestion(
  draft: OnboardingPreferencesDraft,
  sequence: readonly OnboardingQuestion[] = ONBOARDING_ENABLED_QUESTION_SEQUENCE,
): OnboardingQuestion | null {
  for (const question of sequence) {
    if (hasErrors(QUESTION_VALIDATORS[question](draft))) {
      return question;
    }
  }
  return null;
}

export function getNextOnboardingQuestion(
  question: OnboardingQuestion,
  sequence: readonly OnboardingQuestion[] = ONBOARDING_ENABLED_QUESTION_SEQUENCE,
): OnboardingQuestion | null {
  const index = sequence.indexOf(question);
  if (index === -1) return null;
  return sequence[index + 1] ?? null;
}

export function getPreviousOnboardingQuestion(
  question: OnboardingQuestion,
  sequence: readonly OnboardingQuestion[] = ONBOARDING_ENABLED_QUESTION_SEQUENCE,
): OnboardingQuestion | null {
  const index = sequence.indexOf(question);
  if (index <= 0) return null;
  return sequence[index - 1] ?? null;
}

export function createProgressSnapshot(
  answers: OnboardingPreferencesDraft,
  options: {
    onboardingStep: OnboardingStep;
    currentQuestion: OnboardingQuestion | null;
  },
): OnboardingProgressSnapshot {
  return { version: 1, ...options, answers };
}

export function convertPreferencesDraft(
  draft: OnboardingPreferencesDraft,
): PreferencesConversionResult {
  const errors = validatePreferencesDraft(draft, ONBOARDING_QUESTION_SEQUENCE);
  if (hasErrors(errors)) return { ok: false, errors };

  const preferredLocations = draft.preferredLocations.map((location) => ({
    city: location.city.trim(),
    state: location.state.trim(),
  }));

  const desiredSalary =
    draft.answers.desiredSalary === 'answered' && draft.desiredSalary !== null
      ? {
          minimum: parseAmountText(draft.desiredSalary.minimum.trim()) ?? 0,
          target: parseAmountText(draft.desiredSalary.target.trim()) ?? 0,
          currency: draft.desiredSalary.currency.trim(),
        }
      : null;

  if (draft.remotePreference === null) {
    throw new Error('Validated draft must have a remote preference.');
  }

  const value = onboardingValidatedPreferencesSchema.parse({
    preferredLocations,
    searchRadiusMiles: parseRadiusMiles(draft.searchRadiusMiles) ?? 0,
    secondarySearchRadiusMiles:
      parseRadiusMiles(draft.secondarySearchRadiusMiles) ?? 0,
    remotePreference: draft.remotePreference,
    desiredSalary,
    desiredJobTitles: trimmedNonEmpty(draft.desiredJobTitles),
    desiredEmploymentTypes: draft.desiredEmploymentTypes,
  });

  return { ok: true, value };
}

export function pickPreferencesFromProfile(
  profile: CandidateProfile,
): OnboardingValidatedPreferences {
  return onboardingValidatedPreferencesSchema.parse({
    preferredLocations: profile.preferredLocations,
    searchRadiusMiles: profile.searchRadiusMiles,
    secondarySearchRadiusMiles: profile.secondarySearchRadiusMiles,
    remotePreference: profile.remotePreference,
    desiredSalary: profile.desiredSalary,
    desiredJobTitles: profile.desiredJobTitles,
    desiredEmploymentTypes: profile.desiredEmploymentTypes,
  });
}

export function mergePreferencesIntoProfile(
  original: CandidateProfile,
  preferences: OnboardingValidatedPreferences,
): CandidateProfile {
  const { desiredSalary, ...restOfPreferences } = preferences;
  return {
    ...original,
    ...restOfPreferences,
    // A null value means "not provided", not "clear this preference".
    // The deferred salary question (L1) must never wipe an existing
    // salary, so only non-null values are written.
    ...(desiredSalary !== null ? { desiredSalary } : {}),
  };
}

export function toPreferencesDraft(
  preferences: OnboardingValidatedPreferences,
): OnboardingPreferencesDraft {
  return {
    desiredJobTitles: [...preferences.desiredJobTitles],
    preferredLocations: preferences.preferredLocations.map((location) => ({
      city: location.city,
      state: location.state,
    })),
    searchRadiusMiles: String(preferences.searchRadiusMiles),
    secondarySearchRadiusMiles: String(preferences.secondarySearchRadiusMiles),
    remotePreference: preferences.remotePreference,
    answers: {
      remotePreference: 'answered',
      // A saved null salary does not prove an explicit skip (L4); the
      // draft restores as unanswered unless a stored snapshot actually
      // recorded a deliberate skip.
      desiredSalary:
        preferences.desiredSalary === null ? 'unanswered' : 'answered',
    },
    desiredSalary:
      preferences.desiredSalary === null
        ? null
        : {
            minimum: String(preferences.desiredSalary.minimum),
            target: String(preferences.desiredSalary.target),
            currency: preferences.desiredSalary.currency,
          },
    desiredEmploymentTypes: [...preferences.desiredEmploymentTypes],
  };
}

export function createEmptyPreferencesDraft(): OnboardingPreferencesDraft {
  return {
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
}
