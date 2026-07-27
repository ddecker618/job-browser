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
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  JOB_BROWSER_SMOKE_USER_DATA: userData,
  JOB_BROWSER_SMOKE_TEST: '1',
};
delete environment['ELECTRON_RUN_AS_NODE'];

if (!packaged) installElectronNativeDependencies();

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
    env: environment,
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
    new Promise<'timeout'>((accept) =>
      setTimeout(() => accept('timeout'), 120_000),
    ),
  ]);
  if (exitCode === 'timeout') throw new Error('Electron smoke test timed out');
  if (exitCode !== 0)
    throw new Error(`Electron exited with code ${String(exitCode)}`);
  if (!processOutput.includes('Desktop smoke test passed')) {
    throw new Error('Electron exited without completing smoke assertions');
  }
  console.log('Desktop smoke test passed');
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
  terminateProcessTree();
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

function terminateProcessTree(): void {
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
