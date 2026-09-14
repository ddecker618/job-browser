/**
 * Coordinates the desktop lifecycle: close-to-tray setting, the quit
 * flag, repeated-exit handling, write serialization, and the bounded
 * tray-refresh loop. All Electron-touching code (tray, window, app.quit)
 * is reached through injected dependencies so the coordination itself
 * is exercised in a Node test environment without spinning up Electron.
 */

import { closeAction, type CloseAction } from './desktopLifecycle.js';

export interface TrayLike {
  isCreated: boolean;
  destroy(): void;
  refresh(): Promise<void>;
}

export interface WindowLike {
  isDestroyed(): boolean;
  hide(): void;
  show(): void;
  focus(): void;
}

export interface AppLike {
  quit(): void;
  exit(code?: number): void;
}

export interface LogLike {
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

export interface BackendLike {
  current: unknown;
  stop(): Promise<void>;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface LifecycleControllerOptions {
  backend: BackendLike;
  tray: () => TrayLike | null;
  window: () => WindowLike | null;
  app: AppLike;
  log: LogLike;
  fetchImpl?: FetchLike;
  /** Bounded time (ms) for the best-effort shutdown await. */
  shutdownTimeoutMs?: number;
  /** Interval (ms) for the bounded tray-refresh loop. 0 disables the loop. */
  trayRefreshIntervalMs?: number;
}

export interface SetCloseToTrayResult {
  closeToTray: boolean;
  persisted: boolean;
}

/**
 * Default `app.quit()` adapter. Tests inject a stub.
 */
export function defaultAppQuit(): void {
  // Imported lazily so test code can inject a stub before the Electron app
  // module is resolved.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as { app: AppLike };
  app.quit();
}

interface PendingWrite {
  value: boolean;
  previous: boolean;
  resolve: (result: SetCloseToTrayResult) => void;
  reject: (error: unknown) => void;
}

export class LifecycleController {
  private closeToTray = true;
  private quitRequestedFlag = false;
  private shutdownPromise: Promise<void> | null = null;
  private trayCreatedFlag = false;
  private trayRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private trayRefreshInFlight = false;
  private trayRefreshStopped = false;
  private writeQueue: PendingWrite[] = [];
  private writeInFlight = false;
  private lastKnownPersisted: boolean | null = null;

  public constructor(private readonly options: LifecycleControllerOptions) {
    this.trayCreatedFlag = options.tray()?.isCreated ?? false;
  }

  public isQuitRequested(): boolean {
    return this.quitRequestedFlag;
  }

  public getCloseToTray(): boolean {
    return this.closeToTray;
  }

  public isTrayAvailable(): boolean {
    return this.options.tray()?.isCreated === true;
  }

  public isWindowOpen(): boolean {
    const w = this.options.window();
    return w !== null && !w.isDestroyed();
  }

  public getLastKnownPersisted(): boolean | null {
    return this.lastKnownPersisted;
  }

  public setTrayCreated(created: boolean): void {
    this.trayCreatedFlag = created;
    if (!created) this.stopTrayRefreshLoop();
  }

  public setCloseToTray(value: boolean): void {
    this.closeToTray = value;
  }

  public async loadCloseToTrayFromBackend(fetchImpl: FetchLike): Promise<void> {
    if (this.options.backend.current === null) return;
    try {
      const response = await fetchImpl('/api/desktop-settings');
      if (!response.ok) return;
      const body = (await response.json()) as { closeToTray?: unknown };
      if (typeof body.closeToTray === 'boolean') {
        this.closeToTray = body.closeToTray;
        this.lastKnownPersisted = body.closeToTray;
      }
    } catch {
      // Keep the in-memory default; the user can toggle later.
    }
  }

  /**
   * Persists the close-to-tray setting. Concurrent calls are serialized
   * so the backend sees writes in the order they were submitted and the
   * final in-memory + persisted state agree. On any failure (network,
   * non-2xx, unavailable backend) the actual previous in-memory value is
   * restored and `persisted: false` is returned so the UI can surface an
   * error rather than claim success.
   */
  public persistCloseToTray(
    value: boolean,
    fetchImpl: FetchLike,
  ): Promise<SetCloseToTrayResult> {
    return new Promise<SetCloseToTrayResult>((resolve, reject) => {
      this.writeQueue.push({
        value,
        previous: this.closeToTray,
        resolve,
        reject,
      });
      void this.drainWriteQueue(fetchImpl);
    });
  }

  private async drainWriteQueue(fetchImpl: FetchLike): Promise<void> {
    if (this.writeInFlight) return;
    this.writeInFlight = true;
    try {
      while (this.writeQueue.length > 0) {
        const pending = this.writeQueue.shift();
        if (pending === undefined) break;
        try {
          const result = await this.applyWrite(pending, fetchImpl);
          pending.resolve(result);
        } catch (error) {
          pending.reject(error);
        }
      }
    } finally {
      this.writeInFlight = false;
    }
  }

  private async applyWrite(
    pending: PendingWrite,
    fetchImpl: FetchLike,
  ): Promise<SetCloseToTrayResult> {
    // Snapshot the actual previous in-memory value at the moment this
    // write starts. A later write may have already mutated closeToTray;
    // using its captured `previous` ensures the rollback restores what
    // the caller actually overwrote.
    this.closeToTray = pending.value;
    if (this.options.backend.current === null) {
      this.closeToTray = pending.previous;
      return { closeToTray: pending.previous, persisted: false };
    }
    try {
      const response = await fetchImpl('/api/desktop-settings', {
        method: 'PUT',
        body: JSON.stringify({ closeToTray: pending.value }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        this.closeToTray = pending.previous;
        this.options.log.warn('closeToTray backend rejected update', {
          status: response.status,
        });
        return { closeToTray: pending.previous, persisted: false };
      }
      const body = (await response.json()) as { closeToTray?: unknown };
      if (typeof body.closeToTray === 'boolean') {
        this.closeToTray = body.closeToTray;
        this.lastKnownPersisted = body.closeToTray;
      } else {
        this.lastKnownPersisted = pending.value;
      }
      return { closeToTray: this.closeToTray, persisted: true };
    } catch (error) {
      this.closeToTray = pending.previous;
      this.options.log.warn('closeToTray backend unreachable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { closeToTray: pending.previous, persisted: false };
    }
  }

  public closeAction(): CloseAction {
    return closeAction({
      closeToTray: this.closeToTray,
      quitRequested: this.quitRequestedFlag,
      trayAvailable: this.isTrayAvailable(),
    });
  }

  /**
   * Mark quit as requested and tear down the tray. Does NOT call
   * `app.quit()` — the caller decides whether to invoke Electron's
   * `before-quit` path (preferred) or `app.exit()` (force). The single
   * source of truth for "should we be exiting" lives in the
   * `before-quit` handler, so direct `app.quit()` callers can route
   * here too without bypassing coordination.
   */
  public markQuitRequested(): void {
    if (this.quitRequestedFlag) return;
    this.quitRequestedFlag = true;
    this.options.tray()?.destroy();
    this.stopTrayRefreshLoop();
  }

  /**
   * Convenience: mark the quit and ask the host app to begin the quit
   * sequence. Idempotent with `markQuitRequested`; the `app.quit()` call
   * is gated so a second invocation does not re-fire `before-quit`.
   */
  public requestQuit(): void {
    const alreadyQuitting = this.quitRequestedFlag;
    this.markQuitRequested();
    if (!alreadyQuitting) {
      this.options.app.quit();
    }
  }

  /**
   * Bounded shutdown of the backend. Multiple callers share the same
   * promise so repeated quit attempts do not race the cleanup. Returns
   * `true` when the backend stop completed before the timeout, `false`
   * when the timeout fired — callers must not treat a timeout-forced
   * exit as a graceful cleanup.
   */
  public async shutdown(): Promise<{ graceful: boolean }> {
    this.markQuitRequested();
    const existing = this.shutdownPromise as Promise<{
      graceful: boolean;
    }> | null;
    if (existing !== null) {
      return await existing;
    }
    const timeoutMs = this.options.shutdownTimeoutMs ?? 5_000;
    const timedOut = { value: false };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = this.options.backend.stop();
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut.value = true;
        this.options.log.warn(
          'Backend shutdown did not complete before timeout',
        );
        resolve();
      }, timeoutMs);
    });
    // Attach the timer to the stop promise so we still wait for `stop`
    // to finish; the timeout just flags the shutdown as non-graceful.
    void timeout;
    // Always await the actual backend stop so the DB is fully closed
    // before the controller returns. The timeout only flags the
    // shutdown as non-graceful; the stop still runs to completion so
    // writes are flushed and the DB handle is released. Without this,
    // a timed-out shutdown would let `finalizeExit` call `app.exit`
    // before `backend.stop()` finished, dropping any pending writes
    // (notably `closeToTray`) and risking a corrupted DB on the next
    // process start.
    const promise = stop.finally(() => {
      if (timer !== null) clearTimeout(timer);
      this.shutdownPromise = null;
    });
    this.shutdownPromise = promise;
    await promise;
    return { graceful: !timedOut.value };
  }

  /**
   * Finalize the quit: run bounded backend shutdown, then `app.exit`
   * unconditionally. Used by the `before-quit` handler so the process
   * actually terminates even when the OS keeps the quit pending.
   */
  public async finalizeExit(): Promise<void> {
    const { graceful } = await this.shutdown();
    if (!graceful) {
      this.options.log.warn(
        'Shutdown timed out; forcing app.exit without graceful cleanup completion',
      );
    }
    this.options.app.exit(0);
  }

  /**
   * Best-effort bounded cleanup for Windows shutdown. `querySessionEnd`
   * can preventDefault and wait for cleanup; `sessionEnd` cannot.
   * After cleanup, the process exits unconditionally so Windows can
   * proceed with shutdown.
   */
  public async onWindowsSessionEnd(
    canDelay: boolean,
    fetchImpl: FetchLike | undefined,
  ): Promise<void> {
    this.options.log.warn(
      canDelay
        ? 'Windows session-end requested; beginning bounded cleanup'
        : 'Windows session-end imminent; last-chance cleanup',
    );
    await this.shutdown();
    if (fetchImpl !== undefined) {
      try {
        const handle = this.options.backend;
        if (handle.current !== null) {
          await Promise.race([
            handle.stop(),
            new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
          ]);
        }
      } catch {
        // Swallow: Windows will terminate the process regardless.
      }
    }
    this.options.app.exit(0);
  }

  /**
   * Begin a bounded tray-refresh loop. Each tick asks the tray to
   * refresh via the host's `getSummary` provider; in-flight refreshes
   * are guarded so out-of-order updates cannot interleave.
   */
  public startTrayRefreshLoop(
    refresh: () => Promise<void>,
    intervalMs?: number,
  ): void {
    const ms = intervalMs ?? this.options.trayRefreshIntervalMs ?? 5_000;
    if (ms <= 0) return;
    this.trayRefreshStopped = false;
    if (this.trayRefreshTimer !== null) return;
    this.trayRefreshTimer = setInterval(() => {
      void this.requestTrayRefresh(refresh);
    }, ms);
  }

  public stopTrayRefreshLoop(): void {
    this.trayRefreshStopped = true;
    if (this.trayRefreshTimer !== null) {
      clearInterval(this.trayRefreshTimer);
      this.trayRefreshTimer = null;
    }
  }

  /**
   * Request an out-of-band tray refresh. Skipped while shutdown is in
   * flight or after destroy. Concurrent calls coalesce: only one refresh
   * runs at a time, and the next tick re-evaluates.
   */
  public async requestTrayRefresh(refresh: () => Promise<void>): Promise<void> {
    if (this.trayRefreshStopped) return;
    if (this.quitRequestedFlag) return;
    if (this.trayRefreshInFlight) return;
    this.trayRefreshInFlight = true;
    try {
      await refresh();
    } catch (error) {
      this.options.log.warn('Tray refresh failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.trayRefreshInFlight = false;
    }
  }
}
