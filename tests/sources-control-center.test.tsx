import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SourcesPage } from '../src/client/pages/SourcesPage.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('sources control center', () => {
  it('shows summary metrics, failed health, latest counts, and next run', async () => {
    mockApi();
    renderPage();
    expect(await screen.findByText('Discovery control')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('New unique')).toBeInTheDocument();
    expect(screen.getByText('4 new · 2 merged')).toBeInTheDocument();
    expect(screen.getAllByText('failed').length).toBeGreaterThan(0);
  });

  it('opens the add-source workflow', async () => {
    mockApi();
    renderPage();
    await screen.findByText('Example USAJOBS');
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Add source' }));
    expect(
      screen.getByRole('region', { name: 'Source editor' }),
    ).toBeInTheDocument();
  });

  it('requires confirmation before applying a detected ATS configuration', async () => {
    mockApi();
    renderPage();
    await screen.findByText('Example USAJOBS');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add source' }));
    await user.type(
      screen.getByLabelText('Public careers URL'),
      'https://jobs.smartrecruiters.com/FixtureCorp',
    );
    await user.click(screen.getByRole('button', { name: 'Detect ATS' }));

    expect(
      await screen.findByText(/SmartRecruiters · supported/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Provider')).toHaveValue('usajobs');

    await user.click(
      screen.getByRole('button', { name: 'Apply detected configuration' }),
    );
    expect(screen.getByLabelText('Provider')).toHaveValue('smartrecruiters');
    expect(screen.getByLabelText('Company identifier')).toHaveValue(
      'FixtureCorp',
    );
  });

  it('derives SmartRecruiters companyIdentifier from the careers URL on Validate', async () => {
    mockApi();
    renderPage();
    await screen.findByText('Example USAJOBS');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add source' }));
    await user.selectOptions(screen.getByLabelText('Provider'), [
      'smartrecruiters',
    ]);
    await user.type(
      screen.getByLabelText('Public careers URL'),
      'https://jobs.smartrecruiters.com/acmecorp',
    );
    await user.type(screen.getByLabelText('Employer'), 'Acme Corp');
    const editor = screen.getByRole('region', { name: 'Source editor' });
    await user.click(within(editor).getByRole('button', { name: 'Validate' }));

    expect(
      await screen.findByText(/Validation succeeded .*Source is ready to save/),
    ).toBeInTheDocument();
  });

  it('shows a helpful message when the careers URL is missing', async () => {
    mockApi();
    renderPage();
    await screen.findByText('Example USAJOBS');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add source' }));
    await user.selectOptions(screen.getByLabelText('Provider'), ['icims']);
    await user.type(screen.getByLabelText('Employer'), 'Acme Corp');
    const editor = screen.getByRole('region', { name: 'Source editor' });
    await user.click(within(editor).getByRole('button', { name: 'Validate' }));
    expect(
      await screen.findByText(/Enter the iCIMS portal URL/),
    ).toBeInTheDocument();
  });

  it('explains the first-run Handshake login and session behavior', async () => {
    mockApi();
    renderPage();
    await screen.findByText('Example USAJOBS');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add source' }));
    await user.selectOptions(screen.getByLabelText('Provider'), ['handshake']);

    expect(screen.getByText('Handshake provider notice:')).toBeInTheDocument();
    expect(
      screen.getByText(/choose your school and complete its SSO\/MFA flow/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Work arrangement')).toBeInTheDocument();
  });

  it('shows the empty state without configured sources', async () => {
    mockApi([]);
    renderPage();
    expect(
      await screen.findByText('No configured sources'),
    ).toBeInTheDocument();
  });

  it('renders Daily and next run date when daily schedule is enabled', async () => {
    mockApi([
      {
        ...sourceFixture(),
        schedule: {
          enabled: true,
          cadence: 'daily',
          dailyLocalTime: '09:00',
          nextRunAt: '2026-07-20T14:00:00.000Z',
          lastDueAt: null,
        },
      },
    ]);
    renderPage();
    expect(await screen.findByText('Daily')).toBeInTheDocument();
  });
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SourcesPage />
    </QueryClientProvider>,
  );
}

function mockApi(sources: unknown[] = [sourceFixture()]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const path =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (path.endsWith('/api/providers')) {
        return Promise.resolve(
          response([
            {
              id: 'usajobs',
              name: 'USAJOBS',
              type: 'government',
              capabilities: {
                keywordSearch: true,
                locationSearch: true,
                remoteFilter: true,
                pagination: true,
                compensation: true,
                requiresCredentials: true,
                structuredPreview: false,
              },
              credentialStatus: { configured: false, available: true },
              supportState: 'supported',
            },
            {
              id: 'smartrecruiters',
              name: 'SmartRecruiters',
              type: 'ats',
              capabilities: {
                keywordSearch: true,
                locationSearch: true,
                remoteFilter: true,
                pagination: true,
                compensation: false,
                requiresCredentials: false,
                structuredPreview: false,
              },
              credentialStatus: { configured: true, available: true },
              supportState: 'supported',
            },
            {
              id: 'handshake',
              name: 'Handshake',
              type: 'job-board',
              capabilities: {
                keywordSearch: true,
                locationSearch: false,
                remoteFilter: true,
                pagination: true,
                compensation: true,
                requiresCredentials: false,
                structuredPreview: false,
                interactiveBrowser: true,
              },
              credentialStatus: { configured: true, available: true },
              supportState: 'supported-with-configuration',
            },
            {
              id: 'icims',
              name: 'iCIMS',
              type: 'ats',
              capabilities: {
                keywordSearch: true,
                locationSearch: true,
                remoteFilter: true,
                pagination: true,
                compensation: false,
                requiresCredentials: false,
                structuredPreview: false,
              },
              credentialStatus: { configured: true, available: true },
              supportState: 'supported',
            },
          ]),
        );
      }
      if (path.endsWith('/api/sources/validate')) {
        const rawBody =
          typeof init?.body === 'string'
            ? init.body
            : '{"providerId":"","configuration":{}}';
        const body = JSON.parse(rawBody) as {
          providerId: string;
          configuration: Record<string, unknown>;
        };
        const identifier = body.configuration['companyIdentifier'];
        const valid =
          typeof identifier === 'string' && identifier.trim().length > 0;
        return Promise.resolve(
          response({
            valid,
            message: valid
              ? 'SmartRecruiters configuration is valid'
              : 'Company identifier must be a string',
            normalizedConfiguration: body.configuration,
            preview: null,
          }),
        );
      }
      if (path.endsWith('/api/sources/detect')) {
        return Promise.resolve(
          response({
            detectedPlatform: 'SmartRecruiters',
            confidence: 0.99,
            confidenceLabel: 'high',
            supportState: 'supported',
            suggestedProvider: 'smartrecruiters',
            extractedConfiguration: {
              companyIdentifier: 'FixtureCorp',
              company: 'Fixture Corp',
            },
            fallbackConfiguration: null,
            structuredFallback: false,
            explanation: 'SmartRecruiters configuration was detected.',
            resolvedUrl: 'https://jobs.smartrecruiters.com/FixtureCorp',
          }),
        );
      }
      if (path.endsWith('/api/sources/control-center')) {
        return Promise.resolve(
          response({
            summary: {
              healthySources: 0,
              enabledSources: sources.length,
              disabledSources: 0,
              failedSources: sources.length,
              lastDiscoveryRun: '2026-07-19T12:00:00.000Z',
              nextScheduledRun: '2026-07-20T12:00:00.000Z',
              jobsFoundToday: 9,
              newUniqueJobs: 4,
              duplicatesMerged: 2,
            },
            sources,
            recentRuns: [
              {
                id: 'run',
                sourceId: 'source',
                providerId: 'usajobs',
                trigger: 'manual-source',
                status: 'failed',
                startedAt: '2026-07-19T12:00:00.000Z',
                completedAt: '2026-07-19T12:01:00.000Z',
                jobsFound: 9,
                jobsInserted: 4,
                jobsUpdated: 2,
                duplicatesMerged: 2,
                jobsFailed: 1,
                error: 'Rate limited',
              },
            ],
            discovery: {
              running: false,
              queuedSourceIds: [],
              activeSourceId: null,
              startedAt: null,
              completedSources: 0,
              totalSources: 0,
              lastError: null,
            },
            schedulerEnabled: true,
          }),
        );
      }
      return Promise.resolve(response({}));
    }),
  );
}

function sourceFixture() {
  return {
    id: 'source',
    displayName: 'Example USAJOBS',
    employer: 'Federal government',
    providerId: 'usajobs',
    sourceType: 'government',
    careersUrl: 'https://www.usajobs.gov',
    enabled: true,
    configuration: { resultsPerPage: 50 },
    searchCriteria: {
      query: 'security',
      location: 'Scott AFB',
      remoteOnly: false,
      limit: 50,
    },
    configurationStatus: 'credentials-required',
    healthStatus: 'failed',
    healthMessage: 'Credentials are required',
    lastHealthCheckAt: null,
    lastSuccessfulRun: null,
    lastFailure: 'Credentials are required',
    failureCount: 1,
    schedule: {
      enabled: true,
      cadence: 'every-24-hours',
      dailyLocalTime: null,
      nextRunAt: '2026-07-20T12:00:00.000Z',
      lastDueAt: null,
    },
  };
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
// @vitest-environment jsdom
