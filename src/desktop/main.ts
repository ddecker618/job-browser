import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  app,
  clipboard,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';

import { BackendManager } from './backendManager.js';
import { userFacingError } from './errors.js';
import { createDesktopLogger } from './logger.js';
import { CredentialVault } from './credentialVault.js';
import {
  initializeDesktopPaths,
  resolveDesktopPaths,
  type DesktopPaths,
} from './paths.js';
import { WindowManager } from './windowManager.js';

app.setName('Job Browser');
if (process.env['JOB_BROWSER_SMOKE_USER_DATA']) {
  app.setPath('userData', process.env['JOB_BROWSER_SMOKE_USER_DATA']);
}
const smokeTest = process.env['JOB_BROWSER_SMOKE_TEST'] === '1';
const smokeStatusPath = smokeTest
  ? resolve(app.getPath('userData'), 'smoke-status.txt')
  : null;
recordSmokeStage('main-loaded');
const lock = smokeTest || app.requestSingleInstanceLock();
if (!lock) app.exit(0);

const backend = new BackendManager();
const windows = new WindowManager();
let paths: DesktopPaths;
let desktopLogger: ReturnType<typeof createDesktopLogger>;
let credentialVault: CredentialVault;
let diagnosticText = '';
let starting = false;
let commitIdentifier = 'local-dev';

app.on('second-instance', () => windows.focus());
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (backend.current !== null) {
    event.preventDefault();
    void backend.stop().finally(() => {
      app.removeAllListeners('before-quit');
      app.quit();
    });
  }
});

if (lock) void startDesktop();

async function startDesktop(): Promise<void> {
  await app.whenReady();
  recordSmokeStage('app-ready');
  const projectRoot = app.isPackaged ? app.getAppPath() : process.cwd();
  const infoPath = resolve(projectRoot, 'build-info.json');
  if (existsSync(infoPath)) {
    try {
      const parsed = JSON.parse(readFileSync(infoPath, 'utf8')) as {
        commit?: string;
      };
      commitIdentifier = parsed.commit ?? 'local-dev';
    } catch {
      // Ignore
    }
  }
  paths = resolveDesktopPaths({
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    resourcesPath: process.resourcesPath,
    projectRoot,
    ...(process.env['JOB_BROWSER_DB_PATH'] === undefined
      ? {}
      : { databaseOverride: process.env['JOB_BROWSER_DB_PATH'] }),
  });
  const defaultsRoot = app.isPackaged
    ? resolve(process.resourcesPath, 'assets', 'default-config')
    : resolve(projectRoot, 'config');
  initializeDesktopPaths(paths, defaultsRoot);
  recordSmokeStage('paths-ready');
  desktopLogger = createDesktopLogger(paths.logs);
  credentialVault = new CredentialVault(paths.credentials);
  windows.create({
    preload: resolve(app.getAppPath(), 'dist', 'src', 'desktop', 'preload.cjs'),
    startupHtml: paths.startupHtml,
    icon: paths.icon,
    windowState: paths.windowState,
    development: !app.isPackaged && !process.argv.includes('--built'),
  });
  recordSmokeStage('window-created');
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );

  ipcMain.handle('desktop:runtime-info', (event) => {
    ensureTrustedSender(event);
    return runtimeInfo();
  });
  ipcMain.handle('desktop:open-data', () => shell.openPath(paths.root));
  ipcMain.handle('desktop:open-logs', () => shell.openPath(paths.logs));
  ipcMain.handle('desktop:create-backup', async () => {
    const handle = backend.current;
    if (handle === null) throw new Error('The local database is not ready');
    return handle.backup();
  });
  ipcMain.handle('desktop:copy-diagnostics', () =>
    clipboard.writeText(diagnosticText),
  );
  ipcMain.handle('desktop:restart', () => {
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle('desktop:retry-startup', () => void runStartup());
  ipcMain.handle('desktop:safe-exit', () => app.quit());
  ipcMain.handle('desktop:credentials-status', async (event) => {
    ensureTrustedSender(event);
    return credentialVault.status('usajobs');
  });
  ipcMain.handle(
    'desktop:set-usajobs-credentials',
    async (event, credentials: { email: string; apiKey: string }) => {
      ensureTrustedSender(event);
      await credentialVault.setUsaJobs(credentials);
      return credentialVault.status('usajobs');
    },
  );
  ipcMain.handle('desktop:clear-usajobs-credentials', (event) => {
    ensureTrustedSender(event);
    credentialVault.clearUsaJobs();
  });
  ipcMain.handle('desktop:get-linkedin-profile-path', (event) => {
    ensureTrustedSender(event);
    return paths.linkedinProfile;
  });
  ipcMain.handle('desktop:clear-linkedin-session', async (event) => {
    ensureTrustedSender(event);
    const { rmSync } = await import('node:fs');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { join } = await import('node:path');
    try {
      const entries = await import('node:fs/promises').then((m) =>
        m.readdir(paths.linkedinProfile),
      );
      for (const entry of entries) {
        rmSync(join(paths.linkedinProfile, entry), {
          recursive: true,
          force: true,
        });
      }
      return { cleared: true };
    } catch {
      return { cleared: false };
    }
  });
  ipcMain.handle('desktop:get-usajobs-profile-path', (event) => {
    ensureTrustedSender(event);
    return paths.usaJobsProfile;
  });
  ipcMain.handle('desktop:clear-usajobs-session', async (event) => {
    ensureTrustedSender(event);
    const { rmSync } = await import('node:fs');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { join } = await import('node:path');
    try {
      const entries = await import('node:fs/promises').then((m) =>
        m.readdir(paths.usaJobsProfile),
      );
      for (const entry of entries) {
        rmSync(join(paths.usaJobsProfile, entry), {
          recursive: true,
          force: true,
        });
      }
      return { cleared: true };
    } catch {
      return { cleared: false };
    }
  });

  await runStartup();
  recordSmokeStage('startup-finished');
  if (smokeTest) await runDesktopSmoke();
}

async function runStartup(): Promise<void> {
  if (starting) return;
  starting = true;
  try {
    await backend.stop();
    windows.sendProgress('Preparing application');
    windows.sendProgress('Locating database');
    windows.sendProgress('Checking database');
    windows.sendProgress('Applying database updates');
    windows.sendProgress('Starting local service');
    const handle = await backend.start(paths, {
      development: !app.isPackaged && !process.argv.includes('--built'),
      logger: desktopLogger.log,
      credentialResolver: credentialVault,
    });
    windows.sendProgress('Loading dashboard');
    await windows.loadDashboard(handle.url);
    windows.sendProgress('Ready');
    diagnosticText = JSON.stringify(runtimeInfo(), null, 2);
  } catch (error) {
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    desktopLogger.log('error', 'Desktop startup failed', { error: detail });
    diagnosticText = JSON.stringify(
      {
        version: app.getVersion(),
        databasePath: paths.database,
        logPath: desktopLogger.path,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    );
    windows.sendFailure({
      title: 'Job Browser could not start',
      message: userFacingError(error),
      databasePath: paths.database,
    });
  } finally {
    starting = false;
  }
}

function runtimeInfo() {
  const isDev = !app.isPackaged && !process.argv.includes('--built');
  return {
    desktop: true,
    version: app.getVersion(),
    databasePath: paths.database,
    resumeDirectory: paths.resumes,
    logDirectory: paths.logs,
    backupDirectory: paths.backups,
    backendStatus: backend.current === null ? 'stopped' : 'healthy',
    backendUrl: backend.current?.url ?? null,
    executablePath: app.getPath('exe'),
    rendererMode: isDev ? 'development' : 'packaged',
    commitIdentifier,
  };
}

function ensureTrustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url;
  if (senderUrl === undefined)
    throw new Error('Desktop request has no sender frame');
  const backendUrl = backend.current?.url;
  if (
    backendUrl !== undefined &&
    new URL(senderUrl).origin === new URL(backendUrl).origin
  ) {
    return;
  }
  if (senderUrl.startsWith('file:') && senderUrl.endsWith('/startup.html'))
    return;
  throw new Error('Desktop request came from an untrusted page');
}

async function runDesktopSmoke(): Promise<void> {
  try {
    recordSmokeStage('asserting-dashboard');
    const handle = backend.current;
    const window = windows.window;
    if (handle === null || window === null) {
      throw new Error(`Desktop startup did not complete: ${diagnosticText}`);
    }

    await assertPageText(window.webContents, 'Opportunity command center');
    recordSmokeStage('asserting-jobs');
    await clickRoute(window.webContents, '/jobs');
    await assertPageText(window.webContents, 'OPPORTUNITY INVENTORY');
    recordSmokeStage('asserting-sources');
    await clickRoute(window.webContents, '/sources');
    await assertPageText(window.webContents, 'DISCOVERY CONTROL');
    recordSmokeStage('asserting-settings');
    await clickRoute(window.webContents, '/settings');
    await assertPageText(window.webContents, 'Desktop application');
    if (!(await fetch(`${handle.url}/api/health`)).ok) {
      throw new Error('Desktop backend health endpoint failed');
    }
    const providersResponse = await fetch(`${handle.url}/api/providers`);
    if (!providersResponse.ok) {
      throw new Error('Desktop provider endpoint failed');
    }
    const providers: unknown = await providersResponse.json();
    for (const providerId of [
      'builtin',
      'handshake',
      'wellfound',
      'ziprecruiter',
    ]) {
      if (!hasProvider(providers, providerId)) {
        throw new Error(`Packaged provider was not loaded: ${providerId}`);
      }
    }
    const sourcesResponse = await fetch(
      `${handle.url}/api/sources/control-center`,
    );
    if (!sourcesResponse.ok) {
      throw new Error('Desktop starter sources endpoint failed');
    }
    const sourceControl: unknown = await sourcesResponse.json();
    for (const providerId of ['builtin']) {
      if (!hasSource(sourceControl, providerId, true)) {
        throw new Error(`Enabled starter source was not seeded: ${providerId}`);
      }
    }
    for (const providerId of [
      'wellfound',
      'ziprecruiter',
      'dice',
      'handshake',
      'indeed',
      'usajobs',
    ]) {
      if (!hasSource(sourceControl, providerId, false)) {
        throw new Error(
          `Disabled browser source was not seeded: ${providerId}`,
        );
      }
    }

    recordSmokeStage('passed');
    console.log('Desktop smoke test passed');
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}

function recordSmokeStage(stage: string): void {
  if (smokeStatusPath !== null)
    writeFileSync(smokeStatusPath, `${stage}\n`, 'utf8');
}

function hasProvider(value: unknown, providerId: string): boolean {
  return (
    Array.isArray(value) &&
    value.some((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const record = item as { id?: unknown };
      return record.id === providerId;
    })
  );
}

function hasSource(
  value: unknown,
  providerId: string,
  enabled: boolean,
): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const sources = (value as { sources?: unknown }).sources;
  return (
    Array.isArray(sources) &&
    sources.some((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const source = item as { providerId?: unknown; enabled?: unknown };
      return source.providerId === providerId && source.enabled === enabled;
    })
  );
}

async function assertPageText(
  contents: WebContents,
  expected: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let body = '';
  while (Date.now() < deadline) {
    const rendered = (await contents.executeJavaScript(
      'document.body.innerText',
      true,
    )) as unknown;
    body = typeof rendered === 'string' ? rendered : String(rendered);
    if (body.includes(expected)) return;
    await new Promise((accept) => setTimeout(accept, 100));
  }
  throw new Error(
    `Desktop page did not render expected text: ${expected}. Rendered: ${body.slice(0, 500)}`,
  );
}

async function clickRoute(contents: WebContents, route: string): Promise<void> {
  const clicked = (await contents.executeJavaScript(
    `(() => { const link = document.querySelector('a[href=${JSON.stringify(route)}]'); if (!link) return false; link.click(); return true; })()`,
    true,
  )) as unknown;
  if (clicked !== true)
    throw new Error(`Desktop navigation link was not found: ${route}`);
}
