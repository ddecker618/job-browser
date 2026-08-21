import type { ProviderConfiguration } from '../models/source-management.js';

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref',
  'ref_src',
  'ref_source',
  'spm',
  'spm_id_from',
  'ytclid',
  'zd_source',
  'zd_campaign',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
]);

function parseHttpUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function stripWww(hostname: string): string {
  return hostname.startsWith('www.') && hostname.split('.').length > 2
    ? hostname.slice(4)
    : hostname;
}

function collapseSlashes(pathname: string): string {
  return pathname.replace(/\/{2,}/g, '/');
}

/**
 * Canonical URL identity used for cross-source and manifest dedup.
 *
 * Lowercases the host, strips `www.` only when a second-level label remains,
 * removes fragments, default ports, and known tracking parameters, sorts the
 * remaining query parameters, collapses repeated slashes, and trims a trailing
 * slash. Paths and ATS tenant ids are preserved. Returns null for invalid or
 * non-HTTP(S) URLs.
 */
export function normalizeUrlIdentity(input: string): string | null {
  const url = parseHttpUrl(input);
  if (url === null) return null;
  const clean = new URL(url.toString());
  clean.hash = '';
  clean.username = '';
  clean.password = '';
  clean.hostname = stripWww(clean.hostname);
  const defaultPort = clean.protocol === 'https:' ? '443' : '80';
  if (clean.port === '' || clean.port === defaultPort) clean.port = '';
  const keptKeys = [...new Set(clean.searchParams.keys())].filter(
    (key) => !TRACKING_PARAMS.has(key.toLowerCase()),
  );
  const keptParams: [string, string][] = [];
  for (const key of keptKeys) {
    for (const value of clean.searchParams.getAll(key)) {
      keptParams.push([key, value]);
    }
  }
  clean.search = '';
  keptParams.sort(
    (a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]),
  );
  for (const [key, value] of keptParams) clean.searchParams.append(key, value);
  const pathname = collapseSlashes(clean.pathname).replace(/\/+$/, '');
  clean.pathname = pathname === '' ? '/' : pathname;
  return clean.toString();
}

/**
 * Domain identity for exact employer domain matching. Accepts either a bare
 * hostname or a full URL. Returns null when no usable host can be derived.
 */
export function normalizeDomainIdentity(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  let host: string;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    const url = parseHttpUrl(trimmed);
    if (url === null) return null;
    host = url.hostname;
  } else {
    host = trimmed.split(/[/?#]/)[0] ?? '';
  }
  host = stripWww(host.toLowerCase().replace(/\.$/, ''));
  if (host.length === 0) return null;
  return host.split(':')[0] ?? null;
}

/** Normalizes an employer name the same way `employers.normalized_name` is stored. */
export function normalizeEmployerName(name: string): string {
  return name.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
}

/** Deterministic, recursively key-sorted JSON used for Source configuration equality. */
export function canonicalConfigJson(
  configuration: ProviderConfiguration,
): string {
  return JSON.stringify(sortKeys(configuration));
}

/**
 * Stable ATS tenant identity extracted from a provider configuration.
 *
 * Two career sites that produce the same provider + tenant identity are the
 * same ATS board even when their submitted URLs differ (for example a
 * Greenhouse board_token or a Workday tenant/site pair).
 */
export function atsTenantIdentity(
  providerId: string,
  configuration: ProviderConfiguration | null,
): string | null {
  if (configuration === null) return null;
  const value = (key: string): string | null =>
    typeof configuration[key] === 'string' && configuration[key] !== ''
      ? configuration[key]
      : null;
  switch (providerId) {
    case 'greenhouse': {
      const boardToken = value('boardToken');
      return boardToken === null ? null : `greenhouse:${boardToken}`;
    }
    case 'lever': {
      const site = value('site');
      return site === null ? null : `lever:${site}`;
    }
    case 'ashby': {
      const boardName = value('boardName');
      return boardName === null ? null : `ashby:${boardName}`;
    }
    case 'workday': {
      const tenant = value('tenant');
      const site = value('site');
      return tenant === null
        ? null
        : `workday:${tenant}${site === null ? '' : `:${site}`}`;
    }
    case 'cisco':
      return 'workday:cisco:Cisco_Careers';
    case 'crowdstrike':
      return 'workday:crowdstrike:crowdstrikecareers';
    case 'smartrecruiters': {
      const identifier = value('companyIdentifier');
      return identifier === null ? null : `smartrecruiters:${identifier}`;
    }
    case 'bamboohr': {
      const companyDomain = value('companyDomain');
      return companyDomain === null ? null : `bamboohr:${companyDomain}`;
    }
    case 'recruitee': {
      const company = value('company');
      return company === null ? null : `recruitee:${company}`;
    }
    case 'teamtailor': {
      const company = value('company');
      return company === null ? null : `teamtailor:${company}`;
    }
    case 'workable': {
      const subdomain = value('subdomain');
      return subdomain === null ? null : `workable:${subdomain}`;
    }
    case 'icims': {
      const company = value('company');
      return company === null ? null : `icims:${company}`;
    }
    default:
      return null;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}
