import type { Browser, BrowserContext, Page } from 'playwright';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

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
    context: { newPage: vi.fn() } as unknown as BrowserContext,
    profileDir: '/mock/profile',
    persistentContext: {} as BrowserContext,
    underlyingBrowser: {} as Browser,
  })),
  closeBrowserSession: vi.fn(() => Promise.resolve(undefined)),
  navigateWithRetry: vi.fn(() => Promise.resolve(undefined)),
  waitForContent: vi.fn(() => Promise.resolve(true)),
  takeDiagnosticScreenshot: vi.fn(() => Promise.resolve(undefined)),
}));

import { waitForContent } from '../src/providers/linkedIn/browserSession.js';
import { DiceProvider } from '../src/providers/dice.provider.js';
import type { ProviderSearch } from '../src/models/discovery.js';
import { extractJobDetail } from '../src/providers/dice/jobDetailExtractor.js';

vi.mock('../src/providers/dice/jobDetailExtractor.js', () => ({
  extractJobDetail: vi.fn(() =>
    Promise.resolve({
      description: 'Detail description',
      salaryText: null,
      salaryMinimum: null,
      salaryMaximum: null,
      workplaceType: null,
      employmentType: null,
      postedDate: null,
      companyName: null,
      location: null,
      jobTitle: null,
      companyLogo: null,
      employmentDetails: [],
    }),
  ),
}));

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
    deadline: number,
  ) => Promise<RawJob[]>;
  enrichWithDetails: (
    context: BrowserContext,
    jobs: RawJob[],
    checkCancelled: () => void,
    deadline: number,
  ) => Promise<{
    completed: number;
    stopReason: 'request_budget' | 'cancelled' | 'provider_error' | null;
  }>;
}

function detailPage(overrides: Partial<Page> = {}): Page {
  return {
    goto: vi.fn(() => Promise.resolve(null)),
    close: vi.fn(() => Promise.resolve()),
    ...overrides,
  } as unknown as Page;
}

function detailContext(pages: Page[]): BrowserContext {
  let index = 0;
  return {
    newPage: vi.fn(() => {
      const page = pages[index++];
      if (!page) throw new Error('Unexpected Dice detail worker page');
      return Promise.resolve(page);
    }),
  } as unknown as BrowserContext;
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
      .mockResolvedValue({ completed: 0, stopReason: null });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    ).mockImplementation((_page, jobs) => {
      for (const job of jobs) job.salaryText = '$100k';
      return Promise.resolve({ completed: 1, stopReason: null });
    });
    const result = await provider.fetch(makeSearch());
    expect(result.records.length).toBeGreaterThanOrEqual(1);
    expect((result.records[0] as { salaryText?: string }).salaryText).toBe(
      '$100k',
    );
  });

  it('aborts the fetch when two consecutive queries render no job cards and nothing was collected', async () => {
    vi.mocked(waitForContent).mockResolvedValue(false);
    vi.spyOn(
      provider as unknown as DicePrivateApi,
      'collectCards',
    ).mockResolvedValue([]);
    await expect(provider.fetch(makeSearch())).rejects.toThrow(
      /did not render any job listings/,
    );
    expect(vi.mocked(waitForContent)).toHaveBeenCalledTimes(2);
  });

  it('keeps running when a single query fails to render cards but a later one succeeds', async () => {
    let renderCount = 0;
    vi.mocked(waitForContent).mockImplementation(() => {
      renderCount++;
      return Promise.resolve(renderCount !== 1);
    });
    vi.spyOn(
      provider as unknown as DicePrivateApi,
      'collectCards',
    ).mockImplementation(() =>
      Promise.resolve([
        rawJob({
          jobId: `recovered-${String(renderCount)}`,
          title: 'Recovered',
          company: 'C',
          location: 'Remote',
          postingUrl: `https://dice.com/${String(renderCount)}`,
          employmentType: 'full-time',
        }),
      ]),
    );
    passThroughEnrich();
    const result = await provider.fetch(makeSearch());
    expect(result.complete).toBe(false);
    expect(result.completedQueries).toBe(2);
    expect(result.failedQueries).toBe(1);
    expect(result.records.length).toBe(2);
  });

  it('reports raw results once per card returned without double counting', async () => {
    vi.spyOn(
      provider as unknown as DicePrivateApi,
      'collectCards',
    ).mockResolvedValue([
      rawJob({
        jobId: 'single-raw-job',
        title: 'Single Raw',
        company: 'C',
        location: 'Remote',
        postingUrl: 'https://dice.com/single-raw',
        employmentType: 'full-time',
      }),
    ]);
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
          maxResults: 50,
          browserProfileDir: '/mock/dice-profile',
          keepBrowserOpen: false,
          debugMode: false,
        },
      }),
    );
    expect(result.queryDiagnostics?.[0]?.rawResultsReturned).toBe(1);
    expect(result.queryDiagnostics?.[0]?.duplicatesRemoved).toBe(0);
  });

  it('maps batched card extraction fields and deduplicates returned cards', async () => {
    const evaluate = vi.fn(() =>
      Promise.resolve([
        {
          jobId: 'batch-1',
          title: 'Systems Engineer',
          company: 'Example Co',
          location: 'Remote',
          postedDate: 'Today',
          salaryText: '$100,000',
          postingUrl: 'https://www.dice.com/jobs/1',
        },
        {
          jobId: 'batch-1',
          title: 'Duplicate Systems Engineer',
          company: 'Example Co',
          location: 'Remote',
          postedDate: 'Today',
          salaryText: '$100,000',
          postingUrl: 'https://www.dice.com/jobs/1',
        },
        {
          jobId: 'batch-2',
          title: 'Network Engineer',
          company: 'Other Co',
          location: 'Denver, CO',
          postedDate: 'Yesterday',
          salaryText: null,
          postingUrl: 'https://www.dice.com/jobs/2',
        },
      ]),
    );
    const page = detailPage({
      waitForSelector: vi.fn(() =>
        Promise.resolve(null),
      ) as unknown as Page['waitForSelector'],
      evaluate: evaluate as unknown as Page['evaluate'],
    });
    const cards = await (provider as unknown as DicePrivateApi).collectCards(
      page,
      2,
      () => undefined,
      Date.now() + 60_000,
    );

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      jobId: 'batch-1',
      title: 'Systems Engineer',
      company: 'Example Co',
      location: 'Remote',
      postedDate: 'Today',
      salaryText: '$100,000',
      postingUrl: 'https://www.dice.com/jobs/1',
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('uses at most two detail workers, preserves failed cards, and paces repeat visits', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const closePage = [
      vi.fn(() => Promise.resolve()),
      vi.fn(() => Promise.resolve()),
    ];
    const starts: number[][] = [[], []];
    const pages = [
      detailPage({
        close: closePage[0]!,
        goto: vi.fn(() => {
          starts[0]!.push(Date.now());
          return Promise.resolve(null);
        }),
      }),
      detailPage({
        close: closePage[1]!,
        goto: vi.fn(() => {
          starts[1]!.push(Date.now());
          return Promise.resolve(null);
        }),
      }),
    ];
    let activeDetails = 0;
    let peakDetails = 0;
    vi.mocked(extractJobDetail).mockImplementation(() => {
      activeDetails++;
      peakDetails = Math.max(peakDetails, activeDetails);
      return Promise.resolve().then(() => {
        activeDetails--;
        throw new Error('detail extraction failed');
      });
    });
    const jobs = [
      rawJob({
        jobId: 'keep-1',
        title: 'Original One',
        postingUrl: 'https://dice.com/1',
      }),
      rawJob({
        jobId: 'keep-2',
        title: 'Original Two',
        postingUrl: 'https://dice.com/2',
      }),
      rawJob({
        jobId: 'keep-3',
        title: 'Original Three',
        postingUrl: 'https://dice.com/3',
      }),
      rawJob({
        jobId: 'keep-4',
        title: 'Original Four',
        postingUrl: 'https://dice.com/4',
      }),
    ];

    const pending = (provider as unknown as DicePrivateApi).enrichWithDetails(
      detailContext(pages),
      jobs,
      () => undefined,
      Date.now() + 60_000,
    );
    await vi.advanceTimersByTimeAsync(2600);
    const outcome = await pending;

    expect(peakDetails).toBeLessThanOrEqual(2);
    expect(vi.mocked(extractJobDetail)).toHaveBeenCalledTimes(4);
    expect(jobs.map(({ title }) => title)).toEqual([
      'Original One',
      'Original Two',
      'Original Three',
      'Original Four',
    ]);
    expect(outcome).toEqual({ completed: 4, stopReason: null });
    expect(starts.every((workerStarts) => workerStarts.length === 2)).toBe(
      true,
    );
    expect(
      starts.every(
        (workerStarts) => workerStarts[1]! - workerStarts[0]! >= 2500,
      ),
    ).toBe(true);
    expect(closePage.every((close) => close.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it('stops detail starts at the deadline, returns cards, and closes worker pages', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const secondGoto = vi.fn(() => Promise.resolve(null));
    const closePage = [
      vi.fn(() => Promise.resolve()),
      vi.fn(() => Promise.resolve()),
    ];
    const pages = [
      detailPage({
        goto: vi.fn(() => {
          vi.setSystemTime(new Date('2026-01-01T00:00:00.200Z'));
          return Promise.resolve(null);
        }),
      }),
      detailPage({ goto: secondGoto, close: closePage[1]! }),
    ];
    pages[0]!.close = closePage[0]!;
    const jobs = [
      rawJob({ jobId: 'deadline-1', postingUrl: 'https://dice.com/1' }),
      rawJob({ jobId: 'deadline-2', postingUrl: 'https://dice.com/2' }),
    ];

    const outcome = await (
      provider as unknown as DicePrivateApi
    ).enrichWithDetails(
      detailContext(pages),
      jobs,
      () => undefined,
      Date.now() + 100,
    );

    expect(outcome.stopReason).toBe('request_budget');
    expect(secondGoto).not.toHaveBeenCalled();
    expect(closePage.every((close) => close.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it('stops starting detail requests after cancellation and closes worker pages', async () => {
    const closePage = [
      vi.fn(() => Promise.resolve()),
      vi.fn(() => Promise.resolve()),
    ];
    const visited: string[][] = [[], []];
    const pages = [0, 1].map((index) =>
      detailPage({
        close: closePage[index]!,
        goto: vi.fn((url: string) => {
          visited[index]!.push(url);
          return Promise.resolve(null);
        }),
      }),
    );
    const jobs = [
      rawJob({ jobId: 'cancel-1', postingUrl: 'https://dice.com/1' }),
      rawJob({ jobId: 'cancel-2', postingUrl: 'https://dice.com/2' }),
      rawJob({ jobId: 'cancel-3', postingUrl: 'https://dice.com/3' }),
    ];
    vi.mocked(extractJobDetail).mockImplementation(() => {
      provider.requestCancel();
      return Promise.resolve({
        description: null,
        salaryText: null,
        salaryMinimum: null,
        salaryMaximum: null,
        workplaceType: null,
        employmentType: null,
        postedDate: null,
        companyName: null,
        location: null,
        jobTitle: null,
        companyLogo: null,
        employmentDetails: [],
      });
    });

    const outcome = await (
      provider as unknown as DicePrivateApi
    ).enrichWithDetails(
      detailContext(pages),
      jobs,
      () => {
        if (
          (provider as unknown as { cancelRequested: boolean }).cancelRequested
        )
          throw new Error('Dice search cancelled');
      },
      Date.now() + 60_000,
    );

    expect(outcome.stopReason).toBe('cancelled');
    expect(vi.mocked(extractJobDetail)).toHaveBeenCalledTimes(1);
    expect(visited.flat()).not.toContain('https://dice.com/3');
    expect(closePage.every((close) => close.mock.calls.length === 1)).toBe(
      true,
    );
    (provider as unknown as { cancelRequested: boolean }).cancelRequested =
      false;
  });

  it('records queries skipped after the Dice fetch budget is exhausted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    vi.spyOn(
      provider as unknown as DicePrivateApi,
      'collectCards',
    ).mockImplementation(() => {
      vi.setSystemTime(new Date('2026-01-01T00:21:00.000Z'));
      return Promise.resolve([]);
    });
    passThroughEnrich();
    const result = await provider.fetch(makeSearch());
    expect(result.complete).toBe(false);
    expect(result.completedQueries).toBe(0);
    expect(result.failedQueries).toBe(0);
    expect(
      result.queryDiagnostics?.map((item) => item.terminationReason),
    ).toEqual(['request_budget', 'request_budget', 'request_budget']);
  });

  it('marks the run partial when the shared fetch budget stops detail enrichment', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    vi.spyOn(
      provider as unknown as DicePrivateApi,
      'collectCards',
    ).mockImplementation(() => {
      vi.setSystemTime(new Date('2026-01-01T00:21:00.000Z'));
      return Promise.resolve([
        rawJob({
          jobId: 'detail-budget-job',
          title: 'Detail Budget Job',
          company: 'C',
          location: 'Remote',
          postingUrl: 'https://dice.com/detail-budget-job',
        }),
      ]);
    });

    const result = await provider.fetch(
      makeSearch({
        configuration: {
          searchKeywords: 'Engineer',
          location: '',
          queries: [{ keywords: 'Engineer', location: '' }],
          remoteFilter: '',
          distance: 25,
          datePosted: 'month',
          maxResults: 50,
          browserProfileDir: '/mock/dice-profile',
          keepBrowserOpen: false,
          debugMode: false,
        },
      }),
    );

    expect(result.complete).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.records).toHaveLength(1);
    expect((result.records[0] as { jobId?: string }).jobId).toBe(
      'detail-budget-job',
    );
    expect(result.queryDiagnostics?.[0]?.terminationReason).toBe(
      'request_budget',
    );
    expect(result.queryDiagnostics?.[0]?.errors).toContain(
      'Dice fetch time budget exhausted before all job details were enriched',
    );
  });
});
