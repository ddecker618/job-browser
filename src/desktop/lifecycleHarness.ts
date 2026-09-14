/**
 * Test-only stdin/stdout protocol used by `scripts/lifecycle-harness.ts`
 * to drive the Electron main process through deterministic scenarios.
 *
 * The desktop logger writes to a file, not stderr, on Windows GUI
 * Electron. To make the backend URL discoverable without depending on
 * stderr parsing, the main process writes a `harness-state.json` file
 * with the current backend URL, close-to-tray setting, and other
 * observable state. The harness reads this file in addition to the
 * command/response protocol.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

import type { LifecycleController } from './lifecycleController.js';

export interface LifecycleHarnessHooks {
  onTrayCreated?: () => void;
  onStartupComplete?: () => void;
}

interface HarnessCommandBase {
  id: number;
}

interface GetStateCommand extends HarnessCommandBase {
  op: 'get_state';
}

interface SimulateWindowCloseCommand extends HarnessCommandBase {
  op: 'simulate_window_close';
}

interface SimulateSafeExitCommand extends HarnessCommandBase {
  op: 'simulate_safe_exit';
}

interface SimulateTrayPauseCommand extends HarnessCommandBase {
  op: 'simulate_tray_pause';
}

interface SimulateAppQuitCommand extends HarnessCommandBase {
  op: 'simulate_app_quit';
}

interface SimulateQuerySessionEndCommand extends HarnessCommandBase {
  op: 'simulate_query_session_end';
}

interface SimulateSessionEndCommand extends HarnessCommandBase {
  op: 'simulate_session_end';
}

interface RefreshTrayCommand extends HarnessCommandBase {
  op: 'refresh_tray';
}

interface SetSourceAttentionCommand extends HarnessCommandBase {
  op: 'set_source_attention';
  enabled?: boolean;
  health?: 'healthy' | 'credentials-required' | 'failed' | 'never-run';
}

interface CloseCommand extends HarnessCommandBase {
  op: 'close';
}

type HarnessCommand =
  | GetStateCommand
  | SimulateWindowCloseCommand
  | SimulateSafeExitCommand
  | SimulateTrayPauseCommand
  | SimulateAppQuitCommand
  | SimulateQuerySessionEndCommand
  | SimulateSessionEndCommand
  | RefreshTrayCommand
  | SetSourceAttentionCommand
  | CloseCommand;

interface StateResponse {
  ok: true;
  id: number;
  state: {
    backendUrl: string | null;
    quitRequested: boolean;
    closeToTray: boolean;
    trayCreated: boolean;
    windowExists: boolean;
    windowVisible: boolean;
    backendRunning: boolean;
    startupComplete: boolean;
    schedulerEnabled: boolean;
    employerDiscoveryEnabled: boolean;
    lastKnownPersisted: boolean | null;
    pendingWrites: number;
  };
}

interface AckResponse {
  ok: true;
  id: number;
}

interface ErrorResponse {
  ok: false;
  id: number;
  error: string;
}

type HarnessResponse = StateResponse | AckResponse | ErrorResponse;

interface DispatcherDeps {
  getLifecycle: () => LifecycleController | null;
  getWindow: () => Electron.BrowserWindow | null;
  getTray: () => { isCreated: boolean } | null;
  getBackendRunning: () => boolean;
  getStartupComplete: () => boolean;
  getSchedulerEnabled: () => Promise<boolean>;
  getEmployerDiscoveryEnabled: () => Promise<boolean>;
  setSourceAttention: (
    enabled: boolean,
    health: 'healthy' | 'credentials-required' | 'failed' | 'never-run',
  ) => Promise<void>;
  getPendingWrites: () => number;
  refreshTray: () => Promise<void>;
  /** Snapshot of the current observable harness state (backend URL, quit flag, etc.) */
  getHarnessSnapshot: () => Omit<
    HarnessStateFile,
    'trayCreated' | 'pendingWrites'
  >;
}

export interface HarnessStateFile {
  backendUrl: string | null;
  closeToTray: boolean;
  trayCreated: boolean;
  quitRequested: boolean;
  windowExists: boolean;
  windowVisible: boolean;
  startupComplete: boolean;
  schedulerEnabled: boolean;
  employerDiscoveryEnabled: boolean;
  lastKnownPersisted: boolean | null;
  pendingWrites: number;
}

/**
 * Writes a JSON file the harness reads to discover the backend URL and
 * other observable state. The desktop logger writes to a log file
 * rather than stderr, so the harness needs an explicit, durable
 * channel to observe the backend URL.
 */
export function writeHarnessState(
  state: HarnessStateFile,
  fileName = 'harness-state.json',
): string {
  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true });
  const path = join(userData, fileName);
  writeFileSync(path, `${JSON.stringify(state)}\n`, 'utf8');
  return path;
}

/**
 * Reads the most recent harness state file the main process wrote.
 * Returns null if the file is missing, unreadable, or malformed.
 */
export function readHarnessState(
  fileName = 'harness-state.json',
): HarnessStateFile | null {
  const path = join(app.getPath('userData'), fileName);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as HarnessStateFile;
  } catch {
    return null;
  }
}

export function installLifecycleHarnessHooks(
  getInitialState: () => Omit<HarnessStateFile, 'pendingWrites'>,
): LifecycleHarnessHooks {
  return {
    onTrayCreated: () => {
      try {
        writeHarnessState({
          ...getInitialState(),
          trayCreated: true,
          pendingWrites: 0,
        });
      } catch {
        // Ignore: harness may have torn down.
      }
    },
    onStartupComplete: () => {
      try {
        writeHarnessState({
          ...getInitialState(),
          startupComplete: true,
          trayCreated: true,
          pendingWrites: 0,
        });
      } catch {
        // Ignore: harness may have torn down.
      }
    },
  };
}

export function attachHarnessStdio(deps: DispatcherDeps): () => void {
  // Windows Electron is a GUI-subsystem binary and may not have a
  // console attached, so `process.stdout.write` can be silently dropped.
  // Use a file-based protocol: the harness writes one JSON command per
  // line to `<userData>/harness-cmd.jsonl` and polls for one JSON
  // response per command at `<userData>/harness-resp-<id>.json`.
  const cmdPath = join(app.getPath('userData'), 'harness-cmd.jsonl');
  const respDir = app.getPath('userData');
  let closed = false;
  const seen = new Set<number>();
  const send = (response: HarnessResponse): void => {
    if (closed) return;
    const path = join(respDir, `harness-resp-${String(response.id)}.json`);
    try {
      writeFileSync(path, `${JSON.stringify(response)}\n`, 'utf8');
    } catch {
      // Ignore: harness may have torn down.
    }
  };
  const tick = setInterval(() => {
    if (closed) return;
    if (!existsSync(cmdPath)) return;
    let raw: string;
    try {
      raw = readFileSync(cmdPath, 'utf8');
    } catch {
      return;
    }
    const lines = raw.split('\n');
    // Keep the last partial line for the next tick.
    const last = lines.pop() ?? '';
    const remainingLines = last.length > 0 ? [last] : [];
    // Clear the command file so we don't re-process.
    try {
      writeFileSync(cmdPath, '', 'utf8');
    } catch {
      // Ignore.
    }
    for (const line of [...lines, ...remainingLines]) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let command: HarnessCommand;
      try {
        command = JSON.parse(trimmed) as HarnessCommand;
      } catch (error) {
        send({ ok: false, id: -1, error: `invalid JSON: ${String(error)}` });
        continue;
      }
      if (seen.has(command.id)) continue;
      seen.add(command.id);
      void dispatch(command, deps, send).catch((error: unknown) => {
        send({
          ok: false,
          id: command.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }, 50);
  return () => {
    closed = true;
    clearInterval(tick);
    try {
      unlinkSync(cmdPath);
    } catch {
      // Ignore.
    }
  };
}

async function dispatch(
  command: HarnessCommand,
  deps: DispatcherDeps,
  send: (response: HarnessResponse) => void,
): Promise<void> {
  switch (command.op) {
    case 'get_state': {
      const lifecycle = deps.getLifecycle();
      const window = deps.getWindow();
      // Refresh the on-disk state file so the harness can observe
      // current values even if it was started before this command ran.
      try {
        writeHarnessState({
          ...deps.getHarnessSnapshot(),
          trayCreated: deps.getTray()?.isCreated ?? false,
          windowExists: window !== null,
          windowVisible: window?.isVisible() ?? false,
          schedulerEnabled: await deps.getSchedulerEnabled(),
          employerDiscoveryEnabled: await deps.getEmployerDiscoveryEnabled(),
          lastKnownPersisted: lifecycle?.getLastKnownPersisted() ?? null,
          pendingWrites: deps.getPendingWrites(),
        });
      } catch {
        // Ignore: state file is best-effort.
      }
      send({
        ok: true,
        id: command.id,
        state: {
          backendUrl: deps.getHarnessSnapshot().backendUrl,
          quitRequested: lifecycle?.isQuitRequested() ?? false,
          closeToTray: lifecycle?.getCloseToTray() ?? true,
          trayCreated: deps.getTray()?.isCreated ?? false,
          windowExists: window !== null,
          windowVisible: window?.isVisible() ?? false,
          backendRunning: deps.getBackendRunning(),
          startupComplete: deps.getStartupComplete(),
          schedulerEnabled: await deps.getSchedulerEnabled(),
          employerDiscoveryEnabled: await deps.getEmployerDiscoveryEnabled(),
          lastKnownPersisted: lifecycle?.getLastKnownPersisted() ?? null,
          pendingWrites: deps.getPendingWrites(),
        },
      });
      return;
    }
    case 'simulate_window_close': {
      const window = deps.getWindow();
      if (window === null) {
        send({ ok: false, id: command.id, error: 'window not created' });
        return;
      }
      window.close();
      send({ ok: true, id: command.id });
      return;
    }
    case 'simulate_safe_exit': {
      const lifecycle = deps.getLifecycle();
      lifecycle?.requestQuit();
      send({ ok: true, id: command.id });
      return;
    }
    case 'simulate_tray_pause': {
      const lifecycle = deps.getLifecycle();
      if (lifecycle === null) {
        send({ ok: false, id: command.id, error: 'lifecycle not ready' });
        return;
      }
      await lifecycle.requestTrayRefresh(async () => {
        await deps.refreshTray();
      });
      send({ ok: true, id: command.id });
      return;
    }
    case 'simulate_app_quit': {
      // Direct app.quit without going through requestQuit. Tests that
      // the before-quit handler still coordinates cleanup.
      app.quit();
      send({ ok: true, id: command.id });
      return;
    }
    case 'simulate_query_session_end': {
      const lifecycle = deps.getLifecycle();
      if (lifecycle === null) {
        send({ ok: false, id: command.id, error: 'lifecycle not ready' });
        return;
      }
      void lifecycle.onWindowsSessionEnd(true, undefined);
      send({ ok: true, id: command.id });
      return;
    }
    case 'simulate_session_end': {
      const lifecycle = deps.getLifecycle();
      if (lifecycle === null) {
        send({ ok: false, id: command.id, error: 'lifecycle not ready' });
        return;
      }
      void lifecycle.onWindowsSessionEnd(false, undefined);
      send({ ok: true, id: command.id });
      return;
    }
    case 'refresh_tray': {
      await deps.refreshTray();
      send({ ok: true, id: command.id });
      return;
    }
    case 'set_source_attention': {
      await deps.setSourceAttention(
        command.enabled ?? true,
        command.health ?? 'credentials-required',
      );
      send({ ok: true, id: command.id });
      return;
    }
    case 'close': {
      // Graceful self-shutdown from the harness; the main process exits
      // so the harness can clean up.
      app.quit();
      send({ ok: true, id: command.id });
      return;
    }
    default: {
      const fallback = command as { id?: unknown; op?: unknown };
      send({
        ok: false,
        id: typeof fallback.id === 'number' ? fallback.id : -1,
        error: `unknown op: ${String(fallback.op)}`,
      });
      return;
    }
  }
}
