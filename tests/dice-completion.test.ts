import type { Browser, BrowserContext, Page } from 'playwright';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/providers/linkedIn/browserSession.js', () => ({
  launchBrowserSession: vi.fn(() => ({
    page: {
      evaluate: vi.fn(() => undefined),
      waitForTimeout: vi.fn(() => undefined),
      url: vi.fn(() => 'https://www.dice.com/jobs?q=Engineer'),
      goto: vi.fn(() => undefined),
      waitForLoadState: vi.fn(() => undefined),
      textContent: vi.fn(() => ''),
      $: vi.fn(() => ({})),
    } as unknown as Page,
    context: {} as BrowserContext,
    profileDir: '/mock/profile',
    persistentContext: {} as BrowserContext,
    underlyingBrowser: {} as Browser,
  })),
  closeBrowserSession: vi.fn(() => Promise.resolve(undefined)),
  navigateWithRetry: vi.fn(() => Promise.resolve(undefined)),
  takeDiagnosticScreenshot: vi.fn(() => Promise.resolve(undefined)),
}));

import { DiceProvider } from '../src/providers/dice.provider.js';
import type { ProviderSearch } from '../src/models/discovery.js';

interface RawJob {
  jobId: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  salaryText: string | null;
  salaryMinimum: number | null;
  salaryMaximum: number | null;
  description: string | null;
  postingUrl: string | null;
  postedDate: string | null;
  employmentType: string | null;
  workplaceType: string | null;
  companyLogo: string | null;
  seniorityLevel: string | null;
  employmentDetails: string[];
}

interface DicePrivateApi {
  collectCards: (
    page: Page,
    maxResults: number,
    checkCancelled: () => void,
  ) => Promise<RawJob[]>;
  enrichWithDetails: (
    page: Page,
    jobs: RawJob[],
    checkCancelled: () => void,
  ) => Promise<RawJob[]>;
}

function rawJob(overrides: Partial<RawJob> = {}): RawJob {
  return {
    jobId: null,
    title: null,
    company: null,
    location: null,
    salaryText: null,
    salaryMinimum: null,
    salaryMaximum: null,
    description: null,
    postingUrl: null,
    postedDate: null,
    employmentType: null,
    workplaceType: null,
    companyLogo: null,
    seniorityLevel: null,
    employmentDetails: [],
    ...overrides,
  };
}

describe('Dice completion semantics', () => {
  const provider = new DiceProvider();

  function makeSearch(overrides: Partial<ProviderSearch> = {}): ProviderSearch {
    return {
      request: {
        query: 'Engineer',
        location: null,
        remoteOnly: false,
        limit: 50,
        maxAgeDays: 30,
      },
      target: 'https://www.dice.com/jobs',
      fixturePath: null,
      configuration: {
        searchKeywords: 'Engineer',
        location: '',
        queries: [
          { keywords: 'Engineer', location: '' },
          { keywords: 'Developer', location: '' },
          { keywords: 'Architect', location: '' },
        ],
        remoteFilter: '',
        distance: 25,
        datePosted: 'month',
        maxResults: 50,
        browserProfileDir: '/mock/dice-profile',
        keepBrowserOpen: false,
        debugMode: false,
      },
      ...overrides,
    };
  }

  function passThroughEnrich() {
    return vi
      .spyOn(provider as unknown as DicePrivateApi, 'enrichWithDetails')
      .mockImplementation((_page, jobs) => Promise.resolve(jobs));
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('all queries complete returns complete=true', async () => {
    vi.spyOn(
      provider as unknown as DicePrivateApi,
      'collectCards',
    ).mockResolvedValue([
      rawJob({
        jobId: 'dice-job-1',
        title: 'Job 1',
        company: 'C',
        location: 'Remote',
        postingUrl: 'https://dice.com/1',
        employmentType: 'full-time',
      }),
      rawJob({
        jobId: 'dice-job-2',
        title: 'Job 2',
        company: 'C',
        location: 'Remote',
        postingUrl: 'https://dice.com/2',
        employmentType: 'full-time',
      }),
    ]);
    passThroughEnrich();
    const result = await provider.fetch(makeSearch());
    expect(result.complete).toBe(true);
    expect(result.completedQueries).toBe(3);
    expect(result.failedQueries).toBe(0);
  });

  it('one failing query returns complete=false', async () => {
    let callCount = 0;
    vi.spyOn(
      provider as unknown as DicePrivateApi,
      'collectCards',
    ).mockImplementation(() => {
      callCount++;
      if (callCount === 2) return Promise.reject(new Error('Collect failed'));
      return Promise.resolve([
        rawJob({
          jobId: `dice-job-${String(callCount)}`,
          title: `Job ${String(callCount)}`,
          company: 'C',
          location: 'Remote',
          postingUrl: `https://dice.com/${String(callCount)}`,
          employmentType: 'full-time',
        }),
      ]);
    });
    passThroughEnrich();
    const result = await provider.fetch(makeSearch());
    expect(result.complete).toBe(false);
    expect(result.completedQueries).toBe(2);
    expect(result.failedQueries).toBe(1);
  });

  it('truncated query is still complete=true when all queries ran', async () => {
    vi.spyOn(
      provider as unknown as DicePrivateApi,
      'collectCards',
    ).mockResolvedValue(
      Array.from({ length: 50 }, (_, i) =>
        rawJob({
          jobId: `dice-job-${String(i)}`,
          title: `Job ${String(i)}`,
          company: 'C',
          location: 'Remote',
          postingUrl: `https://dice.com/${String(i)}`,
          employmentType: 'full-time',
        }),
      ),
    );
    passThroughEnrich();
    const result = await provider.fetch(
      makeSearch({
        configuration: {
          searchKeywords: 'Engineer',
          location: '',
          queries: [{ keywords: 'Engineer', location: '' }],
          remoteFilter: '',
          distance: 25,
          datePosted: 'month',
          maxResults: 10,
          browserProfileDir: '/mock/dice-profile',
          keepBrowserOpen: false,
          debugMode: false,
        },
      }),
    );
    expect(result.complete).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.completedQueries).toBe(1);
  });

  it('duplicates are consolidated across queries', async () => {
    let callCount = 0;
    vi.spyOn(
      provider as unknown as DicePrivateApi,
      'collectCards',
    ).mockImplementation(() => {
      callCount++;
      return Promise.resolve([
        rawJob({
          jobId: 'shared-job',
          title: 'Shared',
          company: 'C',
          location: 'Remote',
          postingUrl: 'https://dice.com/shared',
          employmentType: 'full-time',
        }),
        rawJob({
          jobId: `unique-${String(callCount)}`,
          title: `Unique ${String(callCount)}`,
          company: 'C',
          location: 'Remote',
          postingUrl: `https://dice.com/unique-${String(callCount)}`,
          employmentType: 'full-time',
        }),
      ]);
    });
    passThroughEnrich();
    const result = await provider.fetch(makeSearch());
    const uniqueIds = new Set(
      result.records.map((r) => (r as { jobId?: string }).jobId),
    );
    expect(uniqueIds.size).toBe(result.records.length);
    expect(uniqueIds.has('shared-job')).toBe(true);
  });

  it('returns records after enrichment', async () => {
    vi.spyOn(
      provider as unknown as DicePrivateApi,
      'collectCards',
    ).mockResolvedValue([
      rawJob({
        jobId: 'dice-final-job',
        title: 'Final Job',
        company: 'C',
        location: 'Remote',
        postingUrl: 'https://dice.com/final',
        employmentType: 'full-time',
      }),
    ]);
    vi.spyOn(
      provider as unknown as DicePrivateApi,
      'enrichWithDetails',
    ).mockImplementation((_page, jobs) =>
      Promise.resolve(jobs.map((j) => ({ ...j, salaryText: '$100k' }))),
    );
    const result = await provider.fetch(makeSearch());
    expect(result.records.length).toBeGreaterThanOrEqual(1);
    expect((result.records[0] as { salaryText?: string }).salaryText).toBe(
      '$100k',
    );
  });
});
