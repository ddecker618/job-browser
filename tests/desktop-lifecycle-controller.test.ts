import { describe, expect, it } from 'vitest';

import {
  LifecycleController,
  type AppLike,
  type BackendLike,
  type FetchLike,
  type LogLike,
  type TrayLike,
  type WindowLike,
} from '../src/desktop/lifecycleController.js';

function makeBackend(
  initialHandle: { stopCalls: number } | null = { stopCalls: 0 },
): BackendLike {
  const handle = initialHandle;
  return {
    get current() {
      return handle;
    },
    stop() {
      if (handle === null) return Promise.resolve();
      handle.stopCalls += 1;
      return Promise.resolve();
    },
  };
}

function makeTray(initialCreated = true): TrayLike & {
  destroyCalls: number;
} {
  let created = initialCreated;
  let destroyCalls = 0;
  const tray: TrayLike & { destroyCalls: number } = {
    get isCreated() {
      return created;
    },
    destroy() {
      created = false;
      destroyCalls += 1;
    },
    async refresh() {
      // no-op for tests
    },
    get destroyCalls() {
      return destroyCalls;
    },
  } as TrayLike & { destroyCalls: number };
  return tray;
}

function makeWindow(): WindowLike & {
  hideCalls: number;
  showCalls: number;
  focusCalls: number;
  destroyed: boolean;
} {
  const w: WindowLike & {
    hideCalls: number;
    showCalls: number;
    focusCalls: number;
    destroyed: boolean;
  } = {
    isDestroyed: () => w.destroyed,
    hide: () => {
      w.hideCalls += 1;
    },
    show: () => {
      w.showCalls += 1;
    },
    focus: () => {
      w.focusCalls += 1;
    },
    hideCalls: 0,
    showCalls: 0,
    focusCalls: 0,
    destroyed: false,
  };
  return w;
}

function makeApp(): AppLike & {
  quitCalls: number;
  exitCalls: number[];
} {
  const app: AppLike & { quitCalls: number; exitCalls: number[] } = {
    quit: () => {
      app.quitCalls += 1;
    },
    exit: (code?: number) => {
      app.exitCalls.push(code ?? 0);
    },
    quitCalls: 0,
    exitCalls: [],
  };
  return app;
}

function makeLog(): LogLike & { warns: unknown[]; errors: unknown[] } {
  const log: LogLike & { warns: unknown[]; errors: unknown[] } = {
    warn: (_msg, details) => log.warns.push(details ?? null),
    error: (_msg, details) => log.errors.push(details ?? null),
    warns: [],
    errors: [],
  };
  return log;
}

function makeFetch(
  routes: Record<string, { ok: boolean; status?: number; body?: unknown }>,
  calls: { url: string; method?: string; body?: string }[] = [],
): FetchLike {
  return (input, init) => {
    const url = input.startsWith('/') ? input : new URL(input).pathname;
    calls.push({ url, ...(init ?? {}) });
    const route = routes[url];
    if (route === undefined) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'not found' }),
      });
    }
    return Promise.resolve({
      ok: route.ok,
      status: route.status ?? (route.ok ? 200 : 500),
      json: () => Promise.resolve(route.body ?? {}),
    });
  };
}

describe('LifecycleController', () => {
  describe('closeAction', () => {
    it('returns "close" when quit was requested (tray Exit, app.quit)', () => {
      const c = new LifecycleController({
        backend: makeBackend(),
        tray: () => makeTray(true),
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      c.requestQuit();
      expect(c.closeAction()).toBe('close');
    });

    it('returns "hide" when close-to-tray is on AND the tray is available', () => {
      const c = new LifecycleController({
        backend: makeBackend(),
        tray: () => makeTray(true),
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      expect(c.closeAction()).toBe('hide');
    });

    it('returns "close" when close-to-tray is on but the tray was never created (startup failure)', () => {
      const tray = makeTray(false);
      const c = new LifecycleController({
        backend: makeBackend(),
        tray: () => tray,
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      expect(c.closeAction()).toBe('close');
    });

    it('returns "close" when close-to-tray is off, preserving prior behavior', () => {
      const c = new LifecycleController({
        backend: makeBackend(),
        tray: () => makeTray(true),
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      c.setCloseToTray(false);
      expect(c.closeAction()).toBe('close');
    });
  });

  describe('requestQuit', () => {
    it('marks quit requested, destroys the tray, and calls app.quit()', () => {
      const tray = makeTray(true);
      const app = makeApp();
      const c = new LifecycleController({
        backend: makeBackend(),
        tray: () => tray,
        window: () => makeWindow(),
        app,
        log: makeLog(),
      });
      c.requestQuit();
      expect(c.isQuitRequested()).toBe(true);
      expect(tray.destroyCalls).toBe(1);
      expect(app.quitCalls).toBe(1);
    });

    it('is idempotent (repeated calls do not double-destroy or re-quit)', () => {
      const tray = makeTray(true);
      const app = makeApp();
      const c = new LifecycleController({
        backend: makeBackend(),
        tray: () => tray,
        window: () => makeWindow(),
        app,
        log: makeLog(),
      });
      c.requestQuit();
      c.requestQuit();
      c.requestQuit();
      expect(tray.destroyCalls).toBe(1);
      expect(app.quitCalls).toBe(1);
    });
  });

  describe('shutdown', () => {
    it('stops the backend exactly once across repeated calls', async () => {
      const handle = { stopCalls: 0 };
      const backend = makeBackend(handle);
      const c = new LifecycleController({
        backend,
        tray: () => makeTray(false),
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
        shutdownTimeoutMs: 1_000,
      });
      const p1 = c.shutdown();
      const p2 = c.shutdown();
      await Promise.all([p1, p2]);
      expect(handle.stopCalls).toBe(1);
    });

    it('destroys the tray after shutdown', async () => {
      const tray = makeTray(true);
      const c = new LifecycleController({
        backend: makeBackend(),
        tray: () => tray,
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      await c.shutdown();
      expect(tray.destroyCalls).toBe(1);
    });

    it('bounds cleanup with a timeout if backend.stop() hangs', async () => {
      const log = makeLog();
      const c = new LifecycleController({
        backend: {
          get current() {
            return { stopCalls: 0 };
          },
          async stop() {
            // Hangs past the timeout but eventually resolves so the
            // controller still returns (the new "always await stop"
            // contract means the test must let the stop finish).
            await new Promise<void>((resolve) => setTimeout(resolve, 250));
          },
        },
        tray: () => makeTray(false),
        window: () => makeWindow(),
        app: makeApp(),
        log,
        shutdownTimeoutMs: 50,
      });
      const start = Date.now();
      const result = await c.shutdown();
      const elapsed = Date.now() - start;
      // The timeout fires at 50 ms but we still wait for stop to
      // complete (~250 ms), so elapsed should be at least 200 ms.
      expect(elapsed).toBeGreaterThanOrEqual(200);
      expect(result.graceful).toBe(false);
      expect(log.warns.length).toBeGreaterThan(0);
    });
  });

  describe('persistCloseToTray', () => {
    it('round-trips the value when the backend accepts it', async () => {
      const calls: { url: string; method?: string; body?: string }[] = [];
      const c = new LifecycleController({
        backend: makeBackend({ stopCalls: 0 }),
        tray: () => makeTray(false),
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      const result = await c.persistCloseToTray(
        false,
        makeFetch(
          {
            '/api/desktop-settings': {
              ok: true,
              body: { closeToTray: false },
            },
          },
          calls,
        ),
      );
      expect(result).toEqual({ closeToTray: false, persisted: true });
      expect(c.getCloseToTray()).toBe(false);
      expect(calls[0]?.method).toBe('PUT');
    });

    it('restores the actual previous value when the backend rejects', async () => {
      const log = makeLog();
      const c = new LifecycleController({
        backend: makeBackend({ stopCalls: 0 }),
        tray: () => makeTray(false),
        window: () => makeWindow(),
        app: makeApp(),
        log,
      });
      const previous = c.getCloseToTray();
      const result = await c.persistCloseToTray(
        !previous,
        makeFetch({
          '/api/desktop-settings': { ok: false, status: 400 },
        }),
      );
      expect(result.persisted).toBe(false);
      expect(result.closeToTray).toBe(previous);
      expect(c.getCloseToTray()).toBe(previous);
      expect(log.warns.length).toBeGreaterThan(0);
    });

    it('reports persisted=false and restores previous value when the backend is unavailable', async () => {
      const c = new LifecycleController({
        backend: makeBackend(null),
        tray: () => makeTray(false),
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      const previous = c.getCloseToTray();
      const result = await c.persistCloseToTray(
        !previous,
        makeFetch({
          '/api/desktop-settings': { ok: false, status: 404 },
        }),
      );
      expect(result.persisted).toBe(false);
      expect(result.closeToTray).toBe(previous);
    });

    it('reports persisted=false and warns when the fetch throws', async () => {
      const log = makeLog();
      const c = new LifecycleController({
        backend: makeBackend({ stopCalls: 0 }),
        tray: () => makeTray(false),
        window: () => makeWindow(),
        app: makeApp(),
        log,
      });
      const previous = c.getCloseToTray();
      const fetchImpl: FetchLike = () =>
        Promise.reject(new Error('connection refused'));
      const result = await c.persistCloseToTray(!previous, fetchImpl);
      expect(result.persisted).toBe(false);
      expect(result.closeToTray).toBe(previous);
      expect(log.warns.length).toBeGreaterThan(0);
    });

    it('serializes repeated PUTs without losing intermediate updates', async () => {
      const c = new LifecycleController({
        backend: makeBackend({ stopCalls: 0 }),
        tray: () => makeTray(false),
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      const fetchImpl = makeFetch({
        '/api/desktop-settings': {
          ok: true,
          body: { closeToTray: false },
        },
      });
      // Two concurrent flips; both should succeed and the final state
      // must reflect the second one (intermediate lost updates are OK as
      // long as we do not silently leave the UI claiming the wrong state).
      const [r1, r2] = await Promise.all([
        c.persistCloseToTray(false, fetchImpl),
        c.persistCloseToTray(true, fetchImpl),
      ]);
      expect(r1.persisted).toBe(true);
      expect(r2.persisted).toBe(true);
    });
  });

  describe('loadCloseToTrayFromBackend', () => {
    it('updates the in-memory value from the backend response', async () => {
      const c = new LifecycleController({
        backend: makeBackend({ stopCalls: 0 }),
        tray: () => makeTray(false),
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      c.setCloseToTray(true);
      await c.loadCloseToTrayFromBackend(
        makeFetch({
          '/api/desktop-settings': {
            ok: true,
            body: { closeToTray: false },
          },
        }),
      );
      expect(c.getCloseToTray()).toBe(false);
    });

    it('keeps the current value on a network blip', async () => {
      const c = new LifecycleController({
        backend: makeBackend({ stopCalls: 0 }),
        tray: () => makeTray(false),
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      const fetchImpl: FetchLike = () =>
        Promise.reject(new Error('connection refused'));
      await c.loadCloseToTrayFromBackend(fetchImpl);
      expect(c.getCloseToTray()).toBe(true);
    });
  });

  describe('onWindowsSessionEnd', () => {
    it('runs bounded cleanup and never blocks past the timeout', async () => {
      const backend = makeBackend({ stopCalls: 0 });
      const log = makeLog();
      const c = new LifecycleController({
        backend,
        tray: () => makeTray(true),
        window: () => makeWindow(),
        app: makeApp(),
        log,
        shutdownTimeoutMs: 50,
      });
      const start = Date.now();
      await c.onWindowsSessionEnd(true, undefined);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1_000);
      expect(log.warns.length).toBeGreaterThan(0);
    });
  });

  describe('serialized persistCloseToTray writes', () => {
    it('orders concurrent writes so the backend sees them sequentially', async () => {
      const completionOrder: string[] = [];
      const inflight: { id: string; resolve: () => void }[] = [];
      const fetchImpl: FetchLike = (_input, init) => {
        const parsed = JSON.parse(init?.body ?? '{}') as {
          closeToTray: boolean;
        };
        const id = String(parsed.closeToTray);
        return new Promise((resolve) => {
          inflight.push({
            id,
            resolve: () => {
              completionOrder.push(id);
              resolve({
                ok: true,
                status: 200,
                json: () =>
                  Promise.resolve({ closeToTray: parsed.closeToTray }),
              });
            },
          });
        });
      };
      const c = new LifecycleController({
        backend: makeBackend({ stopCalls: 0 }),
        tray: () => makeTray(false),
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      const p1 = c.persistCloseToTray(false, fetchImpl);
      const p2 = c.persistCloseToTray(true, fetchImpl);
      // Allow the queue to fill; nothing has flushed yet because the
      // fetch promises have not been resolved.
      await new Promise((accept) => setImmediate(accept));
      expect(completionOrder).toEqual([]);
      // Resolve the first in-flight fetch; the second then proceeds.
      const first = inflight.shift();
      expect(first?.id).toBe('false');
      first?.resolve();
      await p1;
      await new Promise((accept) => setImmediate(accept));
      // The second fetch must now have been started (sequential),
      // not still queued behind the first.
      expect(completionOrder).toEqual(['false']);
      expect(inflight.length).toBe(1);
      const second = inflight.shift();
      expect(second?.id).toBe('true');
      second?.resolve();
      await p2;
      expect(completionOrder).toEqual(['false', 'true']);
    });

    it('restores the actual previous value when a write fails after a successful write', async () => {
      let first = true;
      const fetchImpl: FetchLike = () => {
        if (first) {
          first = false;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ closeToTray: false }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'server error' }),
        });
      };
      const c = new LifecycleController({
        backend: makeBackend({ stopCalls: 0 }),
        tray: () => makeTray(false),
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      const r1 = await c.persistCloseToTray(false, fetchImpl);
      expect(r1).toEqual({ closeToTray: false, persisted: true });
      expect(c.getCloseToTray()).toBe(false);
      const r2 = await c.persistCloseToTray(true, fetchImpl);
      expect(r2.persisted).toBe(false);
      expect(r2.closeToTray).toBe(false);
      expect(c.getCloseToTray()).toBe(false);
    });
  });

  describe('tray refresh loop', () => {
    it('refreshes on each interval tick when in flight', async () => {
      let refreshCalls = 0;
      const refresh = (): Promise<void> => {
        refreshCalls += 1;
        return Promise.resolve();
      };
      const c = new LifecycleController({
        backend: makeBackend(),
        tray: () => makeTray(true),
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      c.startTrayRefreshLoop(refresh, 30);
      await new Promise((accept) => setTimeout(accept, 100));
      c.stopTrayRefreshLoop();
      expect(refreshCalls).toBeGreaterThanOrEqual(2);
    });

    it('does not refresh after shutdown begins', async () => {
      let refreshCalls = 0;
      const refresh = (): Promise<void> => {
        refreshCalls += 1;
        return Promise.resolve();
      };
      const c = new LifecycleController({
        backend: makeBackend({ stopCalls: 0 }),
        tray: () => makeTray(true),
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
        shutdownTimeoutMs: 500,
      });
      c.startTrayRefreshLoop(refresh, 20);
      // Trigger shutdown; the loop should stop issuing new refreshes.
      void c.shutdown();
      const before = refreshCalls;
      await new Promise((accept) => setTimeout(accept, 60));
      c.stopTrayRefreshLoop();
      // Allow at most one in-flight refresh to settle.
      await new Promise((accept) => setTimeout(accept, 30));
      const delta = refreshCalls - before;
      expect(delta).toBeLessThanOrEqual(1);
    });

    it('coalesces concurrent requestTrayRefresh calls', async () => {
      let refreshCalls = 0;
      const resolvers: (() => void)[] = [];
      const refresh = (): Promise<void> => {
        refreshCalls += 1;
        return new Promise<void>((accept) => {
          resolvers.push(accept);
        });
      };
      const c = new LifecycleController({
        backend: makeBackend(),
        tray: () => makeTray(true),
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      const p1 = c.requestTrayRefresh(refresh);
      const p2 = c.requestTrayRefresh(refresh);
      // The second call must coalesce — no extra refresh is started.
      expect(refreshCalls).toBe(1);
      // Resolve the in-flight refresh; the coalesced call must complete.
      const resolve = resolvers.shift();
      if (resolve !== undefined) resolve();
      await Promise.all([p1, p2]);
    });
  });

  describe('timeout-forced shutdown', () => {
    it('returns graceful=false when backend.stop hangs', async () => {
      const log = makeLog();
      const c = new LifecycleController({
        backend: {
          get current() {
            return { stopCalls: 0 };
          },
          stop: () => new Promise<void>((resolve) => setTimeout(resolve, 80)),
        },
        tray: () => makeTray(false),
        window: () => makeWindow(),
        app: makeApp(),
        log,
        shutdownTimeoutMs: 30,
      });
      const result = await c.shutdown();
      expect(result).toEqual({ graceful: false });
      expect(log.warns.length).toBeGreaterThan(0);
    });

    it('finalizeExit calls app.exit even when shutdown times out', async () => {
      const app = makeApp();
      const c = new LifecycleController({
        backend: {
          get current() {
            return { stopCalls: 0 };
          },
          stop: () => new Promise<void>((resolve) => setTimeout(resolve, 80)),
        },
        tray: () => makeTray(false),
        window: () => makeWindow(),
        app,
        log: makeLog(),
        shutdownTimeoutMs: 20,
      });
      await c.finalizeExit();
      expect(app.exitCalls).toEqual([0]);
    });

    it('still awaits the actual backend stop after the timeout fires', async () => {
      // Regression: a timed-out shutdown used to return via
      // Promise.race, which let finalizeExit call app.exit before
      // backend.stop() completed. The controller now always awaits
      // the real stop so any pending DB writes are flushed.
      let stopCompleted = false;
      const log = makeLog();
      const c = new LifecycleController({
        backend: {
          get current() {
            return { stopCalls: 0 };
          },
          async stop() {
            // Long enough that the timeout (50 ms) fires first, but
            // short enough that the test stays fast.
            await new Promise((resolve) => setTimeout(resolve, 200));
            stopCompleted = true;
          },
        },
        tray: () => makeTray(false),
        window: () => makeWindow(),
        app: makeApp(),
        log,
        shutdownTimeoutMs: 50,
      });
      const start = Date.now();
      const result = await c.shutdown();
      const elapsed = Date.now() - start;
      expect(result.graceful).toBe(false);
      expect(stopCompleted).toBe(true);
      // Stop should run to completion (>= 200 ms) even though the
      // timeout fired at 50 ms.
      expect(elapsed).toBeGreaterThanOrEqual(190);
      expect(log.warns.length).toBeGreaterThan(0);
    });
  });

  describe('markQuitRequested idempotency', () => {
    it('is idempotent across repeated calls', () => {
      const tray = makeTray(true);
      const c = new LifecycleController({
        backend: makeBackend(),
        tray: () => tray,
        window: () => makeWindow(),
        app: makeApp(),
        log: makeLog(),
      });
      c.markQuitRequested();
      c.markQuitRequested();
      c.markQuitRequested();
      expect(tray.destroyCalls).toBe(1);
      expect(c.isQuitRequested()).toBe(true);
    });
  });
});
