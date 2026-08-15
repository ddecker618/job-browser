import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

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
import { DesktopStartupError, userFacingError } from './errors.js';
import { createDesktopLogger } from './logger.js';
import { CredentialVault } from './credentialVault.js';
import {
  initializeDesktopPaths,
  resolveDesktopPaths,
  type DesktopPaths,
} from './paths.js';
import { WindowManager } from './windowManager.js';
import {
  applicationIdFromSmokeCreateResponse,
  isApplicationListSmokeResponse,
  loadDesktopSmokeApplicationDetail,
  loadDesktopSmokeRoute,
} from './smokeNavigation.js';
import type { JobDatabase } from '../db/database.js';
import type { NormalizedJob } from '../schemas/normalized-job.js';
import { ROLE_DETAILS_VERSION } from '../schemas/role-details.js';
import { JobRepository } from '../repositories/job-repository.js';
import { SourceRepository } from '../repositories/source-repository.js';

const DESKTOP_SMOKE_RESUME_ID = '00000000-0000-4000-8000-000000008303';
const DESKTOP_SMOKE_TITLE = 'Desktop Smoke Application Engineer';
const DESKTOP_SMOKE_JOB_TITLE = 'Desktop Smoke Retained Job';

const UPGRADE_SMOKE_STALE_FINGERPRINT = 'd'.repeat(64);
const UPGRADE_SMOKE_REMOVED_FINGERPRINT = 'e'.repeat(64);
const UPGRADE_SMOKE_STALE_SCORE_VERSION = 'stale-1.0.15-score-version';

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
    const handle = await backend.start(paths, {
      development: !app.isPackaged && !process.argv.includes('--built'),
      logger: desktopLogger.log,
      credentialResolver: credentialVault,
      onProgress: (stage) => windows.sendProgress(stage),
    });
    windows.sendProgress('Loading dashboard');
    await windows.loadDashboard(handle.url);
    windows.sendProgress('Ready');
    diagnosticText = JSON.stringify(runtimeInfo(), null, 2);
  } catch (error) {
    const startupError =
      error instanceof DesktopStartupError ? error : undefined;
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    desktopLogger.log('error', 'Desktop startup failed', {
      error: detail,
      ...(startupError === undefined ? {} : { code: startupError.code }),
      ...(startupError?.quarantinePath === undefined
        ? {}
        : { quarantinePath: startupError.quarantinePath }),
    });
    diagnosticText = JSON.stringify(
      {
        version: app.getVersion(),
        databasePath: paths.database,
        logPath: desktopLogger.path,
        error: error instanceof Error ? error.message : String(error),
        errorCode: startupError?.code ?? 'unknown',
        quarantinePath: startupError?.quarantinePath ?? null,
      },
      null,
      2,
    );
    windows.sendFailure({
      title:
        startupError?.code.startsWith('database-') === true
          ? 'Database recovery required'
          : 'Job Browser could not start',
      message: userFacingError(error),
      databasePath: paths.database,
      code: startupError?.code ?? 'unknown',
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
    snapshotDirectory: paths.snapshots,
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
    if (process.env['JOB_BROWSER_SMOKE_UPGRADE'] === '1') {
      recordSmokeStage('asserting-upgrade-reconciliation');
      assertUpgradeReconciliation(handle.database);
    }
    recordSmokeStage('creating-application-fixture');
    const desktopSmokeJobId = randomUUID();
    const desktopSmokeEventId = randomUUID();
    const desktopSmokeFingerprint =
      randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    insertDesktopSmokeJob(
      handle.database,
      desktopSmokeJobId,
      desktopSmokeFingerprint,
    );
    insertDesktopSmokeResume(handle.database);
    const createResponse = await fetch(`${handle.url}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: desktopSmokeEventId,
        jobId: desktopSmokeJobId,
        occurredAt: '2020-01-15T12:00:00.000Z',
        occurrencePrecision: 'exact',
        titleAtApplication: DESKTOP_SMOKE_TITLE,
        companyAtApplication: 'Desktop Smoke Company',
        locationAtApplication: 'Smoke Lab',
        applicationUrl: null,
        sourceId: null,
        notes: 'Created by isolated desktop smoke validation',
        resumeId: DESKTOP_SMOKE_RESUME_ID,
      }),
    });
    if (!createResponse.ok) {
      const createErrorBody = await createResponse.text();
      throw new Error(
        `Desktop smoke Application creation failed: ${createErrorBody}`,
      );
    }
    const createdApplication: unknown = await createResponse.json();
    const applicationId = applicationIdFromSmokeCreateResponse(
      createdApplication,
      desktopSmokeJobId,
      desktopSmokeEventId,
    );
    if (applicationId === null) {
      throw new Error(
        'Desktop smoke Application creation returned invalid data',
      );
    }
    recordSmokeStage('asserting-jobs');
    await loadDesktopSmokeRoute(window.webContents, '/jobs');
    await assertPageText(window.webContents, 'OPPORTUNITY INVENTORY');
    recordSmokeStage('asserting-applications');
    await loadDesktopSmokeRoute(window.webContents, '/applications');
    await assertPageText(window.webContents, DESKTOP_SMOKE_TITLE);
    const applicationsResponse = await fetch(`${handle.url}/api/applications`);
    if (!applicationsResponse.ok) {
      throw new Error('Desktop Applications endpoint failed');
    }
    const applications: unknown = await applicationsResponse.json();
    if (!isApplicationListSmokeResponse(applications)) {
      throw new Error(
        'Desktop Applications endpoint returned an invalid shape',
      );
    }
    if (!hasApplicationListItem(applications.items, applicationId)) {
      throw new Error('Desktop Applications list omitted the smoke record');
    }
    recordSmokeStage('asserting-resume-snapshots');
    const snapshotsResponse = await fetch(`${handle.url}/api/resume-snapshots`);
    if (!snapshotsResponse.ok) {
      throw new Error('Desktop resume-snapshots endpoint failed');
    }
    const snapshots: unknown = await snapshotsResponse.json();
    if (!snapshotHealthFromSmokeResponse(snapshots)) {
      throw new Error('Desktop snapshot reconciliation reported unhealthy');
    }
    const snapshotKeys = snapshotStorageKeysFromSmokeResponse(snapshots);
    if (snapshotKeys.length !== 1) {
      throw new Error(
        'Desktop snapshot capture did not persist exactly one artifact',
      );
    }
    recordSmokeStage('asserting-application-detail');
    await loadDesktopSmokeApplicationDetail(window.webContents, applicationId);
    await assertPageText(window.webContents, DESKTOP_SMOKE_TITLE);
    await assertPageText(window.webContents, 'Application timeline');
    recordSmokeStage('asserting-sources');
    await loadDesktopSmokeRoute(window.webContents, '/sources');
    await assertPageText(window.webContents, 'DISCOVERY CONTROL');
    recordSmokeStage('asserting-discovery-engine');
    await loadDesktopSmokeRoute(window.webContents, '/employers');
    await assertPageText(window.webContents, 'Discovery Engine');
    await assertPageText(window.webContents, 'Discovery Control Center');
    await assertPageText(window.webContents, 'Run Discovery Now');
    await assertPageText(window.webContents, 'Run Enabled Sources');
    await assertPageText(window.webContents, 'Discovery Intelligence');
    await assertPageText(window.webContents, 'Check CareerSite Health');
    await assertPageText(window.webContents, 'Check health');
    recordSmokeStage('asserting-analytics');
    await loadDesktopSmokeRoute(window.webContents, '/analytics');
    await assertPageText(window.webContents, 'Average listed salary');
    await assertPageText(window.webContents, 'Tracked employers');
    recordSmokeStage('asserting-search-profile');
    await loadDesktopSmokeRoute(window.webContents, '/search-profile');
    await assertPageText(window.webContents, 'Discovery boundaries');
    await assertPageText(window.webContents, 'Max onsite distance');
    recordSmokeStage('asserting-settings');
    await loadDesktopSmokeRoute(window.webContents, '/settings');
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

function insertDesktopSmokeJob(
  database: JobDatabase,
  jobId: string,
  fingerprint: string,
): void {
  const source = new SourceRepository(database).list()[0];
  if (source === undefined) {
    throw new Error('Desktop smoke requires one seeded local Source');
  }
  const job: NormalizedJob = {
    id: jobId,
    fingerprint,
    externalId: jobId,
    title: DESKTOP_SMOKE_JOB_TITLE,
    normalizedTitle: 'desktop smoke retained job',
    company: 'Desktop Smoke Company',
    normalizedCompany: 'desktop smoke company',
    location: 'Smoke Lab',
    city: null,
    state: null,
    remoteType: 'unknown',
    employmentType: 'unknown',
    salaryMinimum: null,
    salaryMaximum: null,
    salaryText: null,
    description: null,
    requirements: null,
    preferredQualifications: null,
    postingUrl: null,
    sourceName: 'Desktop smoke fixture',
    sourceType: 'desktop-smoke',
    datePosted: '2020-01-01T12:00:00.000Z',
    agency: null,
    department: null,
    gradeLow: null,
    gradeHigh: null,
    payPlan: null,
    appointmentType: null,
    workSchedule: null,
    teleworkEligible: null,
    openingDate: null,
    closingDate: null,
    closingDatePrecision: null,
    providerLifecycleStatus: 'unknown',
    applicationUrls: [],
    firstSeenAt: '2020-01-01T12:00:00.000Z',
    lastSeenAt: '2020-01-01T12:00:00.000Z',
    active: true,
    clearanceRequirement: null,
    sponsorshipAvailable: null,
    estimatedExperienceYears: null,
    seniorityLevel: 'unknown',
    score: null,
    recommendation: null,
    scoreExplanation: null,
    status: 'new',
  };
  new JobRepository(database).upsertObservation({
    job,
    sourceId: source.id,
    providerId: null,
    rawData: { fixture: 'desktop-smoke' },
  });
}

function insertDesktopSmokeResume(database: JobDatabase): void {
  const resumePath = join(paths.resumes, 'desktop-smoke-resume.txt');
  const content = 'Desktop smoke resume with SIEM experience';
  writeFileSync(resumePath, content);
  database
    .prepare(
      `INSERT INTO resumes (
        id, display_name, original_filename, storage_path, mime_type,
        size_bytes, is_default, parsing_status, extracted_skills_json,
        extracted_certifications_json, parsing_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 'parsed', '[]', '[]', NULL,
        '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        original_filename = excluded.original_filename,
        storage_path = excluded.storage_path,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes`,
    )
    .run(
      DESKTOP_SMOKE_RESUME_ID,
      'Desktop Smoke Resume',
      'desktop-smoke-resume.txt',
      resumePath,
      'text/plain',
      statSync(resumePath).size,
    );
}

interface UpgradeReconciliationStaleRow {
  role_details_json: string;
  remote_type: string;
  score: number | null;
  recommendation: string | null;
  score_version: string | null;
}

interface UpgradeReconciliationRemovedRow {
  active: number;
  user_removed: number;
  role_details_json: string;
}

function assertUpgradeReconciliation(database: JobDatabase): void {
  const stale = database
    .prepare<[string], UpgradeReconciliationStaleRow>(
      `SELECT role_details_json, remote_type, score, recommendation, score_version
         FROM jobs WHERE fingerprint = ?`,
    )
    .get(UPGRADE_SMOKE_STALE_FINGERPRINT);
  if (stale === undefined) {
    throw new Error('Upgrade smoke: seeded stale job is missing');
  }
  const roleDetails = JSON.parse(stale.role_details_json) as {
    version?: unknown;
    workplace?: { arrangement?: unknown };
    locations?: {
      primaryCity?: unknown;
      primaryState?: unknown;
    };
    clearance?: { mode?: unknown; level?: unknown };
  };
  if (roleDetails.version !== ROLE_DETAILS_VERSION) {
    throw new Error(
      `Upgrade smoke: role details were not re-extracted (found version ${String(roleDetails.version)})`,
    );
  }
  const arrangement = roleDetails.workplace?.arrangement;
  if (arrangement !== 'onsite') {
    throw new Error(
      `Upgrade smoke: work arrangement not corrected (${String(arrangement)})`,
    );
  }
  if (stale.remote_type !== 'onsite') {
    throw new Error(
      `Upgrade smoke: remote arrangement was not corrected (remote_type=${stale.remote_type})`,
    );
  }
  const primaryCity = roleDetails.locations?.primaryCity;
  const primaryState = roleDetails.locations?.primaryState;
  if (primaryCity !== 'Annapolis Junction') {
    throw new Error(
      `Upgrade smoke: city was not normalized (${String(primaryCity)})`,
    );
  }
  if (primaryState !== 'MD') {
    throw new Error(
      `Upgrade smoke: state was not normalized (${String(primaryState)})`,
    );
  }
  const clearanceMode = roleDetails.clearance?.mode;
  const clearanceLevel = roleDetails.clearance?.level;
  if (clearanceMode !== 'active') {
    throw new Error(
      `Upgrade smoke: clearance was not classified as active (${String(clearanceMode)})`,
    );
  }
  if (typeof clearanceLevel !== 'string' || !/ts\/sci/i.test(clearanceLevel)) {
    throw new Error(
      `Upgrade smoke: clearance level was not recognized (${String(clearanceLevel)})`,
    );
  }
  if (
    stale.score === 88 ||
    stale.recommendation === 'Verified Match' ||
    stale.score_version === UPGRADE_SMOKE_STALE_SCORE_VERSION
  ) {
    throw new Error('Upgrade smoke: stale score survived reconciliation');
  }
  if (stale.recommendation !== 'Hard No' || stale.score !== 0) {
    throw new Error(
      `Upgrade smoke: score was not recomputed (${String(stale.recommendation)} / ${String(stale.score)})`,
    );
  }
  const removed = database
    .prepare<[string], UpgradeReconciliationRemovedRow>(
      `SELECT active, user_removed, role_details_json FROM jobs WHERE fingerprint = ?`,
    )
    .get(UPGRADE_SMOKE_REMOVED_FINGERPRINT);
  if (removed === undefined) {
    throw new Error('Upgrade smoke: removed fixture is missing');
  }
  if (removed.active !== 0 || removed.user_removed !== 1) {
    throw new Error('Upgrade smoke: removed job was resurrected');
  }
  const removedDetails = JSON.parse(removed.role_details_json) as {
    version?: unknown;
  };
  if (removedDetails.version !== 'role-details-v1') {
    throw new Error('Upgrade smoke: removed job role details were touched');
  }
}

function snapshotHealthFromSmokeResponse(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const health = (value as { health?: unknown }).health;
  if (typeof health !== 'object' || health === null) return false;
  return (health as { healthy?: unknown }).healthy === true;
}

function snapshotStorageKeysFromSmokeResponse(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const snapshots = (value as { snapshots?: unknown }).snapshots;
  return Array.isArray(snapshots)
    ? snapshots.filter((key): key is string => typeof key === 'string')
    : [];
}

function hasApplicationListItem(
  items: unknown[],
  applicationId: string,
): boolean {
  return items.some(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      'id' in item &&
      item.id === applicationId,
  );
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
