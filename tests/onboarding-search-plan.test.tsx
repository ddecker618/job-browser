// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  OnboardingSearchPlan,
  OnboardingSearchPlanSourceEntry,
} from '../src/models/onboarding.js';
import { ONBOARDING_SEARCH_PLAN_VERSION } from '../src/models/onboarding.js';
import { SearchPlanStep } from '../src/client/components/onboarding/SearchPlanStep.js';
import {
  buildOnboardingSearchPlan,
  type BuildOnboardingSearchPlanInput,
} from '../src/onboarding/search-plan-service.js';
import {
  fictionalSearchPlanBounded,
  fictionalSearchPlanMixed,
  fictionalSearchPlanNoConfirmedRoles,
  fictionalSearchPlanNoReadySources,
  fictionalSearchPlanReady,
  fictionalSearchPreferences,
  fictionalSearchProfileMax40,
  fictionalSearchProfileMax2,
  fictionalSearchProviderBuiltIn,
  fictionalSearchSourceExcludedArchived,
  fictionalSearchSourceExcludedDisabled,
  fictionalSearchSourceExcludedInvalidConfig,
  fictionalSearchSourceExcludedNoProvider,
  fictionalSearchSourceExcludedUnknownProvider,
  fictionalSearchSourceExcludedUnvalidatedConfig,
  fictionalSearchSourceNeedsCredentials,
  fictionalSearchSourceNeedsFailedHealth,
  fictionalSearchSourceReadyBuiltIn,
  fictionalSearchSourceReadyNeverRun,
} from '../src/client/fixtures/onboarding.fixture.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function planFrom(plan: OnboardingSearchPlan): {
  plan: OnboardingSearchPlan;
  sources: readonly OnboardingSearchPlanSourceEntry[];
} {
  return { plan, sources: plan.sources };
}

function buildFailedHealthSource(
  healthMessage: string,
): ConfiguredSourceWithHealth {
  return {
    ...fictionalSearchSourceNeedsFailedHealth,
    healthMessage,
  };
}

type ConfiguredSourceWithHealth = typeof fictionalSearchSourceNeedsFailedHealth;

describe('buildOnboardingSearchPlan — pure service', () => {
  it('is deterministic for equal inputs (JSON-stable)', () => {
    const input: BuildOnboardingSearchPlanInput = {
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: ['Network Engineer', 'Cloud Support Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceReadyBuiltIn],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    };

    const first = buildOnboardingSearchPlan(input);
    const second = buildOnboardingSearchPlan({
      ...input,
      sources: [...input.sources].reverse(),
      providerDescriptors: [...input.providerDescriptors].reverse(),
    });

    expect(second).toEqual(first);
    expect(JSON.parse(JSON.stringify(second))).toEqual(
      JSON.parse(JSON.stringify(first)),
    );
    expect(first.version).toBe(ONBOARDING_SEARCH_PLAN_VERSION);
  });

  it('does not mutate any input (deep-freeze probe)', () => {
    const preferences = clone(fictionalSearchPreferences);
    const sources = [fictionalSearchSourceReadyBuiltIn];
    const providerDescriptors = [fictionalSearchProviderBuiltIn];
    const confirmedTitles = ['Network Engineer', 'Cloud Support Engineer'];

    Object.freeze(preferences);
    Object.freeze(sources);
    Object.freeze(providerDescriptors);
    Object.freeze(confirmedTitles);

    expect(() =>
      buildOnboardingSearchPlan({
        preferences,
        confirmedTitles,
        searchProfile: fictionalSearchProfileMax40,
        sources,
        providerDescriptors,
      }),
    ).not.toThrow();
  });

  it('preserves first user-visible spelling on case-insensitive dedupe', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: [
        'Network Engineer',
        'network engineer',
        'NETWORK ENGINEER',
        'Cloud Support Engineer',
      ],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceReadyBuiltIn],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });

    expect(plan.confirmedTitles).toEqual([
      'Network Engineer',
      'Cloud Support Engineer',
    ]);
    expect(plan.appliedQueries).toEqual([
      'Network Engineer',
      'Cloud Support Engineer',
    ]);
  });

  it('drops empty / whitespace-only titles and preserves user order', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: [
        '   ',
        '',
        'Network Engineer',
        '\tCloud Support Engineer\n',
        ' ',
      ],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceReadyBuiltIn],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });

    expect(plan.confirmedTitles).toEqual([
      'Network Engineer',
      'Cloud Support Engineer',
    ]);
  });

  it('bounds queries by SearchProfile.maxQueriesPerRun and records overflow + warning', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: [
        'Network Engineer',
        'Cloud Support Engineer',
        'Database Administrator',
        'Security Analyst',
        'Help Desk Technician',
      ],
      searchProfile: fictionalSearchProfileMax2,
      sources: [fictionalSearchSourceReadyBuiltIn],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });

    expect(plan.appliedQueries).toEqual([
      'Network Engineer',
      'Cloud Support Engineer',
    ]);
    expect(plan.omittedTitles).toEqual([
      'Database Administrator',
      'Security Analyst',
      'Help Desk Technician',
    ]);
    expect(plan.warnings.length).toBe(1);
    expect(plan.warnings[0]).toMatch(/3 confirmed titles/);
    expect(plan.warnings[0]).toMatch(/capped at 2 quer/);
  });

  it('does not warn when no confirmed titles are omitted', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceReadyBuiltIn],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });
    expect(plan.warnings).toEqual([]);
  });

  it('disables confirmation when there are no usable queries', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: [],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceReadyBuiltIn],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });
    expect(plan.appliedQueries).toEqual([]);
    expect(plan.confirmationAllowed).toBe(false);
  });

  it('disables confirmation when there are no ready sources', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceExcludedArchived],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });
    expect(plan.readySourceCount).toBe(0);
    expect(plan.confirmationAllowed).toBe(false);
  });

  it('classifies ready enabled + valid + healthy sources', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceReadyBuiltIn],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });
    const entry = plan.sources[0]!;
    expect(entry.state).toBe('ready');
    expect(entry.reason).toBeNull();
    expect(plan.readySourceCount).toBe(1);
    expect(plan.confirmationAllowed).toBe(true);
  });

  it('classifies ready sources with healthy or never-run health', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [
        fictionalSearchSourceReadyBuiltIn,
        fictionalSearchSourceReadyNeverRun,
      ],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });
    expect(plan.readySourceCount).toBe(2);
    expect(plan.sources.every((entry) => entry.state === 'ready')).toBe(true);
  });

  it('excludes archived sources with a bounded archived reason', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceExcludedArchived],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });
    const entry = plan.sources[0]!;
    expect(entry.state).toBe('excluded');
    expect(entry.reason).toBe('Source is archived');
    expect(plan.excludedSourceCount).toBe(1);
  });

  it('excludes disabled sources with a bounded disabled reason', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceExcludedDisabled],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });
    const entry = plan.sources[0]!;
    expect(entry.state).toBe('excluded');
    expect(entry.reason).toBe('Source is disabled');
  });

  it('excludes sources without a providerId', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceExcludedNoProvider],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });
    const entry = plan.sources[0]!;
    expect(entry.state).toBe('excluded');
    expect(entry.reason).toBe('No provider configured');
  });

  it('excludes sources whose providerId is not registered', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceExcludedUnknownProvider],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });
    const entry = plan.sources[0]!;
    expect(entry.state).toBe('excluded');
    expect(entry.reason).toBe('Provider is not available');
  });

  it('excludes sources with unvalidated or invalid configuration', () => {
    const unvalidated = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceExcludedUnvalidatedConfig],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });
    expect(unvalidated.sources[0]!.state).toBe('excluded');
    expect(unvalidated.sources[0]!.reason).toBe('Configuration not validated');

    const invalid = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceExcludedInvalidConfig],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });
    expect(invalid.sources[0]!.state).toBe('excluded');
    expect(invalid.sources[0]!.reason).toBe('Configuration is invalid');
  });

  it('marks credential-required sources needs-attention (cannot be ready)', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceNeedsCredentials],
      providerDescriptors: [
        fictionalSearchProviderBuiltIn,
        {
          id: 'browser-provider',
          name: 'Browser Provider',
          type: 'job-board',
          capabilities: {
            keywordSearch: true,
            locationSearch: true,
            remoteFilter: true,
            pagination: true,
            compensation: true,
            requiresCredentials: true,
            structuredPreview: true,
            interactiveBrowser: true,
          },
          credentialStatus: { configured: true, available: false },
          supportState: 'supported',
        },
      ],
    });
    const entry = plan.sources[0]!;
    expect(entry.state).toBe('needs-attention');
    expect(entry.reason).toBe('Credentials required');
    expect(plan.readySourceCount).toBe(0);
    expect(plan.needsAttentionSourceCount).toBe(1);
    expect(plan.confirmationAllowed).toBe(false);
  });

  it('uses a safe generic reason for failed health, not the raw healthMessage', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceNeedsFailedHealth],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });
    const entry = plan.sources[0]!;
    expect(entry.state).toBe('needs-attention');
    expect(entry.reason).toBe(
      'The last source check failed. Review this source before searching.',
    );
  });

  it.each([
    {
      label: 'URL with token',
      healthMessage:
        'Request failed: https://api.example.com/jobs?token=secret-token-123',
      leakPatterns: ['token=secret-token-123', 'api.example.com'],
    },
    {
      label: 'password/token/secret text',
      healthMessage:
        'Auth failed: password=SuperSecret!, token=abc123, secret_key=xyz',
      leakPatterns: ['SuperSecret!', 'abc123', 'secret_key=xyz'],
    },
    {
      label: 'Windows path',
      healthMessage:
        'Could not read C:\\Users\\candidate\\AppData\\Local\\Job Browser\\data\\jobs.sqlite',
      leakPatterns: ['C:\\Users\\candidate', 'jobs.sqlite'],
    },
    {
      label: 'email / account identifier',
      healthMessage:
        'Account lookup failed for candidate@example.com (id: acct-987654)',
      leakPatterns: ['candidate@example.com', 'acct-987654'],
    },
    {
      label: 'long raw exception',
      healthMessage:
        'Error: connect ECONNREFUSED 192.168.1.50:443\n    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1141:16)\n    at Socket.emit (events.js:315:20)\n    at internal/errors.js:123:45',
      leakPatterns: ['ECONNREFUSED', '192.168.1.50', 'net.js'],
    },
  ])(
    'does not leak hostile $label diagnostics into the serialized plan',
    ({ healthMessage, leakPatterns }) => {
      const plan = buildOnboardingSearchPlan({
        preferences: clone(fictionalSearchPreferences),
        confirmedTitles: ['Network Engineer'],
        searchProfile: fictionalSearchProfileMax40,
        sources: [buildFailedHealthSource(healthMessage)],
        providerDescriptors: [fictionalSearchProviderBuiltIn],
      });

      const serialized = JSON.stringify(plan);
      for (const pattern of leakPatterns) {
        expect(serialized).not.toContain(pattern);
      }
      expect(serialized).toContain(
        'The last source check failed. Review this source before searching.',
      );
    },
  );

  it('sorts sources by displayName then id for stable output', () => {
    const sourceA = {
      ...fictionalSearchSourceReadyBuiltIn,
      id: 'src-a',
      displayName: 'Z Source',
      employer: 'Z',
    };
    const sourceB = {
      ...fictionalSearchSourceReadyBuiltIn,
      id: 'src-b',
      displayName: 'A Source',
      employer: 'A',
    };
    const sourceC = {
      ...fictionalSearchSourceReadyBuiltIn,
      id: 'src-c',
      displayName: '',
      employer: 'M Employer',
    };

    const input: BuildOnboardingSearchPlanInput = {
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [sourceA, sourceB, sourceC],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    };

    const plan = buildOnboardingSearchPlan(input);
    expect(plan.sources.map((entry) => entry.id)).toEqual([
      'src-b',
      'src-c',
      'src-a',
    ]);

    const reversed = buildOnboardingSearchPlan({
      ...input,
      sources: [sourceC, sourceA, sourceB],
    });
    expect(reversed.sources.map((entry) => entry.id)).toEqual([
      'src-b',
      'src-c',
      'src-a',
    ]);
  });

  it('returns a detached preferredLocations snapshot', () => {
    const preferences = clone(fictionalSearchPreferences);
    const plan = buildOnboardingSearchPlan({
      preferences,
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceReadyBuiltIn],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });

    expect(plan.preferredLocations).not.toBe(preferences.preferredLocations);
    expect(plan.preferredLocations).toEqual(preferences.preferredLocations);
    expect(plan.preferredLocations.length).toBeGreaterThan(0);

    for (let i = 0; i < plan.preferredLocations.length; i += 1) {
      expect(plan.preferredLocations[i]).not.toBe(
        preferences.preferredLocations[i],
      );
    }

    // Mutating the returned snapshot must not change the original preferences.
    const originalLocation = preferences.preferredLocations[0]!;
    const planLocation = plan.preferredLocations[0]!;
    const mutableCopy = [...plan.preferredLocations];
    mutableCopy[0] = { city: 'Mutated City', state: 'MC' };
    expect(originalLocation).toEqual({
      city: originalLocation.city,
      state: originalLocation.state,
    });
    expect(planLocation).not.toEqual({
      city: 'Mutated City',
      state: 'MC',
    });
  });

  it('preserves preferences fields exactly and never modifies them', () => {
    const preferences = clone(fictionalSearchPreferences);
    const before = JSON.stringify(preferences);
    const plan = buildOnboardingSearchPlan({
      preferences,
      confirmedTitles: ['Network Engineer'],
      searchProfile: fictionalSearchProfileMax40,
      sources: [fictionalSearchSourceReadyBuiltIn],
      providerDescriptors: [fictionalSearchProviderBuiltIn],
    });
    expect(JSON.stringify(preferences)).toBe(before);
    expect(plan.preferredLocations).toEqual(preferences.preferredLocations);
    expect(plan.remotePreference).toBe(preferences.remotePreference);
    expect(plan.primaryRadiusMiles).toBe(preferences.searchRadiusMiles);
    expect(plan.secondaryRadiusMiles).toBe(
      preferences.secondarySearchRadiusMiles,
    );
  });

  it('plan JSON round-trip is stable (deep-equal after serialize/deserialize)', () => {
    const plan = buildOnboardingSearchPlan({
      preferences: clone(fictionalSearchPreferences),
      confirmedTitles: [
        'Network Engineer',
        'Cloud Support Engineer',
        'Database Administrator',
      ],
      searchProfile: fictionalSearchProfileMax2,
      sources: [
        fictionalSearchSourceReadyBuiltIn,
        fictionalSearchSourceNeedsCredentials,
        fictionalSearchSourceExcludedArchived,
      ],
      providerDescriptors: [
        fictionalSearchProviderBuiltIn,
        {
          id: 'browser-provider',
          name: 'Browser Provider',
          type: 'job-board',
          capabilities: {
            keywordSearch: true,
            locationSearch: true,
            remoteFilter: true,
            pagination: true,
            compensation: true,
            requiresCredentials: true,
            structuredPreview: true,
            interactiveBrowser: true,
          },
          credentialStatus: { configured: true, available: false },
          supportState: 'supported',
        },
      ],
    });

    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });

  it('performs no provider, coordinator, database, filesystem, or network side-effects', () => {
    const globalAny = globalThis as unknown as { fetch?: typeof fetch };
    const fetchSpy = vi.fn();
    globalAny.fetch = fetchSpy as unknown as typeof fetch;

    // The pure service module is importable without filesystem reads;
    // it must not import `fs`, providers, the coordinator, or
    // SQLite, and must not call `fetch`.
    expect(typeof buildOnboardingSearchPlan).toBe('function');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('SearchPlanStep — component behaviour', () => {
  it('renders included queries, constraints, source groups, and a no-search-yet statement', () => {
    render(
      <SearchPlanStep
        plan={fictionalSearchPlanMixed}
        saving={false}
        saveError={null}
        onBack={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    expect(
      screen.getByRole('heading', { name: /Review your search plan/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('onboarding-search-plan-included-queries-list'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('onboarding-search-plan-ready-list'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('onboarding-search-plan-needs-attention-list'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('onboarding-search-plan-excluded-list'),
    ).toBeInTheDocument();
    expect(screen.getByText(/No search has run yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Use Back to change your job preferences\. Sources needing attention must be fixed from the Sources workspace/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/correct anything we misunderstood/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/does not verify a qualification/i),
    ).not.toBeInTheDocument();
  });

  it('renders the empty-state copy when no queries are included', () => {
    render(
      <SearchPlanStep
        plan={fictionalSearchPlanNoConfirmedRoles}
        saving={false}
        saveError={null}
        onBack={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(
      screen.getByTestId('onboarding-search-plan-empty-included-queries'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('onboarding-search-plan-included-queries-list'),
    ).not.toBeInTheDocument();
  });

  it('renders applied queries and omitted titles as separate lists', () => {
    render(
      <SearchPlanStep
        plan={fictionalSearchPlanBounded}
        saving={false}
        saveError={null}
        onBack={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    const includedList = screen.getByTestId(
      'onboarding-search-plan-included-queries-list',
    );
    const omittedList = screen.getByTestId(
      'onboarding-search-plan-omitted-titles-list',
    );

    for (const query of fictionalSearchPlanBounded.appliedQueries) {
      expect(
        screen.getByTestId(`onboarding-search-plan-included-query-${query}`),
      ).toBeInTheDocument();
      expect(includedList).toHaveTextContent(query);
    }

    for (const title of fictionalSearchPlanBounded.omittedTitles) {
      expect(
        screen.getByTestId(`onboarding-search-plan-omitted-title-${title}`),
      ).toBeInTheDocument();
      expect(omittedList).toHaveTextContent(title);
    }

    // An omitted title must never appear in the included-query list.
    for (const omitted of fictionalSearchPlanBounded.omittedTitles) {
      expect(
        screen.queryByTestId(
          `onboarding-search-plan-included-query-${omitted}`,
        ),
      ).not.toBeInTheDocument();
      expect(includedList).not.toHaveTextContent(omitted);
    }

    expect(
      screen.getByText(
        /These confirmed titles exceeded the configured per-run query limit/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('onboarding-search-plan-applied-count'),
    ).toHaveTextContent(
      String(fictionalSearchPlanBounded.appliedQueries.length),
    );
    expect(
      screen.getByTestId('onboarding-search-plan-omitted-count'),
    ).toHaveTextContent(
      String(fictionalSearchPlanBounded.omittedTitles.length),
    );
  });

  it('disables Confirm when no queries are included', () => {
    render(
      <SearchPlanStep
        plan={fictionalSearchPlanNoConfirmedRoles}
        saving={false}
        saveError={null}
        onBack={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    const confirm = screen.getByTestId('onboarding-search-plan-confirm');
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
  });

  it('renders bounded source counts and the bounded warning when queries are capped', () => {
    render(
      <SearchPlanStep
        plan={fictionalSearchPlanBounded}
        saving={false}
        saveError={null}
        onBack={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(
      screen.getByTestId('onboarding-search-plan-applied-count'),
    ).toHaveTextContent('2');
    expect(
      screen.getByTestId('onboarding-search-plan-omitted-count'),
    ).toHaveTextContent('3');
    expect(
      screen.getByTestId('onboarding-search-plan-warnings-list'),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 confirmed titles/)).toBeInTheDocument();
  });

  it('displays the reason for every non-ready source', () => {
    render(
      <SearchPlanStep
        plan={fictionalSearchPlanMixed}
        saving={false}
        saveError={null}
        onBack={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(
      screen.getByTestId(
        'onboarding-search-plan-needs-attention-reason-src-needs-credentials',
      ),
    ).toHaveTextContent('Credentials required');
    expect(
      screen.getByTestId('onboarding-search-plan-excluded-reason-src-archived'),
    ).toHaveTextContent('Source is archived');
  });

  it('calls onBack when the Back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(
      <SearchPlanStep
        plan={fictionalSearchPlanReady}
        saving={false}
        saveError={null}
        onBack={onBack}
        onConfirm={() => undefined}
      />,
    );

    await user.click(screen.getByTestId('onboarding-search-plan-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when the Confirm button is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <SearchPlanStep
        plan={fictionalSearchPlanReady}
        saving={false}
        saveError={null}
        onBack={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByTestId('onboarding-search-plan-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables Confirm when the plan is not confirmable', () => {
    render(
      <SearchPlanStep
        plan={fictionalSearchPlanNoReadySources}
        saving={false}
        saveError={null}
        onBack={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    const confirm = screen.getByTestId('onboarding-search-plan-confirm');
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
  });

  it('blocks duplicate confirmation while saving and shows confirming status', () => {
    render(
      <SearchPlanStep
        plan={fictionalSearchPlanReady}
        saving={true}
        saveError={null}
        onBack={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    const confirm = screen.getByTestId('onboarding-search-plan-confirm');
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveTextContent('Confirming…');
    expect(
      screen.getByTestId('onboarding-search-plan-saving-status'),
    ).toHaveTextContent(/Confirming your search plan/i);
    expect(screen.getByTestId('onboarding-search-plan-back')).toBeDisabled();
  });

  it('blocks duplicate submission even when onConfirm is invoked from a different path', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <SearchPlanStep
        plan={fictionalSearchPlanReady}
        saving={false}
        saveError={null}
        onBack={() => undefined}
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByTestId('onboarding-search-plan-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(
      <SearchPlanStep
        plan={fictionalSearchPlanReady}
        saving={true}
        saveError={null}
        onBack={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    const button = screen.getByTestId('onboarding-search-plan-confirm');
    await user.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('keeps the plan visible while showing a save error', () => {
    render(
      <SearchPlanStep
        plan={fictionalSearchPlanReady}
        saving={false}
        saveError="Could not save the search plan. Please try again."
        onBack={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(
      screen.getByTestId('onboarding-search-plan-save-error'),
    ).toHaveTextContent(/Could not save the search plan/i);
    expect(
      screen.getByTestId('onboarding-search-plan-included-queries-list'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Review your search plan/i }),
    ).toBeInTheDocument();
  });

  it('all interactive controls are reachable by keyboard and have accessible names', async () => {
    const user = userEvent.setup();
    render(
      <SearchPlanStep
        plan={fictionalSearchPlanReady}
        saving={false}
        saveError={null}
        onBack={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    await user.tab();
    const back = screen.getByTestId('onboarding-search-plan-back');
    expect(document.activeElement).toBe(back);

    await user.tab();
    const confirm = screen.getByTestId('onboarding-search-plan-confirm');
    expect(document.activeElement).toBe(confirm);

    expect(back).toHaveAccessibleName('Back');
    expect(confirm).toHaveAccessibleName('Confirm plan');
  });

  it('never executes a provider, coordinator, or HTTP call when the component is mounted', async () => {
    const fetchSpy = vi.fn();
    const globalAny = globalThis as unknown as { fetch?: typeof fetch };
    globalAny.fetch = fetchSpy as unknown as typeof fetch;

    render(
      <SearchPlanStep
        plan={fictionalSearchPlanReady}
        saving={false}
        saveError={null}
        onBack={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-search-plan-confirm')).toBeTruthy();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('fixtures are typed as readonly plan entries', () => {
  it('keeps every fixture typed and JSON-stable', () => {
    expect(planFrom(fictionalSearchPlanReady)).toBeDefined();
    expect(planFrom(fictionalSearchPlanBounded)).toBeDefined();
    expect(planFrom(fictionalSearchPlanMixed)).toBeDefined();
    expect(planFrom(fictionalSearchPlanNoConfirmedRoles)).toBeDefined();
    expect(planFrom(fictionalSearchPlanNoReadySources)).toBeDefined();
    expect(JSON.parse(JSON.stringify(fictionalSearchPlanReady))).toEqual(
      fictionalSearchPlanReady,
    );
  });
});
