// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import { App } from '../src/client/App.js';
import { AnalyticsPage } from '../src/client/pages/AnalyticsPage.js';
import { DashboardPage } from '../src/client/pages/DashboardPage.js';
import { JobsPage } from '../src/client/pages/JobsPage.js';
import { ProfilePage } from '../src/client/pages/ProfilePage.js';
import { ResumesPage } from '../src/client/pages/ResumesPage.js';
import { SettingsPage } from '../src/client/pages/SettingsPage.js';
import { SCORING_RULES_VERSION } from '../src/intelligence/scoringVersion.js';

vi.mock('react-chartjs-2', () => ({
  Bar: () => <div data-testid="bar-chart" />,
  Doughnut: () => <div data-testid="doughnut-chart" />,
  Line: () => <div data-testid="line-chart" />,
}));

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const height = this.classList.contains('jobs-table-scroll') ? 620 : 62;
      return {
        x: 0,
        y: 0,
        top: 0,
        right: 1250,
        bottom: height,
        left: 0,
        width: 1250,
        height,
        toJSON: () => ({}),
      };
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('dashboard UI', () => {
  it('renders dashboard summaries and recent activity', async () => {
    mockFetch(() => ({
      totalJobs: 12,
      newJobsToday: 3,
      strongMatches: 4,
      appliedJobs: 2,
      hiddenJobs: 1,
      expiredJobs: 1,
      averageMatchScore: 76.4,
      topEmployer: 'Security Employer',
      topSkill: 'Splunk',
      recentActivity: [
        {
          id: 'a1',
          type: 'status',
          label: 'Analyst changed to applied',
          timestamp: new Date().toISOString(),
        },
      ],
    }));
    renderPage(<DashboardPage />);

    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('Security Employer')).toBeInTheDocument();
    expect(screen.getByText('Analyst changed to applied')).toBeInTheDocument();
  });

  it('shows first-run onboarding in place of the summary when no jobs exist', async () => {
    mockFetch((url) => {
      if (url.endsWith('/api/sources/control-center')) {
        return { sources: [] };
      }
      if (url.endsWith('/api/discovery-alerts')) return [];
      return dashboard();
    });
    renderPage(<DashboardPage />);

    expect(
      await screen.findByText('Set up discovery in three steps'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Add your first source' }),
    ).toHaveAttribute('href', '/sources');
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Set up discovery in three steps',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Add sources')).toBeInTheDocument();
    expect(screen.getByText('Let discovery run')).toBeInTheDocument();
    expect(screen.getByText('Review and apply')).toBeInTheDocument();
    expect(screen.queryByLabelText('Job summary')).not.toBeInTheDocument();
  });

  it('adapts first-run onboarding when sources are already configured', async () => {
    mockFetch((url) => {
      if (url.endsWith('/api/sources/control-center')) {
        return { sources: [{ id: 's1' }] };
      }
      if (url.endsWith('/api/discovery-alerts')) return [];
      return dashboard();
    });
    renderPage(<DashboardPage />);

    expect(
      await screen.findByRole('link', { name: 'Manage sources' }),
    ).toHaveAttribute('href', '/sources');
    expect(
      screen.getByRole('link', { name: 'Open discovery control' }),
    ).toHaveAttribute('href', '/employers');
  });

  it('selects a target role, resets pagination, and shows indexed evidence', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    mockFetch((url) => {
      if (url.endsWith('/api/saved-filters')) return [];
      if (url.endsWith('/api/search-profile'))
        return {
          families: [
            {
              key: 'security',
              displayName: 'Security',
              enabled: true,
              priority: 1,
            },
            {
              key: 'disabled',
              displayName: 'Disabled',
              enabled: false,
              priority: 2,
            },
          ],
        };
      calls.push(url);
      const selected = url.includes('targetRole=security');
      return {
        ...searchResponse([
          {
            ...searchJob('1', 'SOC Analyst', 'Fixture'),
            matchedFamilies: 'security',
            roleEvidence: selected
              ? [
                  {
                    key: 'security',
                    displayName: 'Security',
                    how: 'title-match',
                    basis: 'Structured title record.',
                    indexedSkills: [
                      { skill: 'Splunk', evidence: 'Splunk required.' },
                    ],
                  },
                ]
              : [],
          },
        ]),
        role: selected
          ? { familyKey: 'security', displayName: 'Security', approved: true }
          : null,
      };
    });
    renderPage(
      <>
        <JobsPage />
        <LocationProbe />
      </>,
      ['/jobs?page=2'],
    );
    await screen.findByText('SOC Analyst');
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    expect(
      screen.queryByRole('option', { name: 'Disabled' }),
    ).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Target role'), 'security');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        'targetRole=security',
      ),
    );
    expect(screen.getByTestId('location')).not.toHaveTextContent('page=2');
    expect(await screen.findByTitle('Splunk required.')).toHaveTextContent(
      'Splunk',
    );
    expect(calls.some((url) => url.includes('targetRole=security'))).toBe(true);
    await user.selectOptions(screen.getByLabelText('Target role'), '');
    await waitFor(() =>
      expect(screen.getByTestId('location')).not.toHaveTextContent(
        'targetRole',
      ),
    );
  });

  it('shows a deterministic baseline and evidence when NLP breaks a search tie', async () => {
    mockFetch((url) => {
      if (url.endsWith('/api/saved-filters')) return [];
      return searchResponse([
        {
          ...searchJob('1', 'SOC Analyst', 'Fixture'),
          nlpTieBreak: {
            reason:
              'The primary score value tied at 80. Current description evidence supplied the secondary relevance value 0.900.',
            baseline: { sortField: 'score', direction: 'desc', value: 80 },
            relevance: {
              score: 0.9,
              indexVersion: 'job-search-relevance-v3',
            },
            evidence: [
              {
                category: 'skill',
                label: 'Splunk',
                evidence: 'Splunk required.',
                sourceField: 'description',
                charStart: 0,
                charEnd: 16,
              },
            ],
            authority: {
              productionScore: 'unchanged',
              eligibility: 'unchanged',
              primarySort: 'unchanged',
            },
          },
        },
      ]);
    });
    renderPage(<JobsPage />, ['/jobs']);

    expect(await screen.findByText(/Tie-break explanation:/)).toHaveTextContent(
      'primary score value tied at 80',
    );
    expect(screen.getByTitle('description characters 0–16')).toHaveTextContent(
      'Splunk',
    );
  });

  it('sends URL-backed filters to server search and replaces typing history', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    mockFetch((url) => {
      if (url.endsWith('/api/saved-filters')) return [];
      calls.push(url);
      return searchResponse([
        searchJob('1', 'Network Administrator', 'Beta Systems'),
      ]);
    });
    renderPage(
      <>
        <JobsPage />
        <LocationProbe />
      </>,
      ['/jobs?company=Beta%20Systems&minScore=75&page=2&sort=company'],
    );
    expect(
      await screen.findByText('Network Administrator'),
    ).toBeInTheDocument();
    expect(calls[0]).toContain('/api/jobs/search?');
    expect(calls[0]).toContain('company=Beta+Systems');
    expect(calls[0]).toContain('minScore=75');
    expect(calls[0]).toContain('page=2');
    expect(calls[0]).toContain('sort=company');

    await user.type(screen.getByLabelText('Search jobs'), 'security');

    await waitFor(() =>
      expect(calls.some((url) => url.includes('q=security'))).toBe(true),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('q=security');
    expect(screen.getByTestId('location')).not.toHaveTextContent('page=2');
  });

  it('renders server facets, pagination, and selected job state', async () => {
    const user = userEvent.setup();
    mockFetch((url) => {
      if (url.endsWith('/api/saved-filters')) return [];
      if (url.endsWith('/api/jobs/1')) return jobDetail();
      return searchResponse(
        [searchJob('1', 'Cybersecurity Analyst', 'Alpha Health')],
        { page: url.includes('page=2') ? 2 : 1, pages: 3, total: 201 },
      );
    });
    renderPage(
      <>
        <JobsPage />
        <LocationProbe />
      </>,
      ['/jobs'],
    );
    await screen.findByText('Cybersecurity Analyst');
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByLabelText('Company')).toHaveTextContent(
      'Alpha Health (1)',
    );
    expect(screen.getByLabelText('Provider')).toHaveTextContent(
      'greenhouse (1)',
    );
    expect(screen.getByLabelText('Source')).toHaveTextContent(
      'Alpha careers (1)',
    );

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('page=2'),
    );
    await user.click(screen.getByText('Cybersecurity Analyst'));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('job=1'),
    );
    expect(await screen.findByLabelText('Job details')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close job details' }));
    expect(screen.getByTestId('location')).not.toHaveTextContent('job=1');
  });

  it('renders structured role details in the job detail panel', async () => {
    const user = userEvent.setup();
    mockFetch((url) => {
      if (url.endsWith('/api/saved-filters')) return [];
      if (url.endsWith('/api/jobs/1')) return jobDetail();
      return searchResponse([
        searchJob('1', 'Cybersecurity Analyst', 'Alpha Health'),
      ]);
    });
    renderPage(<JobsPage />, ['/jobs']);
    await screen.findByText('Cybersecurity Analyst');
    await user.click(screen.getByText('Cybersecurity Analyst'));

    expect(await screen.findByLabelText('Job details')).toBeInTheDocument();
    const section = within(
      (await screen.findByText('Structured role details')).closest('section')!,
    );
    expect(section.getByText('Work arrangement')).toBeInTheDocument();
    expect(section.getByText('On-site')).toBeInTheDocument();
    expect(section.getByText('Primary location')).toBeInTheDocument();
    expect(section.getByText('Clearance')).toBeInTheDocument();
    expect(section.getByText('Experience required')).toBeInTheDocument();
    expect(section.getByText('Required skills')).toBeInTheDocument();
    expect(section.getByText('Linux, Splunk')).toBeInTheDocument();
    expect(section.getByText('Preferred skills')).toBeInTheDocument();
    expect(section.getByText('Required certifications')).toBeInTheDocument();
    expect(section.getByText('CompTIA Security+')).toBeInTheDocument();
    expect(section.getByText('Conditions')).toBeInTheDocument();
    expect(
      section.getByText(
        'Professional engineering required; Contingent on award',
      ),
    ).toBeInTheDocument();
    expect(section.getByText('Education')).toBeInTheDocument();
    expect(section.getByText("Bachelor's degree")).toBeInTheDocument();
    expect(section.getByText('Experience substitution')).toBeInTheDocument();
  });

  it('restores saved filters and virtualizes a large server page', async () => {
    localStorage.setItem(
      `job-browser-filters:${SCORING_RULES_VERSION}`,
      JSON.stringify({ provider: 'usajobs', active: 'active' }),
    );
    const calls: string[] = [];
    mockFetch((url) => {
      if (url.endsWith('/api/saved-filters')) return [];
      calls.push(url);
      return searchResponse(
        Array.from({ length: 100 }, (_, index) =>
          searchJob(String(index), `Role ${String(index)}`, 'Agency'),
        ),
        { total: 100, pages: 1 },
      );
    });
    renderPage(
      <>
        <JobsPage />
        <LocationProbe />
      </>,
      ['/jobs'],
    );

    await screen.findByText('Role 0');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        'provider=usajobs',
      ),
    );
    expect(calls.some((url) => url.includes('provider=usajobs'))).toBe(true);
    expect(screen.getAllByRole('row').length).toBeLessThan(100);
  });

  it('edits and saves the candidate profile', async () => {
    const user = userEvent.setup();
    const calls: { url: string; method: string }[] = [];
    mockFetch((url, init) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.endsWith('/api/profile') && init?.method !== 'PUT') {
        return {
          profile: loadCandidateProfile(),
          scoring: loadScoringConfig(),
        };
      }
      return url.endsWith('/api/scoring')
        ? loadScoringConfig()
        : { profile: loadCandidateProfile() };
    });
    renderPage(<ProfilePage />);
    const name = await screen.findByLabelText('Profile name');
    await user.clear(name);
    await user.type(name, 'Example Updated');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.url.endsWith('/api/profile') && call.method === 'PUT',
        ),
      ).toBe(true),
    );
  });

  it('uploads a resume through the resume manager', async () => {
    const user = userEvent.setup();
    const calls: { method: string; body: BodyInit | null | undefined }[] = [];
    mockFetch((_url, init) => {
      calls.push({ method: init?.method ?? 'GET', body: init?.body });
      return init?.method === 'POST' ? resume() : [];
    });
    renderPage(<ResumesPage />);
    const file = new File(['Splunk Security+'], 'resume.txt', {
      type: 'text/plain',
    });
    await user.upload(await screen.findByLabelText('Resume file'), file);
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.method === 'POST' && call.body instanceof FormData,
        ),
      ).toBe(true),
    );
  });

  it('navigates between all primary routes', async () => {
    const user = userEvent.setup();
    mockFetch((url) => {
      if (url.endsWith('/api/dashboard')) return dashboard();
      if (url.endsWith('/api/saved-filters')) return [];
      if (url.includes('/api/jobs/search')) return searchResponse([]);
      return {};
    });
    renderPage(<App />, ['/']);
    await screen.findByText('Opportunity command center');
    await user.click(screen.getByRole('link', { name: /Jobs/ }));

    expect(
      await screen.findByText('Opportunity inventory'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Analytics/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Settings/ })).toBeInTheDocument();
  });

  it('renders analytics charts from existing metrics', async () => {
    mockFetch((url) => {
      if (url.includes('/api/analytics/application-outcomes')) {
        return {
          definition: 'Applications after last activity',
          applications: { cohortSize: 2, everReached: [] },
          unknownCompanyCount: 0,
          unknownQualificationCount: 0,
        };
      }
      return {
        topSkills: [{ label: 'Splunk', value: 4 }],
        topCertifications: [{ label: 'Security+', value: 3 }],
        topEmployers: [{ label: 'Alpha Health', value: 5 }],
        jobsByLocation: [{ label: 'Remote', value: 4 }],
        jobsByScore: [{ label: '80-100', value: 2 }],
        recommendationDistribution: [{ label: 'Strong Match', value: 2 }],
        jobsOverTime: [{ label: '2026-07-18', value: 2 }],
        averageSalary: 82000,
        trackedEmployers: 12,
        skillSignals: 4,
      };
    });
    renderPage(<AnalyticsPage />);

    expect(await screen.findByText('$82,000')).toBeInTheDocument();
    expect(screen.getAllByTestId('bar-chart')).toHaveLength(4);
    expect(screen.getByTestId('doughnut-chart')).toBeInTheDocument();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(
      screen
        .getByText('Tracked employers')
        .closest('article')
        ?.querySelector('strong'),
    ).toHaveTextContent('12');
  });

  it('surfaces an application-outcomes failure instead of hiding the panel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.includes('/api/analytics/application-outcomes')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ error: 'Outcome analytics are down' }),
              {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              topSkills: [],
              topCertifications: [],
              topEmployers: [{ label: 'Alpha Health', value: 1 }],
              jobsByLocation: [],
              jobsByScore: [],
              recommendationDistribution: [],
              jobsOverTime: [],
              averageSalary: 0,
              trackedEmployers: 1,
              skillSignals: 0,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }),
    );
    renderPage(<AnalyticsPage />);

    expect(
      await screen.findByText('Outcome analytics are down', undefined, {
        timeout: 5_000,
      }),
    ).toBeInTheDocument();
  });

  it('edits and saves application settings', async () => {
    const user = userEvent.setup();
    const settings = {
      databaseLocation: 'data/job-browser.sqlite',
      defaultSearch: '',
      theme: 'dark',
      defaultSort: 'score',
      loggingLevel: 'info',
      resumeDirectory: 'data/resumes',
      artifactDirectory: 'artifacts',
      targetRoles: [
        'systems administrator',
        'network administrator',
        'network analyst',
        'SOC analyst',
      ],
    };
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(init?.method ?? 'GET');
      if (url.endsWith('/api/adoption')) {
        return {
          installedAt: '2026-07-01T12:00:00.000Z',
          firstSourceAt: null,
        };
      }
      return settings;
    });
    renderPage(<SettingsPage />);
    const search = await screen.findByLabelText('Default search');
    fireEvent.change(search, { target: { value: 'security analyst' } });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(calls).toContain('PUT'));
  });

  it('shows read-only NLP versions, progress, flags, and fallback status', async () => {
    mockFetch((url) => {
      if (url.endsWith('/api/intelligence/status')) {
        return {
          statusVersion: 'nlp-status-v1',
          worker: null,
          extractionVersion: 'job-nlp-v1',
          documentVersion: 'document-v1',
          relevanceVersion: 'search-relevance-v3',
          comparisonVersion: 'nlp-comparison-v1',
          flags: {
            version: 'nlp-capability-flags-v1',
            jobIntelligenceExplanation: false,
            roleFamilySuggestion: false,
            searchTieBreak: false,
            searchProfileFeedback: false,
          },
          counts: {
            jobs: 12,
            analyzed: 10,
            currentEnrichments: 10,
            currentRelevanceIndexes: 9,
            currentComparisons: 8,
          },
          lastSuccessAt: '2026-09-11T12:00:00.000Z',
          lastFailure:
            'One item failed. Deterministic behavior remains active.',
          state: 'degraded',
          notice: 'Not used for scoring or eligibility.',
        };
      }
      if (url.endsWith('/api/adoption'))
        return { installedAt: null, firstSourceAt: null };
      return {
        databaseLocation: 'data/job-browser.sqlite',
        defaultSearch: '',
        theme: 'dark',
        defaultSort: 'score',
        loggingLevel: 'info',
        resumeDirectory: 'data/resumes',
        artifactDirectory: 'artifacts',
        targetRoles: [],
      };
    });
    renderPage(<SettingsPage />);
    expect(
      await screen.findByText('Job-description intelligence'),
    ).toBeInTheDocument();
    expect(screen.getByText('job-nlp-v1')).toBeInTheDocument();
    expect(screen.getByText('10/12')).toBeInTheDocument();
    expect(
      screen.getByText('Not used for scoring or eligibility.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Deterministic behavior remains active/),
    ).toBeInTheDocument();
  });

  it('shows local adoption markers read-only', async () => {
    mockFetch((url) => {
      if (url.endsWith('/api/adoption')) {
        return {
          installedAt: '2026-07-01T12:00:00.000Z',
          firstSourceAt: null,
        };
      }
      return {
        databaseLocation: 'data/job-browser.sqlite',
        defaultSearch: '',
        theme: 'dark',
        defaultSort: 'score',
        loggingLevel: 'info',
        resumeDirectory: 'data/resumes',
        artifactDirectory: 'artifacts',
        targetRoles: [],
      };
    });
    renderPage(<SettingsPage />);

    expect(
      await screen.findByText('Local adoption markers'),
    ).toBeInTheDocument();
    const installed = screen.getByLabelText('First launched');
    expect(installed).toHaveAttribute('readonly');
    expect(installed).not.toHaveValue('Not yet');
    expect(screen.getByLabelText('First source added')).toHaveValue('Not yet');
  });

  it('distinguishes filtered and unfiltered empty job results', async () => {
    const user = userEvent.setup();
    mockFetch((url) => {
      if (url.endsWith('/api/saved-filters')) return [];
      return searchResponse([]);
    });
    renderPage(
      <>
        <JobsPage />
        <LocationProbe />
      </>,
      ['/jobs?company=Beta%20Systems'],
    );

    expect(
      await screen.findByText('No jobs match these filters'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all jobs' })).toHaveAttribute(
      'href',
      '/jobs',
    );

    await user.click(screen.getByRole('link', { name: 'Show all jobs' }));
    expect(screen.getByTestId('location')).not.toHaveTextContent('company=');
  });

  it('guides empty jobs view toward discovery setup', async () => {
    mockFetch((url) => {
      if (url.endsWith('/api/saved-filters')) return [];
      return searchResponse([]);
    });
    renderPage(
      <>
        <JobsPage />
      </>,
      ['/jobs'],
    );

    expect(await screen.findByText('No jobs yet')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Check your sources/ }),
    ).toHaveAttribute('href', '/sources');
  });
});

function renderPage(element: ReactElement, entries = ['/']) {
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
      const body = handler(url, init);
      return Promise.resolve(
        new Response(JSON.stringify(body), {
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
    provider: 'smartrecruiters',
    favorite: false,
    active: true,
  };
}
function searchJob(id: string, title: string, company: string) {
  return {
    ...job(id, title, company),
    matchedFamilies: null as string | null,
    roleEvidence:
      [] as import('../src/models/job-search.js').JobSearchRoleEvidence[],
    nlpTieBreak: undefined as
      | import('../src/models/job-search.js').JobSearchNlpTieBreak
      | undefined,
    lastVerifiedAt: '2026-07-18T12:00:00.000Z',
    materiallyUpdatedAt: null,
    closingDate: null,
    sources: [
      {
        sourceId: 'source-alpha',
        sourceName: 'Alpha careers',
        providerId: 'greenhouse',
      },
    ],
  };
}
function searchResponse(
  items: ReturnType<typeof searchJob>[],
  overrides: Partial<{ page: number; pages: number; total: number }> = {},
) {
  return {
    items,
    page: overrides.page ?? 1,
    pageSize: 100,
    total: overrides.total ?? items.length,
    pages: overrides.pages ?? (items.length === 0 ? 0 : 1),
    searchMode: 'fts5',
    facets: {
      companies: [{ value: 'Alpha Health', label: 'Alpha Health', count: 1 }],
      locations: [{ value: 'Remote', label: 'Remote', count: 1 }],
      remoteTypes: [{ value: 'remote', label: 'remote', count: 1 }],
      providers: [{ value: 'greenhouse', label: 'greenhouse', count: 1 }],
      sources: [{ value: 'source-alpha', label: 'Alpha careers', count: 1 }],
      recommendations: [
        { value: 'Strong Match', label: 'Strong Match', count: 1 },
      ],
      statuses: [{ value: 'new', label: 'new', count: 1 }],
      activeStates: [{ value: 'active', label: 'Active', count: 1 }],
    },
  };
}
function jobDetail() {
  return {
    ...job('1', 'Cybersecurity Analyst', 'Alpha Health'),
    provider: 'greenhouse',
    existingApplicationId: null,
    city: 'Springfield',
    state: 'IL',
    notes: null,
    categoryScores: null,
    explanations: [],
    missingQualifications: [],
    skills: [],
    certifications: [],
    salaryText: null,
    employmentType: 'full-time',
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
    description: 'Original description prose remains visible below.',
    postingUrl: null,
    sources: [],
    applicationUrls: [],
    recommendationStatus: null,
    roleDetails: {
      version: 'role-details-v1',
      generatedAt: '2026-08-14T12:00:00.000Z',
      sourceTextHash: 'a'.repeat(64),
      workplace: { arrangement: 'onsite', source: 'provider', evidence: [] },
      employment: {
        type: 'full-time',
        source: 'provider',
        evidence: ['Provider employment type: full-time'],
      },
      locations: {
        primaryCity: 'Springfield',
        primaryState: 'IL',
        remoteCapable: false,
        multiple: false,
        evidence: [],
      },
      clearance: {
        mode: 'obtainable',
        level: 'Secret',
        sponsorable: false,
        evidence: [],
      },
      education: {
        degreeRequired: 'bachelor',
        degreeInProgressOk: false,
        field: null,
        evidence: [],
      },
      experience: {
        requiredYears: 5,
        preferredYears: null,
        substitution: ['or equivalent combination of education and experience'],
        evidence: [],
      },
      skills: {
        required: ['Linux', 'Splunk'],
        preferred: ['AWS'],
      },
      technologies: ['Splunk'],
      certifications: {
        required: ['CompTIA Security+'],
        preferred: [],
      },
      occupationalSeries: ['0854'],
      citizenship: { usCitizenRequired: false, evidence: [] },
      travel: { required: false, percent: null, evidence: [] },
      schedule: { classification: 'daytime', flags: [], evidence: [] },
      contingentConditions: {
        commissionBased: false,
        physicalRequirements: false,
        fieldInstallation: false,
        developmentFocused: false,
        professionalEngineering: true,
        contingentOnAward: true,
        evidence: [],
      },
    },
  };
}
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}
function dashboard() {
  return {
    totalJobs: 0,
    newJobsToday: 0,
    strongMatches: 0,
    appliedJobs: 0,
    hiddenJobs: 0,
    expiredJobs: 0,
    averageMatchScore: 0,
    topEmployer: null,
    topSkill: null,
    recentActivity: [],
  };
}
function resume() {
  return {
    id: 'r1',
    displayName: 'Resume',
    originalFilename: 'resume.txt',
    mimeType: 'text/plain',
    sizeBytes: 10,
    isDefault: true,
    parsingStatus: 'parsed',
    extractedSkills: [],
    extractedCertifications: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    proposals: [],
  };
}
