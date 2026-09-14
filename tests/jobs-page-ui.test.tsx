// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { SCORING_RULES_VERSION } from '../src/intelligence/scoringVersion.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JobsPage } from '../src/client/pages/JobsPage.js';
import type { JobSearchItem } from '../src/models/job-search.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

interface Call {
  url: string;
  method: string;
  body: string | undefined;
}

describe('Jobs page scope', () => {
  it('waits for remembered scope before restoring local filters on bare navigation', async () => {
    localStorage.setItem(
      'job-browser-filters:' + SCORING_RULES_VERSION,
      JSON.stringify({ company: 'Acme' }),
    );
    let resolveScope!: (value: { scope: string }) => void;
    const delayed = new Promise<{ scope: string }>((resolve) => {
      resolveScope = resolve;
    });
    const calls = renderJobs(['/jobs'], 'all', { scopeResponse: delayed });
    expect(calls.some((call) => call.url.includes('/api/jobs/search'))).toBe(
      false,
    );
    resolveScope({ scope: 'all' });
    await screen.findByText('Network Administrator');
    await waitFor(() =>
      expect(lastSearchCall(calls)).toContain('company=Acme'),
    );
    expect(lastSearchCall(calls)).toContain('scope=all');
    expect(
      calls
        .filter((call) => call.url.includes('/api/jobs/search'))
        .every((call) => call.url.includes('scope=all')),
    ).toBe(true);
  });

  it('preserves the selected scope when an older remembered response arrives', async () => {
    const user = userEvent.setup();
    let resolveScope!: (value: { scope: string }) => void;
    const delayed = new Promise<{ scope: string }>((resolve) => {
      resolveScope = resolve;
    });
    const calls = renderJobs(['/jobs?scope=matches'], 'matches', {
      scopeResponse: delayed,
    });
    await screen.findByText('Network Administrator');
    await user.click(screen.getByRole('button', { name: 'All jobs' }));
    resolveScope({ scope: 'matches' });
    await waitFor(() => expect(lastSearchCall(calls)).toContain('scope=all'));
    expect(screen.getByRole('button', { name: 'All jobs' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Test back' }));
    await waitFor(() =>
      expect(lastSearchCall(calls)).toContain('scope=matches'),
    );
    await user.click(screen.getByRole('button', { name: 'Test forward' }));
    await waitFor(() => expect(lastSearchCall(calls)).toContain('scope=all'));
  });

  it('keeps legacy URLs with filters on My matches even when scope is remembered as all', async () => {
    const calls = renderJobs(['/jobs?company=Beta%20Systems'], 'all');
    await screen.findByText('Network Administrator');
    const search = lastSearchCall(calls);
    expect(search).toContain('scope=matches');
    expect(search).toContain('sort=score');
    expect(search).toContain('company=Beta+Systems');
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('uses the remembered scope for a bare jobs navigation and writes it to the URL', async () => {
    const calls = renderJobs(['/jobs'], 'all');
    await screen.findByText('Network Administrator');
    await waitFor(() => {
      expect(lastSearchCall(calls)).toContain('scope=all');
      expect(lastSearchCall(calls)).toContain('sort=firstSeenAt');
    });
    expect(screen.getByRole('button', { name: 'All jobs' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByText(/this is not the entire job market/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('scope=all'),
    );
  });

  it('lets an explicit URL scope win over a remembered scope that arrives later', async () => {
    const calls = renderJobs(['/jobs?scope=all'], 'matches');
    await screen.findByText('Network Administrator');
    expect(lastSearchCall(calls)).toContain('scope=all');
    expect(screen.getByRole('button', { name: 'All jobs' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByText(/this is not the entire job market/),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'All jobs' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  it('switches scope from the toggle, persists it, and resets pagination', async () => {
    const user = userEvent.setup();
    const calls = renderJobs(['/jobs?scope=matches&page=2'], 'matches');
    await screen.findByText('Network Administrator');
    const initialSearch = new URLSearchParams(
      lastSearchCall(calls).split('?')[1] ?? '',
    );
    expect(initialSearch.get('scope')).toBe('matches');
    expect(initialSearch.get('page')).toBe('2');
    expect(screen.getByLabelText('Sort jobs')).toHaveValue('score');

    await user.click(screen.getByRole('button', { name: 'All jobs' }));
    await waitFor(() => {
      const put = calls.find(
        (call) => call.url.endsWith('/api/view-scope') && call.method === 'PUT',
      );
      expect(JSON.parse(put?.body ?? '{}') as { scope: string }).toEqual({
        scope: 'all',
      });
    });
    await waitFor(() => {
      const params = new URLSearchParams(
        lastSearchCall(calls).split('?')[1] ?? '',
      );
      expect(params.get('scope')).toBe('all');
      expect(params.get('page')).toBe('1');
      expect(params.get('sort')).toBe('firstSeenAt');
    });
    expect(screen.getByLabelText('Sort jobs')).toHaveValue('firstSeenAt');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('scope=all'),
    );
    expect(screen.getByTestId('location')).not.toHaveTextContent('page=2');
  });

  it('renders ineligible, stale, and unscored jobs in All jobs with accurate labels', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Optional view');
    const items = [
      searchJob('1', 'Current Analyst', 'Alpha'),
      searchJob('2', 'Stale Analyst', 'Beta', {
        score: 70,
        recommendation: 'Match',
        scoreVersion: 'old-version',
      }),
      searchJob('3', 'Ineligible Analyst', 'Gamma', {
        score: 55,
        recommendation: 'Hard No',
        eligibilityPassed: false,
        eligibilityRejection: 'location_outside_radius',
      }),
      searchJob('4', 'Unscored Analyst', 'Delta', {
        score: null,
        recommendation: null,
        scoreVersion: null,
      }),
    ];
    const calls = renderJobs(['/jobs?scope=all'], 'matches', {
      items,
      currentScoreVersion: 'current-version',
    });
    await screen.findByText('Current Analyst');

    expect(screen.getAllByText('—')).toHaveLength(1);
    expect(screen.getByText('Stale score')).toBeInTheDocument();
    expect(screen.getByText('Ineligible')).toBeInTheDocument();
    expect(screen.getAllByText('Unscored').length).toBeGreaterThan(0);
    expect(screen.queryByText('Freshness unknown')).not.toBeInTheDocument();

    const written = calls.filter((call) => call.method !== 'GET');
    expect(written).toEqual([]);
  });

  it('labels freshness unknown when a scoreVersion is missing and stays consistent in the drawer', async () => {
    const user = userEvent.setup();
    const items = [
      searchJob('1', 'Known Current', 'Alpha', {
        score: 82,
        recommendation: 'Strong Match',
        scoreVersion: 'current-version',
      }),
      searchJob('2', 'Unaltered Evidence', 'Beta', {
        score: 74,
        recommendation: 'Match',
        scoreVersion: null,
      }),
    ];
    const calls = renderJobs(['/jobs?scope=matches'], 'matches', {
      items,
      currentScoreVersion: 'current-version',
    });
    await screen.findByText('Known Current');
    expect(screen.getByText('Freshness unknown')).toBeInTheDocument();
    expect(screen.queryByText('Stale score')).not.toBeInTheDocument();

    await user.click(screen.getByText('Unaltered Evidence'));
    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith('/api/jobs/2'))).toBe(true),
    );
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Freshness unknown')).toBeInTheDocument();
    expect(within(drawer).getByText('Match')).toBeInTheDocument();
  });

  it('restores the recorded scope from new saved filters and matches from legacy ones', async () => {
    const user = userEvent.setup();
    const filters = [
      {
        id: 's1',
        name: 'Remote all',
        scope: 'all' as const,
        filters: { remoteType: 'remote' },
      },
      {
        id: 's2',
        name: 'Legacy filter',
        scope: null,
        filters: { company: 'Acme' },
      },
    ];
    const calls = renderJobs(['/jobs'], 'matches', { savedFilters: filters });
    await screen.findByText('Network Administrator');

    await user.click(screen.getByRole('button', { name: 'Remote all' }));
    await waitFor(() => expect(lastSearchCall(calls)).toContain('scope=all'));
    expect(lastSearchCall(calls)).toContain('remoteType=remote');

    await user.click(screen.getByRole('button', { name: 'Legacy filter' }));
    await waitFor(() =>
      expect(lastSearchCall(calls)).toContain('scope=matches'),
    );
    expect(lastSearchCall(calls)).toContain('company=Acme');
  });

  it('defaults the sort to score for my matches', async () => {
    const calls = renderJobs(['/jobs'], 'matches');
    await screen.findByText('Network Administrator');
    expect(
      new URLSearchParams(lastSearchCall(calls).split('?')[1] ?? '').get(
        'sort',
      ),
    ).toBe('score');
    expect(screen.getByLabelText('Sort jobs')).toHaveValue('score');
  });

  it('defaults the sort to newest-first in the all jobs scope', async () => {
    const calls = renderJobs(['/jobs'], 'all');
    await screen.findByText('Network Administrator');
    await waitFor(() =>
      expect(screen.getByLabelText('Sort jobs')).toHaveValue('firstSeenAt'),
    );
    expect(
      new URLSearchParams(lastSearchCall(calls).split('?')[1] ?? '').get(
        'sort',
      ),
    ).toBe('firstSeenAt');
    expect(
      new URLSearchParams(lastSearchCall(calls).split('?')[1] ?? '').get(
        'scope',
      ),
    ).toBe('all');
  });

  it('respects an explicit sort and keeps it when switching scope', async () => {
    const user = userEvent.setup();
    const calls = renderJobs(['/jobs?scope=all&sort=company'], 'matches');
    await screen.findByText('Network Administrator');
    expect(
      new URLSearchParams(lastSearchCall(calls).split('?')[1] ?? '').get(
        'sort',
      ),
    ).toBe('company');
    expect(screen.getByLabelText('Sort jobs')).toHaveValue('company');

    await user.click(screen.getByRole('button', { name: 'My matches' }));
    await waitFor(() => {
      const params = new URLSearchParams(
        lastSearchCall(calls).split('?')[1] ?? '',
      );
      expect(params.get('sort')).toBe('company');
      expect(params.get('scope')).toBe('matches');
    });
  });
});

function renderJobs(
  entries: string[],
  remembered: 'matches' | 'all',
  overrides: {
    scopeResponse?: Promise<{ scope: string }>;
    items?: ReturnType<typeof searchJob>[];
    currentScoreVersion?: string | null;
    savedFilters?: {
      id: string;
      name: string;
      scope: 'matches' | 'all' | null;
      filters: Record<string, string | number | boolean>;
    }[];
  } = {},
): Call[] {
  const calls: Call[] = [];
  const items = overrides.items ?? [
    searchJob('1', 'Network Administrator', 'Beta Systems'),
  ];
  const currentScoreVersion =
    overrides.currentScoreVersion === undefined
      ? 'current-version'
      : overrides.currentScoreVersion;
  mockFetch((url, init) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body as string | undefined });
    if (url.includes('/api/view-scope') && method === 'GET') {
      return overrides.scopeResponse ?? { scope: remembered };
    }
    if (url.includes('/api/view-scope') && method === 'PUT')
      return JSON.parse(init?.body as string);
    if (url.includes('/api/saved-filters') && method === 'GET') {
      return overrides.savedFilters ?? [];
    }
    if (url.endsWith('/api/search-profile')) return { families: [] };
    if (url.includes('/api/jobs/search')) {
      const requested = new URLSearchParams(url.split('?')[1] ?? '');
      const scope = requested.get('scope');
      return searchResponse(items, {
        scope: scope === 'all' ? 'all' : 'matches',
        currentScoreVersion,
      });
    }
    if (/\/api\/jobs\/[^/]+$/.test(url)) {
      const id = url.split('/').pop() ?? '1';
      const source = items.find((item) => item.id === id);
      return source ? jobDetail(source) : null;
    }
    return null;
  });
  renderPage(
    <>
      <JobsPage />
      <LocationProbe />
    </>,
    entries,
  );
  return calls;
}

function lastSearchCall(calls: Call[]): string {
  const search = [...calls]
    .reverse()
    .find((call) => call.url.includes('/api/jobs/search'));
  expect(search).toBeDefined();
  return search?.url ?? '';
}

function renderPage(element: ReactElement, entries: string[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries}>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      return Promise.resolve(handler(url, init)).then(
        (result) =>
          new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      );
    }),
  );
}

function job(id: string, title: string, company: string) {
  return {
    id,
    title,
    company,
    location: 'Remote',
    remoteType: 'remote',
    salaryMinimum: 70000,
    salaryMaximum: 90000,
    score: 80,
    recommendation: 'Strong Match',
    status: 'new',
    firstSeenAt: '2026-07-18T12:00:00.000Z',
    lastSeenAt: '2026-07-18T12:00:00.000Z',
    favorite: false,
    active: true,
  };
}

function searchJob(
  id: string,
  title: string,
  company: string,
  overrides: Partial<JobSearchItem> = {},
): JobSearchItem {
  return {
    ...job(id, title, company),
    location: 'Remote',
    matchedFamilies: null,
    roleEvidence: [],
    materiallyUpdatedAt: null,
    closingDate: null,
    lastVerifiedAt: '2026-07-18T12:00:00.000Z',
    sources: [
      {
        sourceId: 'source-alpha',
        sourceName: 'Alpha careers',
        providerId: 'greenhouse',
      },
    ],
    verificationStatus: null,
    eligibilityPassed: null,
    eligibilityRejection: null,
    workArrangement: 'remote',
    scoreVersion: 'current-version',
    userRemoved: false,
    lifecycleReason: 'active',
    removedAt: null,
    ...overrides,
  } as JobSearchItem;
}

function searchResponse(
  items: JobSearchItem[],
  overrides: {
    scope: 'matches' | 'all';
    currentScoreVersion: string | null;
  },
) {
  return {
    items,
    page: 1,
    pageSize: 100,
    total: items.length,
    pages: items.length === 0 ? 0 : 1,
    searchMode: 'fts5',
    role: null,
    facets: {
      companies: [...new Set(items.map((item) => item.company))].map(
        (company) => ({ value: company, label: company, count: 1 }),
      ),
      locations: [{ value: 'Remote', label: 'Remote', count: items.length }],
      remoteTypes: [{ value: 'remote', label: 'remote', count: items.length }],
      providers: [
        { value: 'greenhouse', label: 'greenhouse', count: items.length },
      ],
      sources: [
        { value: 'source-alpha', label: 'Alpha careers', count: items.length },
      ],
      recommendations: items.map((item) => ({
        value: item.recommendation ?? 'Unscored',
        label: item.recommendation ?? 'Unscored',
        count: 1,
      })),
      statuses: items.map((item) => ({
        value: item.status,
        label: item.status,
        count: 1,
      })),
      activeStates: [{ value: 'active', label: 'Active', count: items.length }],
    },
    ...overrides,
  };
}

function jobDetail(source: JobSearchItem) {
  return {
    ...source,
    existingApplicationId: null,
    city: null,
    state: null,
    employmentType: 'full-time',
    notes: null,
    roleDetails: null,
    categoryScores: null,
    explanations: [],
    missingQualifications: [],
    skills: [],
    certifications: [],
    salaryText: null,
    requirements: null,
    preferredQualifications: null,
    datePosted: null,
    clearanceRequirement: null,
    agency: null,
    department: null,
    gradeLow: null,
    gradeHigh: null,
    payPlan: null,
    appointmentType: null,
    workSchedule: null,
    teleworkEligible: null,
    openingDate: null,
    closingDate: null,
    provider: 'greenhouse',
    description: null,
    postingUrl: null,
    applicationUrls: [],
  };
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <button
        onClick={() => {
          void navigate(-1);
        }}
      >
        Test back
      </button>
      <button
        onClick={() => {
          void navigate(1);
        }}
      >
        Test forward
      </button>
      <output aria-label="Location probe" data-testid="location">
        {location.search}
      </output>
    </>
  );
}
