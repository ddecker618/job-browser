import type { Browser, BrowserContext, Page } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/providers/linkedIn/browserSession.js', () => ({
  launchBrowserSession: vi.fn(() => ({
    page: {
      goto: vi.fn(() => Promise.resolve(null)),
      evaluate: vi.fn(() => Promise.resolve(undefined)),
      waitForTimeout: vi.fn(() => Promise.resolve(undefined)),
    } as unknown as Page,
    context: {} as BrowserContext,
    profileDir: '/mock/linkedin-profile',
    persistentContext: {} as BrowserContext,
    underlyingBrowser: {} as Browser,
  })),
  closeBrowserSession: vi.fn(() => Promise.resolve(undefined)),
  waitForLogin: vi.fn(() => Promise.resolve(true)),
  navigateWithRetry: vi.fn(() => Promise.resolve(undefined)),
  waitForContent: vi.fn(() => Promise.resolve(true)),
  waitForCardCount: vi.fn(() => Promise.resolve(false)),
  isLoggedIn: vi.fn(() => Promise.resolve(true)),
  takeDiagnosticScreenshot: vi.fn(() => Promise.resolve(null)),
  detectSecurityChallenge: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('../src/providers/linkedIn/resultCardExtractor.js', () => ({
  extractJobCards: vi.fn(() => Promise.resolve([])),
  waitForSearchResults: vi.fn(() => Promise.resolve(false)),
}));

import { closeBrowserSession } from '../src/providers/linkedIn/browserSession.js';
import { LinkedInProvider } from '../src/providers/linkedIn.provider.js';

describe('LinkedIn completion safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never reports an all-zero unverified extraction as a complete snapshot', async () => {
    const provider = new LinkedInProvider();
    const search = await provider.search(
      {
        query: 'systems administrator',
        location: null,
        remoteOnly: false,
        limit: 25,
      },
      {
        fixtureOnly: false,
        configuration: {
          queries: [
            { keywords: 'systems administrator', location: '' },
            { keywords: 'network administrator', location: '' },
          ],
          keepBrowserOpen: false,
        },
      },
    );

    const result = await provider.fetch(search);

    expect(result.records).toHaveLength(0);
    expect(result.complete).toBe(false);
    expect(result.truncated).toBe(true);
    expect(closeBrowserSession).toHaveBeenCalledTimes(1);
  });
});
