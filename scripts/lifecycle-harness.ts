/**
 * Fixture-based Electron lifecycle harness.
 *
 * Spawns the real `main.ts` entry point under Electron with
 * `JOB_BROWSER_LIFECYCLE_TEST=1` and a fresh temporary user-data
 * directory per scenario. Communicates via a file-based protocol:
 *
 *   - Harness writes one JSON command per line to
 *     `<userData>/harness-cmd.jsonl`.
 *   - Electron main process polls the file, dispatches the command, and
 *     writes a JSON response to `<userData>/harness-resp-<id>.json`.
 *
 * The file-based protocol works on all platforms, including Windows
 * where Electron's main process is a GUI-subsystem binary and may not
 * have a console attached for stdout piping.
 *
 * No live discovery is performed: the fixture uses the `builtin`
 * provider that ships with the project. The discovery scheduler can be
 * exercised through the pause toggle without contacting the network.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  backupCurrentNativeBinary,
  installElectronNativeDependencies,
  restoreNativeBinaryFromBackup,
  restoreNodeNativeDependencies,
} from './native-dependencies.js';

interface HarnessStateResponse {
  ok: boolean;
  id: number;
  state?: {
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
  error?: string;
}

interface PendingRequest {
  resolve: (value: HarnessStateResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class HarnessClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly responses = new Map<number, HarnessStateResponse>();
  private readonly userData: string;
  private readonly cmdPath: string;
  private readonly respDir: string;
  public readonly child: ChildProcessWithoutNullStreams;
  public lastBackendUrl: string | null = null;

  public constructor(
    child: ChildProcessWithoutNullStreams,
    userData: string,
  ) {
    this.child = child;
    this.userData = userData;
    this.cmdPath = join(userData, 'harness-cmd.jsonl');
    this.respDir = userData;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // The desktop logger emits JSON lines like:
      //   {"timestamp":"...","message":"Backend started","url":"http://127.0.0.1:1234",...}
      // The regex accepts both JSON ("url":"http://...") and the legacy
      // plain (url="http://...") shapes so the harness is robust to
      // logger changes.
      const match = chunk.match(
        /"url"\s*:\s*"(https?:\/\/127\.0\.0\.1:\d+)"|url=("?)(https?:\/\/127\.0\.0\.1:\d+)\2/,
      );
      if (match !== null) {
        const url = (match[1] ?? match[3]) ?? null;
        if (url !== null) this.lastBackendUrl = url;
      }
      if (process.env['JOB_BROWSER_LIFECYCLE_VERBOSE'] === '1') {
        process.stderr.write(`[electron] ${chunk}`);
      }
    });
    // Poll for response files written by the Electron main process.
    const poll = setInterval(() => {
      if (!existsSync(this.respDir)) return;
      for (const entry of readdirSync(this.respDir)) {
        const match = entry.match(/^harness-resp-(\d+)\.json$/);
        if (match === null) continue;
        const id = Number(match[1]);
        if (this.pending.has(id) && !this.responses.has(id)) {
          try {
            const body = JSON.parse(
              readResponseFile(join(this.respDir, entry)),
            ) as HarnessStateResponse;
            this.responses.set(id, body);
            unlinkSync(join(this.respDir, entry));
            const request = this.pending.get(id);
            if (request !== undefined) {
              clearTimeout(request.timer);
              this.pending.delete(id);
              if (body.ok) request.resolve(body);
              else request.reject(new Error(body.error ?? 'harness error'));
            }
          } catch {
            // Ignore malformed files.
          }
        }
      }
    }, 50);
    child.once('exit', () => clearInterval(poll));
  }

  public async send(
    op: string,
    timeoutMs = 10_000,
    extra: Record<string, unknown> = {},
  ): Promise<HarnessStateResponse> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<HarnessStateResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`Timeout waiting for response to op=${op} (id=${id})`),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const command = `${JSON.stringify({ id, op, ...extra })}\n`;
      writeFileSync(this.cmdPath, command, { flag: 'a' });
    });
  }

  public async waitForReady(timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // Prefer the on-disk state file written by the main process: the
      // desktop logger writes to a file, not stderr, on Windows GUI
      // Electron. The state file also gives us the backend URL directly.
      const fileState = readHarnessStateFile(this.userData);
      if (fileState !== null && fileState.backendUrl !== null) {
        this.lastBackendUrl = fileState.backendUrl;
        if (fileState.startupComplete) return;
        // Startup-failure path: the tray was created but the backend
        // never started. The harness can drive the scenario as soon
        // as the tray is available and the failure page is showing.
        if (fileState.trayCreated && !this.lastBackendUrl.includes('null')) {
          // No-op; the get_state path below is the source of truth.
        }
      }
      try {
        const state = await this.send('get_state', 2_000);
        if (state.ok && state.state) {
          // Normal startup: backend up, ready.
          if (
            state.state.startupComplete &&
            state.state.backendUrl !== null
          ) {
            this.lastBackendUrl = state.state.backendUrl;
            return;
          }
          // Forced startup-failure: tray created, backend never came up.
          if (
            state.state.trayCreated &&
            state.state.backendRunning === false
          ) {
            return;
          }
        }
      } catch {
        // Keep polling; the Electron process may not have started yet.
      }
      await new Promise((accept) => setTimeout(accept, 250));
    }
    throw new Error(
      `Electron lifecycle harness did not become ready within ${String(timeoutMs)}ms`,
    );
  }

  public async backendPort(): Promise<number> {
    const fromFile = readHarnessStateFile(this.userData);
    if (fromFile?.backendUrl !== null && fromFile?.backendUrl !== undefined) {
      this.lastBackendUrl = fromFile.backendUrl;
    }
    if (this.lastBackendUrl !== null) {
      return Number(new URL(this.lastBackendUrl).port);
    }
    throw new Error('Backend URL not yet captured from harness state file');
  }

  public async backendUrl(): Promise<string> {
    const fromFile = readHarnessStateFile(this.userData);
    if (fromFile?.backendUrl !== null && fromFile?.backendUrl !== undefined) {
      this.lastBackendUrl = fromFile.backendUrl;
    }
    if (this.lastBackendUrl !== null) return this.lastBackendUrl;
    throw new Error('Backend URL not yet captured from harness state file');
  }
}

function readHarnessStateFile(userData: string): {
  backendUrl: string | null;
  startupComplete: boolean;
  trayCreated: boolean;
  quitRequested: boolean;
} | null {
  const path = join(userData, 'harness-state.json');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as {
      backendUrl?: unknown;
      startupComplete?: unknown;
      trayCreated?: unknown;
      quitRequested?: unknown;
    };
    return {
      backendUrl: typeof parsed.backendUrl === 'string' ? parsed.backendUrl : null,
      startupComplete: parsed.startupComplete === true,
      trayCreated: parsed.trayCreated === true,
      quitRequested: parsed.quitRequested === true,
    };
  } catch {
    return null;
  }
}

function readResponseFile(path: string): string {
  return readFileSync(path, 'utf8');
}

interface ScenarioResult {
  name: string;
  passed: boolean;
  error?: string;
  diagnostics?: string;
}

async function waitForExit(
  proc: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  if (proc.exitCode !== null && proc.killed) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Electron did not exit within ${String(timeoutMs)}ms`));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      resolve();
    };
    proc.once('exit', cleanup);
  });
}

async function terminate(proc: ChildProcessWithoutNullStreams): Promise<void> {
  if (proc.exitCode !== null) return;
  try {
    proc.kill();
  } catch {
    // Already exiting.
  }
  await new Promise<void>((accept) => {
    const timer = setTimeout(() => accept(), 1_000);
    proc.once('exit', () => {
      clearTimeout(timer);
      accept();
    });
  });
}

function safeRemove(path: string): void {
  try {
    rmSync(path, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 200,
    });
  } catch (error) {
    process.stderr.write(
      `Could not remove ${path}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

async function launchElectron(
  userData: string,
  extraEnv: NodeJS.ProcessEnv,
): Promise<{ proc: ChildProcessWithoutNullStreams; client: HarnessClient }> {
  mkdirSync(userData, { recursive: true });
  mkdirSync(join(userData, 'data'), { recursive: true });
  // Remove stale harness files from a previous process that reused the
  // same userData directory. Otherwise `waitForReady` can observe the
  // previous process's readiness state file and return before this
  // process's backend is actually up.
  for (const staleFile of [
    'harness-state.json',
    'harness-cmd.jsonl',
  ]) {
    const path = join(userData, staleFile);
    if (existsSync(path)) unlinkSync(path);
  }
  for (const entry of readdirSync(userData)) {
    const match = entry.match(/^harness-resp-(\d+)\.json$/);
    if (match === null) continue;
    try {
      unlinkSync(join(userData, entry));
    } catch {
      // Ignore: the file may have been removed concurrently.
    }
  }
  const electronBinary = resolve(
    process.cwd(),
    'node_modules',
    'electron',
    'dist',
    'electron.exe',
  );
  const proc = spawn(electronBinary, ['.'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      JOB_BROWSER_LIFECYCLE_TEST: '1',
      JOB_BROWSER_LIFECYCLE_TEST_ROOT: userData,
      JOB_BROWSER_DB_PATH: join(userData, 'data', 'jobs.sqlite'),
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const client = new HarnessClient(proc, userData);
  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(
        `Electron exited with non-zero code: ${String(code)}\n`,
      );
    }
  });
  return { proc, client };
}

const pauseResumeScenario = {
  name: 'pause/resume through tray callback preserves employer-discovery opt-out',
  async run(client: HarnessClient): Promise<void> {
    const port = await client.backendPort();
    await fetch(`http://127.0.0.1:${port}/api/discovery/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schedulerEnabled: true,
        employerDiscoveryEnabled: false,
      }),
    });
    await client.send('refresh_tray');
    const before = await client.send('get_state');
    if (before.state?.employerDiscoveryEnabled !== false) {
      throw new Error('Failed to seed employerDiscovery opt-out');
    }
    await client.send('simulate_tray_pause');
    const paused = await client.send('get_state');
    if (paused.state?.schedulerEnabled !== false) {
      throw new Error('Pause toggle did not flip schedulerEnabled');
    }
    if (paused.state?.employerDiscoveryEnabled !== false) {
      throw new Error('Pause toggle clobbered employerDiscoveryEnabled');
    }
    await client.send('simulate_tray_pause');
    const resumed = await client.send('get_state');
    if (resumed.state?.schedulerEnabled !== true) {
      throw new Error('Resume toggle did not flip schedulerEnabled');
    }
    if (resumed.state?.employerDiscoveryEnabled !== false) {
      throw new Error('Resume toggle clobbered employerDiscoveryEnabled');
    }
  },
};

const externalSchedulerScenario = {
  name: 'external scheduler change updates tray state on refresh',
  async run(client: HarnessClient): Promise<void> {
    const port = await client.backendPort();
    await fetch(`http://127.0.0.1:${port}/api/discovery/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schedulerEnabled: false,
        employerDiscoveryEnabled: true,
      }),
    });
    await client.send('refresh_tray');
    const state = await client.send('get_state');
    if (state.state?.schedulerEnabled !== false) {
      throw new Error('External scheduler change not reflected after refresh');
    }
  },
};

const sourceAttentionScenario = {
  name: 'source health change updates attention count on refresh',
  async run(client: HarnessClient): Promise<void> {
    const port = await client.backendPort();
    await client.send('set_source_attention', 5_000, {
      enabled: true,
      health: 'credentials-required',
    });
    await client.send('refresh_tray');
    const response = await fetch(
      `http://127.0.0.1:${port}/api/tray-summary`,
    );
    const body = (await response.json()) as { attentionSources: number };
    if (body.attentionSources < 1) {
      throw new Error('Attention count did not update after refresh');
    }
  },
};

const closeToTrayHideScenario = {
  name: 'close with close-to-tray on hides the window',
  async run(client: HarnessClient): Promise<void> {
    await client.send('set_close_to_tray', 5_000, { value: true });
    await client.send('refresh_tray');
    const before = await client.send('get_state');
    if (before.state?.closeToTray !== true) {
      throw new Error('Failed to enable close-to-tray');
    }
    await client.send('simulate_window_close');
    await new Promise((accept) => setTimeout(accept, 500));
    const after = await client.send('get_state');
    if (after.state?.windowVisible !== false) {
      throw new Error('Window was not hidden when close-to-tray is on');
    }
    if (after.state?.quitRequested) {
      throw new Error('Quit was requested on a hide-only close');
    }
    if (!after.state?.backendRunning) {
      throw new Error('Backend was stopped on a hide-only close');
    }
  },
};

async function runScenarioStandalone(
  name: string,
  scenario: (client: HarnessClient, proc: ChildProcessWithoutNullStreams) => Promise<void>,
  extraEnv: NodeJS.ProcessEnv = {},
  userDataOverride?: string,
): Promise<ScenarioResult> {
  const userData =
    userDataOverride !== undefined
      ? userDataOverride
      : mkdtempSync(join(tmpdir(), 'job-browser-lifecycle-'));
  const { proc, client } = await launchElectron(userData, extraEnv);
  try {
    await client.waitForReady();
    await scenario(client, proc);
    return { name, passed: true };
  } catch (error) {
    return {
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await terminate(proc);
    if (userDataOverride === undefined) safeRemove(userData);
  }
}

async function main(): Promise<void> {
  const usePackaged = process.argv.includes('--packaged');
  let nativeBackupPath: string | null = null;
  if (!usePackaged) {
    // Snapshot the current Node-compatible binary to a durable
    // location before swapping to the Electron binary. A `finally`
    // block alone is insufficient if the process is killed
    // mid-scenario (graphics crash, abrupt shutdown); the backup on
    // disk is the recovery anchor for the next harness run.
    nativeBackupPath = backupCurrentNativeBinary('lifecycle-harness');
    installElectronNativeDependencies();
  }

  const results: ScenarioResult[] = [];
  try {
    results.push(
      await runScenarioStandalone('pause/resume preserves opt-out', (c) =>
        pauseResumeScenario.run(c),
      ),
    );
    results.push(
      await runScenarioStandalone(
        'external scheduler change updates tray',
        (c) => externalSchedulerScenario.run(c),
      ),
    );
    results.push(
      await runScenarioStandalone(
        'source attention count updates on refresh',
        (c) => sourceAttentionScenario.run(c),
      ),
    );
    results.push(
      await runScenarioStandalone(
        'close with close-to-tray on hides the window',
        async (c, proc) => {
          await closeToTrayHideScenario.run(c);
          await c.send('simulate_safe_exit');
          await waitForExit(proc, 8_000);
        },
      ),
    );
    results.push(
      await runScenarioStandalone(
        'close with close-to-tray off exits gracefully',
        async (c, proc) => {
          await c.send('set_close_to_tray', 5_000, { value: false });
          await c.send('refresh_tray');
          const state = await c.send('get_state');
          if (state.state?.closeToTray !== false) {
            throw new Error('closeToTray was not set to false before close');
          }
          await c.send('simulate_window_close');
          // The bounded shutdown (default 5 s) plus finalizeExit must
          // terminate the process well within 15 s on a clean run.
          await waitForExit(proc, 15_000);
        },
      ),
    );
    results.push(
      await runScenarioStandalone(
        'tray Exit and repeated exit terminate cleanly',
        async (c, proc) => {
          await c.send('set_close_to_tray', 5_000, { value: true });
          const p1 = c.send('simulate_safe_exit');
          const p2 = c.send('simulate_safe_exit');
          await Promise.all([p1, p2]);
          await waitForExit(proc, 8_000);
        },
      ),
    );
    results.push(
      await runScenarioStandalone(
        'startup failure leaves a tray Exit path',
        async (c, proc) => {
          const state = await c.send('get_state');
          if (!state.state?.trayCreated) {
            throw new Error('Tray was not created under startup failure');
          }
          if (state.state?.backendRunning) {
            throw new Error(
              'Backend should not be running after forced startup failure',
            );
          }
          await c.send('simulate_safe_exit');
          await waitForExit(proc, 8_000);
        },
        { JOB_BROWSER_FORCE_STARTUP_FAILURE: '1' },
      ),
    );
    results.push(
      await runScenarioStandalone(
        'tray creation failure falls back to closing',
        async (c, proc) => {
          const state = await c.send('get_state');
          if (state.state?.trayCreated) {
            throw new Error('Tray should not be reported as created');
          }
          if (!state.state?.backendRunning) {
            throw new Error('Backend should still be running');
          }
          await c.send('simulate_window_close');
          await waitForExit(proc, 8_000);
        },
        { JOB_BROWSER_FORCE_TRAY_FAILURE: '1' },
      ),
    );
    // Persisted closeToTray across restart: two processes sharing a
    // userData directory.
    {
      const sharedUserData = mkdtempSync(
        join(tmpdir(), 'job-browser-lifecycle-shared-'),
      );
      try {
        // Process 1: write closeToTray=false and exit.
        const writeResult = await runScenarioStandalone(
          'persisted closeToTray write',
          async (c, proc) => {
            await c.send('set_close_to_tray', 5_000, { value: false });
            await c.send('refresh_tray');
            const state = await c.send('get_state');
            if (state.state?.closeToTray !== false) {
              throw new Error('closeToTray was not set to false before shutdown');
            }
            await c.send('simulate_safe_exit');
            await waitForExit(proc, 15_000);
          },
          {},
          sharedUserData,
        );
        results.push(writeResult);
        // Process 2: read closeToTray=false after restart.
        const readResult = await runScenarioStandalone(
          'persisted closeToTray survives restart',
          async (c) => {
            const state = await c.send('get_state');
            if (state.state?.closeToTray !== false) {
              let persistedFromApi: string | null = null;
              try {
                const port = await c.backendPort();
                const response = await fetch(
                  `http://127.0.0.1:${port}/api/desktop-settings`,
                );
                const body = (await response.json()) as {
                  closeToTray: boolean;
                };
                persistedFromApi = String(body.closeToTray);
              } catch (error) {
                persistedFromApi = `(prefetch failed: ${
                  error instanceof Error ? error.message : String(error)
                })`;
              }
              throw new Error(
                `closeToTray did not survive restart; expected false, got ${String(state.state?.closeToTray)} (live API reported ${String(persistedFromApi)})`,
              );
            }
          },
          {},
          sharedUserData,
        );
        results.push(readResult);
      } finally {
        safeRemove(sharedUserData);
      }
    }
    results.push(
      await runScenarioStandalone(
        'query-session-end is bounded',
        async (c, proc) => {
          // `onWindowsSessionEnd` calls `app.exit(0)` after cleanup,
          // so the in-band `get_state` poll would time out. The
          // bounded-cleanup assertion is that the process actually
          // exits within the shutdown budget, not that a follow-up
          // IPC call still works.
          const before = await c.send('get_state');
          if (!before.state?.backendRunning) {
            throw new Error('Backend should be running before session-end dispatch');
          }
          await c.send('simulate_query_session_end');
          await waitForExit(proc, 10_000);
        },
      ),
    );
  } finally {
    if (!usePackaged) {
      try {
        restoreNodeNativeDependencies();
      } catch (error) {
        // The prebuild-install restore failed (e.g. no matching Node
        // prebuild available). Fall back to the durable on-disk
        // backup we took at startup; that file is guaranteed to be
        // Node-compatible because the harness captured it before
        // swapping the runtime.
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `Native restore failed (${message}); falling back to on-disk backup.\\n`,
        );
        if (nativeBackupPath !== null) {
          try {
            restoreNativeBinaryFromBackup(nativeBackupPath);
          } catch (fallbackError) {
            process.stderr.write(
              `Backup restore also failed: ${
                fallbackError instanceof Error
                  ? fallbackError.message
                  : String(fallbackError)
              }\\n`,
            );
            process.exit(2);
          }
        }
      }
    }
  }

  let totalPassed = 0;
  let totalFailed = 0;
  for (const result of results) {
    if (result.passed) {
      totalPassed += 1;
      // eslint-disable-next-line no-console
      console.log(`[PASS] ${result.name}`);
    } else {
      totalFailed += 1;
      // eslint-disable-next-line no-console
      console.error(`[FAIL] ${result.name}: ${result.error ?? ''}`);
      if (result.diagnostics !== undefined) {
        // eslint-disable-next-line no-console
        console.error(`  ${result.diagnostics}`);
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    `\nHarness summary: ${String(totalPassed)} passed, ${String(totalFailed)} failed`,
  );
  if (totalFailed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Harness failed:', error);
  process.exit(1);
});
