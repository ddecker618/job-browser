// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingPage } from '../src/client/pages/OnboardingPage.js';
import type {
  OnboardingDiscoveryOutcome,
  OnboardingStatusResponse,
} from '../src/client/api.js';
import { createEmptyPreferencesDraft } from '../src/schemas/onboarding.js';
import type { OnboardingProgressSnapshot } from '../src/models/onboarding.js';

const apiMock = vi.hoisted(() => ({
  onboardingStatus: vi.fn(),
  onboardingPreview: vi.fn(),
  onboardingDraftFromProfile: vi.fn(),
  saveOnboardingProgress: vi.fn(),
  resetOnboardingProgress: vi.fn(),
  startOnboardingEdit: vi.fn(),
  endOnboardingEdit: vi.fn(),
  completeOnboarding: vi.fn(),
  retryOnboardingDiscovery: vi.fn(),
}));

vi.mock('../src/client/api.js', () => ({
  api: apiMock,
  ApiRequestError: Error,
  apiRequestErrorReason: () => null,
  isDefinitiveApiCommandError: () => false,
}));

const ZERO_OUTCOME: OnboardingDiscoveryOutcome = {
  state: 'not-started',
  message: null,
  summariesCount: 0,
  completedAt: null,
  attemptId: null,
};

const ZERO_EDIT = {
  editing: false,
  startedAt: null,
};

function statusNotStarted(
  overrides: Partial<Omit<OnboardingStatusResponse, 'snapshot'>> & {
    snapshot?: unknown;
  } = {},
): OnboardingStatusResponse {
  const base: OnboardingStatusResponse = {
    state: 'not-started',
    profileId: 'candidate-flow-one',
    question: null,
    prefilledDraft: {
      ...createEmptyPreferencesDraft(),
      desiredJobTitles: ['Network Engineer'],
      preferredLocations: [{ city: 'Example City', state: 'EX' }],
      searchRadiusMiles: '25',
      secondarySearchRadiusMiles: '50',
      remotePreference: 'preferred',
      answers: {
        remotePreference: 'answered',
        desiredSalary: 'unanswered',
      },
      desiredEmploymentTypes: ['full-time'],
    },
    planToken: 'a'.repeat(64),
    discoveryOutcome: ZERO_OUTCOME,
    editSession: ZERO_EDIT,
    completion: { completed: false, completedAt: null },
  };
  return { ...base, ...overrides } as OnboardingStatusResponse;
}

function stripPlanToken(
  overrides: Partial<OnboardingStatusResponse>,
): Partial<OnboardingStatusResponse> {
  const { planToken: _ignore, ...rest } = overrides;
  void _ignore;
  return rest;
}
void stripPlanToken;

function snapshotV2(
  overrides: Partial<OnboardingProgressSnapshot> = {},
): OnboardingProgressSnapshot {
  return {
    version: 2,
    onboardingStep: 'preferences',
    currentQuestion: 'desired-work',
    answers: {
      ...createEmptyPreferencesDraft(),
      desiredJobTitles: ['Network Engineer'],
      preferredLocations: [{ city: 'Example City', state: 'EX' }],
      searchRadiusMiles: '25',
      secondarySearchRadiusMiles: '50',
      remotePreference: 'preferred',
      answers: {
        remotePreference: 'answered',
        desiredSalary: 'unanswered',
      },
      desiredEmploymentTypes: ['full-time'],
    },
    reviewItems: [],
    ...overrides,
  };
}

function renderPage(initialPath = '/onboarding') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/jobs" element={<div>Jobs</div>} />
        <Route path="/sources" element={<div>Sources</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.onboardingStatus.mockReset();
  apiMock.onboardingPreview.mockReset();
  apiMock.onboardingDraftFromProfile.mockReset();
  apiMock.saveOnboardingProgress.mockReset();
  apiMock.resetOnboardingProgress.mockReset();
  apiMock.startOnboardingEdit.mockReset();
  apiMock.endOnboardingEdit.mockReset();
  apiMock.completeOnboarding.mockReset();
  apiMock.retryOnboardingDiscovery.mockReset();

  apiMock.saveOnboardingProgress.mockResolvedValue({ ok: true });
  apiMock.resetOnboardingProgress.mockResolvedValue({ ok: true });
  apiMock.startOnboardingEdit.mockResolvedValue({ ok: true });
  apiMock.endOnboardingEdit.mockResolvedValue({ ok: true });
  apiMock.onboardingPreview.mockResolvedValue({
    plan: {
      version: 1,
      confirmedTitles: ['Network Engineer'],
      appliedQueries: ['Network Engineer'],
      omittedTitles: [],
      preferredLocations: [{ city: 'Example City', state: 'EX' }],
      remotePreference: 'preferred',
      primaryRadiusMiles: 25,
      secondaryRadiusMiles: 50,
      sources: [],
      totalSourceCount: 1,
      readySourceCount: 1,
      needsAttentionSourceCount: 0,
      excludedSourceCount: 0,
      warnings: [],
      confirmationAllowed: true,
    },
    planToken: 'a'.repeat(64),
    confirmationAllowed: true,
  });
  apiMock.onboardingDraftFromProfile.mockResolvedValue({
    draft: {
      ...createEmptyPreferencesDraft(),
      desiredJobTitles: ['Network Engineer'],
    },
    planToken: 'a'.repeat(64),
    confirmationAllowed: true,
  });
  apiMock.completeOnboarding.mockResolvedValue({
    ok: true,
    idempotent: false,
    attemptId: 'a',
    discoveryOutcome: {
      state: 'succeeded',
      message: null,
      summariesCount: 1,
      completedAt: '2026-09-24T00:00:00.000Z',
      attemptId: 'a',
    },
  });
  apiMock.retryOnboardingDiscovery.mockResolvedValue({
    ok: true,
    idempotent: false,
    attemptId: 'a',
    discoveryOutcome: {
      state: 'succeeded',
      message: null,
      summariesCount: 1,
      completedAt: '2026-09-24T00:00:00.000Z',
      attemptId: 'a',
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OnboardingPage â€” visible entry points', () => {
  it('exposes a /onboarding route that loads status on mount', async () => {
    apiMock.onboardingStatus.mockResolvedValue(statusNotStarted());
    renderPage();
    await waitFor(() => {
      expect(apiMock.onboardingStatus).toHaveBeenCalledTimes(1);
    });
  });
});

describe('OnboardingPage â€” blocked states', () => {
  it('shows a distinct blocked screen for malformed progress with an explicit reset action', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'blocked',
        blockKind: 'malformed',
        blockMessage: 'Stored onboarding progress is unreadable.',
        prefilledDraft: undefined,
        planToken: undefined,
      }),
    );
    renderPage();
    expect(
      await screen.findByRole('heading', {
        name: /Onboarding progress is unreadable/i,
      }),
    ).toBeInTheDocument();
    const resetButton = screen.getByRole('button', {
      name: /Reset onboarding/i,
    });
    await userEvent.setup().click(resetButton);
    await waitFor(() => {
      expect(apiMock.resetOnboardingProgress).toHaveBeenCalled();
    });
  });

  it('shows a distinct blocked screen for unsupported-version progress', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'blocked',
        blockKind: 'unsupported-version',
        blockMessage:
          'Stored onboarding progress uses an unsupported version (9).',
        prefilledDraft: undefined,
        planToken: undefined,
      }),
    );
    renderPage();
    expect(
      await screen.findByRole('heading', {
        name: /unsupported version/i,
      }),
    ).toBeInTheDocument();
  });

  it('shows a distinct blocked screen for storage-failure progress with Retry and Leave (no destructive reset)', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'blocked',
        blockKind: 'storage-failure',
        blockMessage: 'Onboarding progress could not be loaded.',
        prefilledDraft: undefined,
        planToken: undefined,
      }),
    );
    renderPage();
    expect(
      await screen.findByRole('heading', {
        name: /Onboarding progress could not be loaded/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Reset onboarding/i }),
    ).not.toBeInTheDocument();
  });
});

describe('OnboardingPage â€” persistence transitions', () => {
  it('persists the destination snapshot on Continue before advancing', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2(),
        resumeKind: 'stored',
        question: 'desired-work',
        planToken: undefined,
        prefilledDraft: undefined,
      }),
    );
    renderPage();
    const continueButton = await screen.findByRole('button', {
      name: /Continue/i,
    });
    await userEvent.setup().click(continueButton);
    await waitFor(() => {
      expect(apiMock.saveOnboardingProgress).toHaveBeenCalled();
    });
    const lastCall = apiMock.saveOnboardingProgress.mock.calls[
      apiMock.saveOnboardingProgress.mock.calls.length - 1
    ]?.[0] as OnboardingProgressSnapshot;
    // The saved snapshot must reflect the destination (location)
    // rather than the previous question (desired-work).
    expect(lastCall.currentQuestion).toBe('location');
  });

  it('does not advance when the destination save fails', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2(),
        resumeKind: 'stored',
        question: 'desired-work',
        planToken: undefined,
        prefilledDraft: undefined,
      }),
    );
    apiMock.saveOnboardingProgress.mockRejectedValueOnce(
      new Error('disk on fire'),
    );
    renderPage();
    const continueButton = await screen.findByRole('button', {
      name: /Continue/i,
    });
    await userEvent.setup().click(continueButton);
    await waitFor(() => {
      expect(apiMock.saveOnboardingProgress).toHaveBeenCalled();
    });
    expect(
      await screen.findByText(/Onboarding progress could not be saved/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /What roles interest you/i }),
    ).toBeInTheDocument();
  });

  it('prefills from the server-supplied draft when status reports not-started', async () => {
    apiMock.onboardingStatus.mockResolvedValue(statusNotStarted());
    renderPage();
    await waitFor(() => {
      expect(apiMock.onboardingStatus).toHaveBeenCalled();
    });
    // The desired-work input should be prefilled with "Network Engineer"
    const prefilled = screen.getByDisplayValue('Network Engineer');
    expect(prefilled).toBeInTheDocument();
  });
});

describe('OnboardingPage â€” Cancel preserves resumable progress', () => {
  it('saves the current snapshot and ends the editing session without calling destructive reset', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2(),
        resumeKind: 'stored',
        question: 'desired-work',
        planToken: undefined,
        prefilledDraft: undefined,
      }),
    );
    renderPage();
    const cancelButton = await screen.findByRole('button', {
      name: /Save and leave/i,
    });
    await userEvent.setup().click(cancelButton);
    await waitFor(() => {
      expect(apiMock.saveOnboardingProgress).toHaveBeenCalled();
    });
    expect(apiMock.endOnboardingEdit).toHaveBeenCalledWith(true);
    expect(apiMock.resetOnboardingProgress).not.toHaveBeenCalled();
  });
});

describe('OnboardingPage â€” confirmation and discovery outcome', () => {
  it('completes with a generated attemptId and a matching planToken', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2({
          onboardingStep: 'search-plan',
        }) as unknown as Record<string, unknown>,
        resumeKind: 'stored',
        question: 'desired-work',
        planToken: undefined,
        prefilledDraft: undefined,
      }),
    );
    renderPage();
    const confirmButton = await screen.findByTestId(
      'onboarding-search-plan-confirm',
    );
    await userEvent.setup().click(confirmButton);
    await waitFor(() => {
      expect(apiMock.completeOnboarding).toHaveBeenCalledTimes(1);
    });
    const call = apiMock.completeOnboarding.mock.calls[0]?.[0] as {
      planToken: string;
      attemptId: string;
    };
    expect(call.planToken).toBe('a'.repeat(64));
    expect(call.attemptId).toMatch(/^attempt-\d+-\d+$/);
  });

  it('renders a retry-preview fallback when the preview cannot be loaded', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2({
          onboardingStep: 'search-plan',
        }) as unknown as Record<string, unknown>,
        resumeKind: 'stored',
        question: 'desired-work',
        planToken: undefined,
        prefilledDraft: undefined,
      }),
    );
    apiMock.onboardingPreview.mockRejectedValueOnce(new Error('preview boom'));
    renderPage();
    expect(
      await screen.findByRole('button', { name: /Retry preview/i }),
    ).toBeInTheDocument();
    expect(apiMock.completeOnboarding).not.toHaveBeenCalled();
  });

  it('surfaces a bounded confirmation error when persistence fails and keeps the draft', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2({
          onboardingStep: 'search-plan',
        }) as unknown as Record<string, unknown>,
        resumeKind: 'stored',
        question: 'desired-work',
        planToken: undefined,
        prefilledDraft: undefined,
      }),
    );
    apiMock.completeOnboarding.mockResolvedValueOnce({
      ok: false,
      idempotent: false,
      attemptId: 'a',
      discoveryOutcome: ZERO_OUTCOME,
      saveError: 'Onboarding could not be saved to your profile preferences.',
    });
    renderPage();
    const confirmButton = await screen.findByTestId(
      'onboarding-search-plan-confirm',
    );
    await userEvent.setup().click(confirmButton);
    expect(
      await screen.findByText(/Onboarding could not be saved/i),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('onboarding-search-plan-confirm'),
    ).toBeInTheDocument();
  });

  it('persists a failed discovery outcome that survives a refresh', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'completed',
        completion: {
          completed: true,
          completedAt: '2026-09-24T00:00:00.000Z',
        },
        discoveryOutcome: {
          state: 'failed',
          message: 'Timeout: The server did not respond in time',
          summariesCount: 0,
          completedAt: '2026-09-24T00:00:00.000Z',
          attemptId: 'a',
        },
      }),
    );
    renderPage();
    expect(
      await screen.findByText(/Preferences saved, search failed/i),
    ).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: /Retry search/i });
    await userEvent.setup().click(retryButton);
    await waitFor(() => {
      expect(apiMock.retryOnboardingDiscovery).toHaveBeenCalled();
    });
  });
});

describe('OnboardingPage â€” duplicate confirm calls completion once', () => {
  it('does not call the completion API twice for rapid duplicate clicks', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2({ onboardingStep: 'search-plan' }),
        resumeKind: 'stored',
        question: 'desired-work',
        planToken: undefined,
        prefilledDraft: undefined,
      }),
    );
    // Make the completion call take a moment so the second click can
    // arrive while the first is in flight.
    apiMock.completeOnboarding.mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                idempotent: false,
                attemptId: 'a',
                discoveryOutcome: {
                  state: 'succeeded',
                  message: null,
                  summariesCount: 1,
                  completedAt: '2026-09-24T00:00:00.000Z',
                  attemptId: 'a',
                },
              }),
            50,
          ),
        ),
    );
    renderPage();
    const confirmButton = await screen.findByTestId(
      'onboarding-search-plan-confirm',
    );
    const user = userEvent.setup();
    await user.click(confirmButton);
    await user.click(confirmButton);
    await waitFor(() => {
      expect(apiMock.completeOnboarding).toHaveBeenCalledTimes(1);
    });
  });
});
