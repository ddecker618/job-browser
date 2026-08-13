// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmployersPage } from '../src/client/pages/EmployersPage.js';
import type { DiscoveryIntelligenceSummary } from '../src/models/employer-discovery-intelligence.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Employers Discovery Intelligence UI', () => {
  it('renders bounded priority, explanations, activity, and provider reliability', async () => {
    mockFetch((url) => {
      if (url.pathname === '/api/employers') return employersFixture();
      if (url.pathname === '/api/employer-discovery/intelligence')
        return intelligenceFixture();
      if (url.pathname === '/api/sources/control-center')
        return sourceControlFixture();
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Discovery Intelligence' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('employer-discovery-intelligence-v1'),
    ).toBeInTheDocument();
    expect(screen.getByText('high-priority · priority 92')).toBeInTheDocument();
    expect(
      screen.getByText(/Recent activity: 6 new and 8 active jobs/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Greenhouse/)).toBeInTheDocument();
    expect(screen.getByText(/89% success/)).toBeInTheDocument();
  });

  it('makes unknown activity and blocked execution explicit', async () => {
    const intelligence = intelligenceFixture();
    intelligence.sites[0] = {
      ...intelligence.sites[0]!,
      schedulingClass: 'credential-required',
      eligible: false,
      executable: false,
      nextEligibleAt: null,
      activity: {
        ...intelligence.sites[0]!.activity,
        known: false,
        activeJobs: null,
        jobsFirstSeen: null,
      },
      reasons: [
        'Credentials are required; automatic execution is disabled',
        'Employer activity is unknown until a linked Source succeeds',
      ],
    };
    mockFetch((url) => {
      if (url.pathname === '/api/employers') return employersFixture();
      if (url.pathname === '/api/sources/control-center')
        return sourceControlFixture();
      return intelligence;
    });
    renderPage();

    expect(
      await screen.findByText('No automatic execution'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Credentials are required/)).toBeInTheDocument();
  });

  it('runs Employer discovery and enabled Sources through the existing APIs', async () => {
    const requests: string[] = [];
    mockFetch((url) => {
      requests.push(url.pathname);
      if (url.pathname === '/api/employers') return employersFixture();
      if (url.pathname === '/api/employer-discovery/intelligence')
        return intelligenceFixture();
      if (url.pathname === '/api/sources/control-center')
        return sourceControlFixture();
      if (url.pathname === '/api/employer-discovery/run')
        return {
          considered: 1,
          attempted: 1,
          sourceCreated: 1,
          sourceReused: 0,
          unsupported: 0,
          credentialRequired: 0,
          skipped: 0,
          failed: 0,
        };
      if (url.pathname === '/api/discovery/run')
        return [
          {
            jobsFound: 4,
            jobsInserted: 3,
          },
        ];
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Discovery Engine' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Employer automation')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run Discovery Now' }));
    await waitFor(() =>
      expect(requests).toContain('/api/employer-discovery/run'),
    );
    await screen.findByText(/1 attempted, 1 created/);

    fireEvent.click(
      screen.getByRole('button', { name: 'Run Enabled Sources' }),
    );
    await waitFor(() => expect(requests).toContain('/api/discovery/run'));
    await screen.findByText(/4 jobs found, 3 inserted/);
  });
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <EmployersPage />
    </QueryClientProvider>,
  );
}

function mockFetch(handler: (url: URL) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const rawUrl = input instanceof Request ? input.url : input.toString();
      return Promise.resolve(
        new Response(
          JSON.stringify(handler(new URL(rawUrl, 'http://localhost'))),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }),
  );
}

function employersFixture() {
  return [
    {
      employer: {
        id: 'employer-1',
        name: 'Acme',
        normalizedName: 'acme',
        websiteUrl: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      careerSites: [],
    },
  ];
}

function intelligenceFixture(): DiscoveryIntelligenceSummary {
  return {
    policyVersion: 'employer-discovery-intelligence-v1',
    evaluatedAt: '2026-08-12T12:00:00.000Z',
    activityWindow: {
      start: '2026-07-13T12:00:00.000Z',
      end: '2026-08-12T12:00:00.000Z',
      semantics: '[start,end)',
    },
    totals: {
      employers: 1,
      careerSites: 1,
      eligibleSites: 1,
      executableSites: 1,
      dueSoon: 1,
      supportedSites: 1,
      unsupportedSites: 0,
      credentialRequiredSites: 0,
      healthySites: 1,
      warningSites: 0,
      brokenSites: 0,
      retiredSites: 0,
      discoverySuccesses: 8,
      discoveryFailures: 1,
    },
    sitesBySchedulingClass: {
      'high-priority': 1,
      normal: 0,
      stable: 0,
      degraded: 0,
      unsupported: 0,
      'credential-required': 0,
      retired: 0,
    },
    sites: [
      {
        policyVersion: 'employer-discovery-intelligence-v1',
        evaluatedAt: '2026-08-12T12:00:00.000Z',
        careerSiteId: 'site-1',
        employerId: 'employer-1',
        employerName: 'Acme',
        url: 'https://boards.greenhouse.io/acme',
        providerId: 'greenhouse',
        schedulingClass: 'high-priority',
        priority: 92,
        eligible: true,
        executable: true,
        cadenceHours: 6,
        nextEligibleAt: '2026-08-12T12:00:00.000Z',
        healthStatus: 'healthy',
        atsConfidence: 0.99,
        providerSuccessRate: 8 / 9,
        activity: {
          windowStart: '2026-07-13T12:00:00.000Z',
          windowEnd: '2026-08-12T12:00:00.000Z',
          known: true,
          activeJobs: 8,
          jobsFirstSeen: 6,
          lastNewJobAt: '2026-08-12T00:00:00.000Z',
          lastSuccessfulDiscoveryAt: '2026-08-12T00:00:00.000Z',
          successfulRuns: 8,
          failedRuns: 1,
          zeroResultSuccessfulRuns: 1,
        },
        components: [],
        reasons: [
          'Recent activity: 6 new and 8 active jobs',
          'ATS confidence 99%',
          'Provider succeeded on 8 of 9 completed recent runs',
        ],
      },
    ],
    providers: [
      {
        providerId: 'greenhouse',
        providerName: 'Greenhouse',
        attemptedCareerSites: 1,
        successfulValidations: 1,
        successfulSourceMappings: 1,
        unsupportedOutcomes: 0,
        credentialRequiredOutcomes: 0,
        discoverySuccesses: 8,
        discoveryFailures: 1,
        interruptedRuns: 0,
        zeroResultSuccessfulRuns: 1,
        recentSuccessRate: 8 / 9,
        lastSuccessAt: '2026-08-12T00:00:00.000Z',
        lastFailureAt: '2026-08-11T00:00:00.000Z',
      },
    ],
    employers: [],
    employersTruncated: false,
    lastEvaluationAt: '2026-08-12T12:00:00.000Z',
    lastDiscoveryRunAt: '2026-08-12T00:00:00.000Z',
  };
}

function sourceControlFixture() {
  return {
    summary: {
      healthySources: 1,
      enabledSources: 1,
      disabledSources: 0,
      failedSources: 0,
      lastDiscoveryRun: null,
      nextScheduledRun: null,
      jobsFoundToday: 0,
      newUniqueJobs: 0,
      duplicatesMerged: 0,
      recordsRejected: 0,
      rediscoveries: 0,
      materialUpdates: 0,
      identityConflicts: 0,
    },
    sources: [],
    recentRuns: [],
    discovery: null,
    schedulerEnabled: true,
    employerDiscoveryEnabled: true,
    employerDiscoveryLastEvaluatedAt: null,
  };
}
