import { DesktopStartupError } from './errors.js';

export const STARTUP_STAGES = [
  'Preparing application',
  'Locating database',
  'Checking database',
  'Backing up database',
  'Applying database updates',
  'Starting local service',
  'Loading dashboard',
  'Ready',
] as const;
export type StartupStage = (typeof STARTUP_STAGES)[number];

export async function waitForHealth(
  url: string,
  timeoutMs = 15_000,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetcher(`${url}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return;
    } catch {
      // The backend may still be entering its listening state.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new DesktopStartupError(
    'health-timeout',
    'The local Job Browser service did not become ready in time.',
  );
}
