import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  installElectronNativeDependencies,
  restoreNodeNativeDependencies,
} from './native-dependencies.js';

const userData = mkdtempSync(join(tmpdir(), 'job-browser-desktop-smoke-'));
const installed = process.argv.includes('--installed');
const packaged = installed || process.argv.includes('--packaged');
const upgrade = process.argv.includes('--upgrade');
const onboarding = process.argv.includes('--onboarding');
const databaseCopyIndex = process.argv.indexOf('--database-copy');
const databaseCopy =
  databaseCopyIndex === -1 ? null : process.argv[databaseCopyIndex + 1] ?? null;
if (databaseCopyIndex !== -1 && databaseCopy === null) {
  throw new Error('--database-copy requires a path');
}
if (databaseCopy !== null && upgrade) {
  throw new Error('--database-copy cannot be combined with --upgrade');
}
if (onboarding && (upgrade || databaseCopy !== null)) {
  throw new Error(
    '--onboarding requires its own disposable database and cannot be combined with upgrade/database-copy modes',
  );
}
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  JOB_BROWSER_SMOKE_USER_DATA: userData,
  JOB_BROWSER_SMOKE_TEST: '1',
  JOB_BROWSER_DB_PATH: databaseCopy ?? join(userData, 'data', 'jobs.sqlite'),
  ...(upgrade ? { JOB_BROWSER_SMOKE_UPGRADE: '1' } : {}),
  ...(databaseCopy !== null ? { JOB_BROWSER_SMOKE_EXISTING_DATA: '1' } : {}),
};
delete environment['ELECTRON_RUN_AS_NODE'];

if (upgrade) {
  seedUpgradeDatabase(join(userData, 'data', 'jobs.sqlite'));
}

if (!packaged) installElectronNativeDependencies();

try {
  if (onboarding) {
    await runElectronSmoke('save');
    await runElectronSmoke('resume');
  } else {
    await runElectronSmoke();
  }
} finally {
  try {
    rmSync(userData, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  } catch (error) {
    console.warn(
      `Could not immediately remove smoke-test data at ${userData}: ${String(error)}`,
    );
  }
  if (!packaged) restoreNodeNativeDependencies();
}

async function runElectronSmoke(
  onboardingPhase?: 'save' | 'resume',
): Promise<void> {
  const childEnvironment = { ...environment };
  delete childEnvironment['JOB_BROWSER_SMOKE_ONBOARDING_PHASE'];
  if (onboardingPhase !== undefined) {
    childEnvironment['JOB_BROWSER_ONBOARDING_ACCEPTANCE_MODE'] = '1';
    childEnvironment['JOB_BROWSER_SMOKE_ONBOARDING_PHASE'] = onboardingPhase;
  } else {
    delete childEnvironment['JOB_BROWSER_ONBOARDING_ACCEPTANCE_MODE'];
  }
  const application = spawn(
    packaged
      ? installed
        ? resolve(
            process.env['LOCALAPPDATA'] ?? '',
            'Programs',
            'Job Browser',
            'Job Browser.exe',
          )
        : resolve(process.cwd(), 'release', 'win-unpacked', 'Job Browser.exe')
      : resolve(
          process.cwd(),
          'node_modules',
          'electron',
          'dist',
          'electron.exe',
        ),
    packaged ? [] : ['.', '--built', '--smoke-test'],
    {
      cwd: process.cwd(),
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let processOutput = '';
  application.stdout.on(
    'data',
    (chunk: Buffer) => (processOutput += chunk.toString()),
  );
  application.stderr.on(
    'data',
    (chunk: Buffer) => (processOutput += chunk.toString()),
  );

  try {
    const exitCode = await Promise.race([
      new Promise<number | null>((accept, reject) => {
        application.once('error', reject);
        application.once('exit', accept);
      }),
      new Promise<'timeout'>((accept) => {
        const timeout = setTimeout(() => accept('timeout'), 120_000);
        timeout.unref();
      }),
    ]);
    if (exitCode === 'timeout')
      throw new Error('Electron smoke test timed out');
    if (exitCode !== 0)
      throw new Error(`Electron exited with code ${String(exitCode)}`);
    const successMarker = onboardingPhase
      ? `Desktop onboarding smoke phase ${onboardingPhase} passed`
      : 'Desktop smoke test passed';
    if (!processOutput.includes(successMarker)) {
      throw new Error('Electron exited without completing smoke assertions');
    }
    console.log(successMarker);
  } catch (error) {
    if (processOutput.trim()) console.error(processOutput.trim());
    try {
      console.error(
        `Last Electron smoke stage: ${readFileSync(join(userData, 'smoke-status.txt'), 'utf8').trim()}`,
      );
    } catch {
      console.error('Electron did not write a smoke stage marker');
    }
    throw error;
  } finally {
    terminateProcessTree(application);
  }
}

function seedUpgradeDatabase(databasePath: string): void {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules', 'tsx', 'dist', 'cli.mjs'),
      resolve('scripts', 'seed-upgrade-database.ts'),
      databasePath,
    ],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
    },
  );
}

function terminateProcessTree(application: ReturnType<typeof spawn>): void {
  if (application.exitCode !== null || application.pid === undefined) return;
  if (process.platform !== 'win32') {
    application.kill();
    return;
  }
  try {
    execFileSync('taskkill', ['/pid', String(application.pid), '/t', '/f'], {
      stdio: 'ignore',
    });
  } catch {
    // The process may have exited between the status check and cleanup.
  }
}
