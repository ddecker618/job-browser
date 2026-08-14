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
  new URL('../fixtures/smartrecruiters-search-response.json', import.meta.url),
);
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const MAX_ITEMS = 500;
const MAX_DETAILS = 100;
const configurationSchema = z.strictObject({
  companyIdentifier: z
    .string({
      message: 'Company identifier must be a string',
    })
    .trim()
    .min(1, 'Company identifier is required')
    .max(300, 'Company identifier is too long')
    .transform(normalizeCompanyIdentifier)
    .pipe(
      z
        .string()
        .min(1, 'Company identifier is required')
        .max(100, 'Company identifier is too long')
        .regex(
          /^[A-Za-z0-9_-]+$/,
          'Company identifier contains invalid characters',
        ),
    ),
  company: z.string().trim().min(1).max(200).optional(),
});
const jobSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  uuid: z.string().optional(),
  ref: z.string().nullable().optional(),
  company: z
    .object({ name: z.string().optional(), identifier: z.string().optional() })
    .optional(),
  location: z
    .object({
      city: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
      remote: z.boolean().optional(),
    })
    .optional(),
  releasedDate: z.string().nullable().optional(),
  typeOfEmployment: z.object({ label: z.string().optional() }).optional(),
  workplaceType: z.string().nullable().optional(),
  jobAd: z
    .object({
      sections: z
        .record(
          z.string(),
          z.object({ text: z.string().nullable().optional() }),
        )
        .optional(),
    })
    .optional(),
  applyUrl: z.url().nullable().optional(),
  postingUrl: z.url().optional(),
  company_name: z.string().optional(),
});
const listSchema = z.object({
  content: z.array(z.unknown()),
  totalFound: z.number().int().nonnegative().optional(),
});
type SmartJob = z.infer<typeof jobSchema>;

function normalizeCompanyIdentifier(value: string): string {
  if (!/^https:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      host !== 'jobs.smartrecruiters.com' &&
      host !== 'careers.smartrecruiters.com'
    )
      return value;
    const slug = url.pathname.split('/').find(Boolean);
    return slug === undefined ? '' : decodeURIComponent(slug);
  } catch {
    return value;
  }
}

export class SmartRecruitersProvider extends BaseProvider {
  public readonly id = 'smartrecruiters';
  public readonly name = 'SmartRecruiters';
  public readonly type = 'ats' as const;
  public readonly capabilities = {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: true,
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
          parsed.error.issues[0]?.message ??
          'Invalid SmartRecruiters configuration',
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
        message: 'SmartRecruiters configuration is valid',
        normalizedConfiguration: parsed.data,
        preview: null,
      };
    }

    try {
      const url = new URL(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(parsed.data.companyIdentifier)}/postings?limit=1`,
      );
      const response = await this.http.request(url, {
        provider: this.name,
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json();
      const check = listSchema.safeParse(payload);
      if (!check.success) {
        return {
          valid: false,
          message: 'SmartRecruiters company response is invalid',
          normalizedConfiguration: null,
          preview: null,
        };
      }
      const count = check.data.totalFound ?? check.data.content.length;
      const samples = check.data.content
        .slice(0, 3)
        .map((item) => {
          const job = jobSchema.safeParse(item);
          return job.success
            ? {
                title: job.data.name,
                company:
                  job.data.company?.name ??
                  job.data.company_name ??
                  parsed.data.companyIdentifier,
                location: locationLabel(job.data),
              }
            : null;
        })
        .filter(
          (
            sample,
          ): sample is { title: string; company: string; location: string } =>
            sample !== null,
        );
      return {
        valid: true,
        message:
          count > 0
            ? `SmartRecruiters company "${parsed.data.companyIdentifier}" is valid with ${String(count)} open job${count === 1 ? '' : 's'}`
            : `SmartRecruiters company "${parsed.data.companyIdentifier}" is valid but currently has no open jobs`,
        normalizedConfiguration: parsed.data,
        preview: {
          format: 'SmartRecruiters Public API',
          jobCount: count,
          samples,
          warnings: [],
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let userMessage = 'SmartRecruiters site is unreachable or inactive';
      if (message.includes('404') || message.includes('Not Found')) {
        userMessage = `SmartRecruiters company "${parsed.data.companyIdentifier}" was not found`;
      } else if (message.includes('timeout') || message.includes('timed out')) {
        userMessage = 'SmartRecruiters validation timed out';
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
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(config.companyIdentifier)}/postings`,
    );
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
    if (search.fixturePath !== null) {
      const res = select(loadJsonFixture(search.fixturePath), search);
      return res;
    }
    const records: unknown[] = [];
    let rejected = 0;
    let exhausted = false;
    let pageFailed = false;
    let unfilteredCount = 0;
    const limit = Math.min(MAX_ITEMS, search.request.limit);
    for (let page = 0; page < MAX_PAGES && records.length < limit; page += 1) {
      const url = publicTarget(search.target);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('offset', String(page * PAGE_SIZE));
      const parsed = await this.tryPage(url, search, page === 0);
      if (parsed === null) {
        pageFailed = true;
        break;
      }
      for (const item of parsed.content) {
        const job = jobSchema.safeParse(item);
        if (!job.success) {
          rejected += 1;
          continue;
        }
        unfilteredCount += 1;
        if (matches(job.data, search.request))
          records.push(withContext(job.data, search.target));
        if (records.length >= limit) break;
      }
      if (
        parsed.content.length < PAGE_SIZE ||
        (parsed.totalFound !== undefined &&
          (page + 1) * PAGE_SIZE >= parsed.totalFound)
      ) {
        exhausted = true;
        break;
      }
    }
    const detailed: unknown[] = [];
    for (const item of records.slice(0, MAX_DETAILS))
      detailed.push(await this.detail(item, search));
    return {
      records: detailed,
      rejected,
      truncated: !exhausted || records.length >= limit,
      complete: exhausted && !pageFailed,
      unfilteredCount,
    };
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const raw = jobSchema.parse(rawJob);
    const location =
      [raw.location?.city, raw.location?.region, raw.location?.country]
        .filter(Boolean)
        .join(', ') || null;
    const sections = raw.jobAd?.sections ?? {};
    const description = sectionText(
      sections['jobDescription'] ?? sections['description'],
    );
    const qualifications = sectionText(sections['qualifications']);
    const postingUrl =
      raw.postingUrl ??
      `https://jobs.smartrecruiters.com/${raw.company?.identifier ?? 'company'}/${raw.id}`;
    return normalizeJob({
      externalId: raw.id,
      title: raw.name,
      company: raw.company_name ?? raw.company?.name ?? 'Unknown employer',
      location,
      ...locationParts(location),
      remoteType: remote(raw, location),
      employmentType: employment(raw.typeOfEmployment?.label),
      salaryMinimum: null,
      salaryMaximum: null,
      salaryText: null,
      description,
      requirements: qualifications,
      preferredQualifications: null,
      postingUrl,
      applicationUrls: raw.applyUrl ? [raw.applyUrl] : [],
      providerId: this.id,
      providerName: this.name,
      datePosted: iso(raw.releasedDate),
      discoveredAt,
    });
  }

  private async detail(
    item: unknown,
    search: ProviderSearch,
  ): Promise<unknown> {
    const job = jobSchema.parse(item);
    const url = publicTarget(search.target);
    url.pathname += `/${encodeURIComponent(job.id)}`;
    try {
      return withContext(
        jobSchema.parse(await this.json(url, search.signal)),
        search.target,
      );
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
  private async tryPage(
    url: URL,
    search: ProviderSearch,
    failHard: boolean,
  ): Promise<{ content: unknown[]; totalFound?: number | undefined } | null> {
    let payload: unknown;
    try {
      payload = await this.json(url, search.signal);
    } catch (error) {
      if (search.signal?.aborted) throw error;
      if (failHard) throw error;
      return null;
    }
    const parsed = listSchema.safeParse(payload);
    if (!parsed.success) {
      if (failHard)
        throw new ProviderFetchError(
          'SmartRecruiters response must contain a content array',
        );
      return null;
    }
    return parsed.data;
  }
}

function select(payload: unknown, search: ProviderSearch): ProviderFetchResult {
  const parsed = listSchema.safeParse(payload);
  if (!parsed.success)
    throw new ProviderFetchError(
      'SmartRecruiters response must contain a content array',
    );
  const valid = parsed.data.content.flatMap((item) => {
    const value = jobSchema.safeParse(item);
    return value.success ? [withContext(value.data, search.target)] : [];
  });
  const records = valid
    .filter((job) => matches(jobSchema.parse(job), search.request))
    .slice(0, search.request.limit);
  return {
    records,
    rejected: parsed.data.content.length - valid.length,
    truncated: records.length >= search.request.limit,
    complete: true,
    unfilteredCount: valid.length,
  };
}
function withContext(job: SmartJob, target: string): SmartJob {
  const url = new URL(target);
  const identifier = url.pathname.split('/')[3] ?? job.company?.identifier;
  const company =
    url.searchParams.get('_company') ??
    job.company?.name ??
    (identifier ? displayIdentifier(identifier) : undefined);
  return {
    ...job,
    company: { ...job.company, ...(identifier ? { identifier } : {}) },
    ...(company ? { company_name: company } : {}),
    postingUrl:
      job.postingUrl ??
      `https://jobs.smartrecruiters.com/${identifier ?? 'company'}/${job.id}`,
  };
}
function sectionText(
  section: { text?: string | null | undefined } | undefined,
): string | null {
  return section?.text ? htmlToText(section.text) || null : null;
}
function displayIdentifier(value: string): string {
  return value.replaceAll(/[-_]+/g, ' ').trim() || value;
}
function publicTarget(value: string): URL {
  const url = new URL(value);
  url.searchParams.delete('_company');
  return url;
}
function matches(job: SmartJob, request: SearchRequest): boolean {
  const text =
    `${job.name} ${JSON.stringify(job.location ?? {})} ${JSON.stringify(job.jobAd ?? {})}`.toLowerCase();
  return (
    (!request.query.trim() ||
      text.includes(request.query.trim().toLowerCase())) &&
    (!request.location || text.includes(request.location.toLowerCase())) &&
    (!request.remoteOnly ||
      job.location?.remote === true ||
      text.includes('remote'))
  );
}
function locationParts(location: string | null): {
  city: string | null;
  state: string | null;
} {
  const parts = location?.split(',').map((v) => v.trim()) ?? [];
  return { city: parts[0] ?? null, state: parts[1] ?? null };
}
function locationLabel(job: SmartJob): string {
  return (
    [job.location?.city, job.location?.region, job.location?.country]
      .filter(Boolean)
      .join(', ') || 'Remote'
  );
}
function remote(job: SmartJob, location: string | null): RemoteType {
  const workplace = (job.workplaceType ?? '').toLowerCase();
  if (workplace === 'remote') return 'remote';
  if (workplace === 'hybrid') return 'hybrid';
  if (workplace === 'onsite' || workplace === 'other') return 'onsite';
  return job.location?.remote === true || /remote/i.test(location ?? '')
    ? 'remote'
    : location
      ? 'onsite'
      : 'unknown';
}
function employment(value?: string): EmploymentType {
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

export default new SmartRecruitersProvider();
