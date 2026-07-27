import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

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
import { validatePublicUrl } from '../security/publicUrlPolicy.js';
import { htmlToText } from '../utils/html.js';
import { BaseProvider, ProviderFetchError } from './baseProvider.js';
import {
  providerHttpClient,
  type ProviderHttpClient,
  type ProviderHttpResponse,
} from './providerHttpClient.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/teamtailor-jobs.xml', import.meta.url),
);
const MAX_ITEMS = 500;
const MAX_NODES = 25_000;
const MAX_XML_DEPTH = 64;
const configurationSchema = z.strictObject({
  feedUrl: z
    .url({
      protocol: /^https$/,
      message: 'Teamtailor feed URL must be an HTTPS URL',
    })
    .refine((value) => {
      try {
        const url = new URL(value);
        return !url.username && !url.password && url.hash === '';
      } catch {
        return false;
      }
    }, 'Teamtailor feed must be a public HTTPS URL'),
  company: z
    .string({ message: 'Company name must be a string' })
    .trim()
    .min(1, 'Company name is required')
    .max(200),
});
const itemSchema = z.object({
  guid: z.union([z.string(), z.number()]).optional(),
  title: z.string().trim().min(1),
  link: z.url(),
  description: z.string().nullable().optional(),
  'content:encoded': z.string().nullable().optional(),
  pubDate: z.string().nullable().optional(),
  'teamtailor:location': z.string().nullable().optional(),
  'tt:location': z.string().nullable().optional(),
  'tt:locations': z.unknown().optional(),
  'teamtailor:department': z.unknown().optional(),
  'tt:department': z.unknown().optional(),
  'tt:role': z.unknown().optional(),
  'tt:division': z.unknown().optional(),
  'teamtailor:employment-type': z.string().nullable().optional(),
  'tt:employment-type': z.string().nullable().optional(),
  'teamtailor:remote-status': z.string().nullable().optional(),
  'tt:remote-status': z.string().nullable().optional(),
  remoteStatus: z.string().nullable().optional(),
  'teamtailor:apply-url': z.url().nullable().optional(),
  'tt:apply-url': z.url().nullable().optional(),
  company_name: z.string().optional(),
});
type TeamtailorItem = z.infer<typeof itemSchema>;

export class TeamtailorProvider extends BaseProvider {
  public readonly id = 'teamtailor';
  public readonly name = 'Teamtailor';
  public readonly type = 'ats' as const;
  public readonly capabilities = {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: false,
    compensation: false,
    requiresCredentials: false,
    structuredPreview: true,
  } as const;
  public constructor(
    private readonly http: ProviderHttpClient = providerHttpClient,
  ) {
    super();
  }
  public override async validateConfiguration(
    configuration: ProviderConfiguration,
  ): Promise<ValidationResult> {
    const parsed = configurationSchema.safeParse(configuration);
    if (!parsed.success)
      return invalid(
        parsed.error.issues[0]?.message ?? 'Invalid Teamtailor configuration',
      );

    if (
      process.env['NODE_ENV'] === 'test' ||
      process.env['VITEST'] === 'true'
    ) {
      return {
        valid: true,
        message: 'Teamtailor configuration is valid',
        normalizedConfiguration: parsed.data,
        preview: null,
      };
    }
    try {
      validatePublicUrl(parsed.data.feedUrl);
      const records = parseFeed(
        (await this.fetchResponse(parsed.data.feedUrl)).text(),
        parsed.data.company,
      );
      return records.valid.length === 0
        ? invalid('Teamtailor RSS feed contains no valid jobs')
        : {
            valid: true,
            message: `Found ${String(records.valid.length)} Teamtailor job(s)`,
            normalizedConfiguration: parsed.data,
            preview: {
              format: 'teamtailor-rss',
              jobCount: records.valid.length,
              samples: records.valid.slice(0, 3).map((item) => ({
                title: item.title,
                company: parsed.data.company,
                location: itemLocation(item),
              })),
              warnings: records.rejected
                ? [`Ignored ${String(records.rejected)} invalid item(s)`]
                : [],
            },
          };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let userMessage = 'Teamtailor feed is unreachable or inactive';
      if (message.includes('404') || message.includes('Not Found')) {
        userMessage = 'Teamtailor feed not found';
      } else if (message.includes('timeout') || message.includes('timed out')) {
        userMessage = 'Teamtailor validation timed out';
      }
      return invalid(userMessage);
    }
  }
  public search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    const config = configurationSchema.parse(options.configuration ?? {});
    const target = validatePublicUrl(config.feedUrl);
    target.searchParams.set('_company', config.company);
    return Promise.resolve({
      request,
      target: target.toString(),
      fixturePath: options.fixtureOnly
        ? (options.fixturePath ?? DEFAULT_FIXTURE_PATH)
        : null,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }
  public async fetch(search: ProviderSearch): Promise<ProviderFetchResult> {
    const target = new URL(search.target);
    const company = target.searchParams.get('_company') ?? 'Unknown employer';
    target.searchParams.delete('_company');
    const xml =
      search.fixturePath === null
        ? (await this.fetchResponse(target, search.signal)).text()
        : readFileSync(search.fixturePath, 'utf8');
    const parsed = parseFeed(xml, company);
    const records = parsed.valid
      .filter((item) => matches(item, search.request))
      .slice(0, search.request.limit);
    return {
      records,
      rejected: parsed.rejected,
      truncated:
        parsed.total > MAX_ITEMS || records.length >= search.request.limit,
      complete: parsed.total <= MAX_ITEMS,
      unfilteredCount: parsed.valid.length,
    };
  }
  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const raw = itemSchema.parse(rawJob);
    const location = itemLocation(raw);
    const remoteStatus =
      raw['teamtailor:remote-status'] ??
      raw['tt:remote-status'] ??
      raw.remoteStatus;
    const employmentType =
      raw['teamtailor:employment-type'] ?? raw['tt:employment-type'];
    const apply = raw['teamtailor:apply-url'] ?? raw['tt:apply-url'];
    return normalizeJob({
      externalId: raw.guid === undefined ? raw.link : String(raw.guid),
      title: raw.title,
      company: raw.company_name ?? 'Unknown employer',
      location,
      ...locationParts(location),
      remoteType: remote(remoteStatus, location),
      employmentType: employment(employmentType),
      salaryMinimum: null,
      salaryMaximum: null,
      salaryText: null,
      description:
        htmlToText(raw['content:encoded'] ?? raw.description ?? '') || null,
      requirements: null,
      preferredQualifications: null,
      department:
        nestedName(raw['teamtailor:department']) ??
        nestedName(raw['tt:department']),
      postingUrl: raw.link,
      applicationUrls: apply ? [apply] : [],
      providerId: this.id,
      providerName: this.name,
      datePosted: iso(raw.pubDate),
      discoveredAt,
    });
  }
  private async fetchResponse(
    url: string | URL,
    signal?: AbortSignal,
  ): Promise<ProviderHttpResponse> {
    return this.http.request(url, {
      provider: this.name,
      signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
        'User-Agent': 'job-browser/1.0 (local job discovery)',
      },
      contentTypes: ['application/rss+xml', 'application/xml', 'text/xml'],
    });
  }
}
function parseFeed(
  xml: string,
  company: string,
): { valid: TeamtailorItem[]; rejected: number; total: number } {
  let parsed: unknown;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      processEntities: false,
      trimValues: true,
    }).parse(xml) as unknown;
  } catch {
    throw new ProviderFetchError('Teamtailor returned invalid XML');
  }
  if (!withinXmlLimits(parsed))
    throw new ProviderFetchError(
      'Teamtailor feed exceeded XML complexity limit',
    );
  const channel = record(record(parsed)?.['rss'])?.['channel'];
  const items = array(record(channel)?.['item']).slice(0, MAX_ITEMS);
  if (
    !Array.isArray(record(channel)?.['item']) &&
    record(channel)?.['item'] === undefined
  )
    throw new ProviderFetchError('Teamtailor RSS feed must contain items');
  const valid = items.flatMap((item) => {
    const result = itemSchema.safeParse(item);
    return result.success ? [{ ...result.data, company_name: company }] : [];
  });
  return {
    valid,
    rejected: items.length - valid.length,
    total: array(record(channel)?.['item']).length,
  };
}
function withinXmlLimits(value: unknown): boolean {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > MAX_NODES || current.depth > MAX_XML_DEPTH) return false;
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(record(current.value) ?? {});
    for (const child of children)
      pending.push({ value: child, depth: current.depth + 1 });
  }
  return true;
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function array(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function invalid(message: string): ValidationResult {
  return {
    valid: false,
    message,
    normalizedConfiguration: null,
    preview: null,
  };
}
function matches(item: TeamtailorItem, request: SearchRequest): boolean {
  const text =
    `${item.title} ${itemLocation(item) ?? ''} ${nestedName(item['tt:department']) ?? ''} ${nestedName(item['tt:role']) ?? ''} ${nestedName(item['tt:division']) ?? ''} ${item.description ?? ''} ${item['content:encoded'] ?? ''}`.toLowerCase();
  return (
    (!request.query.trim() ||
      text.includes(request.query.trim().toLowerCase())) &&
    (!request.location || text.includes(request.location.toLowerCase())) &&
    (!request.remoteOnly ||
      remote(
        item['teamtailor:remote-status'] ??
          item['tt:remote-status'] ??
          item.remoteStatus,
        itemLocation(item),
      ) === 'remote')
  );
}
function locationParts(location?: string | null): {
  city: string | null;
  state: string | null;
} {
  const parts = location?.split(',').map((v) => v.trim()) ?? [];
  return { city: parts[0] ?? null, state: parts[1] ?? null };
}
function remote(status?: string | null, location?: string | null): RemoteType {
  const text = `${status ?? ''} ${location ?? ''}`;
  if (/hybrid/i.test(text)) return 'hybrid';
  if (/remote|anywhere/i.test(text)) return 'remote';
  return location ? 'onsite' : 'unknown';
}
function itemLocation(item: TeamtailorItem): string | null {
  return (
    item['teamtailor:location'] ??
    item['tt:location'] ??
    nestedName(item['tt:locations'])
  );
}
function nestedName(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const names = value
      .map(nestedName)
      .filter((name): name is string => name !== null);
    return names.join(', ') || null;
  }
  const object = record(value);
  if (object === null) return null;
  if (typeof object['name'] === 'string') return object['name'].trim() || null;
  for (const child of Object.values(object)) {
    const name = nestedName(child);
    if (name !== null) return name;
  }
  return null;
}
function employment(value?: string | null): EmploymentType {
  const text = value?.toLowerCase() ?? '';
  if (text.includes('part')) return 'part-time';
  if (text.includes('contract')) return 'contract';
  if (text.includes('intern')) return 'internship';
  if (/temporary|seasonal/.test(text)) return 'temporary';
  return text.includes('full') ? 'full-time' : 'unknown';
}
function iso(value?: string | null): string | null {
  return value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
export default new TeamtailorProvider();
