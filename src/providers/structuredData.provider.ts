import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { XMLParser } from 'fast-xml-parser';
import { parse as parseHtml } from 'parse5';

import type { EmploymentType, RemoteType } from '../domain/job.js';
import type {
  DiscoveryOptions,
  ProviderFetchResult,
  ProviderSearch,
  SearchRequest,
} from '../models/discovery.js';
import type {
  ProviderConfiguration,
  ValidationResult,
} from '../models/source-management.js';
import { normalizeJob } from '../normalizer/jobNormalizer.js';
import type { NormalizedJob } from '../schemas/normalized-job.js';
import {
  boundedPublicFetch,
  type BoundedPublicFetchOptions,
  type PublicFetchResponse,
} from '../security/boundedPublicFetch.js';
import { validatePublicUrl } from '../security/publicUrlPolicy.js';
import { htmlToText } from '../utils/html.js';
import { BaseProvider, ProviderFetchError } from './baseProvider.js';
import { ProviderHttpClient } from './providerHttpClient.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/structured-jobposting-page.html', import.meta.url),
);

interface StructuredRecord extends Record<string, unknown> {
  _sourceUrl: string;
  _itemUrl: string | null;
  _format: string;
}

interface ParsedSource {
  format: string;
  records: StructuredRecord[];
  warnings: string[];
}
const MAX_NESTING = 32;
const MAX_NODES = 50_000;
const MAX_ITEMS = 5_000;
const MAX_JSON_LD_BLOCKS = 100;

type FetchPublic = (
  url: string | URL,
  options?: BoundedPublicFetchOptions,
) => Promise<PublicFetchResponse>;

export class StructuredDataProvider extends BaseProvider {
  public readonly id = 'structured-data';
  public readonly name = 'Structured Data';
  public readonly type = 'structured-data' as const;
  public readonly capabilities = {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: false,
    compensation: true,
    requiresCredentials: false,
    structuredPreview: true,
  } as const;

  public constructor(
    private readonly fetchPublic: FetchPublic = boundedPublicFetch,
    private readonly http = new ProviderHttpClient({
      timeoutMs: 15_000,
      // The injected fetchPublic implementation owns public resolution and pinning.
      resolver: (url) => Promise.resolve(url),
      transport: async (_resolved, url, init) => {
        const response = await fetchPublic(url, { signal: init.signal });
        return new Response(response.text(), {
          status: response.status,
          headers: response.headers as Record<string, string>,
        });
      },
    }),
  ) {
    super();
  }

  public override async validateConfiguration(
    configuration: ProviderConfiguration,
  ): Promise<ValidationResult> {
    const configuredUrl = configuration['url'];
    if (typeof configuredUrl !== 'string' || configuredUrl.trim() === '') {
      return invalidConfiguration('A public source URL is required');
    }

    let url: URL;
    try {
      url = validatePublicUrl(configuredUrl.trim());
    } catch {
      return invalidConfiguration(
        'Source URL must be a public HTTP or HTTPS URL',
      );
    }

    try {
      const parsed = await this.fetchAndParse(url.toString());
      if (parsed.records.length === 0) {
        return invalidConfiguration('Source contains no supported job records');
      }
      return {
        valid: true,
        message: `Found ${String(parsed.records.length)} structured job record(s)`,
        normalizedConfiguration: { url: url.toString() },
        preview: {
          format: parsed.format,
          jobCount: parsed.records.length,
          samples: parsed.records.slice(0, 3).map((record) => ({
            title: text(record['title']) ?? 'Untitled job',
            company: organizationName(record) ?? 'Unknown employer',
            location: locationDetails(record).location,
          })),
          warnings: parsed.warnings,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let userMessage = 'Source URL is unreachable or inactive';
      if (message.includes('404') || message.includes('Not Found')) {
        userMessage = 'Source page not found (HTTP 404)';
      } else if (message.includes('timeout') || message.includes('timed out')) {
        userMessage = 'Source validation timed out';
      } else if (error instanceof ProviderFetchError) {
        userMessage = error.message;
      }
      return invalidConfiguration(userMessage);
    }
  }

  public search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    const configuredUrl = options.configuration?.['url'];
    const target =
      typeof configuredUrl === 'string' && configuredUrl.trim() !== ''
        ? validatePublicUrl(configuredUrl.trim()).toString()
        : 'https://example.com/jobs';
    if (
      !options.fixtureOnly &&
      (typeof configuredUrl !== 'string' || configuredUrl.trim() === '')
    ) {
      throw new ProviderFetchError('Structured data source URL is required');
    }
    return Promise.resolve({
      request,
      target,
      fixturePath: options.fixtureOnly
        ? (options.fixturePath ?? DEFAULT_FIXTURE_PATH)
        : null,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  }

  public async fetch(search: ProviderSearch): Promise<ProviderFetchResult> {
    const parsed =
      search.fixturePath === null
        ? await this.fetchAndParse(search.target, search.signal)
        : parseStructuredSource(
            readFileSync(search.fixturePath, 'utf8'),
            mediaTypeForFixture(search.fixturePath),
            search.target,
          );
    const query = search.request.query.trim().toLowerCase();
    const requestedLocation =
      search.request.location?.trim().toLowerCase() ?? '';
    const records = parsed.records
      .filter((record) => {
        const details = locationDetails(record);
        const searchable = [
          text(record['title']),
          organizationName(record),
          text(record['description']),
          details.location,
        ]
          .filter((value): value is string => value !== null)
          .join(' ')
          .toLowerCase();
        return (
          (query === '' || searchable.includes(query)) &&
          (requestedLocation === '' ||
            searchable.includes(requestedLocation)) &&
          (!search.request.remoteOnly ||
            inferRemoteType(record, details.location) === 'remote')
        );
      })
      .slice(0, search.request.limit);
    return {
      records,
      rejected: 0,
      truncated:
        parsed.records.length >= MAX_ITEMS ||
        records.length >= search.request.limit,
      complete: parsed.records.length < MAX_ITEMS,
    };
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    if (!isRecord(rawJob))
      throw new ProviderFetchError('Structured job record is invalid');
    const title = text(rawJob['title']);
    const company = organizationName(rawJob);
    if (title === null || company === null) {
      throw new ProviderFetchError(
        'Structured job requires title and employer',
      );
    }
    const details = locationDetails(rawJob);
    const salary = salaryDetails(rawJob);
    const sourceUrl = text(rawJob['_sourceUrl']);
    const itemUrl = text(rawJob['_itemUrl']);
    const postingUrl = safeItemUrl(text(rawJob['url']) ?? itemUrl, sourceUrl);
    const identifier = rawJob['identifier'];

    return normalizeJob({
      externalId:
        text(identifier) ??
        (isRecord(identifier) ? text(identifier['value']) : null) ??
        postingUrl,
      title,
      company,
      location: details.location,
      city: details.city,
      state: details.state,
      remoteType: inferRemoteType(rawJob, details.location),
      employmentType: inferEmploymentType(rawJob['employmentType']),
      salaryMinimum: salary.minimum,
      salaryMaximum: salary.maximum,
      salaryText: salary.label,
      description: cleanHtml(rawJob['description']),
      requirements: cleanHtml(
        rawJob['qualifications'] ?? rawJob['experienceRequirements'],
      ),
      preferredQualifications: null,
      postingUrl,
      providerId: this.id,
      providerName: this.name,
      datePosted: isoDate(
        rawJob['datePosted'] ?? rawJob['pubDate'] ?? rawJob['updated'],
      ),
      discoveredAt,
      applicationUrls: postingUrl === null ? [] : [postingUrl],
    });
  }

  private async fetchAndParse(
    url: string,
    signal?: AbortSignal,
  ): Promise<ParsedSource> {
    const response = await this.http.request(url, {
      provider: 'Structured source',
      signal,
    });
    return parseStructuredSource(
      response.text(),
      response.headers.get('content-type') ?? '',
      response.url,
    );
  }
}

export function parseStructuredSource(
  body: string,
  contentType: string,
  sourceUrl: string,
): ParsedSource {
  const leading = body.trimStart();
  if (
    /html/i.test(contentType) ||
    /^<!doctype\s+html|^<html\b/i.test(leading)
  ) {
    return parseJsonLdHtml(body, sourceUrl);
  }
  if (
    /json/i.test(contentType) ||
    leading.startsWith('{') ||
    leading.startsWith('[')
  ) {
    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      throw new ProviderFetchError('Structured source returned invalid JSON');
    }
    return recordsFromJson(payload, sourceUrl, 'json');
  }
  if (/xml|rss|atom/i.test(contentType) || leading.startsWith('<')) {
    return parseXmlFeed(body, sourceUrl);
  }
  throw new ProviderFetchError('Structured source format is unsupported');
}

function parseJsonLdHtml(body: string, sourceUrl: string): ParsedSource {
  const document = parseHtml(body) as HtmlNode;
  const scripts: string[] = [];
  collectJsonLd(document, scripts);
  const records: StructuredRecord[] = [];
  const warnings: string[] = [];
  for (const script of scripts) {
    try {
      records.push(
        ...recordsFromJson(JSON.parse(script) as unknown, sourceUrl, 'json-ld')
          .records,
      );
    } catch {
      warnings.push('Ignored invalid JSON-LD block');
    }
  }
  return { format: 'html/json-ld', records, warnings };
}

interface HtmlNode {
  nodeName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
  value?: string;
}

function collectJsonLd(node: HtmlNode, output: string[]): void {
  const pending: { node: HtmlNode; depth: number }[] = [{ node, depth: 0 }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    visited += 1;
    if (visited > MAX_NODES || current.depth > MAX_NESTING)
      throw new ProviderFetchError(
        'Structured source exceeded processing limits',
      );
    if (
      current.node.nodeName === 'script' &&
      current.node.attrs?.some(
        ({ name, value }) =>
          name === 'type' && value.toLowerCase() === 'application/ld+json',
      ) === true
    ) {
      if (output.length >= MAX_JSON_LD_BLOCKS)
        throw new ProviderFetchError(
          'Structured source exceeded processing limits',
        );
      output.push(
        current.node.childNodes?.map((child) => child.value ?? '').join('') ??
          '',
      );
    }
    for (const child of current.node.childNodes ?? [])
      pending.push({ node: child, depth: current.depth + 1 });
  }
}

function recordsFromJson(
  payload: unknown,
  sourceUrl: string,
  format: string,
): ParsedSource {
  const candidates: unknown[] = [];
  collectJobPostings(payload, candidates);
  return {
    format,
    records: candidates
      .filter(isRecord)
      .map((candidate) => enrich(candidate, sourceUrl, format)),
    warnings: [],
  };
}

function collectJobPostings(value: unknown, output: unknown[]): void {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    visited += 1;
    if (visited > MAX_NODES || current.depth > MAX_NESTING)
      throw new ProviderFetchError(
        'Structured source exceeded processing limits',
      );
    if (Array.isArray(current.value)) {
      for (const item of current.value)
        pending.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (!isRecord(current.value)) continue;
    if (hasJobPostingType(current.value['@type'])) {
      if (output.length >= MAX_ITEMS)
        throw new ProviderFetchError(
          'Structured source exceeded processing limits',
        );
      output.push(current.value);
      continue;
    }
    for (const key of ['@graph', 'itemListElement', 'jobs', 'items', 'item']) {
      const nested = current.value[key];
      if (nested !== undefined)
        pending.push({ value: nested, depth: current.depth + 1 });
    }
  }
}

function parseXmlFeed(body: string, sourceUrl: string): ParsedSource {
  let parsed: unknown;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      parseTagValue: false,
      trimValues: true,
    }).parse(body) as unknown;
  } catch {
    throw new ProviderFetchError('Structured source returned invalid XML');
  }
  if (!isRecord(parsed)) throw new ProviderFetchError('XML feed is invalid');
  const rss = isRecord(parsed['rss']) ? parsed['rss'] : null;
  const channel =
    rss !== null && isRecord(rss['channel']) ? rss['channel'] : null;
  const feed = isRecord(parsed['feed']) ? parsed['feed'] : null;
  const rawItems = channel?.['item'] ?? feed?.['entry'];
  if (rawItems === undefined)
    throw new ProviderFetchError('XML source is not RSS or Atom');
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  if (items.length > MAX_ITEMS)
    throw new ProviderFetchError(
      'Structured source exceeded processing limits',
    );
  const records = items.filter(isRecord).map((item) => {
    const link = xmlLink(item['link']);
    const author = isRecord(item['author'])
      ? item['author']['name']
      : item['author'];
    return enrich(
      {
        ...item,
        '@type': 'JobPosting',
        title: xmlText(item['title']),
        description: xmlText(
          item['description'] ?? item['summary'] ?? item['content'],
        ),
        hiringOrganization: {
          name: xmlText(item['company'] ?? item['organization'] ?? author),
        },
        jobLocation: xmlText(item['location']),
        url: link,
      },
      sourceUrl,
      feed === null ? 'rss' : 'atom',
      link,
    );
  });
  return { format: feed === null ? 'rss' : 'atom', records, warnings: [] };
}

function enrich(
  value: Record<string, unknown>,
  sourceUrl: string,
  format: string,
  itemUrl = safeItemUrl(text(value['url']), sourceUrl),
): StructuredRecord {
  return {
    ...value,
    _sourceUrl: sourceUrl,
    _itemUrl: itemUrl,
    _format: format,
  };
}

function hasJobPostingType(value: unknown): boolean {
  return (Array.isArray(value) ? value : [value]).some(
    (type) => typeof type === 'string' && /(?:^|[/#])JobPosting$/i.test(type),
  );
}

function organizationName(record: Record<string, unknown>): string | null {
  const organization =
    record['hiringOrganization'] ?? record['organization'] ?? record['company'];
  return (
    text(organization) ??
    (isRecord(organization) ? text(organization['name']) : null)
  );
}

function locationDetails(record: Record<string, unknown>): {
  location: string | null;
  city: string | null;
  state: string | null;
} {
  const jobLocation: unknown = record['jobLocation'];
  const raw: unknown = Array.isArray(jobLocation)
    ? (jobLocation as unknown[])[0]
    : (jobLocation ?? record['location']);
  if (typeof raw === 'string')
    return { location: raw.trim() || null, city: null, state: null };
  if (!isRecord(raw)) return { location: null, city: null, state: null };
  const address = isRecord(raw['address']) ? raw['address'] : raw;
  const city = text(address['addressLocality']);
  const state = text(address['addressRegion']);
  const country = text(address['addressCountry']);
  const addressLabel =
    [city, state, country].filter(Boolean).join(', ') || null;
  const location = text(raw['name']) ?? addressLabel;
  return { location, city, state };
}

function salaryDetails(record: Record<string, unknown>): {
  minimum: number | null;
  maximum: number | null;
  label: string | null;
} {
  const salary = record['baseSalary'] ?? record['estimatedSalary'];
  if (!isRecord(salary)) return { minimum: null, maximum: null, label: null };
  const value = isRecord(salary['value']) ? salary['value'] : salary;
  const exact = numberValue(value['value']);
  const minimum = numberValue(value['minValue']) ?? exact;
  const maximum = numberValue(value['maxValue']) ?? exact;
  const currency = text(salary['currency']);
  const unit = text(value['unitText']);
  const range =
    minimum === null && maximum === null
      ? null
      : minimum !== null && maximum !== null && minimum !== maximum
        ? `${String(minimum)}-${String(maximum)}`
        : String(minimum ?? maximum);
  return {
    minimum,
    maximum,
    label:
      range === null ? null : [currency, range, unit].filter(Boolean).join(' '),
  };
}

function inferRemoteType(
  record: Record<string, unknown>,
  location: string | null,
): RemoteType {
  const locationTypes: unknown[] = Array.isArray(record['jobLocationType'])
    ? (record['jobLocationType'] as unknown[])
    : [record['jobLocationType']];
  const marker = [...locationTypes, location]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  if (/telecommute|remote/.test(marker)) return 'remote';
  if (marker.includes('hybrid')) return 'hybrid';
  return location === null ? 'unknown' : 'onsite';
}

function inferEmploymentType(value: unknown): EmploymentType {
  const normalized = (Array.isArray(value) ? value : [value])
    .filter((item): item is string => typeof item === 'string')
    .join(' ')
    .toLowerCase()
    .replaceAll('_', '-');
  if (/part[- ]?time/.test(normalized)) return 'part-time';
  if (/full[- ]?time/.test(normalized)) return 'full-time';
  if (normalized.includes('intern')) return 'internship';
  if (normalized.includes('contract')) return 'contract';
  if (/temporary|temp/.test(normalized)) return 'temporary';
  return 'unknown';
}

function safeItemUrl(
  value: string | null,
  sourceUrl: string | null,
): string | null {
  if (value === null && sourceUrl === null) return null;
  try {
    const candidate =
      value === null ? sourceUrl : new URL(value, sourceUrl ?? undefined);
    if (candidate === null) return null;
    return validatePublicUrl(candidate).toString();
  } catch {
    if (value === null || sourceUrl === null) return null;
    return safeItemUrl(null, sourceUrl);
  }
}

function mediaTypeForFixture(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === '.html' || extension === '.htm') return 'text/html';
  if (extension === '.json') return 'application/json';
  if (extension === '.xml' || extension === '.rss' || extension === '.atom')
    return 'application/xml';
  return 'application/octet-stream';
}

function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function cleanHtml(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const cleaned = htmlToText(raw);
  return cleaned === '' ? null : cleaned;
}

function xmlText(value: unknown): string | null {
  if (isRecord(value)) return text(value['#text']);
  return text(value);
}

function xmlLink(value: unknown): string | null {
  if (Array.isArray(value)) return xmlLink(value[0]);
  if (isRecord(value)) return text(value['@_href']) ?? text(value['#text']);
  return text(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const cleaned = String(value).trim();
  return cleaned === '' ? null : cleaned;
}

function numberValue(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replaceAll(',', ''))
        : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function invalidConfiguration(message: string): ValidationResult {
  return {
    valid: false,
    message,
    normalizedConfiguration: null,
    preview: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default new StructuredDataProvider();
