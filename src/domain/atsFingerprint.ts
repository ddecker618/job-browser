import type { AtsSupportState } from '../models/source-management.js';
import type {
  CareerSiteFingerprint,
} from '../models/employer.js';

export const FINGERPRINT_VERSION = 'ats-fingerprint-v1';

interface UrlMatchEvidence {
  kind: string;
  detail: string;
  confidence: number;
}

interface UrlMatch {
  platform: string;
  provider: string | null;
  configuration: Record<string, unknown> | null;
  confidence: number;
  evidence: UrlMatchEvidence[];
  variant: string | null;
  listingsUrl: string | null;
  sitemapUrl: string | null;
  portalOrigin: string | null;
}

const DETECTED_ONLY_HOSTS: readonly [string, string][] = [
  ['jazzhr.com', 'JazzHR'],
  ['applytojob.com', 'JazzHR'],
  ['jobvite.com', 'Jobvite'],
  ['taleo.net', 'Taleo'],
  ['oraclecloud.com', 'Oracle Recruiting Cloud'],
  ['successfactors.com', 'SuccessFactors'],
  ['successfactors.eu', 'SuccessFactors'],
  ['jobs.sap.com', 'SuccessFactors'],
];

const PROVIDER_IDS = new Set([
  'greenhouse',
  'lever',
  'ashby',
  'workday',
  'workable',
  'smartrecruiters',
  'bamboohr',
  'recruitee',
  'teamtailor',
  'icims',
]);

function normalizeUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function displaySlug(value: string): string {
  return value.replaceAll(/[-_]+/g, ' ').trim();
}

function companyFromHost(hostname: string): string {
  const parts = hostname.split('.');
  const candidate =
    /^(?:careers|jobs)$/i.test(parts[0] ?? '') && parts.length > 2
      ? parts[1]
      : parts[0];
  return displaySlug(candidate ?? hostname);
}

function icimsCompanyFromHost(hostname: string): string {
  if (hostname.endsWith('.icims.com')) {
    const subdomain = hostname.slice(0, -'.icims.com'.length);
    return subdomain.startsWith('careers-')
      ? displaySlug(subdomain.slice('careers-'.length))
      : subdomain.startsWith('jobs-')
        ? displaySlug(subdomain.slice('jobs-'.length))
        : displaySlug(subdomain);
  }
  return companyFromHost(hostname);
}

function supportedMatch(
  platform: string,
  provider: string | null,
  configuration: Record<string, unknown> | null,
  confidence: number,
  evidence: UrlMatchEvidence[],
  variant: string | null,
  listingsUrl: string | null,
  sitemapUrl: string | null,
  portalOrigin: string | null,
): UrlMatch {
  return {
    platform,
    provider,
    configuration,
    confidence,
    evidence,
    variant,
    listingsUrl,
    sitemapUrl,
    portalOrigin,
  };
}

function matchUrl(url: URL): UrlMatch | null {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
    const boardToken =
      url.searchParams.get('board_token') ??
      url.searchParams.get('for') ??
      (parts[0] === 'widgets' && parts[1] !== undefined
        ? parts[1]
        : parts[0] === 'embed' && parts[1] === 'job_board'
          ? parts[2]
          : parts[0]);
    if (boardToken && boardToken !== 'embed' && boardToken !== 'widgets') {
      return supportedMatch(
        'Greenhouse',
        'greenhouse',
        { boardToken, company: displaySlug(boardToken) },
        0.99,
        [
          {
            kind: 'hostname',
            detail: `Hostname ${host} is a known Greenhouse board host.`,
            confidence: 0.99,
          },
          {
            kind: 'board_token',
            detail: `Board token "${boardToken}" extracted from URL path.`,
            confidence: 0.99,
          },
        ],
        null,
        null,
        null,
        null,
      );
    }
  }

  if (host === 'jobs.lever.co') {
    return supportedMatch(
      'Lever',
      'lever',
      parts[0]
        ? { site: parts[0], company: displaySlug(parts[0]) }
        : null,
      0.99,
      [
        {
          kind: 'hostname',
          detail: 'Hostname is jobs.lever.co, a known Lever job board host.',
          confidence: 0.99,
        },
      ],
      null,
      null,
      null,
      null,
    );
  }

  if (host === 'jobs.ashbyhq.com') {
    return supportedMatch(
      'Ashby',
      'ashby',
      parts[0]
        ? { boardName: parts[0], company: displaySlug(parts[0]) }
        : null,
      0.99,
      [
        {
          kind: 'hostname',
          detail: 'Hostname is jobs.ashbyhq.com, a known Ashby job board host.',
          confidence: 0.99,
        },
      ],
      null,
      null,
      null,
      null,
    );
  }

  if (host.endsWith('.myworkdayjobs.com')) {
    const cxs = parts.indexOf('cxs');
    const tenant = cxs >= 0 ? parts[cxs + 1] : host.split('.')[0];
    const site =
      cxs >= 0
        ? parts[cxs + 2]
        : /^\w{2}(?:-\w{2})?$/i.test(parts[0] ?? '')
          ? parts[1]
          : parts[0];
    return supportedMatch(
      'Workday',
      'workday',
      tenant && site ? { origin: url.origin, tenant, site } : null,
      0.98,
      [
        {
          kind: 'hostname',
          detail: `Hostname ${host} ends with .myworkdayjobs.com, a known Workday host.`,
          confidence: 0.98,
        },
      ],
      null,
      null,
      null,
      null,
    );
  }

  if (
    host === 'jobs.smartrecruiters.com' ||
    host === 'careers.smartrecruiters.com'
  ) {
    return supportedMatch(
      'SmartRecruiters',
      'smartrecruiters',
      parts[0]
        ? {
            companyIdentifier: parts[0],
            company: displaySlug(parts[0]),
          }
        : null,
      0.99,
      [
        {
          kind: 'hostname',
          detail: `Hostname ${host} is a known SmartRecruiters host.`,
          confidence: 0.99,
        },
      ],
      null,
      null,
      null,
      null,
    );
  }

  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.bamboohr\.com$/i.test(host)) {
    const companyDomain = host.slice(0, -'.bamboohr.com'.length);
    return supportedMatch(
      'BambooHR',
      'bamboohr',
      companyDomain
        ? { companyDomain, company: displaySlug(companyDomain) }
        : null,
      0.99,
      [
        {
          kind: 'hostname',
          detail: `Hostname ${host} matches BambooHR pattern.`,
          confidence: 0.99,
        },
      ],
      null,
      null,
      null,
      null,
    );
  }

  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.recruitee\.com$/i.test(host)) {
    const company = host.slice(0, -'.recruitee.com'.length);
    return supportedMatch(
      'Recruitee',
      'recruitee',
      { origin: url.origin, company },
      0.98,
      [
        {
          kind: 'hostname',
          detail: `Hostname ${host} matches Recruitee pattern.`,
          confidence: 0.98,
        },
      ],
      null,
      null,
      null,
      null,
    );
  }

  if (host.endsWith('.teamtailor.com')) {
    const subdomain = host.split('.')[0] ?? '';
    const feedUrl = /(?:rss|feed|\.xml)$/i.test(url.pathname)
      ? url.toString()
      : `https://${host}/jobs.rss`;
    return supportedMatch(
      'Teamtailor',
      'teamtailor',
      { feedUrl, company: displaySlug(subdomain) },
      0.99,
      [
        {
          kind: 'hostname',
          detail: `Hostname ${host} ends with .teamtailor.com.`,
          confidence: 0.99,
        },
      ],
      null,
      null,
      null,
      null,
    );
  }

  if (host === 'apply.workable.com') {
    const subdomain = parts[0];
    if (subdomain && !/^(?:j|api)/.test(subdomain)) {
      return supportedMatch(
        'Workable',
        'workable',
        { subdomain, company: displaySlug(subdomain) },
        0.99,
        [
          {
            kind: 'hostname',
            detail: `Hostname is apply.workable.com with subdomain "${subdomain}".`,
            confidence: 0.99,
          },
        ],
        null,
        null,
        null,
        null,
      );
    }
  }

  if (host === 'www.workable.com' || host === 'workable.com') {
    const subdomain = parts[0];
    if (subdomain && parts[1] === undefined) {
      return supportedMatch(
        'Workable',
        'workable',
        { subdomain, company: displaySlug(subdomain) },
        0.95,
        [
          {
            kind: 'hostname',
            detail: `Hostname is workable.com with subdomain "${subdomain}".`,
            confidence: 0.95,
          },
        ],
        null,
        null,
        null,
        null,
      );
    }
  }

  if (host.endsWith('.icims.com')) {
    const company = icimsCompanyFromHost(host);
    return supportedMatch(
      'iCIMS',
      'icims',
      { origin: url.origin, company },
      0.98,
      [
        {
          kind: 'hostname',
          detail: `Hostname ${host} ends with .icims.com.`,
          confidence: 0.98,
        },
      ],
      null,
      null,
      null,
      null,
    );
  }

  for (const [suffix, platform] of DETECTED_ONLY_HOSTS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) {
      return supportedMatch(
        platform,
        null,
        null,
        0.98,
        [
          {
            kind: 'hostname',
            detail: `Hostname ${host} matches known platform "${platform}".`,
            confidence: 0.98,
          },
        ],
        null,
        null,
        null,
        null,
      );
    }
  }

  return null;
}

function isSupportedProvider(provider: string | null): boolean {
  return provider !== null && PROVIDER_IDS.has(provider);
}

export interface CareerSiteProviderSignal {
  providerId: string;
  platform: string;
  configuration: Record<string, unknown> | null;
}

export function detectCareerSiteProvider(
  urlString: string,
): CareerSiteProviderSignal | null {
  const normalized = normalizeUrl(urlString);
  if (normalized === null) return null;
  const match = matchUrl(normalized);
  if (match === null || !isSupportedProvider(match.provider)) return null;
  return {
    providerId: match.provider ?? '',
    platform: match.platform,
    configuration: match.configuration,
  };
}

export function fingerprintCareerSiteUrl(
  urlString: string,
): CareerSiteFingerprint {
  const observedAt = new Date().toISOString();
  const normalized = normalizeUrl(urlString);

  if (normalized === null) {
    return {
      atsPlatform: null,
      atsDetectedProvider: null,
      confidence: 0,
      confidenceLabel: 'low',
      supportState: 'unsupported',
      evidence: [],
      detectedVariant: null,
      listingsUrl: null,
      sitemapUrl: null,
      portalOrigin: null,
      explanation: 'The careers site URL is invalid or malformed.',
      detectionVersion: FINGERPRINT_VERSION,
      observedAt,
      structuredFallback: false,
      failureCategory: 'invalid_url',
    };
  }

  const match = matchUrl(normalized);

  if (match === null) {
    return {
      atsPlatform: null,
      atsDetectedProvider: null,
      confidence: 0,
      confidenceLabel: 'low',
      supportState: 'unsupported',
      evidence: [],
      detectedVariant: null,
      listingsUrl: null,
      sitemapUrl: null,
      portalOrigin: null,
      explanation:
        'The site was reachable by DNS, but no supported ATS URL pattern was identified.',
      detectionVersion: FINGERPRINT_VERSION,
      observedAt,
      structuredFallback: false,
      failureCategory: 'no_signals',
    };
  }

  const providerSupported = isSupportedProvider(match.provider);
  const supportState: AtsSupportState = providerSupported
    ? match.configuration !== null
      ? 'supported'
      : 'supported-with-configuration'
    : 'detected-but-unsupported';

  const explanation = providerSupported
    ? match.configuration !== null
      ? `${match.platform} was detected and its public configuration was extracted.`
      : `${match.platform} was detected, but configuration must be confirmed.`
    : `${match.platform} was detected but does not map to a supported Job Browser provider.`;

  const evidenceRows = match.evidence.map((ev) => ({
    kind: ev.kind,
    detail: ev.detail,
    confidence: ev.confidence,
    observedAt,
  }));

  return {
    atsPlatform: match.platform,
    atsDetectedProvider: providerSupported ? (match.provider ?? null) : null,
    confidence: match.confidence,
    confidenceLabel:
      match.confidence >= 0.85 ? 'high' : match.confidence >= 0.5 ? 'medium' : 'low',
    supportState,
    evidence: evidenceRows,
    detectedVariant: match.variant,
    listingsUrl: match.listingsUrl,
    sitemapUrl: match.sitemapUrl,
    portalOrigin: match.portalOrigin,
    explanation,
    detectionVersion: FINGERPRINT_VERSION,
    observedAt,
    structuredFallback: false,
    failureCategory: providerSupported ? null : 'unsupported',
  };
}
