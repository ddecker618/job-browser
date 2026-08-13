import type { WebContents } from 'electron';

export const DESKTOP_SMOKE_ROUTES = [
  '/jobs',
  '/applications',
  '/sources',
  '/employers',
  '/settings',
] as const;
export type DesktopSmokeRoute = (typeof DESKTOP_SMOKE_ROUTES)[number];

export function resolveDesktopSmokeRoute(
  currentUrl: string,
  route: DesktopSmokeRoute,
): string {
  if (!(DESKTOP_SMOKE_ROUTES as readonly string[]).includes(route)) {
    throw new Error(`Desktop smoke route is not allowed: ${route}`);
  }
  return new URL(route, loopbackOrigin(currentUrl)).toString();
}

export async function loadDesktopSmokeRoute(
  contents: WebContents,
  route: DesktopSmokeRoute,
): Promise<void> {
  await contents.loadURL(resolveDesktopSmokeRoute(contents.getURL(), route));
}

export function resolveDesktopSmokeApplicationDetailUrl(
  currentUrl: string,
  applicationId: string,
): string {
  if (applicationId.trim() === '' || applicationId.length > 200) {
    throw new Error('Desktop smoke Application ID is invalid');
  }
  return new URL(
    `/applications/${encodeURIComponent(applicationId)}`,
    loopbackOrigin(currentUrl),
  ).toString();
}

export async function loadDesktopSmokeApplicationDetail(
  contents: WebContents,
  applicationId: string,
): Promise<void> {
  await contents.loadURL(
    resolveDesktopSmokeApplicationDetailUrl(contents.getURL(), applicationId),
  );
}

export interface ApplicationListSmokeResponse {
  items: unknown[];
  nextCursor: string | null;
}

export function isApplicationListSmokeResponse(
  value: unknown,
): value is ApplicationListSmokeResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as { items?: unknown; nextCursor?: unknown };
  return (
    Array.isArray(response.items) &&
    (response.nextCursor === null || typeof response.nextCursor === 'string')
  );
}

export function applicationIdFromSmokeCreateResponse(
  value: unknown,
  expectedJobId: string,
  expectedEventId: string,
): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const response = value as {
    application?: { id?: unknown; jobId?: unknown };
    event?: { id?: unknown };
    replayed?: unknown;
  };
  const applicationId = response.application?.id;
  return typeof applicationId === 'string' &&
    applicationId.trim() !== '' &&
    applicationId.length <= 200 &&
    response.application?.jobId === expectedJobId &&
    response.event?.id === expectedEventId &&
    typeof response.replayed === 'boolean'
    ? applicationId
    : null;
}

function loopbackOrigin(currentUrl: string): string {
  const current = new URL(currentUrl);
  if (
    current.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(current.hostname)
  ) {
    throw new Error('Desktop smoke navigation requires a loopback HTTP origin');
  }
  return current.origin;
}
