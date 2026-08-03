import type { Page } from 'playwright';

import { log } from '../../logging/logger.js';
import { navigateWithRetry } from '../linkedIn/browserSession.js';

export const HANDSHAKE_SEARCH_URL = 'https://app.joinhandshake.com/job-search';

export function isHandshakeAuthenticationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.hostname !== 'app.joinhandshake.com' ||
      /^\/access(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return true;
  }
}

export async function isHandshakeLoggedIn(page: Page): Promise<boolean> {
  if (isHandshakeAuthenticationUrl(page.url())) return false;
  return (
    (await page
      .locator(
        'form[data-hook="job-search-filters"], [data-hook="student-sidebar-jobs-link"]',
      )
      .count()
      .catch(() => 0)) > 0
  );
}

export async function ensureHandshakeLogin(
  page: Page,
  timeoutMs = 300_000,
  signal?: AbortSignal,
): Promise<boolean> {
  await navigateWithRetry(page, HANDSHAKE_SEARCH_URL, { retries: 3 });
  if (await isHandshakeLoggedIn(page)) {
    log('info', 'Handshake session already authenticated');
    return true;
  }

  log('info', 'Waiting for Handshake school/SSO sign-in');
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted === true) {
      await removeLoginOverlay(page);
      throw new Error('Handshake search cancelled');
    }
    if (await isHandshakeLoggedIn(page)) {
      log('info', 'Handshake login detected');
      await removeLoginOverlay(page);
      return true;
    }
    await injectLoginOverlay(page);
    await page.waitForTimeout(1_000);
  }

  await removeLoginOverlay(page);
  return false;
}

async function injectLoginOverlay(page: Page): Promise<void> {
  try {
    const url = new URL(page.url());
    if (url.hostname !== 'app.joinhandshake.com') return;
    await page.evaluate(() => {
      if (document.getElementById('jb-handshake-overlay')) return;
      const container = document.createElement('div');
      container.id = 'jb-handshake-overlay';
      container.innerHTML = `
        <div style="
          position:fixed;top:0;left:0;right:0;z-index:2147483647;
          background:#172554;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          padding:18px 24px;box-shadow:0 4px 20px rgba(0,0,0,0.45);
          display:flex;align-items:center;gap:20px;flex-wrap:wrap;
        ">
          <div>
            <div style="font-weight:700;font-size:15px">Sign in to Handshake</div>
            <div style="font-size:13px;opacity:0.85">This is a one-time step. Your browser session is saved locally.</div>
          </div>
          <div style="margin-left:auto;font-size:13px;opacity:0.9">
            Choose your school, complete SSO/MFA, then return to Handshake. Job Browser will continue automatically.
          </div>
        </div>`;
      document.body.prepend(container);
    });
  } catch {
    // The browser may be navigating to or from an institution login page.
  }
}

async function removeLoginOverlay(page: Page): Promise<void> {
  await page
    .evaluate(() => document.getElementById('jb-handshake-overlay')?.remove())
    .catch(() => undefined);
}
