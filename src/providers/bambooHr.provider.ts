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
  new URL('../fixtures/bamboohr-search-response.json', import.meta.url),
);
const MAX_ITEMS = 500;
const MAX_DETAILS = 100;
const configurationSchema = z.strictObject({
  companyDomain: z
    .string({
      message: 'BambooHR company subdomain must be a string',
    })
    .trim()
    .toLowerCase()
    .min(1, 'BambooHR company subdomain is required')
    .max(100, 'BambooHR company subdomain is too long')
    .regex(
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
      'BambooHR company subdomain contains invalid characters',
    ),
  company: z
    .string({ message: 'Company name must be a string' })
    .trim()
    .min(1, 'Company name is required')
    .max(200),
});
const jobSchema = z.object({
  id: z.union([z.string(), z.number()]),
  jobOpeningName: z.string().trim().min(1),
  departmentLabel: z.string().nullable().optional(),
  employmentStatusLabel: z.string().nullable().optional(),
  location: z
    .union([
      z.string(),
      z.object({
        city: z.string().nullable().optional(),
        state: z.string().nullable().optional(),
        country: z.string().nullable().optional(),
      }),
    ])
    .nullable()
    .optional(),
  atsLocation: z
    .object({
      city: z.string().nullable().optional(),
      state: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  isRemote: z.boolean().nullable().optional(),
  locationType: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  datePosted: z.string().nullable().optional(),
  jobOpeningShareUrl: z.url().nullable().optional(),
  compensation: z
    .union([
      z.string(),
      z.object({
        minimum: z.number().nonnegative().nullable().optional(),
        maximum: z.number().nonnegative().nullable().optional(),
        currency: z.string().nullable().optional(),
        interval: z.string().nullable().optional(),
      }),
    ])
    .nullable()
    .optional(),
  company_name: z.string().optional(),
  _companyDomain: z.string().optional(),
});
const responseSchema = z.object({ result: z.array(z.unknown()) });
const detailSchema = z.object({
  result: z.object({ jobOpening: z.unknown() }),
});
type BambooJob = z.infer<typeof jobSchema>;

export class BambooHrProvider extends BaseProvider {
  public readonly id = 'bamboohr';
  public readonly name = 'BambooHR';
  public readonly type = 'ats' as const;
  public readonly capabilities = {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: false,
    compensation: true,
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
          parsed.error.issues[0]?.message ?? 'Invalid BambooHR configuration',
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
        message: 'BambooHR configuration is valid',
        normalizedConfiguration: parsed.data,
        preview: null,
      };
    }

    try {
      const url = new URL(
        `https://${encodeURIComponent(parsed.data.companyDomain)}.bamboohr.com/careers/list`,
      );
      const response = await this.http.request(url, {
        provider: this.name,
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json();
      const check = responseSchema.safeParse(payload);
      if (!check.success) {
        return {
          valid: false,
          message: 'BambooHR company response is invalid',
          normalizedConfiguration: null,
          preview: null,
        };
      }
      return {
        valid: true,
        message: 'BambooHR configuration is valid',
        normalizedConfiguration: parsed.data,
        preview: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let userMessage = 'BambooHR subdomain is unreachable or inactive';
      if (message.includes('404') || message.includes('Not Found')) {
        userMessage = 'BambooHR subdomain not found';
      } else if (message.includes('timeout') || message.includes('timed out')) {
        userMessage = 'BambooHR validation timed out';
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
    const target = new URL(
      `https://${config.companyDomain}.bamboohr.com/careers/list`,
    );
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
    const payload =
      search.fixturePath === null
        ? await this.json(publicUrl(search.target), search.signal)
        : loadJsonFixture(search.fixturePath);
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success)
      throw new ProviderFetchError(
        'BambooHR response must contain a result array',
      );
    const bounded = parsed.data.result.slice(0, MAX_ITEMS);
    const valid = bounded.flatMap((item) => {
      const result = jobSchema.safeParse(item);
      return result.success ? [withCompany(result.data, search.target)] : [];
    });
    const selected = valid
      .filter((job) => matches(job, search.request))
      .slice(0, Math.min(search.request.limit, MAX_DETAILS));
    const records: unknown[] = [];
    for (const item of selected)
      records.push(
        search.fixturePath === null ? await this.addDetail(item, search) : item,
      );
    return {
      records,
      rejected: bounded.length - valid.length,
      truncated:
        parsed.data.result.length > MAX_ITEMS ||
        selected.length >= search.request.limit,
      complete: parsed.data.result.length <= MAX_ITEMS,
      unfilteredCount: valid.length,
    };
  }
  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const raw = jobSchema.parse(rawJob);
    const location = locationText(raw.atsLocation ?? raw.location);
    const id = String(raw.id);
    const postingUrl =
      raw.jobOpeningShareUrl ??
      `https://${raw._companyDomain ?? 'company'}.bamboohr.com/careers/${encodeURIComponent(id)}`;
    const salary = compensation(raw.compensation);
    return normalizeJob({
      externalId: id,
      title: raw.jobOpeningName,
      company: raw.company_name ?? 'Unknown employer',
      location,
      ...locationParts(location),
      remoteType: remote(raw, location),
      employmentType: employment(raw.employmentStatusLabel),
      salaryMinimum: salary.minimum,
      salaryMaximum: salary.maximum,
      salaryText: salary.text,
      description:
        raw.description || raw.summary
          ? htmlToText(raw.description ?? raw.summary ?? '')
          : null,
      requirements: null,
      preferredQualifications: null,
      department: raw.departmentLabel ?? null,
      postingUrl,
      applicationUrls: [],
      providerId: this.id,
      providerName: this.name,
      datePosted: iso(raw.datePosted),
      discoveredAt,
    });
  }
  private async addDetail(
    item: BambooJob,
    search: ProviderSearch,
  ): Promise<unknown> {
    const url = publicUrl(search.target);
    url.pathname = `/careers/${encodeURIComponent(String(item.id))}/detail`;
    try {
      const parsed = detailSchema.safeParse(
        await this.json(url, search.signal),
      );
      if (!parsed.success) return item;
      const detail = jobSchema.safeParse(parsed.data.result.jobOpening);
      return detail.success
        ? withCompany({ ...item, ...detail.data }, search.target)
        : item;
    } catch (error) {
      if (search.signal?.aborted) throw error;
      return item;
    }
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
function publicUrl(value: string): URL {
  const url = new URL(value);
  url.searchParams.delete('_company');
  return url;
}
function withCompany(
  job: BambooJob,
  target: string,
): BambooJob & { _companyDomain: string } {
  const url = new URL(target);
  return {
    ...job,
    company_name: url.searchParams.get('_company') ?? job.company_name,
    _companyDomain: url.hostname.slice(0, -'.bamboohr.com'.length),
  };
}
function locationText(value: BambooJob['location']): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!value) return null;
  return (
    [value.city, value.state, value.country].filter(Boolean).join(', ') || null
  );
}
function locationParts(location: string | null): {
  city: string | null;
  state: string | null;
} {
  const parts = location?.split(',').map((v) => v.trim()) ?? [];
  return { city: parts[0] ?? null, state: parts[1] ?? null };
}
function matches(job: BambooJob, request: SearchRequest): boolean {
  const text =
    `${job.jobOpeningName} ${locationText(job.atsLocation ?? job.location) ?? ''} ${job.locationType ?? ''} ${job.description ?? job.summary ?? ''}`.toLowerCase();
  return (
    (!request.query.trim() ||
      text.includes(request.query.trim().toLowerCase())) &&
    (!request.location || text.includes(request.location.toLowerCase())) &&
    (!request.remoteOnly || /remote|anywhere/.test(text))
  );
}
function remote(job: BambooJob, location?: string | null): RemoteType {
  const text = `${job.locationType ?? ''} ${location ?? ''} ${job.description ?? job.summary ?? ''}`;
  if (/hybrid/i.test(text)) return 'hybrid';
  if (job.isRemote === true || /remote|anywhere/i.test(text)) return 'remote';
  return location ? 'onsite' : 'unknown';
}
function compensation(value: BambooJob['compensation']): {
  minimum: number | null;
  maximum: number | null;
  text: string | null;
} {
  if (typeof value === 'string')
    return { minimum: null, maximum: null, text: value.trim() || null };
  if (!value) return { minimum: null, maximum: null, text: null };
  const range = [value.minimum, value.maximum]
    .filter((part): part is number => part !== null && part !== undefined)
    .join(' - ');
  const suffix = [value.currency, value.interval].filter(Boolean).join(' ');
  return {
    minimum: value.minimum ?? null,
    maximum: value.maximum ?? null,
    text: [range, suffix].filter(Boolean).join(' ') || null,
  };
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
export default new BambooHrProvider();
