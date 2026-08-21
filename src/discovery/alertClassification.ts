export type AlertClassification =
  | 'unsupported-platform'
  | 'pending-credentials'
  | 'browser-session'
  | 'anti-bot'
  | 'transient-network'
  | 'invalid-url'
  | 'chronic-provider-failure'
  | 'legitimate-zero-openings'
  | 'zero-yield-regression'
  | 'scheduler-downtime'
  | 'overdue-run'
  | 'broken';

export const BROWSER_SESSION_PROVIDER_IDS: readonly string[] = [
  'linkedin',
  'dice',
  'indeed',
  'wellfound',
  'ziprecruiter',
  'handshake',
  'usajobs',
];

export function isBrowserSessionProvider(providerId: string | null): boolean {
  return (
    providerId !== null && BROWSER_SESSION_PROVIDER_IDS.includes(providerId)
  );
}

export interface ClassifiedFailure {
  classification: AlertClassification;
  severityCap: 'WARNING' | 'CRITICAL';
  action: string;
}

export function classifySourceFailure(
  providerId: string | null,
  configurationStatus: string | null,
  latestErrorMessage: string | null,
): ClassifiedFailure {
  if (isBrowserSessionProvider(providerId)) {
    return {
      classification: 'browser-session',
      severityCap: 'WARNING',
      action:
        'Complete the manual login or security check in the visible browser session, then re-run discovery. Browser-session sources are never auto-disabled.',
    };
  }
  const message = latestErrorMessage ?? '';
  if (
    configurationStatus === 'credentials-required' ||
    /credential/i.test(message)
  ) {
    return {
      classification: 'pending-credentials',
      severityCap: 'WARNING',
      action:
        'Configure the required credentials in desktop Settings, then re-run discovery. Zero yield before credentials is not evidence of a broken source.',
    };
  }
  if (/could not be resolved|timed out|socket|econn/i.test(message)) {
    return {
      classification: 'transient-network',
      severityCap: 'WARNING',
      action:
        'Transient network or DNS failure; retry-aware backoff already applies. Re-check after the next scheduled cycle before escalating.',
    };
  }
  if (/403|429|blocked|access denied/i.test(message)) {
    return {
      classification: 'anti-bot',
      severityCap: 'WARNING',
      action:
        'The target is rate-limiting or blocking automated requests. Respect Retry-After, slow the cadence, and never bypass protections.',
    };
  }
  if (/unreachable or inactive/i.test(message)) {
    return {
      classification: 'chronic-provider-failure',
      severityCap: 'CRITICAL',
      action:
        'The connector reports the target as categorically unreachable. Verify the employer still exists at this endpoint, then repair or disable the source with a documented reason.',
    };
  }
  return {
    classification: 'broken',
    severityCap: 'CRITICAL',
    action:
      'Inspect the latest run error and failed-run artifacts, then repair or disable the source with a documented reason.',
  };
}

export interface ClassifiedSiteHealth {
  classification: AlertClassification;
  severityCap: 'WARNING' | 'CRITICAL';
  action: string;
}

export function classifyCareerSiteHealth(
  healthStatus: string,
  healthMessage: string | null,
): ClassifiedSiteHealth {
  const message = healthMessage ?? '';
  if (/invalid or not allowed/i.test(message)) {
    return {
      classification: 'invalid-url',
      severityCap: 'WARNING',
      action:
        'The stored careers URL is unresolvable or rejected by URL policy. Verify the official careers domain and update the employer record; do not treat this as a broken ATS.',
    };
  }
  if (/no supported ATS signals/i.test(message)) {
    return {
      classification: 'unsupported-platform',
      severityCap: 'WARNING',
      action:
        'The site is reachable but runs a platform without a supported connector. Repair only after confirming a supported ATS endpoint; otherwise keep as registry context.',
    };
  }
  if (/blocked \(HTTP 403\)|HTTP 429|access denied/i.test(message)) {
    return {
      classification: 'anti-bot',
      severityCap: 'WARNING',
      action:
        'Automated access is being blocked. This is visible but must not be labeled permanently broken; retry with slower cadence and respect protections.',
    };
  }
  if (/could not be resolved|dns/i.test(message)) {
    return {
      classification: 'transient-network',
      severityCap: 'WARNING',
      action:
        'DNS resolution failed transiently. Health checks retry automatically; escalate only if the failure persists across cycles.',
    };
  }
  return {
    classification: 'broken',
    severityCap: 'CRITICAL',
    action:
      'The health check reports a genuine failure. Inspect retained verification history, then repair or retire the site with documented evidence.',
  };
}
