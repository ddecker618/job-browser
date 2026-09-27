// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreferencesStep } from '../src/client/components/onboarding/PreferencesStep.js';
import {
  fictionalFirstTimeUserDraft,
  fictionalFullContractDraft,
  fictionalPreferencesDraftComplete,
  fictionalResumedProgressDraft,
} from '../src/client/fixtures/onboarding.fixture.js';
import type {
  OnboardingFieldErrors,
  OnboardingPreferencesDraft,
  OnboardingQuestion,
} from '../src/models/onboarding.js';
import {
  getNextOnboardingQuestion,
  getPreviousOnboardingQuestion,
  validatePreferencesDraft,
  validateQuestion,
} from '../src/schemas/onboarding.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Keep the pending-save window comfortably longer than Testing Library's
// asynchronous user-event sequence so this interaction is deterministic.
const SAVE_DELAY_MS = 1_000;
const FAILURE_MESSAGE = 'Could not save preferences. Please try again.';

function Harness({
  initialDraft,
  initialQuestion = 'desired-work',
  saveFailures = 0,
}: {
  initialDraft: OnboardingPreferencesDraft;
  initialQuestion?: OnboardingQuestion;
  saveFailures?: number;
}) {
  const [draft, setDraft] = useState<OnboardingPreferencesDraft>(initialDraft);
  const [question, setQuestion] = useState<OnboardingQuestion>(initialQuestion);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveAttemptsRef = useRef(0);
  const failCountRef = useRef(saveFailures);
  const lastSavedRef = useRef<OnboardingPreferencesDraft | null>(null);

  const errors = validateQuestion(draft, question);
  const hasErrors =
    errors.desiredJobTitles !== undefined ||
    errors.preferredLocations !== undefined ||
    errors.searchRadiusMiles !== undefined ||
    errors.secondarySearchRadiusMiles !== undefined ||
    errors.remotePreference !== undefined ||
    errors.desiredSalary !== undefined ||
    errors.desiredEmploymentTypes !== undefined;

  function handleContinue(): void {
    if (hasErrors) return;
    const next = getNextOnboardingQuestion(question);
    if (next === null) {
      saveAttemptsRef.current += 1;
      lastSavedRef.current = { ...draft };
      setSaving(true);
      setSaveError(null);
      window.setTimeout(() => {
        setSaving(false);
        const shouldFail = failCountRef.current > 0;
        if (shouldFail) failCountRef.current -= 1;
        setSaveError(shouldFail ? FAILURE_MESSAGE : null);
      }, SAVE_DELAY_MS);
      return;
    }
    setQuestion(next);
  }

  function handleBack(): void {
    const previous = getPreviousOnboardingQuestion(question);
    if (previous !== null) setQuestion(previous);
  }

  return (
    <div
      data-testid="harness"
      data-draft={JSON.stringify(draft)}
      data-save-attempts={saveAttemptsRef.current}
      data-last-saved={JSON.stringify(lastSavedRef.current)}
    >
      <PreferencesStep
        value={draft}
        errors={errors}
        currentQuestion={question}
        saving={saving}
        saveError={saveError}
        onChange={setDraft}
        onBack={handleBack}
        onContinue={handleContinue}
      />
    </div>
  );
}

function hasAnyErrors(errors: OnboardingFieldErrors): boolean {
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

function DeferredErrorHarness({
  initialDraft,
  initialQuestion = 'desired-work',
}: {
  initialDraft: OnboardingPreferencesDraft;
  initialQuestion?: OnboardingQuestion;
}) {
  const [draft, setDraft] = useState<OnboardingPreferencesDraft>(initialDraft);
  const [question, setQuestion] = useState<OnboardingQuestion>(initialQuestion);
  const [errors, setErrors] = useState<OnboardingFieldErrors>({});

  function handleContinue(): void {
    const resolved = validateQuestion(draft, question);
    if (hasAnyErrors(resolved)) {
      setErrors(resolved);
      return;
    }
    setErrors({});
    const next = getNextOnboardingQuestion(question);
    if (next !== null) setQuestion(next);
  }

  function handleBack(): void {
    const previous = getPreviousOnboardingQuestion(question);
    if (previous !== null) setQuestion(previous);
  }

  return (
    <div data-testid="deferred-harness">
      <PreferencesStep
        value={draft}
        errors={errors}
        currentQuestion={question}
        saving={false}
        saveError={null}
        onChange={setDraft}
        onBack={handleBack}
        onContinue={handleContinue}
      />
    </div>
  );
}

function readHarnessDraft(): OnboardingPreferencesDraft {
  const raw = screen.getByTestId('harness').getAttribute('data-draft');
  return raw === null
    ? fictionalFirstTimeUserDraft
    : (JSON.parse(raw) as OnboardingPreferencesDraft);
}

function readHarnessSaveAttempts(): number {
  const raw = screen.getByTestId('harness').getAttribute('data-save-attempts');
  return raw === null ? 0 : Number(raw);
}

function roleInput(n: number) {
  return screen.getByRole('textbox', {
    name: new RegExp(`^Desired role ${String(n)}`),
  });
}

function cityInput(n: number) {
  return screen.getByRole('textbox', {
    name: new RegExp(`^City ${String(n)}`),
  });
}

function stateInput(n: number) {
  return screen.getByRole('textbox', {
    name: new RegExp(`^State ${String(n)}`),
  });
}

const preferredRadiusInput = () =>
  screen.getByRole('textbox', { name: /^Preferred distance \(miles\)/ });
const widerRadiusInput = () =>
  screen.getByRole('textbox', { name: /^Wider limit \(miles\)/ });

describe('PreferencesStep guided onboarding', () => {
  it('shows one enabled question at a time and advances through them in order', async () => {
    const user = userEvent.setup();
    render(<Harness initialDraft={fictionalFirstTimeUserDraft} />);

    expect(
      screen.getByRole('heading', { name: 'What roles interest you?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Question 1 of 5')).toBeInTheDocument();

    await user.type(roleInput(1), 'Network Engineer');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      screen.getByRole('heading', { name: 'Where would you like to work?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Question 2 of 5')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByText('Add at least one city and state.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Where would you like to work?' }),
    ).toBeInTheDocument();

    await user.type(cityInput(1), 'Austin');
    await user.type(stateInput(1), 'TX');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      screen.getByRole('heading', {
        name: 'How far are you willing to travel?',
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getAllByText('Enter a search radius in whole miles.'),
    ).toHaveLength(2);
    expect(
      screen.getByRole('heading', {
        name: 'How far are you willing to travel?',
      }),
    ).toBeInTheDocument();

    await user.type(preferredRadiusInput(), '25');
    await user.type(widerRadiusInput(), '50');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      screen.getByRole('heading', {
        name: 'How do you feel about remote work?',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Question 4 of 5')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByText('Choose a remote-work option before continuing.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Prefer remote/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      screen.getByRole('heading', {
        name: 'What employment types work for you?',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Question 5 of 5')).toBeInTheDocument();
  });

  it('blocks advancement on an invalid current answer and focuses the first invalid field', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialDraft={fictionalResumedProgressDraft}
        initialQuestion="travel-distance"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      screen.getByRole('heading', {
        name: 'How far are you willing to travel?',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('Enter a search radius in whole miles.'),
    ).toHaveLength(2);
    const input = preferredRadiusInput();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(input);
  });

  it('does not surface validation errors for questions the user has not reached', () => {
    const value = fictionalFirstTimeUserDraft;
    render(
      <PreferencesStep
        value={value}
        errors={validatePreferencesDraft(value)}
        currentQuestion="desired-work"
        saving={false}
        saveError={null}
        onChange={() => undefined}
        onBack={() => undefined}
        onContinue={() => undefined}
      />,
    );

    expect(screen.getByText('Question 1 of 5')).toBeInTheDocument();
    expect(
      screen.getByText('Add at least one desired role.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Add at least one city and state.')).toBeNull();
    expect(
      screen.queryByText('Enter a search radius in whole miles.'),
    ).toBeNull();
    expect(
      screen.queryByText('Choose a remote-work option before continuing.'),
    ).toBeNull();
    expect(
      screen.queryByText('Select at least one desired employment type.'),
    ).toBeNull();
  });

  it('preserves earlier answers when navigating back', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialDraft={fictionalPreferencesDraftComplete}
        initialQuestion="remote-work"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByRole('heading', {
        name: 'How far are you willing to travel?',
      }),
    ).toBeInTheDocument();
    expect(preferredRadiusInput()).toHaveValue('50');
    expect(widerRadiusInput()).toHaveValue('75');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByRole('heading', { name: 'Where would you like to work?' }),
    ).toBeInTheDocument();
    expect(cityInput(1)).toHaveValue('Austin');
    expect(stateInput(1)).toHaveValue('TX');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByRole('heading', { name: 'What roles interest you?' }),
    ).toBeInTheDocument();
    expect(roleInput(1)).toHaveValue('Network Engineer');
  });

  it('adds and removes desired roles without leaving the question', async () => {
    const user = userEvent.setup();
    render(<Harness initialDraft={fictionalFirstTimeUserDraft} />);

    await user.type(roleInput(1), 'Network Engineer');
    await user.click(screen.getByRole('button', { name: 'Add role' }));

    expect(
      screen.getByRole('heading', { name: 'What roles interest you?' }),
    ).toBeInTheDocument();
    await user.type(roleInput(2), 'Cloud Support Engineer');
    expect(roleInput(1)).toHaveValue('Network Engineer');

    await user.click(screen.getByRole('button', { name: 'Remove role 2' }));
    expect(
      screen.queryByRole('textbox', { name: /^Desired role 2/ }),
    ).toBeNull();
    expect(roleInput(1)).toHaveValue('Network Engineer');
    expect(
      screen.getByRole('heading', { name: 'What roles interest you?' }),
    ).toBeInTheDocument();
  });

  it('adds and removes preferred locations without leaving the question', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialDraft={fictionalPreferencesDraftComplete}
        initialQuestion="location"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add location' }));
    expect(cityInput(3)).toBeInTheDocument();
    expect(stateInput(3)).toBeInTheDocument();
    await user.type(cityInput(3), 'Dallas');
    await user.type(stateInput(3), 'TX');

    await user.click(screen.getByRole('button', { name: 'Remove location 3' }));
    expect(screen.queryByRole('textbox', { name: /^City 3/ })).toBeNull();
    expect(cityInput(1)).toHaveValue('Austin');
    expect(stateInput(1)).toHaveValue('TX');
    expect(
      screen.getByRole('heading', { name: 'Where would you like to work?' }),
    ).toBeInTheDocument();
  });

  it('keeps temporary numeric text without zero or NaN coercion', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialDraft={fictionalResumedProgressDraft}
        initialQuestion="travel-distance"
      />,
    );

    const input = preferredRadiusInput();
    await user.type(input, '25.');
    expect(input).toHaveValue('25.');

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByText('Enter a whole number greater than zero.'),
    ).toBeInTheDocument();
    expect(input).toHaveValue('25.');

    await user.clear(input);
    await user.type(input, '25');
    await user.type(widerRadiusInput(), '50');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByRole('heading', {
        name: 'How do you feel about remote work?',
      }),
    ).toBeInTheDocument();
  });

  it('records the chosen remote option in the draft value and its answer state', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialDraft={fictionalResumedProgressDraft}
        initialQuestion="remote-work"
      />,
    );

    expect(screen.queryByRole('radio', { name: /not sure/i })).toBeNull();

    await user.click(screen.getByRole('radio', { name: /Remote is OK/ }));
    expect(screen.getByRole('radio', { name: /Remote is OK/ })).toBeChecked();

    const draft = readHarnessDraft();
    expect(draft.remotePreference).toBe('accepted');
    expect(draft.answers.remotePreference).toBe('answered');

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByRole('heading', {
        name: 'What employment types work for you?',
      }),
    ).toBeInTheDocument();
  });

  it('selects and deselects employment types and requires at least one', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialDraft={fictionalFirstTimeUserDraft}
        initialQuestion="employment-types"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Save and finish' }));
    expect(
      screen.getByText('Select at least one desired employment type.'),
    ).toBeInTheDocument();

    const fullTime = screen.getByRole('checkbox', { name: /Full-time/ });
    const contract = screen.getByRole('checkbox', { name: /Contract/ });
    await user.click(fullTime);
    await user.click(contract);
    expect(fullTime).toBeChecked();
    expect(contract).toBeChecked();

    await user.click(contract);
    expect(contract).not.toBeChecked();
    expect(fullTime).toBeChecked();

    await user.click(contract);
    await user.click(screen.getByRole('button', { name: 'Save and finish' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save and finish' }),
      ).not.toBeDisabled(),
    );

    expect(readHarnessDraft().desiredEmploymentTypes).toEqual([
      'full-time',
      'contract',
    ]);
  });

  it('requests saving on the final question and blocks a duplicate submission', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialDraft={fictionalPreferencesDraftComplete}
        initialQuestion="employment-types"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Save and finish' }));

    const savingButton = await screen.findByRole('button', { name: /Saving/ });
    expect(savingButton).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Saving your preferences…',
    );
    expect(document.querySelector('form')).toHaveAttribute('aria-busy', 'true');

    await user.click(savingButton);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save and finish' }),
      ).not.toBeDisabled(),
    );
    expect(readHarnessSaveAttempts()).toBe(1);
  });

  it('keeps the answers after a failed save and supports a retry', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialDraft={fictionalPreferencesDraftComplete}
        initialQuestion="employment-types"
        saveFailures={1}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Save and finish' }));
    expect(await screen.findByText(FAILURE_MESSAGE)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'What employment types work for you?',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Full-time/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Contract/ })).toBeChecked();
    expect(readHarnessSaveAttempts()).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Save and finish' }));
    await waitFor(() => expect(screen.queryByText(FAILURE_MESSAGE)).toBeNull());
    expect(readHarnessSaveAttempts()).toBe(2);
    expect(readHarnessLastSaved()).not.toBeNull();
  });

  it('restores a draft at the saved question and keeps walking from there', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialDraft={fictionalResumedProgressDraft}
        initialQuestion="travel-distance"
      />,
    );

    expect(
      screen.getByRole('heading', {
        name: 'How far are you willing to travel?',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Question 3 of 5')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByRole('heading', { name: 'Where would you like to work?' }),
    ).toBeInTheDocument();
    expect(cityInput(1)).toHaveValue('Austin');
    expect(stateInput(1)).toHaveValue('TX');

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByRole('heading', {
        name: 'How far are you willing to travel?',
      }),
    ).toBeInTheDocument();
  });

  it('never renders salary controls and leaves existing salary data intact', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialDraft={fictionalFullContractDraft}
        initialQuestion="desired-work"
      />,
    );

    expect(screen.queryByLabelText(/salary/i)).toBeNull();
    expect(screen.queryByText(/Salary preferences come later/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByRole('heading', { name: 'Where would you like to work?' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/salary/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByRole('heading', {
        name: 'What employment types work for you?',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/salary/i)).toBeNull();
    expect(screen.queryByText(/Salary preferences come later/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save and finish' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save and finish' }),
      ).not.toBeDisabled(),
    );

    const saved = readHarnessLastSaved();
    expect(saved?.desiredSalary).toEqual({
      minimum: '70000',
      target: '85000',
      currency: 'USD',
    });
    expect(saved?.answers.desiredSalary).toBe('answered');
    expect(saved?.desiredEmploymentTypes).toEqual(['full-time', 'contract']);
  });

  it('submits with the keyboard', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialDraft={fictionalResumedProgressDraft}
        initialQuestion="travel-distance"
      />,
    );

    await user.type(preferredRadiusInput(), '25');
    await user.type(widerRadiusInput(), '50');
    screen.getByRole('button', { name: 'Continue' }).focus();
    await user.keyboard('{Enter}');

    expect(
      await screen.findByRole('heading', {
        name: 'How do you feel about remote work?',
      }),
    ).toBeInTheDocument();
  });

  it('links field errors and controls with aria-describedby', async () => {
    const user = userEvent.setup();
    render(<Harness initialDraft={fictionalFirstTimeUserDraft} />);

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const input = roleInput(1);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      'Add at least one desired role.',
    );
  });

  it('labels the unspecified employment type accurately and stores its exact value', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialDraft={fictionalFirstTimeUserDraft}
        initialQuestion="employment-types"
      />,
    );

    const unspecified = screen.getByRole('checkbox', {
      name: /Jobs with unspecified employment type/,
    });
    expect(
      screen.getByText(/does not state its employment arrangement/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/standard weekly schedule for a full-time position/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/engineering workweek/i)).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /open to all/i })).toBeNull();
    expect(
      screen.getByText(/A job matches only when it lists one of the types/i),
    ).toBeInTheDocument();

    await user.click(unspecified);
    expect(readHarnessDraft().desiredEmploymentTypes).toEqual(['unknown']);
  });

  it('shows an editable blank role row when no roles exist yet', async () => {
    const user = userEvent.setup();
    render(<Harness initialDraft={fictionalFirstTimeUserDraft} />);

    const first = roleInput(1);
    expect(first).toHaveValue('');

    await user.type(first, 'Network Engineer');
    expect(readHarnessDraft().desiredJobTitles).toEqual(['Network Engineer']);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByRole('heading', { name: 'Where would you like to work?' }),
    ).toBeInTheDocument();
  });

  it('shows an editable blank location row when no locations exist yet', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialDraft={fictionalFirstTimeUserDraft}
        initialQuestion="location"
      />,
    );

    expect(cityInput(1)).toHaveValue('');
    expect(stateInput(1)).toHaveValue('');

    await user.type(cityInput(1), 'Austin');
    await user.type(stateInput(1), 'TX');
    expect(readHarnessDraft().preferredLocations).toEqual([
      { city: 'Austin', state: 'TX' },
    ]);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByRole('heading', {
        name: 'How far are you willing to travel?',
      }),
    ).toBeInTheDocument();
  });

  it('disables editing and add/remove controls while saving', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PreferencesStep
        value={fictionalPreferencesDraftComplete}
        errors={{}}
        currentQuestion="location"
        saving={true}
        saveError={null}
        onChange={onChange}
        onBack={() => undefined}
        onContinue={() => undefined}
      />,
    );

    expect(cityInput(1)).toBeDisabled();
    expect(stateInput(1)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add location' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Remove location 1' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Add location' }));
    await user.click(screen.getByRole('button', { name: 'Remove location 1' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('blocks edits during a pending save and resumes editing after failure', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialDraft={fictionalPreferencesDraftComplete}
        initialQuestion="employment-types"
        saveFailures={1}
      />,
    );

    const before = readHarnessDraft().desiredEmploymentTypes;
    const partTime = screen.getByRole('checkbox', { name: /Part-time/ });

    await user.click(screen.getByRole('button', { name: 'Save and finish' }));
    const savingButton = await screen.findByRole('button', { name: /Saving/ });
    expect(savingButton).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Full-time/ })).toBeDisabled();
    expect(partTime).toBeDisabled();

    await user.click(partTime);
    expect(readHarnessDraft().desiredEmploymentTypes).toEqual(before);
    expect(readHarnessSaveAttempts()).toBe(1);

    expect(await screen.findByText(FAILURE_MESSAGE)).toBeInTheDocument();

    await user.click(partTime);
    expect(readHarnessDraft().desiredEmploymentTypes).toEqual([
      ...before,
      'part-time',
    ]);

    await user.click(screen.getByRole('button', { name: 'Save and finish' }));
    await waitFor(() => expect(screen.queryByText(FAILURE_MESSAGE)).toBeNull());
    expect(readHarnessSaveAttempts()).toBe(2);
    expect(readHarnessLastSaved()?.desiredEmploymentTypes).toEqual([
      ...before,
      'part-time',
    ]);
  });

  it('focuses the first invalid control when a parent reveals errors only after Continue', async () => {
    const user = userEvent.setup();
    render(
      <DeferredErrorHarness
        initialDraft={fictionalFirstTimeUserDraft}
        initialQuestion="desired-work"
      />,
    );

    expect(screen.queryByText('Add at least one desired role.')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      screen.getByText('Add at least one desired role.'),
    ).toBeInTheDocument();
    expect(roleInput(1)).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(roleInput(1));
  });

  it('focuses the blank location row for an empty-list error revealed after Continue', async () => {
    const user = userEvent.setup();
    render(
      <DeferredErrorHarness
        initialDraft={fictionalFirstTimeUserDraft}
        initialQuestion="location"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      screen.getByText('Add at least one city and state.'),
    ).toBeInTheDocument();
    expect(cityInput(1)).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(cityInput(1));
  });
});

function readHarnessLastSaved(): OnboardingPreferencesDraft | null {
  const raw = screen.getByTestId('harness').getAttribute('data-last-saved');
  return JSON.parse(raw ?? 'null') as OnboardingPreferencesDraft | null;
}
