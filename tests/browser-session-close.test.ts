import { describe, expect, it } from 'vitest';

import type { Browser, BrowserContext } from 'playwright';
import {
  closeSession,
  DEFAULT_SESSION_CLOSE_TIMEOUT_MS,
} from '../src/providers/linkedIn/browserSession.js';
import type { BrowserSession } from '../src/providers/linkedIn/browserSession.js';

function fakeSession(overrides: Partial<BrowserSession> = {}): {
  session: BrowserSession;
  shutdown: {
    contextCloseCalls: number;
    browserCloseCalls: number;
    killed: number;
  };
} {
  const shutdown = {
    contextCloseCalls: 0,
    browserCloseCalls: 0,
    killed: 0,
  };
  const session: BrowserSession = {
    context: {} as BrowserContext,
    page: {} as never,
    profileDir: 'test-profile',
    persistentContext: {
      close: () => {
        shutdown.contextCloseCalls += 1;
        return Promise.resolve();
      },
    } as unknown as BrowserContext,
    underlyingBrowser: {
      close: () => {
        shutdown.browserCloseCalls += 1;
        return Promise.resolve();
      },
      process: () => ({
        kill: () => {
          shutdown.killed += 1;
        },
      }),
    } as unknown as Browser,
    ...overrides,
  };
  return { session, shutdown };
}

describe('closeSession (bounded browser session close)', () => {
  it('resolves quickly for a healthy browser and does not force-kill', async () => {
    const { session, shutdown } = fakeSession();
    await closeSession(session, 200);
    expect(shutdown.contextCloseCalls).toBe(1);
    expect(shutdown.browserCloseCalls).toBe(1);
    expect(shutdown.killed).toBe(0);
  });

  it('ignores close failures and never throws for a healthy browser', async () => {
    const { session, shutdown } = fakeSession({
      persistentContext: {
        close: () => Promise.reject(new Error('context already closed')),
      } as unknown as BrowserContext,
      underlyingBrowser: {
        close: () => Promise.reject(new Error('browser gone')),
        process: () => null,
      } as unknown as Browser,
    });
    await expect(closeSession(session, 200)).resolves.toBeUndefined();
    expect(shutdown.killed).toBe(0);
  });

  it('force-kills the Playwright-owned browser when graceful close hangs', async () => {
    const { session, shutdown } = fakeSession({
      persistentContext: {
        close: () => new Promise(() => undefined),
      } as unknown as BrowserContext,
      underlyingBrowser: {
        close: () => new Promise(() => undefined),
        process: () => ({
          kill: () => {
            shutdown.killed += 1;
          },
        }),
      } as unknown as Browser,
    });
    const started = Date.now();
    await closeSession(session, 100);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(5000);
    expect(shutdown.killed).toBe(1);
  });

  it('still returns when there is no child process to kill', async () => {
    const { session, shutdown } = fakeSession({
      persistentContext: {
        close: () => new Promise(() => undefined),
      } as unknown as BrowserContext,
      underlyingBrowser: {
        close: () => new Promise(() => undefined),
        process: () => null,
      } as unknown as Browser,
    });
    await expect(closeSession(session, 50)).resolves.toBeUndefined();
    expect(shutdown.killed).toBe(0);
  });

  it('normalizes a vanished process handle without throwing', async () => {
    const { session, shutdown } = fakeSession({
      persistentContext: {
        close: () => new Promise(() => undefined),
      } as unknown as BrowserContext,
      underlyingBrowser: {
        close: () => new Promise(() => undefined),
        process: () => ({
          kill: () => {
            throw new Error('process already gone');
          },
        }),
      } as unknown as Browser,
    });
    await expect(closeSession(session, 50)).resolves.toBeUndefined();
    expect(shutdown.killed).toBe(0);
  });

  it('defaults to the exported bounded timeout for production callers', () => {
    expect(DEFAULT_SESSION_CLOSE_TIMEOUT_MS).toBe(10_000);
  });
});
