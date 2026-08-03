import type { Browser, BrowserContext, Page } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/providers/linkedIn/browserSession.js', () => ({
  launchBrowserSession: vi.fn(() => ({
    page: {} as Page,
    context: {} as BrowserContext,
    profileDir: '/mock/handshake-profile',
    persistentContext: {} as BrowserContext,
    underlyingBrowser: {} as Browser,
  })),
  closeBrowserSession: vi.fn(() => Promise.resolve(undefined)),
  navigateWithRetry: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../src/providers/handshake/browserSession.js', () => ({
  ensureHandshakeLogin: vi.fn(() => Promise.resolve(true)),
  isHandshakeLoggedIn: vi.fn(() => Promise.resolve(true)),
}));

import { HandshakeProvider } from '../src/providers/handshake.provider.js';
import { parseHandshakeSearchPayload } from '../src/providers/handshake/searchResponse.js';
import { closeBrowserSession } from '../src/providers/linkedIn/browserSession.js';
import { ensureHandshakeLogin } from '../src/providers/handshake/browserSession.js';
import type { ProviderSearch } from '../src/models/discovery.js';
import type {
  HandshakeRawJob,
  HandshakeSearchPage,
} from '../src/providers/handshake/searchResponse.js';

const request = {
  query: 'SOC analyst',
  location: 'Highland, IL',
  remoteOnly: true,
  limit: 50,
} as const;

const rawJob: HandshakeRawJob = {
  jobId: 'hs-1001',
  title: 'Junior Security Operations Analyst',
  company: 'Fixture Security',
  location: 'Remote - United States',
  salaryText: '$60,000 - $75,000 per year',
  salaryMinimum: 60_000,
  salaryMaximum: 75_000,
  description: 'Monitor SIEM alerts and document security incidents.',
  postingUrl: 'https://app.joinhandshake.com/job-search/hs-1001',
  postedDate: '2026-07-28T14:00:00.000Z',
  closingDate: '2026-08-28T23:59:59.000Z',
  employmentType: 'FULL_TIME',
  workplaceType: 'REMOTE',
  applicationUrls: ['https://careers.example.com/jobs/hs-1001'],
};

interface HandshakePrivateApi {
  loadSearchPage: (page: Page, url: string) => Promise<HandshakeSearchPage>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HandshakeProvider', () => {
  it('validates configuration and reports interactive browser capabilities', async () => {
    const provider = new HandshakeProvider();

    await expect(provider.validateConfiguration({})).resolves.toMatchObject({
      valid: true,
    });
    await expect(
      provider.validateConfiguration({ maxResults: 0 }),
    ).resolves.toMatchObject({ valid: false });
    expect(provider.capabilities).toMatchObject({
      keywordSearch: true,
      locationSearch: false,
      remoteFilter: true,
      pagination: true,
      requiresCredentials: false,
      interactiveBrowser: true,
    });
  });

  it('builds the current job-search URL with a remote-work filter', async () => {
    const provider = new HandshakeProvider();
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration: { queries: [] },
    });
    const target = new URL(search.target);

    expect(target.origin + target.pathname).toBe(
      'https://app.joinhandshake.com/job-search',
    );
    expect(target.searchParams.get('query')).toBe('SOC analyst');
    expect(target.searchParams.get('remoteWork')).toBe('remote');
    expect(target.searchParams.get('page')).toBe('1');
    expect(target.searchParams.get('per_page')).toBe('25');
  });

  it('loads and normalizes the offline fixture', async () => {
    const provider = new HandshakeProvider();
    const search = await provider.search(request, { fixtureOnly: true });
    const fetched = await provider.fetch(search);
    const first = fetched.records[0];
    const normalized = provider.validate(
      provider.normalize(first, '2026-08-01T12:00:00.000Z'),
    );

    expect(fetched.records).toHaveLength(2);
    expect(normalized).toMatchObject({
      externalId: 'hs-1001',
      title: 'Junior Security Operations Analyst',
      company: 'Fixture Security',
      remoteType: 'remote',
      employmentType: 'full-time',
      salaryMinimum: 60_000,
      salaryMaximum: 75_000,
      datePosted: '2026-07-28T14:00:00.000Z',
      closingDate: '2026-08-28T23:59:59.000Z',
      applicationUrls: ['https://careers.example.com/jobs/hs-1001'],
    });
    expect(normalized.description).toContain('SIEM alerts');
  });

  it('rejects a GraphQL payload without JobSearchQuery data', () => {
    expect(() =>
      parseHandshakeSearchPayload({
        errors: [{ message: 'Not authenticated' }],
      }),
    ).toThrow('Not authenticated');
  });

  it('parses JobSearchQuery from a batched GraphQL response', () => {
    const parsed = parseHandshakeSearchPayload([
      { data: { viewer: { id: 'student-1' } } },
      {
        data: {
          jobSearch: {
            totalCount: 1,
            pageInfo: { hasNextPage: false },
            edges: [{ node: { job: { id: 'hs-2001', title: 'SOC Analyst' } } }],
          },
        },
      },
    ]);

    expect(parsed.jobs[0]).toMatchObject({
      jobId: 'hs-2001',
      title: 'SOC Analyst',
    });
  });

  it('reuses an authenticated session and deduplicates across queries', async () => {
    const provider = new HandshakeProvider();
    vi.spyOn(
      provider as unknown as HandshakePrivateApi,
      'loadSearchPage',
    ).mockImplementation((_page, url) => {
      const query = new URL(url).searchParams.get('query');
      const jobs =
        query === 'network administrator'
          ? [{ ...rawJob }, { ...rawJob, jobId: 'hs-1002' }]
          : [{ ...rawJob }];
      return Promise.resolve({
        jobs,
        totalCount: jobs.length,
        hasNextPage: false,
        rejected: 0,
      });
    });

    const result = await provider.fetch(liveSearch());

    expect(result.records).toHaveLength(2);
    expect(result).toMatchObject({
      complete: true,
      completedQueries: 2,
      failedQueries: 0,
      truncatedQueries: 0,
    });
    expect(ensureHandshakeLogin).toHaveBeenCalledOnce();
    expect(closeBrowserSession).toHaveBeenCalledOnce();
  });
});

function liveSearch(): ProviderSearch {
  return {
    request,
    target: 'https://app.joinhandshake.com/job-search',
    fixturePath: null,
    configuration: {
      searchKeywords: 'SOC analyst',
      queries: [
        { keywords: 'SOC analyst', location: '' },
        { keywords: 'network administrator', location: '' },
      ],
      remoteFilter: 'remote',
      maxResults: 25,
      keepBrowserOpen: false,
      debugMode: false,
    },
  };
}
