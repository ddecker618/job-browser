import type { WebContents } from 'electron';

export const DESKTOP_SMOKE_ROUTES = ['/jobs', '/sources', '/settings'] as const;
export type DesktopSmokeRoute = (typeof DESKTOP_SMOKE_ROUTES)[number];

export function resolveDesktopSmokeRoute(
  currentUrl: string,
  route: DesktopSmokeRoute,
): string {
  if (!(DESKTOP_SMOKE_ROUTES as readonly string[]).includes(route)) {
    throw new Error(`Desktop smoke route is not allowed: ${route}`);
  }
  const current = new URL(currentUrl);
  if (
    current.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(current.hostname)
  ) {
    throw new Error('Desktop smoke navigation requires a loopback HTTP origin');
  }
  return new URL(route, current.origin).toString();
}

export async function loadDesktopSmokeRoute(
  contents: WebContents,
  route: DesktopSmokeRoute,
): Promise<void> {
  await contents.loadURL(resolveDesktopSmokeRoute(contents.getURL(), route));
}
