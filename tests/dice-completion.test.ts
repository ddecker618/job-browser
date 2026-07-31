import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/providers/linkedIn/browserSession.js', () => ({
  launchBrowserSession: vi.fn(async () => ({
    page: {
      evaluate: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      url: vi.fn(() => 'https://www.dice.com/jobs?q=Engineer'),
      goto: vi.fn(async () => undefined),
      waitForLoadState: vi.fn(async () => undefined),
      textContent: vi.fn(async () => ''),
      $: vi.fn(async () => ({})),
    } as unknown as any,
    context: {} as any,
    profileDir: '/mock/profile',
    persistentContext: {} as any,
    underlyingBrowser: {} as any,
  })),
  closeBrowserSession: vi.fn(async () => undefined),
  navigateWithRetry: vi.fn(async () => undefined),
  takeDiagnosticScreenshot: vi.fn(async () => undefined),
}));

import { DiceProvider } from '../src/providers/dice.provider.js';
import type { ProviderSearch } from '../src/models/discovery.js';

describe('Dice completion semantics', () => {
  const provider = new DiceProvider();

  function makeSearch(overrides: Partial<ProviderSearch> = {}): ProviderSearch {
    return {
      request: { query: 'Engineer', location: null, remoteOnly: false, limit: 50, maxAgeDays: 30 },
      target: 'https://www.dice.com/jobs',
      fixturePath: null,
      configuration: {
        searchKeywords: 'Engineer',
        location: '',
        queries: [{ keywords: 'Engineer', location: '' }, { keywords: 'Developer', location: '' }, { keywords: 'Architect', location: '' }],
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
    return vi.spyOn(provider as any, 'enrichWithDetails').mockImplementation(
      async (_page: unknown, ...args: unknown[]) =>
        args[0] as Array<Record<string, unknown>>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('all queries complete returns complete=true', async () => {
    vi.spyOn(provider as any, 'collectCards').mockResolvedValue([
      { jobId: 'dice-job-1', title: 'Job 1', company: 'C', location: 'Remote', postingUrl: 'https://dice.com/1', employmentType: 'full-time', postedDate: null },
      { jobId: 'dice-job-2', title: 'Job 2', company: 'C', location: 'Remote', postingUrl: 'https://dice.com/2', employmentType: 'full-time', postedDate: null },
    ]);
    passThroughEnrich();
    const result = await provider.fetch(makeSearch());
    expect(result.complete).toBe(true);
    expect(result.completedQueries).toBe(3);
    expect(result.failedQueries).toBe(0);
  });

  it('one failing query returns complete=false', async () => {
    let callCount = 0;
    vi.spyOn(provider as any, 'collectCards').mockImplementation(async () => {
      callCount++;
      if (callCount === 2) throw new Error('Collect failed');
      return [
        { jobId: `dice-job-${callCount}`, title: `Job ${callCount}`, company: 'C', location: 'Remote', postingUrl: `https://dice.com/${callCount}`, employmentType: 'full-time', postedDate: null },
      ];
    });
    passThroughEnrich();
    const result = await provider.fetch(makeSearch());
    expect(result.complete).toBe(false);
    expect(result.completedQueries).toBe(2);
    expect(result.failedQueries).toBe(1);
  });

  it('truncated query is still complete=true when all queries ran', async () => {
    vi.spyOn(provider as any, 'collectCards').mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({
        jobId: `dice-job-${i}`,
        title: `Job ${i}`,
        company: 'C',
        location: 'Remote',
        postingUrl: `https://dice.com/${i}`,
        employmentType: 'full-time',
        postedDate: null,
      })),
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
    vi.spyOn(provider as any, 'collectCards').mockImplementation(async () => {
      callCount++;
      return [
        { jobId: 'shared-job', title: 'Shared', company: 'C', location: 'Remote', postingUrl: 'https://dice.com/shared', employmentType: 'full-time', postedDate: null },
        { jobId: `unique-${callCount}`, title: `Unique ${callCount}`, company: 'C', location: 'Remote', postingUrl: `https://dice.com/unique-${callCount}`, employmentType: 'full-time', postedDate: null },
      ];
    });
    passThroughEnrich();
    const result = await provider.fetch(makeSearch());
    const uniqueIds = new Set(result.records.map((r: any) => r.jobId));
    expect(uniqueIds.size).toBe(result.records.length);
    expect(uniqueIds.has('shared-job')).toBe(true);
  });

  it('returns records after enrichment', async () => {
    vi.spyOn(provider as any, 'collectCards').mockResolvedValue([
      { jobId: 'dice-final-job', title: 'Final Job', company: 'C', location: 'Remote', postingUrl: 'https://dice.com/final', employmentType: 'full-time', postedDate: null },
    ]);
    vi.spyOn(provider as any, 'enrichWithDetails').mockImplementation(
      async (_page: unknown, ...args: unknown[]) =>
        (args[0] as Array<Record<string, unknown>>).map((j) => ({
          ...j,
          salaryText: '$100k',
        })),
    );
    const result = await provider.fetch(makeSearch());
    expect(result.records.length).toBeGreaterThanOrEqual(1);
    expect((result.records[0] as Record<string, unknown>)?.['salaryText']).toBe(
      '$100k',
    );
  });
});
