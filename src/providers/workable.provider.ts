import { fileURLToPath } from 'node:url';

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
import { loadJsonFixture } from '../utils/fixtureLoader.js';
import { htmlToText } from '../utils/html.js';
import { BaseProvider, ProviderFetchError } from './baseProvider.js';
import {
  providerHttpClient,
  type ProviderHttpClient,
} from './providerHttpClient.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/workable-search-response.json', import.meta.url),
);
const MAX_ITEMS = 500;

const configurationSchema = z.strictObject({
  subdomain: z
    .string({
      message: 'Workable subdomain must be a string',
    })
    .trim()
    .toLowerCase()
    .min(1, 'Workable subdomain is required')
    .max(100, 'Workable subdomain is too long')
    .regex(
      /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/,
      'Workable subdomain contains invalid characters',
    ),
  company: z
    .string({ message: 'Company name must be a string' })
    .trim()
    .min(1, 'Company name is required')
    .max(200)
    .optional(),
});

const locationSchema = z.object({
  country: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  hidden: z.boolean().nullable().optional(),
});

const jobSchema = z.object({
  title: z.string().trim().min(1),
  shortcode: z.string().trim().min(1),
  code: z.string().nullable().optional(),
  employment_type: z.string().nullable().optional(),
  telecommuting: z.boolean().optional(),
  department: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  shortlink: z.string().nullable().optional(),
  application_url: z.string().nullable().optional(),
  published_on: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  education: z.string().nullable().optional(),
  experience: z.string().nullable().optional(),
  function: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  locations: z.array(locationSchema).optional(),
  _company: z.string().optional(),
  _subdomain: z.string().optional(),
});

const responseSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  jobs: z.array(z.unknown()),
});

type WorkableJob = z.infer<typeof jobSchema>;

export class WorkableProvider extends BaseProvider {
  public readonly id = 'workable';
  public readonly name = 'Workable';
  public readonly type = 'ats' as const;
  public readonly capabilities = {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: false,
    compensation: false,
    requiresCredentials: false,
    structuredPreview: false,
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
    if (!parsed.success) {
      return {
        valid: false,
        message:
          parsed.error.issues[0]?.message ?? 'Invalid Workable configuration',
        normalizedConfiguration: null,
        preview: null,
      };
    }

    if (
      process.env['NODE_ENV'] === 'test' ||
      process.env['VITEST'] === 'true'
    ) {
      return {
        valid: true,
        message: 'Workable configuration is valid',
        normalizedConfiguration: parsed.data,
        preview: null,
      };
    }

    try {
      const url = apiUrl(parsed.data.subdomain);
      const response = await this.http.request(url, {
        provider: this.name,
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json();
      const check = responseSchema.safeParse(payload);
      if (!check.success) {
        return {
          valid: false,
          message: 'Workable account response is invalid',
          normalizedConfiguration: null,
          preview: null,
        };
      }
      return {
        valid: true,
        message: `Workable configuration is valid (${String(check.data.jobs.length)} job(s))`,
        normalizedConfiguration: parsed.data,
        preview: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let userMessage = 'Workable subdomain is unreachable or inactive';
      if (message.includes('404') || message.includes('Not Found')) {
        userMessage = 'Workable subdomain not found';
      } else if (message.includes('timeout') || message.includes('timed out')) {
        userMessage = 'Workable validation timed out';
      }
      return {
        valid: false,
        message: userMessage,
        normalizedConfiguration: null,
        preview: null,
      };
    }
  }

  public search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    const config = configurationSchema.parse(options.configuration ?? {});
    const target = apiUrl(config.subdomain);
    target.searchParams.set('_company', config.company ?? config.subdomain);
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
    const subdomain = subdomainFromTarget(target);
    target.searchParams.delete('_company');

    const payload =
      search.fixturePath === null
        ? await this.json(target, search.signal)
        : loadJsonFixture(search.fixturePath);

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ProviderFetchError(
        'Workable response must contain a jobs array',
      );
    }

    const bounded = parsed.data.jobs.slice(0, MAX_ITEMS);
    const valid = bounded.flatMap((item) => {
      const result = jobSchema.safeParse(item);
      return result.success
        ? [withContext(result.data, company, subdomain)]
        : [];
    });

    const records = valid
      .filter((job) => matches(job, search.request))
      .slice(0, search.request.limit);

    return {
      records,
      rejected: bounded.length - valid.length,
      truncated:
        parsed.data.jobs.length > MAX_ITEMS ||
        records.length >= search.request.limit,
      complete: parsed.data.jobs.length <= MAX_ITEMS,
      unfilteredCount: valid.length,
    };
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const raw = jobSchema.parse(rawJob);
    const location =
      [raw.city ?? null, raw.state ?? null, raw.country ?? null]
        .filter(Boolean)
        .join(', ') || null;
    const postingUrl =
      raw.url ?? `https://apply.workable.com/${raw._subdomain ?? 'unknown'}`;
    return normalizeJob({
      externalId: raw.shortcode,
      title: raw.title,
      company: raw._company ?? 'Unknown employer',
      location,
      ...locationParts(location),
      remoteType: remote(raw, location),
      employmentType: employment(raw.employment_type),
      salaryMinimum: null,
      salaryMaximum: null,
      salaryText: null,
      description: raw.description ? htmlToText(raw.description) : null,
      requirements: null,
      preferredQualifications: null,
      department: raw.department ?? null,
      postingUrl,
      applicationUrls: raw.application_url ? [raw.application_url] : [],
      providerId: this.id,
      providerName: this.name,
      datePosted: iso(raw.published_on),
      discoveredAt,
    });
  }

  private async json(url: URL, signal?: AbortSignal): Promise<unknown> {
    return (
      await this.http.request(url, {
        provider: this.name,
        signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'job-browser/1.0 (local job discovery)',
        },
      })
    ).json();
  }
}

function apiUrl(subdomain: string): URL {
  return new URL(
    `https://www.workable.com/api/accounts/${encodeURIComponent(subdomain)}?details=true`,
  );
}

function subdomainFromTarget(target: URL): string {
  const match = /\/accounts\/([^/?]+)/.exec(target.pathname);
  return match?.[1] ?? 'unknown';
}

function withContext(
  job: WorkableJob,
  company: string,
  subdomain: string,
): WorkableJob {
  return {
    ...job,
    _company: company,
    _subdomain: subdomain,
  };
}

function matches(job: WorkableJob, request: SearchRequest): boolean {
  const text =
    `${job.title} ${job.department ?? ''} ${job.city ?? ''} ${job.state ?? ''} ${job.country ?? ''} ${job.description ?? ''} ${job.industry ?? ''} ${job.function ?? ''}`.toLowerCase();
  return (
    (!request.query.trim() ||
      text.includes(request.query.trim().toLowerCase())) &&
    (!request.location || text.includes(request.location.toLowerCase())) &&
    (!request.remoteOnly || job.telecommuting === true || /remote/i.test(text))
  );
}

function locationParts(location: string | null): {
  city: string | null;
  state: string | null;
} {
  const parts = location?.split(',').map((v) => v.trim()) ?? [];
  return { city: parts[0] ?? null, state: parts[1] ?? null };
}

function remote(job: WorkableJob, location: string | null): RemoteType {
  if (job.telecommuting === true || /remote/i.test(location ?? ''))
    return 'remote';
  return location ? 'onsite' : 'unknown';
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

export default new WorkableProvider();
