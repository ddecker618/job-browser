// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingPage } from '../src/client/pages/OnboardingPage.js';
import { createEmptyPreferencesDraft } from '../src/schemas/onboarding.js';
import type {
  OnboardingProgressSnapshot,
  OnboardingReviewItem,
} from '../src/models/onboarding.js';

const apiMock = vi.hoisted(() => ({
  onboardingStatus: vi.fn(),
  saveOnboardingProgress: vi.fn(),
  resetOnboardingProgress: vi.fn(),
  completeOnboarding: vi.fn(),
  retryOnboardingDiscovery: vi.fn(),
}));

vi.mock('../src/client/api.js', () => ({
  api: apiMock,
  ApiRequestError: Error,
}));

const basePreferences = {
  preferredLocations: [{ city: 'Example City', state: 'EX' }],
  searchRadiusMiles: 25,
  secondarySearchRadiusMiles: 50,
  remotePreference: 'preferred' as const,
  desiredSalary: null,
  desiredJobTitles: ['Network Engineer'],
  desiredEmploymentTypes: ['full-time' as const],
};

const notStartedStatus = {
  state: 'not-started' as const,
  profileId: 'candidate-flow-one',
  question: null,
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
    totalSourceCount: 0,
    readySourceCount: 0,
    needsAttentionSourceCount: 0,
    excludedSourceCount: 0,
    warnings: [],
    confirmationAllowed: true,
  },
  completion: { completed: false, completedAt: null },
};

const reviewItems: readonly OnboardingReviewItem[] = [
  {
    id: 'skill-1',
    field: 'skills' as const,
    value: 'Kubernetes',
    status: 'confirmed' as const,
    reason: 'Resume heading',
  },
];

function makeSnapshot(
  overrides: Partial<OnboardingProgressSnapshot> = {},
): OnboardingProgressSnapshot {
  return {
    version: 2,
    onboardingStep: 'preferences',
    currentQuestion: 'desired-work',
    answers: createEmptyPreferencesDraft(),
    reviewItems: [...reviewItems],
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
  apiMock.saveOnboardingProgress.mockReset();
  apiMock.resetOnboardingProgress.mockReset();
  apiMock.completeOnboarding.mockReset();
  apiMock.retryOnboardingDiscovery.mockReset();
  apiMock.saveOnboardingProgress.mockResolvedValue({ ok: true });
  apiMock.resetOnboardingProgress.mockResolvedValue({ ok: true });
  apiMock.completeOnboarding.mockResolvedValue({
    ok: true,
    discoveryStarted: true,
    summaries: [],
    completion: { completed: true, completedAt: '2026-09-24T00:00:00.000Z' },
  });
  apiMock.retryOnboardingDiscovery.mockResolvedValue({
    ok: true,
    summaries: [],
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OnboardingPage — client flow', () => {
  it('loads status from the API on mount', async () => {
    apiMock.onboardingStatus.mockResolvedValue(notStartedStatus);
    renderPage();
    await waitFor(() => {
      expect(apiMock.onboardingStatus).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByRole('heading', { name: /What roles interest you/i }),
    ).toBeInTheDocument();
  });

  it('shows a distinct blocked screen for malformed progress with an explicit reset action', async () => {
    apiMock.onboardingStatus.mockResolvedValue({
      ...notStartedStatus,
      state: 'blocked',
      blockKind: 'malformed',
      blockMessage: 'Stored onboarding progress is unreadable.',
    });
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
    apiMock.onboardingStatus.mockResolvedValue({
      ...notStartedStatus,
      state: 'blocked',
      blockKind: 'unsupported-version',
      blockMessage:
        'Stored onboarding progress uses an unsupported version (9).',
    });
    renderPage();
    expect(
      await screen.findByRole('heading', {
        name: /unsupported version/i,
      }),
    ).toBeInTheDocument();
  });

  it('shows a distinct blocked screen for storage-failure progress', async () => {
    apiMock.onboardingStatus.mockResolvedValue({
      ...notStartedStatus,
      state: 'blocked',
      blockKind: 'storage-failure',
      blockMessage: 'Onboarding progress could not be loaded.',
    });
    renderPage();
    expect(
      await screen.findByRole('heading', {
        name: /Onboarding progress could not be loaded/i,
      }),
    ).toBeInTheDocument();
  });

  it('persists progress at navigation boundaries and surfaces a safe save error', async () => {
    apiMock.onboardingStatus.mockResolvedValue({
      ...notStartedStatus,
      state: 'in-progress',
      resumeKind: 'stored',
      question: 'desired-work',
      snapshot: makeSnapshot({
        currentQuestion: 'desired-work',
        onboardingStep: 'preferences',
        answers: {
          ...createEmptyPreferencesDraft(),
          desiredJobTitles: ['Network Engineer'],
        },
      }),
    });
    apiMock.saveOnboardingProgress.mockRejectedValueOnce(
      new Error('disk on fire'),
    );
    renderPage();
    await screen.findByRole('heading', { name: /What roles interest you/i });
    const continueButton = screen.getByRole('button', { name: /Continue/i });
    await userEvent.setup().click(continueButton);
    await waitFor(() => {
      expect(apiMock.saveOnboardingProgress).toHaveBeenCalled();
    });
    expect(
      await screen.findByText(/Onboarding progress could not be saved/i),
    ).toBeInTheDocument();
  });

  it('restores the stored question on resume', async () => {
    apiMock.onboardingStatus.mockResolvedValue({
      ...notStartedStatus,
      state: 'in-progress',
      resumeKind: 'stored',
      question: 'remote-work',
      snapshot: makeSnapshot({
        currentQuestion: 'remote-work',
        onboardingStep: 'preferences',
      }),
    });
    renderPage();
    expect(
      await screen.findByRole('heading', {
        name: /How do you feel about remote work/i,
      }),
    ).toBeInTheDocument();
  });

  it('completes onboarding, invokes the completion API once, and refreshes status', async () => {
    apiMock.onboardingStatus.mockResolvedValue({
      ...notStartedStatus,
      state: 'in-progress',
      resumeKind: 'stored',
      question: 'desired-work',
      snapshot: makeSnapshot({
        currentQuestion: 'desired-work',
        onboardingStep: 'search-plan',
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
      }),
    });
    renderPage();
    // jump straight to the search-plan step by simulating a snapshot
    // whose onboardingStep is already 'search-plan'.
    const confirmButton = await screen.findByTestId(
      'onboarding-search-plan-confirm',
    );
    await userEvent.setup().click(confirmButton);
    await waitFor(() => {
      expect(apiMock.completeOnboarding).toHaveBeenCalledTimes(1);
    });
    const call = apiMock.completeOnboarding.mock.calls[0]?.[0] as {
      preferences: typeof basePreferences;
      reviewItems: typeof reviewItems;
    };
    expect(call.preferences).toEqual(basePreferences);
    expect(call.reviewItems).toEqual(reviewItems);
  });

  it('surfaces a bounded confirmation error when persistence fails and keeps the draft', async () => {
    apiMock.onboardingStatus.mockResolvedValue({
      ...notStartedStatus,
      state: 'in-progress',
      resumeKind: 'stored',
      question: 'desired-work',
      snapshot: makeSnapshot({
        currentQuestion: 'desired-work',
        onboardingStep: 'search-plan',
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
      }),
    });
    apiMock.completeOnboarding.mockResolvedValueOnce({
      ok: false,
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
    // confirm is still rendered (plan still visible)
    expect(
      screen.getByTestId('onboarding-search-plan-confirm'),
    ).toBeInTheDocument();
  });

  it('offers a search-only retry when discovery fails after a successful save', async () => {
    const completedStatus = {
      ...notStartedStatus,
      completion: { completed: true, completedAt: '2026-09-24T00:00:00.000Z' },
    };
    apiMock.onboardingStatus.mockResolvedValue(completedStatus);
    apiMock.completeOnboarding.mockResolvedValueOnce({
      ok: true,
      discoveryStarted: false,
      discoveryError: 'Timeout: The server did not respond in time',
      completion: { completed: true, completedAt: '2026-09-24T00:00:00.000Z' },
    });
    renderPage();
    expect(await screen.findByText(/Onboarding complete/i)).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: /Retry search/i });
    await userEvent.setup().click(retryButton);
    await waitFor(() => {
      expect(apiMock.retryOnboardingDiscovery).toHaveBeenCalled();
    });
  });

  it('exposes Jobs and Sources navigation links on the completed screen', async () => {
    apiMock.onboardingStatus.mockResolvedValue({
      ...notStartedStatus,
      completion: { completed: true, completedAt: '2026-09-24T00:00:00.000Z' },
    });
    renderPage();
    await screen.findByText(/Onboarding complete/i);
    expect(screen.getByRole('link', { name: /Open Jobs/i })).toHaveAttribute(
      'href',
      '/jobs',
    );
    expect(screen.getByRole('link', { name: /Open Sources/i })).toHaveAttribute(
      'href',
      '/sources',
    );
  });

  it('does not call any job or application API when the wizard is rendered', async () => {
    apiMock.onboardingStatus.mockResolvedValue(notStartedStatus);
    const fetchSpy = vi.fn();
    const globalAny = globalThis as unknown as { fetch?: typeof fetch };
    globalAny.fetch = fetchSpy as unknown as typeof fetch;
    renderPage();
    await screen.findByRole('heading', { name: /What roles interest you/i });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
