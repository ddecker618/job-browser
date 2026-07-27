import { parse, type DefaultTreeAdapterMap } from 'parse5';

import type { AtsDetectionResult } from '../models/source-management.js';
import {
  boundedPublicFetch,
  type BoundedPublicFetchOptions,
  type PublicFetchResponse,
} from '../security/boundedPublicFetch.js';
import { validatePublicUrl } from '../security/publicUrlPolicy.js';

type FetchPublic = (
  url: string | URL,
  options?: BoundedPublicFetchOptions,
) => Promise<PublicFetchResponse>;

export interface AtsDetectorOptions {
  fetchPublic?: FetchPublic;
  signal?: AbortSignal;
}

interface Match {
  platform: string;
  provider: string | null;
  configuration: Record<string, unknown> | null;
  confidence: number;
}

const MAX_HTML_NODES = 25_000;
const MAX_HTML_DEPTH = 64;
const MAX_HTML_EVIDENCE = 2_000;

const DETECTED_ONLY = new Map<string, string>([
  ['jazzhr.com', 'JazzHR'],
  ['applytojob.com', 'JazzHR'],
  ['jobvite.com', 'Jobvite'],
  ['taleo.net', 'Taleo'],
  ['oraclecloud.com', 'Oracle Recruiting Cloud'],
  ['successfactors.com', 'SuccessFactors'],
  ['successfactors.eu', 'SuccessFactors'],
  ['jobs.sap.com', 'SuccessFactors'],
]);

async function probeModernIcims(
  origin: string,
  options: AtsDetectorOptions,
): Promise<boolean> {
  try {
    const probeRes = await (options.fetchPublic ?? boundedPublicFetch)(
      new URL('/api/jobs?limit=1', origin),
      {
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        timeoutMs: 3000,
        maxBytes: 128 * 1024,
      },
    );
    if (probeRes.status === 200) {
      const json = JSON.parse(probeRes.text()) as { jobs?: unknown };
      return Array.isArray(json.jobs);
    }
  } catch {
    // Ignore
  }
  return false;
}

async function probeHostedV2(
  origin: string,
  options: AtsDetectorOptions,
): Promise<boolean> {
  try {
    const probeRes = await (options.fetchPublic ?? boundedPublicFetch)(
      new URL('/jobs/search?json=true', origin),
      {
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        timeoutMs: 3000,
        maxBytes: 128 * 1024,
      },
    );
    if (probeRes.status === 200) {
      const text = probeRes.text();
      try {
        const json = JSON.parse(text) as unknown;
        return typeof json === 'object' && json !== null;
      } catch {
        return false;
      }
    }
  } catch {
    // Ignore
  }
  return false;
}

async function probeSitemap(
  origin: string,
  options: AtsDetectorOptions,
): Promise<boolean> {
  try {
    const probeRes = await (options.fetchPublic ?? boundedPublicFetch)(
      new URL('/sitemap.xml', origin),
      {
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        timeoutMs: 3000,
        maxBytes: 64 * 1024,
      },
    );
    if (probeRes.status === 200) {
      const text = probeRes.text().toLowerCase();
      return text.includes('<urlset') || text.includes('<sitemapindex');
    }
  } catch {
    // Ignore
  }
  return false;
}

export async function detectAts(
  input: string,
  options: AtsDetectorOptions = {},
): Promise<AtsDetectionResult> {
  let initial: URL;
  try {
    initial = validatePublicUrl(input);
  } catch {
    return {
      detectedPlatform: null,
      confidence: 0,
      supportState: 'unsupported',
      suggestedProvider: null,
      extractedConfiguration: null,
      structuredFallback: false,
      explanation: 'The careers site URL is invalid or malformed.',
      resolvedUrl: input,
      requestedUrl: input,
      normalizedUrl: input,
      finalUrl: input,
      httpStatus: null,
      providersChecked: [
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
      ],
      positiveSignals: [],
      negativeProbes: [],
      failureCategory: 'invalid_url',
    };
  }

  let response: PublicFetchResponse | null = null;
  let failureCategory: AtsDetectionResult['failureCategory'] = null;
  let httpStatus: number | null = null;
  let explanation = '';
  const positiveSignals: string[] = [];
  const negativeProbes: string[] = [];

  try {
    response = await (options.fetchPublic ?? boundedPublicFetch)(initial, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      maxBytes: 2 * 1024 * 1024,
      maxRedirects: 3,
      timeoutMs: 10_000,
    });
    httpStatus = response.status;
    if (
      response.status === 403 ||
      response.status === 401 ||
      response.status === 429
    ) {
      failureCategory = 'blocked';
      explanation = `Access to the site was blocked (HTTP ${String(
        response.status,
      )}).`;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('timed out')) {
      failureCategory = 'timeout';
      explanation = 'The connection to the site timed out.';
    } else if (
      msg.includes('validation failed') ||
      msg.includes('SSRF') ||
      msg.includes('private')
    ) {
      failureCategory = 'invalid_url';
      explanation = 'The careers site URL is invalid or not allowed.';
    } else if (msg.includes('limit') || msg.includes('size')) {
      failureCategory = 'internal_error';
      explanation = 'The site response exceeded the maximum size limit.';
    } else {
      failureCategory = 'unreachable';
      explanation = 'The site could not be reached or resolved.';
    }
  }

  const resolved = validatePublicUrl(response?.url ?? initial);
  const html = response !== null && isHtml(response) ? response.text() : '';
  const cookies = response?.headers['set-cookie']?.toLowerCase() ?? '';

  let candidates = [
    matchUrl(resolved),
    matchUrl(initial),
    matchHtml(html, resolved),
  ].filter((value): value is Match => value !== null);

  let matchedIcims = false;
  if (
    resolved.hostname.toLowerCase().endsWith('.icims.com') ||
    initial.hostname.toLowerCase().endsWith('.icims.com')
  ) {
    matchedIcims = true;
    positiveSignals.push('Hostname ends with .icims.com');
  }
  if (html.toLowerCase().includes('icims')) {
    matchedIcims = true;
    positiveSignals.push('HTML body contains "icims"');
  }
  if (html.toLowerCase().includes('jibe')) {
    matchedIcims = true;
    positiveSignals.push('HTML body contains "jibe"');
  }
  if (cookies.includes('jasession')) {
    matchedIcims = true;
    positiveSignals.push('set-cookie header contains "jasession"');
  }

  let variant: AtsDetectionResult['variant'] = null;
  let portalOrigin: string | null = null;
  let listingsUrl: string | null = null;
  let sitemapUrl: string | null = null;

  if (matchedIcims) {
    portalOrigin = resolved.origin;
    let isModernJibe =
      cookies.includes('jasession') ||
      html.toLowerCase().includes('//(dh) jibe data object init') ||
      html.toLowerCase().includes('window.jibe');

    if (!isModernJibe && response !== null) {
      isModernJibe = await probeModernIcims(resolved.origin, options);
      if (!isModernJibe) {
        negativeProbes.push(
          'Probe of modern /api/jobs endpoint failed or was empty',
        );
      } else {
        positiveSignals.push('Probe of /api/jobs was successful');
      }
    }

    if (isModernJibe) {
      variant = 'jibe_json';
      listingsUrl = `${resolved.origin}/api/jobs`;
      positiveSignals.push('Jibe-style /api/jobs JSON variant detected.');
    } else {
      const isV2Host = resolved.hostname.toLowerCase().startsWith('internal-');
      let isV2 = isV2Host;
      if (!isV2 && response !== null) {
        isV2 = await probeHostedV2(resolved.origin, options);
      }

      if (isV2) {
        variant = 'icims_hosted_v2';
        listingsUrl = `${resolved.origin}/jobs/search?json=true`;
        positiveSignals.push('iCIMS Hosted v2 variant detected.');
      } else {
        // v1 check
        const hasSearchLink =
          html.toLowerCase().includes('/jobs/search') ||
          html.toLowerCase().includes('/jobs/intro') ||
          html.toLowerCase().includes('/jobs/') ||
          resolved.pathname.includes('/jobs/');
        const hasSitemap = await probeSitemap(resolved.origin, options);
        if (hasSitemap || hasSearchLink) {
          if (hasSitemap) {
            sitemapUrl = `${resolved.origin}/sitemap.xml`;
            positiveSignals.push('iCIMS Sitemap XML found.');
          }
          variant = 'icims_hosted_v1';
          listingsUrl = `${resolved.origin}/jobs/search?in_iframe=1`;
          positiveSignals.push('iCIMS Hosted v1 variant detected.');
        }
      }
    }

    if (variant !== null) {
      candidates = candidates.filter((c) => c.platform !== 'iCIMS');
      const company = icimsCompanyFromHost(resolved.hostname);
      const endsWithIcims = resolved.hostname
        .toLowerCase()
        .endsWith('.icims.com');
      candidates.push({
        platform: 'iCIMS',
        provider: 'icims',
        configuration: endsWithIcims
          ? {
              portalUrl: `https://${resolved.hostname}`,
              company,
              variant,
            }
          : null,
        confidence: 0.99,
      });
    } else {
      if (!failureCategory) {
        failureCategory = 'legacy_portal';
        explanation =
          'This appears to be a legacy iCIMS portal, which is not supported.';
      }
      candidates = candidates.filter((c) => c.platform !== 'iCIMS');
      candidates.push({
        platform: 'iCIMS',
        provider: null,
        configuration: null,
        confidence: 0.99,
      });
    }
  }
  const match = candidates.sort(
    (left, right) => right.confidence - left.confidence,
  )[0];

  const structuredFallback = hasJobPosting(html);
  const providersChecked = [
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
  ];

  let res: AtsDetectionResult;
  if (match === undefined) {
    if (!failureCategory) {
      failureCategory = 'no_signals';
      explanation =
        'The site was reachable, but no supported ATS signals were found.';
    }
    res = result(
      null,
      0,
      structuredFallback ? 'structured-data-fallback-available' : 'unsupported',
      structuredFallback ? 'structured-data' : null,
      structuredFallback ? { url: resolved.toString() } : null,
      structuredFallback,
      explanation || 'No known ATS or structured job data was identified.',
      resolved,
    );
  } else if (match.provider === null) {
    if (!failureCategory) {
      failureCategory =
        match.platform === 'iCIMS' ? 'legacy_portal' : 'unsupported';
      explanation =
        match.platform === 'iCIMS'
          ? 'This appears to be a legacy iCIMS portal, which is not supported.'
          : `${match.platform} is detected but is not a supported connector.`;
    }
    res = result(
      match.platform,
      match.confidence,
      'detected-but-unsupported',
      structuredFallback ? 'structured-data' : null,
      null,
      structuredFallback,
      explanation,
      resolved,
      structuredFallback ? { url: resolved.toString() } : null,
    );
  } else {
    const configured = match.configuration !== null;
    res = result(
      match.platform,
      match.confidence,
      configured ? 'supported' : 'supported-with-configuration',
      match.provider,
      match.configuration,
      structuredFallback,
      configured
        ? `${match.platform} was detected and its public configuration was extracted. Confirm before creating a source.`
        : `${match.platform} was detected, but configuration must be confirmed before creating a source.`,
      resolved,
      null,
      variant,
      portalOrigin,
      listingsUrl,
      sitemapUrl,
    );
  }

  res.requestedUrl = input;
  res.normalizedUrl = initial.toString();
  res.finalUrl = resolved.toString();
  res.httpStatus = httpStatus;
  res.providersChecked = providersChecked;
  res.positiveSignals = positiveSignals;
  res.negativeProbes = negativeProbes;
  res.failureCategory = failureCategory;

  return res;
}

function matchUrl(url: URL): Match | null {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
    const boardToken =
      url.searchParams.get('board_token') ??
      (parts[0] === 'widgets' && parts[1] === 'jobs'
        ? parts[2]
        : parts[0] === 'embed' && parts[1] === 'job_board'
          ? url.searchParams.get('board_token')
          : parts[0]);
    if (boardToken && boardToken !== 'embed' && boardToken !== 'widgets') {
      return supported(
        'Greenhouse',
        'greenhouse',
        { boardToken, company: displaySlug(boardToken) },
        0.99,
      );
    }
  }
  if (host === 'jobs.lever.co')
    return supported(
      'Lever',
      'lever',
      parts[0] ? { site: parts[0], company: displaySlug(parts[0]) } : null,
      0.99,
    );
  if (host === 'jobs.ashbyhq.com')
    return supported(
      'Ashby',
      'ashby',
      parts[0] ? { boardName: parts[0], company: displaySlug(parts[0]) } : null,
      0.99,
    );
  if (host.endsWith('.myworkdayjobs.com')) {
    const cxs = parts.indexOf('cxs');
    const tenant = cxs >= 0 ? parts[cxs + 1] : host.split('.')[0];
    const site =
      cxs >= 0
        ? parts[cxs + 2]
        : /^\w{2}(?:-\w{2})?$/i.test(parts[0] ?? '')
          ? parts[1]
          : parts[0];
    return supported(
      'Workday',
      'workday',
      tenant && site ? { origin: url.origin, tenant, site } : null,
      0.98,
    );
  }
  if (
    host === 'jobs.smartrecruiters.com' ||
    host === 'careers.smartrecruiters.com'
  )
    return supported(
      'SmartRecruiters',
      'smartrecruiters',
      parts[0]
        ? {
            companyIdentifier: parts[0],
            company: displaySlug(parts[0]),
          }
        : null,
      0.99,
    );
  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.bamboohr\.com$/i.test(host)) {
    const companyDomain = host.slice(0, -'.bamboohr.com'.length);
    return supported(
      'BambooHR',
      'bamboohr',
      companyDomain
        ? { companyDomain, company: displaySlug(companyDomain) }
        : null,
      0.99,
    );
  }
  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.recruitee\.com$/i.test(host)) {
    const company = host.slice(0, -'.recruitee.com'.length);
    return supported(
      'Recruitee',
      'recruitee',
      { origin: url.origin, company },
      0.98,
    );
  }
  if (host.endsWith('.teamtailor.com')) {
    const subdomain = host.split('.')[0] ?? '';
    const feedUrl = /(?:rss|feed|\.xml)$/i.test(url.pathname)
      ? url.toString()
      : `https://${host}/jobs.rss`;
    return supported(
      'Teamtailor',
      'teamtailor',
      {
        feedUrl,
        company: displaySlug(subdomain),
      },
      0.99,
    );
  }
  if (host === 'apply.workable.com') {
    const subdomain = parts[0];
    if (subdomain && !/^(?:j|api)/.test(subdomain)) {
      return supported(
        'Workable',
        'workable',
        {
          subdomain,
          company: displaySlug(subdomain),
        },
        0.99,
      );
    }
  }
  if (host === 'www.workable.com' || host === 'workable.com') {
    const subdomain = parts[0];
    if (subdomain && parts[1] === undefined) {
      return supported(
        'Workable',
        'workable',
        {
          subdomain,
          company: displaySlug(subdomain),
        },
        0.95,
      );
    }
  }
  if (host.endsWith('.icims.com')) {
    return {
      platform: 'iCIMS',
      provider: null,
      configuration: null,
      confidence: 0.98,
    };
  }
  for (const [suffix, platform] of DETECTED_ONLY) {
    if (host === suffix || host.endsWith(`.${suffix}`))
      return {
        platform,
        provider: null,
        configuration: null,
        confidence: 0.98,
      };
  }
  return null;
}

function matchHtml(html: string, base: URL): Match | null {
  if (html === '') return null;
  const document = parse(html);
  const evidence: string[] = [];
  const rssAlternates: URL[] = [];
  walkBounded(document, (node) => {
    if (!('attrs' in node)) return;
    const element = node as DefaultTreeAdapterMap['element'];
    const attributes = new Map(
      element.attrs.map((attribute) => [attribute.name, attribute.value]),
    );
    for (const attribute of element.attrs) {
      if (['href', 'action', 'content'].includes(attribute.name))
        evidence.push(attribute.value);
    }
    if (
      element.tagName === 'link' &&
      (attributes.get('rel') ?? '')
        .toLowerCase()
        .split(/\s+/)
        .includes('alternate') &&
      /(?:application\/(?:rss\+xml|xml)|text\/xml)/i.test(
        attributes.get('type') ?? '',
      )
    ) {
      try {
        rssAlternates.push(new URL(attributes.get('href') ?? '', base));
      } catch {
        // Ignore malformed alternate links.
      }
    }
  });
  const lowered = html.toLowerCase();
  if (lowered.includes('teamtailor') && rssAlternates[0] !== undefined) {
    const feed = rssAlternates[0];
    return supported(
      'Teamtailor',
      'teamtailor',
      { feedUrl: feed.toString(), company: companyFromHost(base.hostname) },
      0.9,
    );
  }
  if (lowered.includes('recruitee')) {
    const customApi = evidence.slice(0, MAX_HTML_EVIDENCE).find((value) => {
      try {
        const url = new URL(value, base);
        return (
          url.origin === base.origin && /^\/api\/offers\/?$/i.test(url.pathname)
        );
      } catch {
        return false;
      }
    });
    if (customApi !== undefined) {
      const company = base.hostname.slice(0, -'.recruitee.com'.length);
      return supported(
        'Recruitee',
        'recruitee',
        {
          origin: base.origin,
          company: company || base.hostname.split('.')[0],
        },
        0.9,
      );
    }
  }
  for (const value of evidence.slice(0, MAX_HTML_EVIDENCE)) {
    try {
      const match = matchUrl(new URL(value, base));
      if (match !== null)
        return { ...match, confidence: Math.min(match.confidence, 0.9) };
    } catch {
      // Ignore malformed metadata and links.
    }
  }
  const names: [string, string, string | null][] = [
    ['smartrecruiters', 'SmartRecruiters', 'smartrecruiters'],
    ['bamboohr', 'BambooHR', 'bamboohr'],
    ['recruitee', 'Recruitee', 'recruitee'],
    ['teamtailor', 'Teamtailor', 'teamtailor'],
    ['greenhouse', 'Greenhouse', 'greenhouse'],
    ['lever', 'Lever', 'lever'],
    ['ashby', 'Ashby', 'ashby'],
    ['workday', 'Workday', 'workday'],
    ['workable', 'Workable', 'workable'],
    ['jazzhr', 'JazzHR', null],
    ['jobvite', 'Jobvite', null],
    ['icims', 'iCIMS', 'icims'],
    ['jibe', 'iCIMS', 'icims'],
    ['taleo', 'Taleo', null],
    ['oracle recruiting', 'Oracle Recruiting Cloud', null],
    ['successfactors', 'SuccessFactors', null],
  ];
  const found = names.find(([needle]) => lowered.includes(needle));
  return found === undefined
    ? null
    : {
        platform: found[1],
        provider: found[2],
        configuration: null,
        confidence: 0.72,
      };
}

function hasJobPosting(html: string): boolean {
  return /["']@type["']\s*:\s*["']JobPosting["']/i.test(html);
}
function isHtml(response: PublicFetchResponse | null): boolean {
  return (
    response !== null &&
    (response.headers['content-type'] ?? '').toLowerCase().includes('text/html')
  );
}
function walkBounded(
  node: DefaultTreeAdapterMap['node'],
  visit: (node: DefaultTreeAdapterMap['node']) => void,
): void {
  const pending: { node: DefaultTreeAdapterMap['node']; depth: number }[] = [
    { node, depth: 0 },
  ];
  let count = 0;
  while (pending.length > 0 && count < MAX_HTML_NODES) {
    const current = pending.pop();
    if (current === undefined) break;
    count += 1;
    visit(current.node);
    if (current.depth >= MAX_HTML_DEPTH || !('childNodes' in current.node))
      continue;
    for (
      let index = current.node.childNodes.length - 1;
      index >= 0;
      index -= 1
    ) {
      const child = current.node.childNodes[index];
      if (child !== undefined)
        pending.push({ node: child, depth: current.depth + 1 });
    }
  }
}
function supported(
  platform: string,
  provider: string,
  configuration: Record<string, unknown> | null,
  confidence: number,
): Match {
  return { platform, provider, configuration, confidence };
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
function result(
  detectedPlatform: string | null,
  confidence: number,
  supportState: AtsDetectionResult['supportState'],
  suggestedProvider: string | null,
  extractedConfiguration: Record<string, unknown> | null,
  structuredFallback: boolean,
  explanation: string,
  resolved: URL,
  fallbackConfiguration: Record<string, unknown> | null = null,
  variant: AtsDetectionResult['variant'] = null,
  portalOrigin: string | null = null,
  listingsUrl: string | null = null,
  sitemapUrl: string | null = null,
): AtsDetectionResult {
  return {
    detectedPlatform,
    confidence,
    confidenceLabel:
      confidence >= 0.85 ? 'high' : confidence >= 0.5 ? 'medium' : 'low',
    supportState,
    suggestedProvider,
    extractedConfiguration,
    fallbackConfiguration,
    structuredFallback,
    explanation,
    resolvedUrl: resolved.toString(),
    variant,
    portalOrigin,
    listingsUrl,
    sitemapUrl,
  };
}
