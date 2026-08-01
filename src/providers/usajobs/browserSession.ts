import type { Page } from 'playwright';
import { log } from '../../logging/logger.js';
import { navigateWithRetry } from '../linkedIn/browserSession.js';

export const USAJOBS_DASHBOARD_URL =
  'https://www.usajobs.gov/applicant/profile/dashboard/';

export function isUsaJobsAuthenticationUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return (
      hostname === 'login.usajobs.gov' ||
      hostname === 'secure.login.gov' ||
      hostname === 'idp.login.gov' ||
      hostname === 'sessions.login.gov' ||
      hostname.endsWith('.login.gov')
    );
  } catch {
    return false;
  }
}

export function isUsaJobsLoggedIn(page: Page): boolean {
  try {
    const url = page.url();
    if (url === 'about:blank') return false;
    return (
      !isUsaJobsAuthenticationUrl(url) &&
      url.startsWith('https://www.usajobs.gov/')
    );
  } catch {
    return false;
  }
}

export async function ensureUsaJobsLogin(
  page: Page,
  timeoutMs = 300_000,
): Promise<boolean> {
  await navigateWithRetry(page, USAJOBS_DASHBOARD_URL, { retries: 3 });

  if (isUsaJobsLoggedIn(page)) {
    log('info', 'USAJOBS session already authenticated');
    return true;
  }

  return waitForUsaJobsLogin(page, timeoutMs);
}

export async function waitForUsaJobsLogin(
  page: Page,
  timeoutMs = 300_000,
): Promise<boolean> {
  log('info', 'Waiting for USAJOBS login.gov sign-in');
  const removeOverlay = await injectUsaJobsLoginOverlay(page);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (isUsaJobsLoggedIn(page)) {
      log('info', 'USAJOBS login detected');
      await removeOverlay();
      return true;
    }

    if (page.url().includes('login.usajobs.gov')) {
      try {
        await page.click('a[href*="/account/acknowledgement"]', {
          timeout: 500,
        });
      } catch {
        // no acknowledgement link on this step, keep waiting
      }
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  await removeOverlay();
  return false;
}

async function injectUsaJobsLoginOverlay(
  page: Page,
): Promise<() => Promise<void>> {
  try {
    await page.evaluate(() => {
      const existing = document.getElementById('jb-usajobs-overlay');
      if (existing) existing.remove();
      const div = document.createElement('div');
      div.id = 'jb-usajobs-overlay';
      div.innerHTML = `
        <div style="
          position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
          background: #1a1a2e; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          padding: 20px 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
          display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
        ">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:24px">🔐</span>
            <div>
              <div style="font-weight:700;font-size:15px">Sign in to USAJOBS (login.gov)</div>
              <div style="font-size:13px;opacity:0.8">
                This is a one-time step. Your session will be saved.
              </div>
            </div>
          </div>
          <div style="display:flex;gap:20px;margin-left:auto;font-size:13px;opacity:0.9">
            <span>1. Agree to continue</span>
            <span>→</span>
            <span>2. Sign in with login.gov</span>
            <span>→</span>
            <span>3. Complete MFA if prompted</span>
            <span>→</span>
            <span>4. Wait — jobs will be fetched automatically</span>
          </div>
        </div>`;
      document.body.prepend(div);
    });
  } catch {
    // page may not be ready yet
  }
  return async () => {
    try {
      await page.evaluate(() => {
        document.getElementById('jb-usajobs-overlay')?.remove();
      });
    } catch {
      // ignore
    }
  };
}
