import { describe, expect, expectTypeOf, it } from 'vitest';

import type { EmploymentType } from '../src/domain/job.js';
import type {
  OnboardingEnabledQuestion,
  OnboardingFieldErrors,
  OnboardingPreferencesDraft,
  OnboardingPreferencesStepProps,
  OnboardingQuestion,
  OnboardingReviewItem,
  OnboardingValidatedPreferences,
  PreferencesConversionResult,
} from '../src/models/onboarding.js';
import {
  convertPreferencesDraft,
  createEmptyPreferencesDraft,
  createProgressSnapshot,
  firstUnresolvedQuestion,
  getNextOnboardingQuestion,
  getPreviousOnboardingQuestion,
  mergePreferencesIntoProfile,
  onboardingProgressSnapshotSchema,
  onboardingValidatedPreferencesSchema,
  ONBOARDING_ENABLED_QUESTION_SEQUENCE,
  ONBOARDING_OPTIONAL_QUESTIONS,
  ONBOARDING_QUESTION_SEQUENCE,
  ONBOARDING_REQUIRED_QUESTIONS,
  parseAmountText,
  pickPreferencesFromProfile,
  toPreferencesDraft,
  validatePreferencesDraft,
  validateQuestion,
} from '../src/schemas/onboarding.js';
import {
  candidateProfileSchema,
  type CandidateProfile,
} from '../src/schemas/candidate-profile.js';
import {
  fictionalCorrectedLocationDraft,
  fictionalFirstTimeUserDraft,
  fictionalFullContractDraft,
  fictionalPreferencesDraftComplete,
  fictionalPreferencesDraftEmptyEmploymentTypes,
  fictionalPreferencesDraftEmptyRoles,
  fictionalPreferencesDraftInvalidRadius,
  fictionalPreferencesDraftInvalidSalaryRange,
  fictionalPreferencesDraftMissingLocation,
  fictionalPreferencesSaveFailureProps,
  fictionalPreferencesSavingProps,
  fictionalResumedProgressDraft,
  fictionalResumedProgressSnapshot,
  fictionalReviewItems,
  fictionalReviewSavingProps,
  fictionalSkippedSalaryDraft,
} from '../src/client/fixtures/onboarding.fixture.js';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function baseProfile(): CandidateProfile {
  return {
    id: 'test-profile',
    name: 'Test Candidate',
    preferredLocations: [{ city: 'Austin', state: 'TX' }],
    searchRadiusMiles: 50,
    secondarySearchRadiusMiles: 75,
    remotePreference: 'preferred',
    desiredSalary: null,
    certifications: ['CompTIA Security+'],
    degrees: [],
    skills: ['BGP configuration'],
    clearanceEligibility: 'unknown',
    yearsOfExperience: null,
    desiredJobTitles: ['Network Engineer'],
    excludedJobTitles: [],
    desiredEmploymentTypes: ['full-time'],
    degreeRequired: false,
    degreeInProgressOk: true,
    maxTravelPercent: null,
    noWeekends: false,
    noOnCall: false,
    noRotatingShifts: true,
    noOvernightShifts: true,
  };
}

function profiledWithSalary(): CandidateProfile {
  return {
    ...baseProfile(),
    desiredSalary: { minimum: 65000, target: 80000, currency: 'USD' },
  };
}

function enabledCompleteDraft(): OnboardingPreferencesDraft {
  const source = fictionalPreferencesDraftComplete;
  return {
    desiredJobTitles: [...source.desiredJobTitles],
    preferredLocations: source.preferredLocations.map((location) => ({
      ...location,
    })),
    searchRadiusMiles: source.searchRadiusMiles,
    secondarySearchRadiusMiles: source.secondarySearchRadiusMiles,
    remotePreference: source.remotePreference,
    answers: { ...source.answers },
    desiredSalary: source.desiredSalary ? { ...source.desiredSalary } : null,
    desiredEmploymentTypes: [...source.desiredEmploymentTypes],
  };
}

function fullContractDraft(): OnboardingPreferencesDraft {
  const source = fictionalFullContractDraft;
  return {
    desiredJobTitles: [...source.desiredJobTitles],
    preferredLocations: source.preferredLocations.map((location) => ({
      ...location,
    })),
    searchRadiusMiles: source.searchRadiusMiles,
    secondarySearchRadiusMiles: source.secondarySearchRadiusMiles,
    remotePreference: source.remotePreference,
    answers: { ...source.answers },
    desiredSalary: source.desiredSalary ? { ...source.desiredSalary } : null,
    desiredEmploymentTypes: [...source.desiredEmploymentTypes],
  };
}

describe('onboarding contract types', () => {
  it('validated preferences are exactly the seven profile fields', () => {
    expectTypeOf<OnboardingValidatedPreferences>().toEqualTypeOf<
      Pick<
        CandidateProfile,
        | 'preferredLocations'
        | 'searchRadiusMiles'
        | 'secondarySearchRadiusMiles'
        | 'remotePreference'
        | 'desiredSalary'
        | 'desiredJobTitles'
        | 'desiredEmploymentTypes'
      >
    >();
  });

  it('numeric draft inputs stay strings so blank is representable', () => {
    expectTypeOf<
      OnboardingPreferencesDraft['searchRadiusMiles']
    >().toBeString();
    expectTypeOf<OnboardingPreferencesDraft['desiredSalary']>().toEqualTypeOf<{
      minimum: string;
      target: string;
      currency: string;
    } | null>();
  });

  it('remote work has no silent value and carries an explicit answer state', () => {
    expectTypeOf<
      OnboardingPreferencesDraft['remotePreference']
    >().toEqualTypeOf<'preferred' | 'accepted' | 'not-preferred' | null>();
    expectTypeOf<
      OnboardingPreferencesDraft['answers']['remotePreference']
    >().toEqualTypeOf<'unanswered' | 'answered' | 'skipped'>();
  });

  it('both step prop contracts include the save state', () => {
    type ReviewProps =
      import('../src/models/onboarding.js').OnboardingReviewStepProps;
    expectTypeOf<
      OnboardingPreferencesStepProps['saving']
    >().toEqualTypeOf<boolean>();
    expectTypeOf<OnboardingPreferencesStepProps['saveError']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<ReviewProps['saving']>().toEqualTypeOf<boolean>();
    expectTypeOf<ReviewProps['saveError']>().toEqualTypeOf<string | null>();
    expectTypeOf(fictionalPreferencesSavingProps.saving).toBeBoolean();
    expectTypeOf(fictionalPreferencesSaveFailureProps.saveError).toEqualTypeOf<
      string | null
    >();
  });

  it('preferences props carry the question-navigation contract', () => {
    expectTypeOf<
      OnboardingPreferencesStepProps['currentQuestion']
    >().toEqualTypeOf<OnboardingQuestion>();
    expectTypeOf(
      fictionalPreferencesSavingProps.currentQuestion,
    ).toEqualTypeOf<OnboardingQuestion>();
    expectTypeOf<OnboardingPreferencesStepProps['onChange']>().toEqualTypeOf<
      (next: OnboardingPreferencesDraft) => void
    >();
    expectTypeOf<OnboardingPreferencesStepProps['onBack']>().toEqualTypeOf<
      () => void
    >();
    expectTypeOf<OnboardingPreferencesStepProps['onContinue']>().toEqualTypeOf<
      () => void
    >();
  });

  it('enabled questions are the contract questions except the deferred salary', () => {
    expectTypeOf<OnboardingEnabledQuestion>().toEqualTypeOf<
      Exclude<OnboardingQuestion, 'salary'>
    >();
  });

  it('conversion returns a discriminated result', () => {
    expectTypeOf<PreferencesConversionResult>().toEqualTypeOf<
      | { ok: true; value: OnboardingValidatedPreferences }
      | { ok: false; errors: OnboardingFieldErrors }
    >();
    const result: PreferencesConversionResult = convertPreferencesDraft(
      fictionalFullContractDraft,
    );
    if (result.ok) {
      expectTypeOf(
        result.value,
      ).toEqualTypeOf<OnboardingValidatedPreferences>();
    } else {
      expectTypeOf(result.errors).toEqualTypeOf<OnboardingFieldErrors>();
    }
  });

  it('review items are typed to the review boundary', () => {
    expectTypeOf<OnboardingReviewItem['field']>().toEqualTypeOf<
      'skills' | 'certifications'
    >();
    expectTypeOf<OnboardingReviewItem['status']>().toEqualTypeOf<
      'confirmed' | 'suggested' | 'unknown'
    >();
  });
});

describe('numeric parsing', () => {
  it.each([
    ['', null],
    ['50', 50],
    ['50.0', 50],
    ['70000.50', 70000.5],
    [' 50 ', 50],
  ])('parses accepted decimal syntax %j', (input, expected) => {
    expect(parseAmountText(input)).toBe(expected);
  });

  it.each([
    '0x10',
    '1e3',
    '70,000',
    '-5',
    '+5',
    '70000.',
    '.5',
    '5.5.5',
    '$70000',
  ])('rejects unintended numeric format %j', (input) => {
    expect(parseAmountText(input)).toBeNull();
  });

  it('keeps blank distinct from an explicit zero', () => {
    expect(parseAmountText('')).toBeNull();
    expect(parseAmountText('0')).toBe(0);
  });

  it('rejects a zero or formatted radius while accepting a whole decimal', () => {
    const zero: OnboardingPreferencesDraft = {
      ...enabledCompleteDraft(),
      searchRadiusMiles: '0',
    };
    expect(validatePreferencesDraft(zero).searchRadiusMiles).toBeDefined();

    const hexadecimal: OnboardingPreferencesDraft = {
      ...enabledCompleteDraft(),
      searchRadiusMiles: '0x10',
    };
    expect(
      validatePreferencesDraft(hexadecimal).searchRadiusMiles,
    ).toBeDefined();

    const scientific: OnboardingPreferencesDraft = {
      ...enabledCompleteDraft(),
      secondarySearchRadiusMiles: '1e3',
    };
    expect(
      validatePreferencesDraft(scientific).secondarySearchRadiusMiles,
    ).toBeDefined();

    const wholeDecimal: OnboardingPreferencesDraft = {
      ...enabledCompleteDraft(),
      searchRadiusMiles: '50.0',
    };
    const result = convertPreferencesDraft(wholeDecimal);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.searchRadiusMiles).toBe(50);
  });

  it('accepts explicit salary zero when answered but never a blank', () => {
    const explicitZero: OnboardingPreferencesDraft = {
      ...fullContractDraft(),
      desiredSalary: { minimum: '0', target: '0', currency: 'USD' },
    };
    const result = convertPreferencesDraft(explicitZero);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.desiredSalary).toEqual({
        minimum: 0,
        target: 0,
        currency: 'USD',
      });
    }
  });
});

describe('answer states and conversion', () => {
  it('converts the enabled-flow draft with salary deferred to null', () => {
    const result = convertPreferencesDraft(fictionalPreferencesDraftComplete);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      preferredLocations: [
        { city: 'Austin', state: 'TX' },
        { city: 'Remote', state: 'TX' },
      ],
      searchRadiusMiles: 50,
      secondarySearchRadiusMiles: 75,
      remotePreference: 'preferred',
      desiredSalary: null,
      desiredJobTitles: ['Network Engineer', 'Cloud Support Engineer'],
      desiredEmploymentTypes: ['full-time', 'contract'],
    });
    expect(
      onboardingValidatedPreferencesSchema.safeParse(result.value).success,
    ).toBe(true);
  });

  it('converts the full-contract draft including the deferred salary', () => {
    const result = convertPreferencesDraft(fictionalFullContractDraft);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.desiredSalary).toEqual({
      minimum: 70000,
      target: 85000,
      currency: 'USD',
    });
  });

  it('merged output satisfies the existing candidate schema', () => {
    const result = convertPreferencesDraft(enabledCompleteDraft());
    if (!result.ok) throw new Error('expected valid draft');

    const merged = mergePreferencesIntoProfile(baseProfile(), result.value);
    expect(candidateProfileSchema.safeParse(merged).success).toBe(true);
  });

  it('does not silently choose a remote preference for a new user', () => {
    expect(createEmptyPreferencesDraft().remotePreference).toBeNull();
    expect(fictionalFirstTimeUserDraft).toEqual(createEmptyPreferencesDraft());

    const result = convertPreferencesDraft(fictionalFirstTimeUserDraft);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.remotePreference).toBeDefined();
    expect(result.errors.desiredJobTitles).toBeDefined();
    expect(result.errors.preferredLocations).toBeDefined();
    expect(result.errors.searchRadiusMiles).toBeDefined();
    expect(result.errors.desiredEmploymentTypes).toBeDefined();
  });

  it('rejects an unanswered required remote preference', () => {
    const result = validatePreferencesDraft(fictionalFirstTimeUserDraft);
    expect(result.remotePreference).toBeDefined();
    expect(convertPreferencesDraft(fictionalFirstTimeUserDraft).ok).toBe(false);
  });

  it('treats a snapshot-recorded skipped salary as no preference', () => {
    const skipped = convertPreferencesDraft(fictionalSkippedSalaryDraft);
    expect(skipped.ok).toBe(true);
    if (skipped.ok) expect(skipped.value.desiredSalary).toBeNull();
  });

  it('keeps the deferred salary out of default validation but guards conversion', () => {
    const halfEntered: OnboardingPreferencesDraft = {
      ...fullContractDraft(),
      desiredSalary: { minimum: '', target: '85000', currency: 'USD' },
    };

    expect(validatePreferencesDraft(halfEntered).desiredSalary).toBeUndefined();
    expect(
      validateQuestion(halfEntered, 'salary').desiredSalary?.minimum,
    ).toBeDefined();
    expect(convertPreferencesDraft(halfEntered).ok).toBe(false);
  });

  it('flags amounts typed while salary is not set to be included', () => {
    const draft: OnboardingPreferencesDraft = {
      ...fullContractDraft(),
      desiredSalary: { minimum: '70000', target: '', currency: 'USD' },
      answers: {
        ...fullContractDraft().answers,
        desiredSalary: 'skipped',
      },
    };
    const errors = validateQuestion(draft, 'salary');
    expect(errors.desiredSalary?.minimum).toBeDefined();
  });

  it('requires both salary amounts when salary is answered', () => {
    const draft: OnboardingPreferencesDraft = {
      ...fullContractDraft(),
      desiredSalary: { minimum: '', target: '85000', currency: 'USD' },
    };
    const errors = validateQuestion(draft, 'salary');
    expect(errors.desiredSalary?.minimum).toBeDefined();
    expect(convertPreferencesDraft(draft).ok).toBe(false);
  });

  it('rejects target below minimum on the target field', () => {
    const result = validatePreferencesDraft(
      fictionalPreferencesDraftInvalidSalaryRange,
      ONBOARDING_QUESTION_SEQUENCE,
    );
    expect(result.desiredSalary?.target).toBeDefined();
    expect(
      convertPreferencesDraft(fictionalPreferencesDraftInvalidSalaryRange).ok,
    ).toBe(false);
  });

  it('rejects a malformed currency on the currency field', () => {
    const draft: OnboardingPreferencesDraft = {
      ...fullContractDraft(),
      desiredSalary: { minimum: '70000', target: '85000', currency: 'US' },
    };
    expect(
      validateQuestion(draft, 'salary').desiredSalary?.currency,
    ).toBeDefined();
  });

  it('rejects a secondary radius smaller than the primary radius', () => {
    const errors = validatePreferencesDraft(
      fictionalPreferencesDraftInvalidRadius,
    );
    expect(errors.secondarySearchRadiusMiles).toBeDefined();
    expect(
      convertPreferencesDraft(fictionalPreferencesDraftInvalidRadius).ok,
    ).toBe(false);
  });

  it('points location errors at the offending row and field', () => {
    const errors = validatePreferencesDraft(
      fictionalPreferencesDraftMissingLocation,
    );
    expect(errors.preferredLocations?.empty).toBe(false);
    expect(errors.preferredLocations?.entries).toHaveLength(2);
    const first = errors.preferredLocations?.entries[0];
    expect(first?.index).toBe(0);
    expect(typeof first?.state).toBe('string');
    expect(first?.city).toBeUndefined();
    const second = errors.preferredLocations?.entries[1];
    expect(second?.index).toBe(1);
    expect(typeof second?.city).toBe('string');
    expect(second?.state).toBeUndefined();
  });

  it('treats an empty location list as an explicit empty error', () => {
    const draft: OnboardingPreferencesDraft = {
      ...enabledCompleteDraft(),
      preferredLocations: [],
    };
    expect(validatePreferencesDraft(draft).preferredLocations).toEqual({
      empty: true,
      entries: [],
    });
  });

  it('rejects drafts with no roles or no employment types', () => {
    expect(
      validatePreferencesDraft(fictionalPreferencesDraftEmptyRoles)
        .desiredJobTitles,
    ).toBeDefined();
    expect(
      validatePreferencesDraft(fictionalPreferencesDraftEmptyEmploymentTypes)
        .desiredEmploymentTypes,
    ).toBeDefined();
    expect(
      convertPreferencesDraft(fictionalPreferencesDraftEmptyEmploymentTypes).ok,
    ).toBe(false);
  });
});

describe('guided progression and navigation', () => {
  it('defines the full contract order plus a separate enabled sequence', () => {
    expect(ONBOARDING_QUESTION_SEQUENCE).toEqual([
      'desired-work',
      'location',
      'travel-distance',
      'remote-work',
      'employment-types',
      'salary',
    ]);
    expect(ONBOARDING_ENABLED_QUESTION_SEQUENCE).toEqual([
      'desired-work',
      'location',
      'travel-distance',
      'remote-work',
      'employment-types',
    ]);
    expect(ONBOARDING_REQUIRED_QUESTIONS).toEqual([
      'desired-work',
      'location',
      'travel-distance',
      'remote-work',
      'employment-types',
    ]);
    expect(ONBOARDING_OPTIONAL_QUESTIONS).toEqual(['salary']);
  });

  it('walks the enabled sequence without ever reaching salary', () => {
    expect(getNextOnboardingQuestion('desired-work')).toBe('location');
    expect(getNextOnboardingQuestion('location')).toBe('travel-distance');
    expect(getNextOnboardingQuestion('travel-distance')).toBe('remote-work');
    expect(getNextOnboardingQuestion('remote-work')).toBe('employment-types');
    expect(getNextOnboardingQuestion('employment-types')).toBeNull();

    expect(getPreviousOnboardingQuestion('desired-work')).toBeNull();
    expect(getPreviousOnboardingQuestion('employment-types')).toBe(
      'remote-work',
    );
  });

  it('walks the full contract sequence when passed explicitly', () => {
    expect(
      getNextOnboardingQuestion(
        'employment-types',
        ONBOARDING_QUESTION_SEQUENCE,
      ),
    ).toBe('salary');
    expect(
      getPreviousOnboardingQuestion('salary', ONBOARDING_QUESTION_SEQUENCE),
    ).toBe('employment-types');
    expect(
      getNextOnboardingQuestion('salary', ONBOARDING_QUESTION_SEQUENCE),
    ).toBeNull();
  });

  it('reports the first enabled question that still needs an answer', () => {
    expect(firstUnresolvedQuestion(fictionalFirstTimeUserDraft)).toBe(
      'desired-work',
    );
    expect(
      firstUnresolvedQuestion(fictionalPreferencesDraftComplete),
    ).toBeNull();

    const radiusGap: OnboardingPreferencesDraft = {
      ...enabledCompleteDraft(),
      searchRadiusMiles: '',
      secondarySearchRadiusMiles: '',
    };
    expect(firstUnresolvedQuestion(radiusGap)).toBe('travel-distance');
  });

  it('never blocks on the deferred salary in the enabled flow', () => {
    expect(
      firstUnresolvedQuestion(fictionalPreferencesDraftComplete),
    ).toBeNull();
    const result = convertPreferencesDraft(fictionalPreferencesDraftComplete);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.desiredSalary).toBeNull();
  });

  it('validates the current question only, never untouched later questions', () => {
    const draft: OnboardingPreferencesDraft = {
      ...fictionalPreferencesDraftEmptyRoles,
      desiredSalary: { minimum: '90000', target: '80000', currency: 'USD' },
    };

    const workOnly = validateQuestion(draft, 'desired-work');
    expect(workOnly.desiredJobTitles).toBeDefined();
    expect(workOnly.desiredSalary).toBeUndefined();

    const salaryOnly = validateQuestion(draft, 'salary');
    expect(salaryOnly.desiredSalary?.target).toBeDefined();
    expect(salaryOnly.desiredJobTitles).toBeUndefined();

    expect(validatePreferencesDraft(draft).desiredJobTitles).toBeDefined();
  });

  it('validates travel distance as one question including the radius rule', () => {
    const errors = validateQuestion(
      fictionalPreferencesDraftInvalidRadius,
      'travel-distance',
    );
    expect(errors.secondarySearchRadiusMiles).toBeDefined();
    expect(errors.searchRadiusMiles).toBeUndefined();
  });

  it('completing the final enabled question has no unresolved work left', () => {
    expect(fictionalPreferencesSavingProps.currentQuestion).toBe(
      'employment-types',
    );
    expect(
      firstUnresolvedQuestion(fictionalPreferencesSavingProps.value),
    ).toBeNull();
    expect(
      validatePreferencesDraft(fictionalPreferencesSavingProps.value),
    ).toEqual({});
  });

  it('derives a persistable progress snapshot restoring the current question', () => {
    const snapshot = createProgressSnapshot(fictionalResumedProgressDraft, {
      onboardingStep: 'preferences',
      currentQuestion: 'travel-distance',
    });

    expect(snapshot).toEqual(fictionalResumedProgressSnapshot);
    expect(onboardingProgressSnapshotSchema.safeParse(snapshot).success).toBe(
      true,
    );
    expect(snapshot.version).toBe(1);
    expect(snapshot.currentQuestion).toBe('travel-distance');
    expect(firstUnresolvedQuestion(snapshot.answers)).toBe(
      snapshot.currentQuestion,
    );
    expect(snapshot.answers.answers.desiredSalary).toBe('unanswered');
  });
});

describe('purity, merge and round-trip', () => {
  it('does not mutate the draft it is given', () => {
    const draft = deepFreeze(enabledCompleteDraft());
    expect(() => validatePreferencesDraft(draft)).not.toThrow();
    expect(() => convertPreferencesDraft(draft)).not.toThrow();
  });

  it('merges preferences without touching unrelated profile fields', () => {
    const profile = baseProfile();
    const result = convertPreferencesDraft(enabledCompleteDraft());
    if (!result.ok) throw new Error('expected valid draft');

    const merged = mergePreferencesIntoProfile(profile, result.value);

    expect(merged.id).toBe('test-profile');
    expect(merged.name).toBe('Test Candidate');
    expect(merged.certifications).toEqual(['CompTIA Security+']);
    expect(merged.skills).toEqual(['BGP configuration']);
    expect(merged.clearanceEligibility).toBe('unknown');
    expect(merged.yearsOfExperience).toBeNull();
    expect(merged.preferredLocations).toEqual([
      { city: 'Austin', state: 'TX' },
      { city: 'Remote', state: 'TX' },
    ]);
  });

  it('preserves an existing salary when the salary question was not asked', () => {
    const profile = profiledWithSalary();
    const result = convertPreferencesDraft(enabledCompleteDraft());
    if (!result.ok) throw new Error('expected valid draft');
    expect(result.value.desiredSalary).toBeNull();

    const merged = mergePreferencesIntoProfile(profile, result.value);

    expect(merged.desiredSalary).toEqual({
      minimum: 65000,
      target: 80000,
      currency: 'USD',
    });
    expect(candidateProfileSchema.safeParse(merged).success).toBe(true);
  });

  it('writes a salary when the full-contract flow provides one', () => {
    const result = convertPreferencesDraft(fullContractDraft());
    if (!result.ok) throw new Error('expected valid draft');

    const merged = mergePreferencesIntoProfile(baseProfile(), result.value);
    expect(merged.desiredSalary).toEqual({
      minimum: 70000,
      target: 85000,
      currency: 'USD',
    });
  });

  it('round-trips a validated value with a salary back to the same answers', () => {
    const result = convertPreferencesDraft(fullContractDraft());
    if (!result.ok) throw new Error('expected valid draft');

    const again = convertPreferencesDraft(toPreferencesDraft(result.value));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value).toEqual(result.value);
  });

  it('round-trips the deferred (null salary) value as well', () => {
    const result = convertPreferencesDraft(enabledCompleteDraft());
    if (!result.ok) throw new Error('expected valid draft');

    const again = convertPreferencesDraft(toPreferencesDraft(result.value));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value).toEqual(result.value);
  });

  it('prefills a null saved salary as unanswered, not skipped (L4)', () => {
    const draft = toPreferencesDraft(pickPreferencesFromProfile(baseProfile()));
    expect(draft).toEqual({
      desiredJobTitles: ['Network Engineer'],
      preferredLocations: [{ city: 'Austin', state: 'TX' }],
      searchRadiusMiles: '50',
      secondarySearchRadiusMiles: '75',
      remotePreference: 'preferred',
      answers: {
        remotePreference: 'answered',
        desiredSalary: 'unanswered',
      },
      desiredSalary: null,
      desiredEmploymentTypes: ['full-time'],
    });
  });

  it('prefills an existing salary as answered with its amounts', () => {
    const draft = toPreferencesDraft(
      pickPreferencesFromProfile(profiledWithSalary()),
    );
    expect(draft.answers.desiredSalary).toBe('answered');
    expect(draft.desiredSalary).toEqual({
      minimum: '65000',
      target: '80000',
      currency: 'USD',
    });
  });

  it('keeps a snapshot-recorded deliberate skip distinct from a prefill', () => {
    expect(fictionalSkippedSalaryDraft.answers.desiredSalary).toBe('skipped');
    const prefilled = toPreferencesDraft(
      pickPreferencesFromProfile(baseProfile()),
    );
    expect(prefilled.answers.desiredSalary).toBe('unanswered');
  });
});

describe('guidance fixtures', () => {
  it('preserves answers across a save failure', () => {
    expect(fictionalPreferencesSaveFailureProps.saving).toBe(false);
    expect(fictionalPreferencesSaveFailureProps.saveError).toBeTypeOf('string');
    expect(fictionalPreferencesSaveFailureProps.value).toEqual(
      fictionalPreferencesDraftComplete,
    );
    expect(
      fictionalPreferencesSaveFailureProps.value.answers.desiredSalary,
    ).toBe('unanswered');
    expect(fictionalPreferencesSavingProps.saving).toBe(true);
    expect(fictionalPreferencesSavingProps.saveError).toBeNull();
  });

  it('supports correcting an earlier answer without losing the others', () => {
    const result = convertPreferencesDraft(fictionalCorrectedLocationDraft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.preferredLocations).toEqual([
      { city: 'Fort Worth', state: 'TX' },
      { city: 'Plano', state: 'TX' },
    ]);
    expect(result.value.desiredJobTitles).toEqual([
      'Network Engineer',
      'Cloud Support Engineer',
    ]);
  });

  it('resumes a partial session at the unresolved enabled question', () => {
    expect(fictionalResumedProgressSnapshot.currentQuestion).toBe(
      'travel-distance',
    );
    expect(
      firstUnresolvedQuestion(fictionalResumedProgressSnapshot.answers),
    ).toBe('travel-distance');
    expect(
      convertPreferencesDraft(fictionalResumedProgressSnapshot.answers).ok,
    ).toBe(false);

    const finished: OnboardingPreferencesDraft = {
      ...fictionalResumedProgressDraft,
      searchRadiusMiles: '50',
      secondarySearchRadiusMiles: '75',
      remotePreference: 'accepted',
      answers: {
        ...fictionalResumedProgressDraft.answers,
        remotePreference: 'answered',
      },
      desiredEmploymentTypes: ['full-time'],
    };
    expect(firstUnresolvedQuestion(finished)).toBeNull();
    expect(convertPreferencesDraft(finished).ok).toBe(true);
  });

  it('keeps the full-contract salary fixture available for future enablement', () => {
    expect(validateQuestion(fictionalFullContractDraft, 'salary')).toEqual({});
    const result = convertPreferencesDraft(fictionalFullContractDraft);
    expect(result.ok).toBe(true);
  });
});

describe('review contract', () => {
  it('exposes confirmed, suggested, and unknown review items', () => {
    expect(fictionalReviewItems.map((item) => item.status).sort()).toEqual([
      'confirmed',
      'confirmed',
      'suggested',
      'unknown',
    ]);
    expect(
      fictionalReviewItems.every(
        (item) => item.reason === null || typeof item.reason === 'string',
      ),
    ).toBe(true);
  });

  it('flows review status changes back through onChange', () => {
    const next = fictionalReviewItems.map((item) =>
      item.id === 'rev-4'
        ? { ...item, status: 'confirmed' as const, reason: null }
        : item,
    );
    expect(next.find((item) => item.id === 'rev-4')?.status).toBe('confirmed');
    expectTypeOf(fictionalReviewSavingProps.onChange).toBeFunction();
  });
});

describe('contract fixtures stay typed as workable drafts', () => {
  it('keeps employment types on the domain union', () => {
    const employmentTypes: EmploymentType[] =
      fictionalPreferencesDraftComplete.desiredEmploymentTypes;
    expect(employmentTypes).toBeDefined();
  });
});
