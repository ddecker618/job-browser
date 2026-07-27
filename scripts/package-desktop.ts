import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  installElectronNativeDependencies,
  restoreNodeNativeDependencies,
} from './native-dependencies.js';

const unpacked = process.argv.includes('--dir');
const cleanupBrowser = stagePlaywrightBrowser();
try {
  installElectronNativeDependencies();
  try {
    execFileSync(
      process.execPath,
      [
        resolve('node_modules', 'electron-builder', 'cli.js'),
        '--win',
        ...(unpacked ? ['--dir'] : ['nsis']),
      ],
      { stdio: 'inherit' },
    );
  } finally {
    restoreNodeNativeDependencies();
  }
} finally {
  cleanupBrowser();
}

function stagePlaywrightBrowser(): () => void {
  const browserRoot =
    process.env['PLAYWRIGHT_BROWSERS_PATH'] ??
    join(process.env['LOCALAPPDATA'] ?? '', 'ms-playwright');
  const source = resolve(browserRoot, 'chromium-1200');
  const stagingRoot = resolve('assets', 'ms-playwright');
  if (!existsSync(source)) {
    throw new Error(
      `Bundled Playwright browser was not found at ${source}. Install Chromium with Playwright before packaging.`,
    );
  }
  rmSync(stagingRoot, { recursive: true, force: true });
  cpSync(source, resolve(stagingRoot, 'chromium-1200'), { recursive: true });
  return () => rmSync(stagingRoot, { recursive: true, force: true });
}
