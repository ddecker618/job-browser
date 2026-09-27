// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import {
  MemoryRouter,
  Route,
  Routes,
  createMemoryRouter,
  RouterProvider,
} from 'react-router';
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
  resumable: false,
  startedAt: null,
};

function statusNotStarted(
  overrides: Partial<
    Omit<OnboardingStatusResponse, 'snapshot' | 'prefilledDraft'>
  > & {
    snapshot?: unknown;
    prefilledDraft?: unknown;
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
    } as unknown as Record<string, unknown>,
    planToken: 'a'.repeat(64),
    discoveryOutcome: ZERO_OUTCOME,
    editSession: ZERO_EDIT,
    completion: { completed: false, completedAt: null },
  };
  return { ...base, ...overrides } as OnboardingStatusResponse;
}

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

function renderPageWithNavigation(initialPath = '/onboarding') {
  const router = createMemoryRouter(
    [
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/jobs', element: <div>Jobs</div> },
      { path: '/sources', element: <div>Sources</div> },
    ],
    { initialEntries: [initialPath] },
  );
  return render(<RouterProvider router={router} />);
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

describe('OnboardingPage â€” completed user can edit', () => {
  it('exposes an Edit search setup action on the completed view that calls startOnboardingEdit', async () => {
    apiMock.onboardingStatus
      .mockResolvedValueOnce(
        statusNotStarted({
          state: 'completed',
          completion: {
            completed: true,
            completedAt: '2026-09-24T00:00:00.000Z',
          },
          discoveryOutcome: {
            state: 'succeeded',
            message: null,
            summariesCount: 1,
            completedAt: '2026-09-24T00:00:00.000Z',
            attemptId: 'a',
          },
          prefilledDraft: undefined,
          planToken: undefined,
        }),
      )
      .mockResolvedValueOnce(
        statusNotStarted({
          state: 'in-progress',
          resumeKind: 'editing-existing',
          question: 'desired-work',
          editSession: {
            editing: true,
            resumable: true,
            startedAt: '2026-09-24T00:00:00.000Z',
          },
          completion: {
            completed: true,
            completedAt: '2026-09-24T00:00:00.000Z',
          },
        }),
      );
    renderPage();
    const editButton = await screen.findByTestId('onboarding-completed-edit');
    await userEvent.setup().click(editButton);
    await waitFor(() => {
      expect(apiMock.startOnboardingEdit).toHaveBeenCalledTimes(1);
    });
    expect(apiMock.onboardingStatus).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByRole('heading', { name: /What roles interest you/i }),
    ).toBeInTheDocument();
  });

  it('renders the wizard once editSession.editing is true and keeps the completion marker', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        resumeKind: 'editing-existing',
        onboardingStep: 'preferences',
        question: 'desired-work',
        editSession: {
          editing: true,
          resumable: true,
          startedAt: '2026-09-24T00:00:00.000Z',
        },
        completion: {
          completed: true,
          completedAt: '2026-09-24T00:00:00.000Z',
        },
        prefilledDraft: {
          ...createEmptyPreferencesDraft(),
          desiredJobTitles: ['Network Engineer'],
        } as unknown as Record<string, unknown>,
      }),
    );
    renderPage();
    expect(
      await screen.findByRole('heading', { name: /What roles interest you/i }),
    ).toBeInTheDocument();
    // The destructive "Reset onboarding" button is NOT in the ordinary
    // wizard footer; only Save and leave and Discard current edit are
    // offered.
    expect(
      screen.queryByRole('button', { name: /^Reset onboarding$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Save and leave/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Discard current edit/ }),
    ).toBeInTheDocument();
  });
});

describe('OnboardingPage â€” Save and leave actually leaves', () => {
  it('navigates to /jobs after a successful save', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2() as unknown as Record<string, unknown>,
        resumeKind: 'stored',
        question: 'desired-work',
        prefilledDraft: undefined,
        planToken: undefined,
      }),
    );
    renderPage();
    const leave = await screen.findByTestId('onboarding-save-and-leave');
    await userEvent.setup().click(leave);
    await waitFor(() => {
      expect(apiMock.saveOnboardingProgress).toHaveBeenCalled();
    });
    expect(apiMock.endOnboardingEdit).toHaveBeenCalledWith(true);
    // The router navigates to /jobs; the test router renders the
    // destination's element when the URL changes.
    expect(await screen.findByText('Jobs')).toBeInTheDocument();
  });

  it('does not call endOnboardingEdit and does not navigate when the save fails', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2(),
        resumeKind: 'stored',
        question: 'desired-work',
        prefilledDraft: undefined,
        planToken: undefined,
      }),
    );
    apiMock.saveOnboardingProgress.mockRejectedValueOnce(
      new Error('disk on fire'),
    );
    renderPageWithNavigation();
    const leave = await screen.findByTestId('onboarding-save-and-leave');
    await userEvent.setup().click(leave);
    await waitFor(() => {
      expect(apiMock.saveOnboardingProgress).toHaveBeenCalled();
    });
    expect(apiMock.endOnboardingEdit).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Onboarding progress could not be saved/i),
    ).toBeInTheDocument();
    // The wizard heading is still present, not the Jobs page.
    expect(
      screen.getByRole('heading', { name: /What roles interest you/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Jobs')).not.toBeInTheDocument();
  });

  it('does not navigate when the edit session cannot be ended after a successful save', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2() as unknown as Record<string, unknown>,
        resumeKind: 'stored',
        question: 'desired-work',
        prefilledDraft: undefined,
        planToken: undefined,
      }),
    );
    apiMock.endOnboardingEdit.mockRejectedValueOnce(
      new Error('edit-end disk on fire'),
    );
    renderPageWithNavigation();
    const leave = await screen.findByTestId('onboarding-save-and-leave');
    await userEvent.setup().click(leave);
    await waitFor(() => {
      expect(apiMock.saveOnboardingProgress).toHaveBeenCalled();
    });
    expect(apiMock.endOnboardingEdit).toHaveBeenCalledWith(true);
    // The wizard remains visible and no navigation occurred.
    expect(
      screen.getByRole('heading', { name: /What roles interest you/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/end the editing session/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Jobs')).not.toBeInTheDocument();
  });
});

describe('OnboardingPage â€” Discard current edit', () => {
  it('calls endOnboardingEdit with keepProgress false and does not call saveOnboardingProgress', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2() as unknown as Record<string, unknown>,
        resumeKind: 'stored',
        question: 'desired-work',
        editSession: {
          editing: true,
          resumable: true,
          startedAt: '2026-09-24T00:00:00.000Z',
        },
        completion: {
          completed: true,
          completedAt: '2026-09-23T00:00:00.000Z',
        },
        prefilledDraft: undefined,
        planToken: undefined,
      }),
    );
    renderPage();
    const discard = await screen.findByTestId('onboarding-discard-edit');
    await userEvent.setup().click(discard);
    await waitFor(() => {
      expect(apiMock.endOnboardingEdit).toHaveBeenCalledWith(false);
    });
    // Discard must not save progress first.
    expect(apiMock.saveOnboardingProgress).not.toHaveBeenCalled();
    // Discard must not call the destructive reset endpoint.
    expect(apiMock.resetOnboardingProgress).not.toHaveBeenCalled();
  });
});

describe('OnboardingPage â€” blocked screens', () => {
  it('recovers from one bounded status-readiness failure and logs only safe diagnostics', async () => {
    apiMock.onboardingStatus
      .mockRejectedValueOnce(
        Object.assign(
          new TypeError('Failed to fetch C:\\private\\secret=do-not-log'),
          { code: 'transport_failure' },
        ),
      )
      .mockResolvedValueOnce(statusNotStarted());
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      renderPage();
      expect(
        await screen.findByRole('heading', {
          name: /What roles interest you/i,
        }),
      ).toBeInTheDocument();
      expect(apiMock.onboardingStatus).toHaveBeenCalledTimes(2);
      const diagnosticText = JSON.stringify(warning.mock.calls);
      expect(diagnosticText).toContain('ONBOARDING_STATUS_DIAGNOSTIC');
      expect(diagnosticText).toContain('recovered');
      expect(diagnosticText).not.toContain('C:\\private');
      expect(diagnosticText).not.toContain('do-not-log');
    } finally {
      warning.mockRestore();
    }
  });

  it('keeps invalid progress blocked ahead of a resumable completed-user edit', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'blocked',
        blockKind: 'malformed',
        blockMessage: 'Stored onboarding progress is unreadable.',
        editSession: {
          editing: false,
          resumable: true,
          startedAt: '2026-09-26T00:00:00.000Z',
        },
        completion: {
          completed: true,
          completedAt: '2026-09-25T00:00:00.000Z',
        },
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
    expect(
      screen.queryByTestId('onboarding-save-and-leave'),
    ).not.toBeInTheDocument();
  });

  it('shows a distinct blocked screen for storage-failure progress with Retry+Leave and no destructive reset', async () => {
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
    const retry = screen.getByRole('button', { name: /Retry/i });
    expect(retry).toBeInTheDocument();
    const readsBeforeRetry = apiMock.onboardingStatus.mock.calls.length;
    await userEvent.setup().click(retry);
    await waitFor(() => {
      expect(apiMock.onboardingStatus).toHaveBeenCalledTimes(
        readsBeforeRetry + 1,
      );
    });
    expect(
      screen.queryByRole('button', { name: /^Reset onboarding$/ }),
    ).not.toBeInTheDocument();
    const leave = screen.getByRole('link', { name: 'Leave' });
    expect(leave).toHaveAttribute('href', '/jobs');
    await userEvent.setup().click(leave);
    expect(await screen.findByText('Jobs')).toBeInTheDocument();
    expect(apiMock.resetOnboardingProgress).not.toHaveBeenCalled();
    expect(apiMock.saveOnboardingProgress).not.toHaveBeenCalled();
  });

  it('shows a destructive Reset only for malformed or unsupported-version states', async () => {
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
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /Clear broken progress/i }));
    await waitFor(() => {
      expect(apiMock.resetOnboardingProgress).toHaveBeenCalledWith();
    });
    expect(apiMock.saveOnboardingProgress).not.toHaveBeenCalled();
  });

  it('shows a bounded reset error and does not save progress first', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'blocked',
        blockKind: 'malformed',
        blockMessage: 'Stored onboarding progress is unreadable.',
        prefilledDraft: undefined,
        planToken: undefined,
      }),
    );
    apiMock.resetOnboardingProgress.mockRejectedValueOnce(
      new Error('disk path secret stack'),
    );
    renderPage();
    await screen.findByRole('heading', {
      name: /Onboarding progress is unreadable/i,
    });
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /Clear broken progress/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Onboarding progress could not be saved/i,
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      /secret|stack|path/i,
    );
    expect(apiMock.saveOnboardingProgress).not.toHaveBeenCalled();
  });
});

describe('OnboardingPage — transitions persist the destination', () => {
  it('persists the destination snapshot on Continue before advancing', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2() as unknown as Record<string, unknown>,
        resumeKind: 'stored',
        question: 'desired-work',
        prefilledDraft: undefined,
        planToken: undefined,
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
    ]?.[0] as { currentQuestion: string } | undefined;
    expect(lastCall?.currentQuestion).toBe('location');
  });

  it('does not advance when the destination save fails', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2() as unknown as Record<string, unknown>,
        resumeKind: 'stored',
        question: 'desired-work',
        prefilledDraft: undefined,
        planToken: undefined,
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
});

describe('OnboardingPage â€” completion and durable outcome', () => {
  it('completes with a generated attemptId and a matching planToken', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2({
          onboardingStep: 'search-plan',
        }) as unknown as Record<string, unknown>,
        resumeKind: 'stored',
        question: 'desired-work',
        prefilledDraft: undefined,
        planToken: undefined,
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

  it('surfaces a bounded confirmation error when persistence fails and keeps the draft', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2({
          onboardingStep: 'search-plan',
        }) as unknown as Record<string, unknown>,
        resumeKind: 'stored',
        question: 'desired-work',
        prefilledDraft: undefined,
        planToken: undefined,
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
        prefilledDraft: undefined,
        planToken: undefined,
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

  it('does not call the completion API twice for rapid duplicate clicks', async () => {
    apiMock.onboardingStatus.mockResolvedValue(
      statusNotStarted({
        state: 'in-progress',
        snapshot: snapshotV2({
          onboardingStep: 'search-plan',
        }) as unknown as Record<string, unknown>,
        resumeKind: 'stored',
        question: 'desired-work',
        prefilledDraft: undefined,
        planToken: undefined,
      }),
    );
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
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    await waitFor(() => {
      expect(apiMock.completeOnboarding).toHaveBeenCalledTimes(1);
    });
  });
});

describe('OnboardingPage â€” prefill from server', () => {
  it('prefills the desired-work input from the server-supplied prefilledDraft', async () => {
    apiMock.onboardingStatus.mockResolvedValue(statusNotStarted());
    renderPage();
    await waitFor(() => {
      expect(apiMock.onboardingStatus).toHaveBeenCalled();
    });
    const prefilled = screen.getByDisplayValue('Network Engineer');
    expect(prefilled).toBeInTheDocument();
  });
});
