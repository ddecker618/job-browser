import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';

vi.mock('../src/providers/linkedIn/browserSession.js', () => ({
  launchBrowserSession: vi.fn(async () => ({
    page: {
      evaluate: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      url: vi.fn(() => 'https://example.com/search?q=mock'),
      goto: vi.fn(async () => undefined),
      waitForLoadState: vi.fn(async () => undefined),
      textContent: vi.fn(async () => ''),
    } as unknown as Page,
    context: {} as any,
    profileDir: '/mock/profile',
    persistentContext: {} as any,
    underlyingBrowser: {} as any,
  })),
  closeBrowserSession: vi.fn(async () => undefined),
  navigateWithRetry: vi.fn(async () => undefined),
  takeDiagnosticScreenshot: vi.fn(async () => undefined),
}));

import { runBrowserSearch } from '../src/providers/browserJobBoard.js';
import type { BrowserJobRecord } from '../src/providers/browserJobBoard.js';

interface TestCard extends BrowserJobRecord {
  jobId: string;
  title: string;
  company: string;
  postingUrl: string;
}

function makeCard(jobId: string, title = 'Engineer', company = 'Test Inc'): TestCard {
  return {
    jobId,
    title,
    company,
    location: 'Remote',
    salaryText: null,
    salaryMinimum: null,
    salaryMaximum: null,
    description: null,
    requirements: null,
    preferredQualifications: null,
    postingUrl: `https://example.com/job/${jobId}`,
    postedDate: null,
    employmentType: 'full-time',
    workplaceType: null,
    seniorityLevel: null,
  };
}

function makeOptions(overrides: Partial<Parameters<typeof runBrowserSearch>[0]> = {}): Parameters<typeof runBrowserSearch>[0] {
  return {
    providerName: 'test-provider',
    profileDir: '/mock/profile',
    keepBrowserOpen: false,
    queries: ['query-1', 'query-2', 'query-3'],
    buildSearchUrl: (q: string) => `https://example.com/search?q=${q}`,
    extractCards: vi.fn(async () => []),
    enrichCard: vi.fn(
      async (_page: Page, card: BrowserJobRecord) =>
        card as TestCard,
    ),
    ...overrides,
  };
}

describe('runBrowserSearch query budgeting', () => {
  it('A: first query reaches limit and query 2 still executes', async () => {
    let callCount = 0;
    const options = makeOptions({
      queries: ['q1', 'q2'],
      maxResultsPerQuery: 10,
      maxUniqueResults: 200,
      extractCards: vi.fn(async () => {
        callCount++;
        if (callCount <= 1) {
          const cards: TestCard[] = [];
          for (let i = 0; i < 10; i++) cards.push(makeCard(`q1-${i}`));
          return cards;
        }
        return [makeCard('q2-1')];
      }),
    });
    const result = await runBrowserSearch(options);
    expect(result.completedQueries).toBe(2);
    expect(result.failedQueries).toBe(0);
    expect(result.records.length).toBeGreaterThan(10);
  });

  it('B: multiple queries each contribute unique results', async () => {
    let callCount = 0;
    const options = makeOptions({
      queries: ['q1', 'q2', 'q3'],
      maxResultsPerQuery: 10,
      maxUniqueResults: 200,
      extractCards: vi.fn(async () => {
        callCount++;
        const cards: TestCard[] = [];
        for (let i = 0; i < 10; i++) cards.push(makeCard(`${callCount}-${i}`));
        return cards;
      }),
    });
    const result = await runBrowserSearch(options);
    expect(result.completedQueries).toBe(3);
    expect(result.records.length).toBe(30);
  });

  it('C: duplicate results from later queries are removed', async () => {
    const sharedCards: TestCard[] = [];
    for (let i = 0; i < 50; i++) sharedCards.push(makeCard(`shared-${i}`));
    const newCards: TestCard[] = [];
    for (let i = 0; i < 50; i++) newCards.push(makeCard(`unique-${i}`));
    const allCards = [...sharedCards, ...newCards];
    const options = makeOptions({
      queries: ['q1', 'q2'],
      maxResultsPerQuery: 200,
      maxUniqueResults: 200,
      extractCards: vi.fn(async () => allCards),
    });
    const result = await runBrowserSearch(options);
    const ids = new Set(result.records.map((r) => r.jobId));
    expect(ids.size).toBe(result.records.length);
    expect(result.records.length).toBe(100);
  });

  it('D: one failed query does not abort remaining queries', async () => {
    let callCount = 0;
    const options = makeOptions({
      queries: ['q1', 'q2', 'q3'],
      maxResultsPerQuery: 10,
      extractCards: vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Query failed');
        const cards: TestCard[] = [];
        for (let i = 0; i < 5; i++) cards.push(makeCard(`${callCount}-${i}`));
        return cards;
      }),
    });
    const result = await runBrowserSearch(options);
    expect(result.failedQueries).toBe(1);
    expect(result.completedQueries + result.failedQueries).toBe(3);
    expect(result.records.length).toBeGreaterThanOrEqual(10);
  });

  it('E: per-query timeout records an error but preserves completed query results', async () => {
    const options = makeOptions({
      queries: ['q1', 'q2'],
      maxResultsPerQuery: 10,
      queryTimeoutMs: 50,
      extractCards: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 200));
        return [makeCard('slow-card')];
      }),
    });
    const result = await runBrowserSearch(options);
    expect(result.completedQueries + result.failedQueries).toBe(2);
    const timeoutDiag = result.queryDiagnostics.find(
      (d) => d.terminationReason === 'timeout',
    );
    expect(timeoutDiag).toBeDefined();
    expect(timeoutDiag!.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('F: maxQueriesPerProvider stops execution', async () => {
    let callCount = 0;
    const options = makeOptions({
      queries: ['q1', 'q2', 'q3', 'q4', 'q5'],
      maxQueriesPerProvider: 3,
      maxResultsPerQuery: 5,
      extractCards: vi.fn(async () => {
        callCount++;
        const cards: TestCard[] = [];
        for (let i = 0; i < 5; i++) cards.push(makeCard(`${callCount}-${i}`));
        return cards;
      }),
    });
    const result = await runBrowserSearch(options);
    expect(result.completedQueries).toBe(3);
    expect(result.plannedQueries).toBe(3);
    expect(result.records.length).toBe(15);
  });

  it('G: maxUniqueResults stops after global budget is reached', async () => {
    const options = makeOptions({
      queries: ['q1', 'q2', 'q3'],
      maxResultsPerQuery: 10,
      maxUniqueResults: 25,
      extractCards: vi.fn(async () => {
        const cards: TestCard[] = [];
        for (let i = 0; i < 10; i++) cards.push(makeCard(`${cards.length}-${i}`));
        return cards;
      }).mockImplementationOnce(async () => {
        const cards: TestCard[] = [];
        for (let i = 0; i < 20; i++) cards.push(makeCard(`q1-${i}`));
        return cards;
      }),
    });
    const result = await runBrowserSearch(options);
    expect(result.records.length).toBeLessThanOrEqual(40);
    expect(result.records.length).toBeGreaterThanOrEqual(20);
  });

  it('H: query diagnostics report correct fields', async () => {
    const options = makeOptions({
      queries: ['q1', 'q2'],
      maxResultsPerQuery: 3,
      extractCards: vi.fn(async () => {
        return [makeCard('card-1'), makeCard('card-2')];
      }),
    });
    const result = await runBrowserSearch(options);
    expect(result.queryDiagnostics).toHaveLength(2);
    expect(result.queryDiagnostics.some((d) => d.uniqueResultsRetained > 0)).toBe(
      true,
    );
    for (const diag of result.queryDiagnostics) {
      expect(diag.provider).toBe('test-provider');
      expect(['exhausted_results', 'per_query_limit']).toContain(
        diag.terminationReason,
      );
      expect(typeof diag.durationMs).toBe('number');
    }
  });
});
