import { describe, expect, it } from 'vitest';

import type { Page } from 'playwright';
import { waitForContent } from '../src/providers/linkedIn/browserSession.js';

interface FakeSelector {
  selector: string;
  resolveAfterPolls?: number;
  throwFirst?: boolean;
}

function fakePage(selectors: FakeSelector[]): {
  page: Page;
  pollCount: (selector: string) => number;
} {
  const polls = new Map<string, number>();
  const page = {
    $: (selector: string) => {
      const poll = (polls.get(selector) ?? 0) + 1;
      polls.set(selector, poll);
      const spec = selectors.find((item) => item.selector === selector);
      if (spec === undefined) return null;
      if (spec.throwFirst && poll === 1)
        throw new Error('navigation in progress');
      if (
        spec.resolveAfterPolls !== undefined &&
        poll < spec.resolveAfterPolls
      ) {
        return null;
      }
      return {};
    },
  } as unknown as Page;
  return { page, pollCount: (selector) => polls.get(selector) ?? 0 };
}

describe('waitForContent', () => {
  it('resolves immediately when the selector is already present', async () => {
    const { page } = fakePage([{ selector: '[data-testid="job-card"]' }]);
    const started = Date.now();
    await expect(
      waitForContent(page, ['[data-testid="job-card"]'], 2000, 50),
    ).resolves.toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('checks every selector in the list', async () => {
    const { page } = fakePage([{ selector: '#fallback' }]);
    await expect(
      waitForContent(
        page,
        ['[data-testid="jobDetailStructuredData"]', '#fallback'],
        2000,
        50,
      ),
    ).resolves.toBe(true);
  });

  it('proceeds as soon as content appears instead of sleeping the full budget', async () => {
    const { page, pollCount } = fakePage([
      {
        selector: '[data-testid="job-detail-header-card"]',
        resolveAfterPolls: 4,
      },
    ]);
    const started = Date.now();
    await expect(
      waitForContent(
        page,
        ['[data-testid="job-detail-header-card"]'],
        4000,
        50,
      ),
    ).resolves.toBe(true);
    const elapsed = Date.now() - started;
    expect(pollCount('[data-testid="job-detail-header-card"]')).toBe(4);
    expect(elapsed).toBeGreaterThanOrEqual(120);
    expect(elapsed).toBeLessThan(4000);
  });

  it('returns false without exceeding the timeout when content never appears', async () => {
    const { page } = fakePage([
      {
        selector: '[data-testid="job-detail-header-card"]',
        resolveAfterPolls: Infinity,
      },
    ]);
    const started = Date.now();
    await expect(
      waitForContent(page, ['[data-testid="job-detail-header-card"]'], 200, 50),
    ).resolves.toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('tolerates page.$ throwing mid-navigation and keeps polling', async () => {
    const { page } = fakePage([
      {
        selector: '[data-testid="job-card"]',
        throwFirst: true,
        resolveAfterPolls: 3,
      },
    ]);
    await expect(
      waitForContent(page, ['[data-testid="job-card"]'], 4000, 50),
    ).resolves.toBe(true);
  });
});
