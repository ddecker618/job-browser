import { useEffect, useId, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';

import { EMPLOYMENT_TYPES } from '../../../domain/job.js';
import type { EmploymentType } from '../../../domain/job.js';
import type {
  OnboardingEnabledQuestion,
  OnboardingFieldErrors,
  OnboardingPreferencesStepProps,
  OnboardingQuestion,
  RemotePreference,
} from '../../../models/onboarding.js';
import {
  getNextOnboardingQuestion,
  getPreviousOnboardingQuestion,
  ONBOARDING_ENABLED_QUESTION_SEQUENCE,
} from '../../../schemas/onboarding.js';
import '../../styles/onboarding.css';

type CurrentErrorKey = keyof OnboardingFieldErrors;

const QUESTION_FIELDS: Record<
  OnboardingEnabledQuestion,
  readonly CurrentErrorKey[]
> = {
  'desired-work': ['desiredJobTitles'],
  location: ['preferredLocations'],
  'travel-distance': ['searchRadiusMiles', 'secondarySearchRadiusMiles'],
  'remote-work': ['remotePreference'],
  'employment-types': ['desiredEmploymentTypes'],
};

const REMOTE_OPTIONS: readonly {
  value: RemotePreference;
  label: string;
  description: string;
}[] = [
  {
    value: 'preferred',
    label: 'Prefer remote',
    description: 'Your first choice is remote or mostly-remote/hybrid work.',
  },
  {
    value: 'accepted',
    label: 'Remote is OK',
    description: 'Remote, hybrid, or in-person roles all work for you.',
  },
  {
    value: 'not-preferred',
    label: 'Prefer in person',
    description: 'You would rather work at an office or site in person.',
  },
];

const EMPLOYMENT_TYPE_DETAILS: Record<
  EmploymentType,
  { label: string; description: string }
> = {
  'full-time': {
    label: 'Full-time',
    description: 'The standard weekly schedule for a full-time position.',
  },
  'part-time': {
    label: 'Part-time',
    description: 'Fewer hours than a full-time role.',
  },
  contract: {
    label: 'Contract',
    description: 'A fixed-term or project-based engagement.',
  },
  temporary: {
    label: 'Temporary',
    description: 'A short-term or seasonal assignment.',
  },
  internship: {
    label: 'Internship',
    description: 'A learning role, often for students or early career.',
  },
  unknown: {
    label: 'Jobs with unspecified employment type',
    description:
      'The listing does not state its employment arrangement. Selecting this matches only jobs with an unspecified type.',
  },
};

function describedBy(errorId: string | undefined): {
  'aria-describedby'?: string;
} {
  return errorId === undefined ? {} : { 'aria-describedby': errorId };
}

/**
 * One-question-at-a-time onboarding preferences component (MR1-02).
 * Renders only the question named by `currentQuestion`, in the enabled
 * sequence, which omits the deferred salary question (L1). The parent
 * owns the draft, navigation, validation and saving; this component only
 * emits `onChange`/`onBack`/`onContinue`.
 */
export function PreferencesStep({
  value,
  errors,
  currentQuestion,
  saving,
  saveError,
  onChange,
  onBack,
  onContinue,
}: OnboardingPreferencesStepProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const enabledStep: OnboardingEnabledQuestion | null =
    currentQuestion === 'salary' ? null : currentQuestion;

  const questionIndex =
    enabledStep === null
      ? -1
      : ONBOARDING_ENABLED_QUESTION_SEQUENCE.indexOf(enabledStep);
  const progressLabel =
    enabledStep === null
      ? 'Preferences'
      : `Question ${String(questionIndex + 1)} of ${String(
          ONBOARDING_ENABLED_QUESTION_SEQUENCE.length,
        )}`;

  const currentErrorKeys =
    enabledStep === null
      ? []
      : QUESTION_FIELDS[enabledStep].filter((key) => errors[key] !== undefined);
  const hasCurrentErrors = currentErrorKeys.length > 0;

  const canGoBack = getPreviousOnboardingQuestion(currentQuestion) !== null;
  const isFinalQuestion = getNextOnboardingQuestion(currentQuestion) === null;

  const lastSubmitRef = useRef<{ question: OnboardingQuestion } | null>(null);
  const [submitAttempt, setSubmitAttempt] = useState(0);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [currentQuestion]);

  useEffect(() => {
    const last = lastSubmitRef.current;
    if (last === null) return;
    if (last.question !== currentQuestion) {
      lastSubmitRef.current = null;
      return;
    }
    if (!hasCurrentErrors) return;
    // The parent reports this question's errors only after Continue (or after
    // saving), so focus the first invalid control once those errors render.
    lastSubmitRef.current = null;
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus({ preventScroll: true });
  }, [submitAttempt, errors, currentQuestion, hasCurrentErrors]);

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (saving) return;
    lastSubmitRef.current = { question: currentQuestion };
    setSubmitAttempt((attempt) => attempt + 1);
    if (hasCurrentErrors) return;
    onContinue();
  }

  function changeRole(index: number, text: string): void {
    if (value.desiredJobTitles.length === 0) {
      onChange({ ...value, desiredJobTitles: [text] });
      return;
    }
    onChange({
      ...value,
      desiredJobTitles: value.desiredJobTitles.map((role, i) =>
        i === index ? text : role,
      ),
    });
  }

  function addRole(): void {
    onChange({
      ...value,
      desiredJobTitles: [...value.desiredJobTitles, ''],
    });
  }

  function removeRole(index: number): void {
    onChange({
      ...value,
      desiredJobTitles: value.desiredJobTitles.filter(
        (_role, i) => i !== index,
      ),
    });
  }

  function changeLocation(
    index: number,
    key: 'city' | 'state',
    text: string,
  ): void {
    if (value.preferredLocations.length === 0) {
      onChange({
        ...value,
        preferredLocations: [
          {
            city: key === 'city' ? text : '',
            state: key === 'state' ? text : '',
          },
        ],
      });
      return;
    }
    onChange({
      ...value,
      preferredLocations: value.preferredLocations.map((location, i) =>
        i === index ? { ...location, [key]: text } : location,
      ),
    });
  }

  function addLocation(): void {
    onChange({
      ...value,
      preferredLocations: [
        ...value.preferredLocations,
        { city: '', state: '' },
      ],
    });
  }

  function removeLocation(index: number): void {
    onChange({
      ...value,
      preferredLocations: value.preferredLocations.filter(
        (_location, i) => i !== index,
      ),
    });
  }

  function changeRadius(
    key: 'searchRadiusMiles' | 'secondarySearchRadiusMiles',
    text: string,
  ): void {
    onChange({ ...value, [key]: text });
  }

  function chooseRemote(remotePreference: RemotePreference): void {
    onChange({
      ...value,
      remotePreference,
      answers: { ...value.answers, remotePreference: 'answered' },
    });
  }

  function toggleEmploymentType(employmentType: EmploymentType): void {
    const selected = value.desiredEmploymentTypes;
    const next = selected.includes(employmentType)
      ? selected.filter((type) => type !== employmentType)
      : [...selected, employmentType];
    onChange({ ...value, desiredEmploymentTypes: next });
  }

  const roleError = errors.desiredJobTitles;
  const roleErrorId = `${id}-desired-roles-error`;

  const locationError = errors.preferredLocations;
  const locationsEmptyError =
    locationError !== undefined &&
    (locationError.empty || value.preferredLocations.length === 0);

  const remoteError = errors.remotePreference;
  const remoteErrorId = `${id}-remote-error`;

  const employmentTypesError = errors.desiredEmploymentTypes;
  const employmentTypesErrorId = `${id}-employment-types-error`;

  return (
    <form
      ref={formRef}
      className="onboarding-preferences"
      onSubmit={handleSubmit}
      aria-busy={saving}
    >
      {enabledStep === null ? (
        <div className="onboarding-card">
          <p className="onboarding-progress">Preferences</p>
          <h2 className="onboarding-question-title">
            Salary preferences come later
          </h2>
          <p className="onboarding-question-copy">
            Salary preferences are not collected in this checklist yet, so
            nothing here changes a salary that your profile already has.
          </p>
        </div>
      ) : (
        <section className="onboarding-card" aria-labelledby={`${id}-heading`}>
          <p className="onboarding-progress">{progressLabel}</p>
          <h2
            ref={headingRef}
            id={`${id}-heading`}
            tabIndex={-1}
            className="onboarding-question-title"
          >
            {questionHeading(enabledStep)}
          </h2>
          <p className="onboarding-question-copy">
            {questionCopy(enabledStep)}
          </p>

          {enabledStep === 'desired-work' ? (
            <fieldset className="onboarding-fieldset">
              <legend>Desired roles</legend>
              <p className="onboarding-hint">
                Type one role per field. Titles guide which openings the search
                focuses on.
              </p>
              {(value.desiredJobTitles.length === 0
                ? ['']
                : value.desiredJobTitles
              ).map((role, index) => (
                <div
                  className="onboarding-role-row"
                  key={`${id}-role-${String(index)}`}
                >
                  <label className="onboarding-field">
                    <span>Desired role {index + 1}</span>
                    <input
                      type="text"
                      value={role}
                      disabled={saving}
                      aria-invalid={roleError !== undefined}
                      {...describedBy(
                        roleError !== undefined ? roleErrorId : undefined,
                      )}
                      onChange={(event) =>
                        changeRole(index, event.target.value)
                      }
                    />
                  </label>
                  {value.desiredJobTitles.length > 1 ? (
                    <button
                      type="button"
                      className="button onboarding-row-remove"
                      disabled={saving}
                      onClick={() => removeRole(index)}
                    >
                      Remove role {index + 1}
                    </button>
                  ) : undefined}
                </div>
              ))}
              {roleError !== undefined ? (
                <p
                  id={roleErrorId}
                  className="onboarding-field-error"
                  role="alert"
                >
                  {roleError}
                </p>
              ) : undefined}
              <p className="onboarding-example">
                Examples: “Network Engineer”, “Cloud Support Engineer”, “Desktop
                Support Specialist”.
              </p>
              <button
                type="button"
                className="button onboarding-add-row"
                disabled={saving}
                onClick={addRole}
              >
                Add role
              </button>
            </fieldset>
          ) : undefined}

          {enabledStep === 'location' ? (
            <fieldset className="onboarding-fieldset">
              <legend>Preferred locations</legend>
              <p className="onboarding-hint">
                Each location is a city and state pair. You can add more than
                one area.
              </p>
              {locationsEmptyError ? (
                <p
                  id={`${id}-locations-error`}
                  className="onboarding-field-error"
                  role="alert"
                >
                  Add at least one city and state.
                </p>
              ) : undefined}
              {(value.preferredLocations.length === 0
                ? [{ city: '', state: '' }]
                : value.preferredLocations
              ).map((location, index) => {
                const entry = locationError?.entries.find(
                  (candidate) => candidate.index === index,
                );
                const seedRow =
                  value.preferredLocations.length === 0 && locationsEmptyError;
                const cityInvalid = entry?.city !== undefined || seedRow;
                const stateInvalid = entry?.state !== undefined || seedRow;
                return (
                  <div
                    className="onboarding-location-row"
                    key={`${id}-location-${String(index)}`}
                  >
                    <label className="onboarding-field">
                      <span>City {index + 1}</span>
                      <input
                        type="text"
                        value={location.city}
                        disabled={saving}
                        aria-invalid={cityInvalid}
                        {...describedBy(
                          entry?.city !== undefined
                            ? `${id}-location-${String(index)}-city-error`
                            : seedRow
                              ? `${id}-locations-error`
                              : undefined,
                        )}
                        onChange={(event) =>
                          changeLocation(index, 'city', event.target.value)
                        }
                      />
                      {entry?.city !== undefined ? (
                        <p
                          id={`${id}-location-${String(index)}-city-error`}
                          className="onboarding-field-error"
                          role="alert"
                        >
                          {entry.city}
                        </p>
                      ) : undefined}
                    </label>
                    <label className="onboarding-field">
                      <span>State {index + 1}</span>
                      <input
                        type="text"
                        value={location.state}
                        disabled={saving}
                        aria-invalid={stateInvalid}
                        {...describedBy(
                          entry?.state !== undefined
                            ? `${id}-location-${String(index)}-state-error`
                            : seedRow
                              ? `${id}-locations-error`
                              : undefined,
                        )}
                        onChange={(event) =>
                          changeLocation(index, 'state', event.target.value)
                        }
                      />
                      {entry?.state !== undefined ? (
                        <p
                          id={`${id}-location-${String(index)}-state-error`}
                          className="onboarding-field-error"
                          role="alert"
                        >
                          {entry.state}
                        </p>
                      ) : undefined}
                    </label>
                    {value.preferredLocations.length > 1 ? (
                      <button
                        type="button"
                        className="button onboarding-row-remove"
                        disabled={saving}
                        onClick={() => removeLocation(index)}
                      >
                        Remove location {index + 1}
                      </button>
                    ) : undefined}
                  </div>
                );
              })}
              <p className="onboarding-example">
                For example: city “Austin” with state “TX”, or “Denver” with
                “CO”.
              </p>
              <button
                type="button"
                className="button onboarding-add-row"
                disabled={saving}
                onClick={addLocation}
              >
                Add location
              </button>
            </fieldset>
          ) : undefined}

          {enabledStep === 'travel-distance' ? (
            <fieldset className="onboarding-fieldset">
              <legend>Travel distance</legend>
              <p className="onboarding-hint">
                The preferred distance is your comfort zone; the wider limit is
                the most you would travel for the right role. Whole miles only.
              </p>
              <div className="onboarding-location-row">
                <label className="onboarding-field">
                  <span>Preferred distance (miles)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={value.searchRadiusMiles}
                    disabled={saving}
                    aria-invalid={errors.searchRadiusMiles !== undefined}
                    {...describedBy(
                      errors.searchRadiusMiles !== undefined
                        ? `${id}-search-radius-error`
                        : undefined,
                    )}
                    onChange={(event) =>
                      changeRadius('searchRadiusMiles', event.target.value)
                    }
                  />
                  {errors.searchRadiusMiles !== undefined ? (
                    <p
                      id={`${id}-search-radius-error`}
                      className="onboarding-field-error"
                      role="alert"
                    >
                      {errors.searchRadiusMiles}
                    </p>
                  ) : undefined}
                </label>
                <label className="onboarding-field">
                  <span>Wider limit (miles)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={value.secondarySearchRadiusMiles}
                    disabled={saving}
                    aria-invalid={
                      errors.secondarySearchRadiusMiles !== undefined
                    }
                    {...describedBy(
                      errors.secondarySearchRadiusMiles !== undefined
                        ? `${id}-secondary-radius-error`
                        : undefined,
                    )}
                    onChange={(event) =>
                      changeRadius(
                        'secondarySearchRadiusMiles',
                        event.target.value,
                      )
                    }
                  />
                  {errors.secondarySearchRadiusMiles !== undefined ? (
                    <p
                      id={`${id}-secondary-radius-error`}
                      className="onboarding-field-error"
                      role="alert"
                    >
                      {errors.secondarySearchRadiusMiles}
                    </p>
                  ) : undefined}
                </label>
              </div>
              <p className="onboarding-example">
                For example: 25 and 50. The wider limit cannot be smaller than
                the preferred distance.
              </p>
            </fieldset>
          ) : undefined}

          {enabledStep === 'remote-work' ? (
            <fieldset className="onboarding-fieldset">
              <legend>Remote work</legend>
              {REMOTE_OPTIONS.map((option) => (
                <label className="onboarding-option" key={option.value}>
                  <input
                    type="radio"
                    name={`${id}-remote`}
                    value={option.value}
                    checked={value.remotePreference === option.value}
                    disabled={saving}
                    aria-invalid={remoteError !== undefined}
                    {...describedBy(
                      remoteError !== undefined ? remoteErrorId : undefined,
                    )}
                    onChange={() => chooseRemote(option.value)}
                  />
                  <span className="onboarding-option-text">
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </span>
                </label>
              ))}
              {remoteError !== undefined ? (
                <p
                  id={remoteErrorId}
                  className="onboarding-field-error"
                  role="alert"
                >
                  {remoteError}
                </p>
              ) : undefined}
              <p className="onboarding-hint">
                Choose the one closest to what you would accept — nothing is
                chosen for you.
              </p>
            </fieldset>
          ) : undefined}

          {enabledStep === 'employment-types' ? (
            <fieldset className="onboarding-fieldset">
              <legend>Employment types</legend>
              <p className="onboarding-hint">
                Pick every employment type you are open to. A job matches only
                when it lists one of the types you choose.
              </p>
              {EMPLOYMENT_TYPES.map((employmentType) => {
                const details = EMPLOYMENT_TYPE_DETAILS[employmentType];
                return (
                  <label className="onboarding-option" key={employmentType}>
                    <input
                      type="checkbox"
                      checked={value.desiredEmploymentTypes.includes(
                        employmentType,
                      )}
                      disabled={saving}
                      aria-invalid={employmentTypesError !== undefined}
                      {...describedBy(
                        employmentTypesError !== undefined
                          ? employmentTypesErrorId
                          : undefined,
                      )}
                      onChange={() => toggleEmploymentType(employmentType)}
                    />
                    <span className="onboarding-option-text">
                      <strong>{details.label}</strong>
                      <span>{details.description}</span>
                    </span>
                  </label>
                );
              })}
              {employmentTypesError !== undefined ? (
                <p
                  id={employmentTypesErrorId}
                  className="onboarding-field-error"
                  role="alert"
                >
                  {employmentTypesError}
                </p>
              ) : undefined}
            </fieldset>
          ) : undefined}
        </section>
      )}

      <div className="onboarding-actions">
        <p className="onboarding-footnote">
          No search is started from this screen. Searching begins after your
          search plan is confirmed.
        </p>
        <div className="onboarding-actions-left">
          {saving ? (
            <span className="onboarding-save-status" role="status">
              Saving your preferences…
            </span>
          ) : undefined}
          {saveError !== null ? (
            <p className="onboarding-save-error" role="alert">
              {saveError}
            </p>
          ) : undefined}
          {canGoBack ? (
            <button
              type="button"
              className="button"
              disabled={saving}
              onClick={onBack}
            >
              Back
            </button>
          ) : undefined}
          <button type="submit" className="button primary" disabled={saving}>
            {saving
              ? 'Saving…'
              : isFinalQuestion
                ? 'Save and finish'
                : 'Continue'}
          </button>
        </div>
      </div>
    </form>
  );
}

function questionHeading(question: OnboardingEnabledQuestion): string {
  switch (question) {
    case 'desired-work':
      return 'What roles interest you?';
    case 'location':
      return 'Where would you like to work?';
    case 'travel-distance':
      return 'How far are you willing to travel?';
    case 'remote-work':
      return 'How do you feel about remote work?';
    case 'employment-types':
      return 'What employment types work for you?';
  }
}

function questionCopy(question: OnboardingEnabledQuestion): string {
  switch (question) {
    case 'desired-work':
      return 'The titles you add here tell the search which openings matter most. You can change or remove them later.';
    case 'location':
      return 'You can list more than one area where you are willing to take a role.';
    case 'travel-distance':
      return 'Pick how far from your area you are prepared to travel for the right role.';
    case 'remote-work':
      return 'Jobs can be fully remote, hybrid, or in person. Choose the arrangement you would accept.';
    case 'employment-types':
      return 'Some roles are full-time, some are contract or part-time. Choose the kinds you want to see.';
  }
}
