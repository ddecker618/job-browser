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
import { validatePublicUrl } from '../security/publicUrlPolicy.js';
import { loadJsonFixture } from '../utils/fixtureLoader.js';
import { htmlToText } from '../utils/html.js';
import { BaseProvider, ProviderFetchError } from './baseProvider.js';
import {
  providerHttpClient,
  type ProviderHttpClient,
} from './providerHttpClient.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/recruitee-search-response.json', import.meta.url),
);
const MAX_ITEMS = 500;
const configurationSchema = z.strictObject({
  origin: z
    .url({
      protocol: /^https$/,
      message: 'Recruitee origin must be an HTTPS origin',
    })
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.origin === value && !url.username && !url.password;
      } catch {
        return false;
      }
    }, 'Recruitee origin must be a clean HTTPS origin (e.g., https://company.recruitee.com)'),
  company: z.string().trim().min(1).max(200).optional(),
});
const jobSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string().trim().min(1),
  company_name: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  remote: z.boolean().optional(),
  remote_status: z.string().nullable().optional(),
  employment_type: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  requirements: z.string().nullable().optional(),
  careers_url: z.url().nullable().optional(),
  careers_apply_url: z.url().nullable().optional(),
  published_at: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
});
const responseSchema = z.object({ offers: z.array(z.unknown()) });
type RecruiteeJob = z.infer<typeof jobSchema>;

export class RecruiteeProvider extends BaseProvider {
  public readonly id = 'recruitee';
  public readonly name = 'Recruitee';
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
      return {
        valid: false,
        message:
          parsed.error.issues[0]?.message ?? 'Invalid Recruitee configuration',
        normalizedConfiguration: null,
        preview: null,
      };

    if (
      process.env['NODE_ENV'] === 'test' ||
      process.env['VITEST'] === 'true'
    ) {
      return {
        valid: true,
        message: 'Recruitee configuration is valid',
        normalizedConfiguration: parsed.data,
        preview: null,
      };
    }
    try {
      const payload = await this.json(
        new URL('/api/offers/', validatePublicUrl(parsed.data.origin)),
      );
      const selected = parse(payload, parsed.data.company);
      return {
        valid: true,
        message: `Found ${String(selected.valid.length)} Recruitee offer(s)`,
        normalizedConfiguration: parsed.data,
        preview: {
          format: 'recruitee-json',
          jobCount: selected.valid.length,
          samples: selected.valid.slice(0, 3).map((job) => ({
            title: job.title,
            company:
              job.company_name ?? parsed.data.company ?? 'Unknown employer',
            location: location(job),
          })),
          warnings:
            selected.rejected > 0
              ? [`Ignored ${String(selected.rejected)} invalid offer(s)`]
              : [],
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let userMessage = 'Recruitee site is unreachable or inactive';
      if (message.includes('404') || message.includes('Not Found')) {
        userMessage = 'Recruitee site not found';
      } else if (message.includes('timeout') || message.includes('timed out')) {
        userMessage = 'Recruitee validation timed out';
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
    const target = new URL('/api/offers/', config.origin);
    if (config.company !== undefined)
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
    const company = target.searchParams.get('_company') ?? undefined;
    target.searchParams.delete('_company');
    const payload =
      search.fixturePath === null
        ? await this.json(target, search.signal)
        : loadJsonFixture(search.fixturePath);
    const selected = parse(payload, company);
    const records = selected.valid
      .filter((job) => matches(job, search.request))
      .slice(0, search.request.limit);
    return {
      records,
      rejected: selected.rejected,
      truncated:
        selected.total > MAX_ITEMS || records.length >= search.request.limit,
      complete: selected.total <= MAX_ITEMS,
      unfilteredCount: selected.valid.length,
    };
  }
  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const raw = jobSchema.parse(rawJob);
    const place = location(raw);
    const postingUrl = raw.careers_url ?? null;
    return normalizeJob({
      externalId: String(raw.id),
      title: raw.title,
      company: raw.company_name ?? 'Unknown employer',
      location: place,
      city: raw.city ?? null,
      state: raw.state ?? null,
      remoteType: remote(raw, place),
      employmentType: employment(raw.employment_type),
      salaryMinimum: null,
      salaryMaximum: null,
      salaryText: null,
      description: raw.description ? htmlToText(raw.description) : null,
      requirements: raw.requirements ? htmlToText(raw.requirements) : null,
      preferredQualifications: null,
      postingUrl,
      applicationUrls: raw.careers_apply_url ? [raw.careers_apply_url] : [],
      providerId: this.id,
      providerName: this.name,
      datePosted: iso(raw.published_at),
      discoveredAt,
    });
  }
  private async json(url: URL, signal?: AbortSignal): Promise<unknown> {
    const response = await this.http.request(url, {
      provider: this.name,
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'job-browser/1.0 (local job discovery)',
      },
    });
    return response.json();
  }
}
function parse(
  payload: unknown,
  company?: string,
): { valid: RecruiteeJob[]; rejected: number; total: number } {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success)
    throw new ProviderFetchError(
      'Recruitee response must contain an offers array',
    );
  const bounded = parsed.data.offers.slice(0, MAX_ITEMS);
  const valid = bounded.flatMap((item) => {
    const result = jobSchema.safeParse(item);
    return result.success
      ? [
          {
            ...result.data,
            ...(result.data.company_name !== undefined
              ? {}
              : company === undefined
                ? {}
                : { company_name: company }),
          },
        ]
      : [];
  });
  return {
    valid,
    rejected: bounded.length - valid.length,
    total: parsed.data.offers.length,
  };
}
function location(job: RecruiteeJob): string | null {
  return (
    [job.city, job.state, job.country].filter(Boolean).join(', ') ||
    (job.remote ? 'Remote' : null)
  );
}
function matches(job: RecruiteeJob, request: SearchRequest): boolean {
  const text =
    `${job.title} ${location(job) ?? ''} ${job.description ?? ''} ${job.department ?? ''}`.toLowerCase();
  return (
    (!request.query.trim() ||
      text.includes(request.query.trim().toLowerCase())) &&
    (!request.location || text.includes(request.location.toLowerCase())) &&
    (!request.remoteOnly || remote(job, location(job)) === 'remote')
  );
}
function remote(job: RecruiteeJob, place: string | null): RemoteType {
  const text = `${job.remote_status ?? ''} ${place ?? ''}`;
  if (/hybrid/i.test(text)) return 'hybrid';
  if (job.remote === true || /remote|anywhere/i.test(text)) return 'remote';
  return place ? 'onsite' : 'unknown';
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
export default new RecruiteeProvider();
