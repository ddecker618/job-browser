const MANUAL_ACCEPTANCE_FLAG = 'JOB_BROWSER_ONBOARDING_ACCEPTANCE_MODE';

let blockedProviderAccessAttempts = 0;

export interface ManualAcceptanceNetworkStatus {
  readonly enabled: boolean;
  readonly providerRequestsStarted: 0;
  readonly blockedProviderAccessAttempts: number;
}

export function manualOnboardingAcceptanceEnabled(): boolean {
  return process.env[MANUAL_ACCEPTANCE_FLAG] === '1';
}

/**
 * Final network interlock for provider HTTP and Playwright entry points.
 * Manual onboarding acceptance must not reach any source, even if another
 * route accidentally retains a real coordinator.
 */
export function assertExternalProviderAccessAllowed(): void {
  if (!manualOnboardingAcceptanceEnabled()) return;
  blockedProviderAccessAttempts += 1;
  throw new Error(
    'External provider access is disabled during manual onboarding acceptance.',
  );
}

export function manualAcceptanceNetworkStatus(): ManualAcceptanceNetworkStatus {
  return {
    enabled: manualOnboardingAcceptanceEnabled(),
    providerRequestsStarted: 0,
    blockedProviderAccessAttempts,
  };
}
