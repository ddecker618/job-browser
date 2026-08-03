import type { Page } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/providers/linkedIn/browserSession.js', () => ({
  navigateWithRetry: vi.fn(() => Promise.resolve(undefined)),
}));

import {
  ensureHandshakeLogin,
  isHandshakeAuthenticationUrl,
} from '../src/providers/handshake/browserSession.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Handshake browser session', () => {
  it('recognizes Handshake and institution authentication routes', () => {
    expect(
      isHandshakeAuthenticationUrl('https://app.joinhandshake.com/access'),
    ).toBe(true);
    expect(isHandshakeAuthenticationUrl('https://login.example.edu/saml')).toBe(
      true,
    );
    expect(
      isHandshakeAuthenticationUrl('https://app.joinhandshake.com/job-search'),
    ).toBe(false);
  });

  it('reuses an existing authenticated session without waiting', async () => {
    const state = { authenticated: true };
    const { page, waitForTimeout } = mockPage(state);

    await expect(ensureHandshakeLogin(page, 5_000)).resolves.toBe(true);
    expect(waitForTimeout).not.toHaveBeenCalled();
  });

  it('waits for the user to finish the first school/SSO login', async () => {
    const state = { authenticated: false };
    const { page, waitForTimeout } = mockPage(state, () => {
      state.authenticated = true;
    });

    await expect(ensureHandshakeLogin(page, 5_000)).resolves.toBe(true);
    expect(waitForTimeout).toHaveBeenCalledWith(1_000);
  });

  it('honors cancellation while waiting for login', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      ensureHandshakeLogin(
        mockPage({ authenticated: false }).page,
        5_000,
        controller.signal,
      ),
    ).rejects.toThrow('Handshake search cancelled');
  });
});

function mockPage(
  state: { authenticated: boolean },
  afterWait?: () => void,
): { page: Page; waitForTimeout: ReturnType<typeof vi.fn> } {
  const waitForTimeout = vi.fn(() => {
    afterWait?.();
    return Promise.resolve(undefined);
  });
  const page = {
    url: vi.fn(() =>
      state.authenticated
        ? 'https://app.joinhandshake.com/job-search'
        : 'https://app.joinhandshake.com/access',
    ),
    locator: vi.fn(() => ({
      count: vi.fn(() => Promise.resolve(state.authenticated ? 1 : 0)),
    })),
    evaluate: vi.fn(() => Promise.resolve(undefined)),
    waitForTimeout,
  } as unknown as Page;
  return { page, waitForTimeout };
}
