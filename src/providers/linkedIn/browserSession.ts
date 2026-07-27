import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import { ensureDir } from '../../utilities/files.js';
import { log } from '../../logging/logger.js';

function setBundledBrowserPath(): void {
  if (process.env['PLAYWRIGHT_BROWSERS_PATH']) return;
  try {
    const resourcesPath = (
      process as NodeJS.Process & { resourcesPath?: string }
    ).resourcesPath;
    if (!resourcesPath) return;
    const bundledPath = join(resourcesPath, 'ms-playwright');
    if (existsSync(bundledPath)) {
      process.env['PLAYWRIGHT_BROWSERS_PATH'] = bundledPath;
      log('info', 'Using bundled Playwright browsers', { path: bundledPath });
    }
  } catch {
    // not bundled, use default browser path
  }
}

export interface BrowserSessionConfig {
  profileDir: string;
  headless: boolean;
  remoteDebuggingPort?: number;
}

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  profileDir: string;
  persistentContext: BrowserContext;
  underlyingBrowser: Browser;
}

let activeSession: BrowserSession | null = null;

export function hasActiveSession(): boolean {
  return activeSession !== null;
}

export function getActiveSession(): BrowserSession | null {
  return activeSession;
}

export async function launchBrowserSession(
  config: BrowserSessionConfig,
): Promise<BrowserSession> {
  setBundledBrowserPath();

  if (activeSession !== null) {
    if (activeSession.profileDir === config.profileDir) {
      try {
        await activeSession.page.evaluate('1', { timeout: 2000 });
        return activeSession;
      } catch {
        // session is dead, clean up
      }
    }
    await closeBrowserSession().catch(() => {
      /* ignore */
    });
  }

  log('info', 'Launching browser session', {
    profileDir: config.profileDir,
    headless: config.headless,
  });

  ensureDir(config.profileDir);

  const persistentContext = await chromium.launchPersistentContext(
    config.profileDir,
    {
      headless: config.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      deviceScaleFactor: 1,
      acceptDownloads: false,
    },
  );

  const underlyingBrowser = persistentContext.browser();
  if (underlyingBrowser === null)
    throw new Error('Persistent browser context has no underlying browser');

  const pages = persistentContext.pages();
  const page = pages[0] ?? (await persistentContext.newPage());

  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(45_000);

  await applyStealthPatches(page);

  const session: BrowserSession = {
    context: persistentContext,
    page,
    profileDir: config.profileDir,
    persistentContext,
    underlyingBrowser,
  };
  activeSession = session;

  log('info', 'Browser session started');
  return session;
}

export async function closeBrowserSession(): Promise<void> {
  if (activeSession !== null) {
    const { persistentContext, underlyingBrowser } = activeSession;
    try {
      await persistentContext.close().catch(() => {
        /* ignore */
      });
    } catch {
      // ignore
    }
    try {
      await underlyingBrowser.close().catch(() => {
        /* ignore */
      });
    } catch {
      // ignore
    }
    activeSession = null;
  }
}

export async function navigateWithRetry(
  page: Page,
  url: string,
  options: { timeout?: number; retries?: number } = {},
): Promise<void> {
  const retries = options.retries ?? 2;
  const timeout = options.timeout ?? 45_000;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      return;
    } catch (error) {
      if (attempt < retries) {
        log(
          'warn',
          'Navigation attempt ' + String(attempt) + ' failed, retrying',
          {
            url,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        throw new Error(
          'Failed to navigate to ' +
            url +
            ' after ' +
            String(retries) +
            ' attempts: ' +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
  }
}

export async function waitForSelectorSafe(
  page: Page,
  selector: string,
  timeout = 10_000,
): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout, state: 'attached' });
    return true;
  } catch {
    return false;
  }
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (
      url === 'about:blank' ||
      url.includes('/login') ||
      url.includes('/checkpoint') ||
      url.includes('/authwall')
    )
      return false;
    if (url.includes('/uas/login')) return false;
    const selectors = [
      'header.global-nav',
      '.global-nav__me',
      '.feed-shared-update-v2',
      '.profile-rail-card',
      '#voyager-feed',
      'a[href*="/feed/"]',
      'a[href*="/mynetwork/"]',
      'a[href*="/jobs/"]',
      '.search-global-typeahead__input',
      'div[data-feed-view]',
    ];
    for (const sel of selectors) {
      if (await page.$(sel)) return true;
    }
    const bodyText = (await page.textContent('body').catch(() => null)) ?? '';
    if (
      bodyText.includes('Manage my account') ||
      bodyText.includes('My Network') ||
      bodyText.includes('Messaging')
    )
      return true;
    return false;
  } catch {
    return false;
  }
}

export async function injectLoginOverlay(
  page: Page,
): Promise<() => Promise<void>> {
  const html = String.raw;
  try {
    await page.evaluate(
      (overlayHtml: string) => {
        const existing = document.getElementById('jb-login-overlay');
        if (existing) existing.remove();
        const div = document.createElement('div');
        div.id = 'jb-login-overlay';
        div.innerHTML = overlayHtml;
        document.body.prepend(div);
      },
      html`<div
        style="
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
      background: #1a1a2e; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 20px 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
    "
      >
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:24px">🔐</span>
          <div>
            <div style="font-weight:700;font-size:15px">Log in to LinkedIn</div>
            <div style="font-size:13px;opacity:0.8">
              This is a one-time step. Your session will be saved.
            </div>
          </div>
        </div>
        <div
          style="display:flex;gap:20px;margin-left:auto;font-size:13px;opacity:0.9"
        >
          <span>1. Enter your credentials</span>
          <span>→</span>
          <span>2. If prompted, complete any verification</span>
          <span>→</span>
          <span>3. Wait — jobs will be fetched automatically</span>
        </div>
      </div>`,
    );
  } catch {
    // page may not be ready yet
  }
  return async () => {
    try {
      await page.evaluate(() => {
        document.getElementById('jb-login-overlay')?.remove();
      });
    } catch {
      // ignore
    }
  };
}

export async function waitForLogin(
  page: Page,
  timeoutMs = 300_000,
): Promise<boolean> {
  log('info', 'Waiting for LinkedIn login');
  const removeOverlay = await injectLoginOverlay(page);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const url = page.url();
    if (await isLoggedIn(page)) {
      log('info', 'LinkedIn login detected');
      await removeOverlay();
      return true;
    }
    if (url.includes('/checkpoint') || url.includes('challenge')) {
      log(
        'warn',
        'LinkedIn verification/challenge page detected, waiting for user to complete',
      );
      try {
        await page.evaluate(() => {
          const overlay = document.getElementById('jb-login-overlay');
          if (overlay) {
            overlay.innerHTML = overlay.innerHTML.replace(
              'Enter your credentials',
              'Complete verification',
            );
          }
        });
      } catch {
        // ignore
      }
    } else if (url.includes('/authwall')) {
      log('warn', 'LinkedIn auth wall detected, user may need to dismiss');
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await removeOverlay();
  return false;
}

export async function detectSecurityChallenge(page: Page): Promise<boolean> {
  try {
    const selectors = [
      '#captcha-internal',
      '#security-challenge',
      '.challenge-dialog',
      'div[data-challenge-id]',
      'form[data-challenge]',
    ];
    for (const sel of selectors) {
      if (await page.$(sel)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function applyStealthPatches(page: Page): Promise<void> {
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
      });

      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
      });

      const win = window as unknown as Record<string, unknown>;
      if (typeof win['chrome'] === 'undefined') {
        win['chrome'] = { runtime: {} };
      }

      const perms = navigator.permissions as unknown as
        | Record<string, unknown>
        | undefined;
      if (
        typeof perms !== 'undefined' &&
        typeof perms['query'] === 'function'
      ) {
        const original = perms['query'] as (args: unknown) => Promise<unknown>;
        perms['query'] = (p: Record<string, unknown>) =>
          p['name'] === 'notifications'
            ? Promise.resolve({ state: 'denied' })
            : original(p);
      }

      for (const key of Object.getOwnPropertyNames(win)) {
        if (key.startsWith('cdc_')) {
          win[key] = undefined;
        }
      }
    });
  } catch {
    // stealth patches are non-critical
  }
}

export async function takeDiagnosticScreenshot(
  page: Page,
  label: string,
): Promise<string | null> {
  try {
    const dir = process.env['JOB_BROWSER_ARTIFACTS'] ?? 'artifacts';
    ensureDir(dir);
    const filename = 'linkedin-' + label + '-' + String(Date.now()) + '.png';
    const path = `${dir}/${filename}`;
    await page.screenshot({ path, fullPage: false });
    log('debug', `Diagnostic screenshot saved`, { path, label });
    return path;
  } catch {
    return null;
  }
}
