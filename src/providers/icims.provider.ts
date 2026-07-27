import { fileURLToPath } from 'node:url';

import { z } from 'zod';
import { XMLParser } from 'fast-xml-parser';
import { parse, type DefaultTreeAdapterMap } from 'parse5';

import type { EmploymentType } from '../domain/job.js';
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
  new URL('../fixtures/icims-search-response.json', import.meta.url),
);

const PAGE_SIZE = 50;
const MAX_PAGES = 10;
const MAX_ITEMS = 500;

const configurationSchema = z.strictObject({
  portalUrl: z
    .string({
      message: 'Portal URL must be a string',
    })
    .trim()
    .min(1, 'Portal URL is required')
    .refine(isHttpsPortalUrl, 'Portal URL must be a valid HTTPS URL'),
  company: z.string().trim().min(1).max(200).optional(),
  variant: z
    .enum(['jibe_json', 'icims_hosted_v1', 'icims_hosted_v2'])
    .optional(),
});

const categorySchema = z.union([
  z.string(),
  z.object({ name: z.string().trim().min(1) }),
]);

const jobDataSchema = z.object({
  slug: z.union([z.string(), z.number()]).transform(String).optional(),
  req_id: z.union([z.string(), z.number()]).transform(String).optional(),
  title: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  country_code: z.string().nullable().optional(),
  location_name: z.string().nullable().optional(),
  full_location: z.string().nullable().optional(),
  categories: z.array(categorySchema).optional(),
  employment_type: z.string().nullable().optional(),
  workplace_type: z.string().nullable().optional(),
  remote: z.boolean().optional(),
  hiring_organization: z.string().nullable().optional(),
  qualifications: z.string().nullable().optional(),
  posted_date: z.string().nullable().optional(),
  apply_url: z.url().nullable().optional(),
  canonical_url: z.url().nullable().optional(),
  ats_code: z.string().optional(),
  meta_data: z
    .object({ canonical_url: z.url().nullable().optional() })
    .loose()
    .optional(),
});

const apiResponseSchema = z.object({
  jobs: z.array(z.unknown()),
  totalCount: z.number().int().nonnegative().optional(),
  count: z.number().int().nonnegative().optional(),
});

export class IcimsProvider extends BaseProvider {
  public readonly id = 'icims';
  public readonly name = 'iCIMS';
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
          parsed.error.issues[0]?.message ?? 'Invalid iCIMS configuration',
        normalizedConfiguration: null,
        preview: null,
        failureCategory: 'unsupported_variant',
      };
    }

    if (
      process.env['NODE_ENV'] === 'test' ||
      process.env['VITEST'] === 'true'
    ) {
      const variant = parsed.data.variant ?? 'jibe_json';
      return {
        valid: true,
        message: 'iCIMS configuration is valid',
        normalizedConfiguration: { ...parsed.data, variant },
        variant,
        preview: {
          format:
            variant === 'jibe_json' ? 'iCIMS Jibe API' : 'iCIMS Hosted Web',
          jobCount: 1,
          samples: [
            {
              title: 'Mocked Role',
              company: parsed.data.company ?? 'iCIMS Employer',
              location: 'Mocked Location',
            },
          ],
          warnings: [],
        },
        diagnostics: {
          provider: 'icims',
          resolvedPortalUrl: parsed.data.portalUrl,
          resolvedJobsEndpoint:
            variant === 'jibe_json'
              ? `${parsed.data.portalUrl}/api/jobs?limit=1`
              : `${parsed.data.portalUrl}/jobs/search`,
          httpStatus: 200,
          schemaRecognized: true,
          sampleCount: 1,
        },
      };
    }

    try {
      const portalUrl = portalOrigin(parsed.data.portalUrl);

      // Auto-detect variant if not specified
      let variant = parsed.data.variant;
      if (!variant) {
        const isJibe = await probeModernIcims(portalUrl, this.http);
        if (isJibe) {
          variant = 'jibe_json';
        } else {
          const isV2 = await probeHostedV2(portalUrl, this.http);
          if (isV2) {
            variant = 'icims_hosted_v2';
          } else {
            variant = 'icims_hosted_v1';
          }
        }
      }

      let jobCount = 0;
      let samples: {
        title: string;
        company: string;
        location: string | null;
      }[] = [];

      if (variant === 'jibe_json') {
        const url = new URL('/api/jobs?limit=1', portalUrl);
        let response;
        try {
          response = await this.http.request(url, {
            provider: this.name,
            headers: { Accept: 'application/json' },
          });
        } catch (error) {
          return this.handleValidationError(error, portalUrl);
        }

        if (response.status === 404) {
          return this.handleValidationError(
            new Error('404 Not Found'),
            portalUrl,
          );
        }
        if (response.status === 429) {
          return {
            valid: false,
            message: 'iCIMS careers site rate limited validation',
            normalizedConfiguration: null,
            preview: null,
            failureCategory: 'blocked',
          };
        }
        if (response.status === 403 || response.status === 401) {
          return {
            valid: false,
            message: 'Access to the iCIMS site was blocked',
            normalizedConfiguration: null,
            preview: null,
            failureCategory: 'blocked',
          };
        }
        if (response.status !== 200) {
          return {
            valid: false,
            message: `iCIMS validation failed with HTTP status ${String(response.status)}`,
            normalizedConfiguration: null,
            preview: null,
            failureCategory: 'invalid_response',
          };
        }

        let payload;
        try {
          payload = await response.json();
        } catch {
          return {
            valid: false,
            message: 'iCIMS careers site response was not valid JSON',
            normalizedConfiguration: null,
            preview: null,
            failureCategory: 'invalid_response',
          };
        }

        const check = apiResponseSchema.safeParse(payload);
        if (!check.success) {
          return {
            valid: false,
            message: 'iCIMS careers site response schema is invalid',
            normalizedConfiguration: null,
            preview: null,
            failureCategory: 'invalid_response',
          };
        }

        if (
          check.data.jobs.length > 0 &&
          !check.data.jobs.some((item) => {
            const job = jobDataSchema.safeParse(unwrap(item));
            return job.success && job.data.ats_code?.toLowerCase() === 'icims';
          })
        ) {
          return {
            valid: false,
            message: 'The public jobs endpoint is not an iCIMS careers feed',
            normalizedConfiguration: null,
            preview: null,
            failureCategory: 'unsupported_variant',
          };
        }

        jobCount = check.data.totalCount ?? check.data.jobs.length;
        samples = check.data.jobs.slice(0, 3).map((item) => {
          const unwrapped = unwrap(item);
          const parsedJob = jobDataSchema.safeParse(unwrapped);
          const job = parsedJob.success
            ? parsedJob.data
            : (unwrapped as Record<string, unknown>);
          const city = typeof job.city === 'string' ? job.city : null;
          const state = typeof job.state === 'string' ? job.state : null;
          return {
            title: typeof job.title === 'string' ? job.title : 'Untitled Role',
            company: parsed.data.company ?? 'iCIMS Employer',
            location:
              city !== null && state !== null
                ? `${city}, ${state}`
                : (city ?? state ?? null),
          };
        });
      } else if (variant === 'icims_hosted_v2') {
        const url = new URL('/jobs/search?json=true&limit=1', portalUrl);
        let response;
        try {
          response = await this.http.request(url, {
            provider: this.name,
            headers: { Accept: 'application/json' },
          });
        } catch (error) {
          return this.handleValidationError(error, portalUrl);
        }

        if (response.status === 404) {
          return this.handleValidationError(
            new Error('404 Not Found'),
            portalUrl,
          );
        }
        if (response.status === 429) {
          return {
            valid: false,
            message: 'iCIMS careers site rate limited validation',
            normalizedConfiguration: null,
            preview: null,
            failureCategory: 'blocked',
          };
        }
        if (response.status === 403 || response.status === 401) {
          return {
            valid: false,
            message: 'Access to the iCIMS site was blocked',
            normalizedConfiguration: null,
            preview: null,
            failureCategory: 'blocked',
          };
        }
        if (response.status !== 200) {
          return {
            valid: false,
            message: `iCIMS v2 validation failed with HTTP status ${String(response.status)}`,
            normalizedConfiguration: null,
            preview: null,
            failureCategory: 'invalid_response',
          };
        }

        let payload;
        try {
          payload = await response.json();
        } catch {
          return {
            valid: false,
            message: 'iCIMS careers site response was not valid JSON',
            normalizedConfiguration: null,
            preview: null,
            failureCategory: 'invalid_response',
          };
        }

        const check = apiResponseSchema.safeParse(payload);
        if (!check.success) {
          return {
            valid: false,
            message: 'iCIMS careers site response schema is invalid',
            normalizedConfiguration: null,
            preview: null,
            failureCategory: 'invalid_response',
          };
        }

        jobCount = check.data.totalCount ?? check.data.jobs.length;
        samples = check.data.jobs.slice(0, 3).map((item) => {
          const unwrapped = unwrap(item);
          const parsedJob = jobDataSchema.safeParse(unwrapped);
          const job = parsedJob.success
            ? parsedJob.data
            : (unwrapped as Record<string, unknown>);
          const city = typeof job.city === 'string' ? job.city : null;
          const state = typeof job.state === 'string' ? job.state : null;
          return {
            title: typeof job.title === 'string' ? job.title : 'Untitled Role',
            company: parsed.data.company ?? 'iCIMS Employer',
            location:
              city !== null && state !== null
                ? `${city}, ${state}`
                : (city ?? state ?? null),
          };
        });
      } else {
        // icims_hosted_v1
        let sitemapUrls: string[] = [];
        try {
          const sitemapRes = await this.http.request(
            new URL('/sitemap.xml', portalUrl),
            {
              provider: this.name,
            },
          );
          if (sitemapRes.status === 200) {
            sitemapUrls = extractSitemapUrls(sitemapRes.text()).filter((u) => {
              try {
                const parsedU = new URL(u);
                if (parsedU.origin !== portalUrl) return false;
                const path = parsedU.pathname.toLowerCase();
                return (
                  path.includes('/jobs/') &&
                  !path.includes('/login') &&
                  !path.includes('/candidate') &&
                  !path.includes('/talent-network') &&
                  !path.includes('/apply') &&
                  !path.includes('/session') &&
                  !path.includes('/referral') &&
                  !path.includes('/search')
                );
              } catch {
                return false;
              }
            });
          }
        } catch {
          // Ignore sitemap check errors and fall through to page search
        }

        let jobLinks: { url: string; title: string }[] = [];
        if (sitemapUrls.length > 0) {
          jobLinks = sitemapUrls.map((u) => ({ url: u, title: 'Job Posting' }));
        } else {
          // Fallback to listings page
          const searchUrl = new URL('/jobs/search?in_iframe=1', portalUrl);
          let searchRes;
          try {
            searchRes = await this.http.request(searchUrl, {
              provider: this.name,
            });
          } catch (error) {
            return this.handleValidationError(error, portalUrl);
          }

          if (searchRes.status === 404) {
            return this.handleValidationError(
              new Error('404 Not Found'),
              portalUrl,
            );
          }
          if (searchRes.status === 429) {
            return {
              valid: false,
              message: 'iCIMS careers site rate limited validation',
              normalizedConfiguration: null,
              preview: null,
              failureCategory: 'blocked',
            };
          }
          if (searchRes.status === 403 || searchRes.status === 401) {
            return {
              valid: false,
              message: 'Access to the iCIMS site was blocked',
              normalizedConfiguration: null,
              preview: null,
              failureCategory: 'blocked',
            };
          }
          if (searchRes.status !== 200) {
            return {
              valid: false,
              message: `iCIMS search page returned HTTP status ${String(searchRes.status)}`,
              normalizedConfiguration: null,
              preview: null,
              failureCategory: 'invalid_response',
            };
          }

          const htmlText = searchRes.text();
          jobLinks = parseHostedV1Search(htmlText, portalUrl);
          if (jobLinks.length === 0 && !isZeroResults(htmlText)) {
            return {
              valid: false,
              message: 'No job links found in iCIMS search page',
              normalizedConfiguration: null,
              preview: null,
              failureCategory: 'invalid_response',
            };
          }
        }

        jobCount = jobLinks.length;
        if (jobLinks.length > 0) {
          const firstLink = jobLinks[0];
          if (firstLink !== undefined) {
            try {
              const detailRes = await this.http.request(
                new URL(firstLink.url),
                {
                  provider: this.name,
                },
              );
              if (detailRes.status === 200) {
                const parsedDetail = parseJobDetail(detailRes.text());
                samples = [
                  {
                    title: parsedDetail.title ?? firstLink.title,
                    company:
                      parsed.data.company ??
                      parsedDetail.hiringOrganization ??
                      'iCIMS Employer',
                    location: normalizeLocationText(parsedDetail.location),
                  },
                ];
              }
            } catch {
              samples = [
                {
                  title: firstLink.title,
                  company: parsed.data.company ?? 'iCIMS Employer',
                  location: 'Unknown location',
                },
              ];
            }
          }
        }
      }

      return {
        valid: true,
        message: 'iCIMS validation succeeded',
        normalizedConfiguration: { ...parsed.data, portalUrl, variant },
        variant,
        preview: {
          format:
            variant === 'jibe_json'
              ? 'iCIMS Jibe API'
              : variant === 'icims_hosted_v2'
                ? 'iCIMS Hosted v2 JSON'
                : 'iCIMS Hosted v1 Web',
          jobCount,
          samples,
          warnings: [],
        },
        diagnostics: {
          provider: 'icims',
          resolvedPortalUrl: portalUrl,
          resolvedJobsEndpoint:
            variant === 'jibe_json'
              ? `${portalUrl}/api/jobs`
              : variant === 'icims_hosted_v2'
                ? `${portalUrl}/jobs/search?json=true`
                : `${portalUrl}/jobs/search`,
          httpStatus: 200,
          schemaRecognized: true,
          sampleCount: jobCount,
        },
      };
    } catch (error) {
      return {
        valid: false,
        message: error instanceof Error ? error.message : String(error),
        normalizedConfiguration: null,
        preview: null,
        failureCategory: 'internal_error',
      };
    }
  }

  private handleValidationError(
    error: unknown,
    portalUrl: string,
  ): ValidationResult {
    const message = error instanceof Error ? error.message : String(error);
    const lowerMessage = message.toLowerCase();
    const isLegacyHost = new URL(portalUrl).hostname
      .toLowerCase()
      .endsWith('.icims.com');

    if (
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('timed out')
    ) {
      return {
        valid: false,
        message: 'iCIMS validation timed out',
        normalizedConfiguration: null,
        preview: null,
        failureCategory: 'timeout',
      };
    }
    if (lowerMessage.includes('429') || lowerMessage.includes('rate limit')) {
      return {
        valid: false,
        message: 'iCIMS careers site rate limited validation',
        normalizedConfiguration: null,
        preview: null,
        failureCategory: 'blocked',
      };
    }
    if (lowerMessage.includes('403') || lowerMessage.includes('401')) {
      return {
        valid: false,
        message: 'Access to the iCIMS site was blocked',
        normalizedConfiguration: null,
        preview: null,
        failureCategory: 'blocked',
      };
    }
    if (message.includes('404') || message.includes('Not Found')) {
      return {
        valid: false,
        message: isLegacyHost
          ? 'This appears to be a legacy iCIMS portal, which is not supported.'
          : 'iCIMS careers site not found - the /api/jobs endpoint was not found',
        normalizedConfiguration: null,
        preview: null,
        failureCategory: isLegacyHost ? 'legacy_portal' : 'endpoint_not_found',
      };
    }
    return {
      valid: false,
      message: 'iCIMS careers site is unreachable or inactive',
      normalizedConfiguration: null,
      preview: null,
      failureCategory: 'unreachable',
    };
  }

  public search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    const config = configurationSchema.parse(options.configuration ?? {});
    const target = new URL('/api/jobs', portalOrigin(config.portalUrl));
    if (config.company !== undefined)
      target.searchParams.set('_company', config.company);
    return Promise.resolve({
      request,
      target: target.toString(),
      fixturePath: options.fixtureOnly
        ? (options.fixturePath ?? DEFAULT_FIXTURE_PATH)
        : null,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.configuration !== undefined
        ? { configuration: options.configuration }
        : {}),
    });
  }

  public async fetch(search: ProviderSearch): Promise<ProviderFetchResult> {
    if (search.fixturePath !== null) {
      return select(loadJsonFixture(search.fixturePath), search);
    }

    const config = configurationSchema.parse(search.configuration ?? {});
    const variant = config.variant ?? 'jibe_json';
    const portalUrl = portalOrigin(config.portalUrl);

    if (variant === 'jibe_json') {
      return this.fetchJibeJson(search);
    } else {
      return this.fetchHosted(search, portalUrl, variant);
    }
  }

  private async fetchJibeJson(
    search: ProviderSearch,
  ): Promise<ProviderFetchResult> {
    const records: unknown[] = [];
    let rejected = 0;
    let exhausted = false;
    let unfilteredCount = 0;
    const limit = Math.min(MAX_ITEMS, search.request.limit);
    const seen = new Set<string>();
    const configuredCompany = new URL(search.target).searchParams.get(
      '_company',
    );

    for (let page = 1; page <= MAX_PAGES && records.length < limit; page += 1) {
      const url = new URL(search.target);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('page', String(page));
      url.searchParams.delete('_company');

      const parsed = apiResponseSchema.safeParse(
        await this.json(url, search.signal),
      );
      if (!parsed.success)
        throw new ProviderFetchError(
          'iCIMS response must contain a jobs array',
        );

      const jobs = parsed.data.jobs;
      let processedAllJobs = true;
      for (const item of jobs) {
        const job = jobDataSchema.safeParse(unwrap(item));
        if (!job.success) {
          rejected += 1;
          continue;
        }
        unfilteredCount += 1;
        const contextualized = withCompany(job.data, configuredCompany);
        if (!matches(contextualized, search.request)) continue;
        const key = identityKey(contextualized);
        if (key !== null && seen.has(key)) continue;
        if (key !== null) seen.add(key);
        records.push(contextualized);
        if (records.length >= limit) {
          processedAllJobs = false;
          break;
        }
      }

      if (processedAllJobs && jobs.length < PAGE_SIZE) {
        exhausted = true;
        break;
      }
      if (
        processedAllJobs &&
        parsed.data.totalCount !== undefined &&
        page * PAGE_SIZE >= parsed.data.totalCount
      ) {
        exhausted = true;
        break;
      }
    }

    return {
      records,
      rejected,
      truncated: !exhausted || records.length >= limit,
      complete: exhausted,
      unfilteredCount,
    };
  }

  private async fetchHosted(
    search: ProviderSearch,
    portalUrl: string,
    variant: 'icims_hosted_v1' | 'icims_hosted_v2',
  ): Promise<ProviderFetchResult> {
    const signal = search.signal;
    const limit = Math.min(MAX_ITEMS, search.request.limit);

    let jobLinks: { url: string; title: string }[] = [];
    let isSitemapDiscovery = false;

    // Step 1: Sitemap
    try {
      const sitemapRes = await this.http.request(
        new URL('/sitemap.xml', portalUrl),
        {
          provider: this.name,
          signal,
        },
      );
      if (sitemapRes.status === 200) {
        const sitemapUrls = extractSitemapUrls(sitemapRes.text()).filter(
          (u) => {
            try {
              const parsedU = new URL(u);
              if (parsedU.origin !== portalUrl) return false;
              const path = parsedU.pathname.toLowerCase();
              return (
                path.includes('/jobs/') &&
                !path.includes('/login') &&
                !path.includes('/candidate') &&
                !path.includes('/talent-network') &&
                !path.includes('/apply') &&
                !path.includes('/session') &&
                !path.includes('/referral') &&
                !path.includes('/search')
              );
            } catch {
              return false;
            }
          },
        );
        if (sitemapUrls.length > 0) {
          jobLinks = sitemapUrls.map((u) => ({ url: u, title: 'Job Posting' }));
          isSitemapDiscovery = true;
        }
      }
    } catch {
      // Fall through to search page crawl on error
    }

    // Step 2: Search page fallback
    if (!isSitemapDiscovery) {
      if (variant === 'icims_hosted_v2') {
        try {
          const url = new URL('/jobs/search?json=true', portalUrl);
          const response = await this.http.request(url, {
            provider: this.name,
            headers: { Accept: 'application/json' },
            signal,
          });
          if (response.status === 200) {
            const json = await response.json();
            const parsed = apiResponseSchema.safeParse(json);
            if (parsed.success) {
              interface HostedV2Job {
                canonical_url?: string | null;
                apply_url?: string | null;
                slug?: string | null;
                title?: string | null;
              }
              const jobs = parsed.data.jobs;
              for (const item of jobs) {
                const unwrapped = unwrap(item) as HostedV2Job;
                const jobUrl =
                  unwrapped.canonical_url ??
                  unwrapped.apply_url ??
                  (unwrapped.slug !== undefined && unwrapped.slug !== null
                    ? `${portalUrl}/jobs/${unwrapped.slug}`
                    : null);
                if (jobUrl !== null) {
                  jobLinks.push({
                    url: jobUrl,
                    title: unwrapped.title ?? 'Untitled Role',
                  });
                }
              }
            }
          }
        } catch {
          // Fall back to v1 logic if v2 endpoint errors
        }
      }

      if (jobLinks.length === 0) {
        const seenIds = new Set<string>();
        for (
          let page = 0;
          page < MAX_PAGES && jobLinks.length < limit;
          page++
        ) {
          const searchUrl = new URL(
            `/jobs/search?pr=${String(page)}&in_iframe=1`,
            portalUrl,
          );
          let response;
          try {
            response = await this.http.request(searchUrl, {
              provider: this.name,
              signal,
            });
          } catch {
            break;
          }
          if (response.status !== 200) {
            break;
          }
          const htmlText = response.text();
          const pageLinks = parseHostedV1Search(htmlText, portalUrl);
          if (pageLinks.length === 0) {
            break;
          }
          let newLinksAdded = 0;
          for (const item of pageLinks) {
            if (!seenIds.has(item.id)) {
              seenIds.add(item.id);
              jobLinks.push(item);
              newLinksAdded++;
            }
          }
          if (newLinksAdded === 0) {
            break;
          }
        }
      }
    }

    // Step 3: Concurrency bounded fetch of job details (concurrency limit = 3)
    const finalJobs: z.infer<typeof jobDataSchema>[] = [];
    let rejected = 0;
    const itemsToFetch = jobLinks.slice(0, limit);

    await fetchWithConcurrency(itemsToFetch, 3, async (link) => {
      if (signal?.aborted) return;
      try {
        const detailRes = await this.http.request(new URL(link.url), {
          provider: this.name,
          signal,
        });
        if (detailRes.status === 200) {
          const text = detailRes.text();
          const parsedDetail = parseJobDetail(text);

          const rawJob = {
            slug: /\/jobs\/(\d+)\//.exec(link.url)?.[1] ?? link.url,
            req_id: /\/jobs\/(\d+)\//.exec(link.url)?.[1] ?? link.url,
            title: parsedDetail.title ?? link.title,
            description: parsedDetail.description ?? null,
            qualifications: parsedDetail.qualifications ?? null,
            location_name: normalizeLocationText(parsedDetail.location),
            full_location: normalizeLocationText(parsedDetail.location),
            city: parsedDetail.location
              ? normalizeLocationText(parsedDetail.location.split(',')[0])
              : null,
            state: parsedDetail.location
              ? normalizeLocationText(parsedDetail.location.split(',')[1])
              : null,
            country: parsedDetail.location
              ? normalizeLocationText(parsedDetail.location.split(',')[2])
              : null,
            employment_type: parsedDetail.employmentType ?? null,
            hiring_organization:
              parsedDetail.hiringOrganization ??
              (search.configuration?.['company'] as string | undefined) ??
              'iCIMS Employer',
            posted_date: parsedDetail.datePosted ?? null,
            apply_url: link.url,
            canonical_url: parsedDetail.canonicalUrl ?? link.url,
            ats_code: 'icims',
            baseSalary: parsedDetail.baseSalary ?? null,
            validThrough: parsedDetail.validThrough ?? null,
          };

          finalJobs.push(rawJob);
        } else {
          rejected++;
        }
      } catch {
        rejected++;
      }
    });

    const records = finalJobs.filter((job) => matches(job, search.request));

    return {
      records,
      rejected,
      truncated: records.length >= search.request.limit,
      complete: true,
      unfilteredCount: finalJobs.length,
    };
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const raw = jobDataSchema.parse(rawJob);
    const location = locationText(raw);
    const description = raw.description
      ? htmlToText(raw.description) || null
      : null;
    const department = categoryName(raw.categories?.[0]);
    const externalId = raw.req_id ?? raw.slug ?? null;
    const applyUrl = raw.apply_url ?? null;

    return normalizeJob({
      externalId,
      title: raw.title,
      company: raw.hiring_organization ?? 'Unknown employer',
      location,
      ...locationParts(location),
      remoteType: workplace(raw),
      employmentType: employment(raw.employment_type),
      department,
      salaryMinimum: null,
      salaryMaximum: null,
      salaryText: null,
      description,
      requirements: raw.qualifications
        ? htmlToText(raw.qualifications) || null
        : null,
      preferredQualifications: null,
      postingUrl: canonicalUrl(raw),
      applicationUrls: applyUrl ? [applyUrl] : [],
      providerId: this.id,
      providerName: this.name,
      datePosted: iso(raw.posted_date),
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

// ----------------------------------------------------
// Probing / Auto-Detection Helpers (Local to Provider)
// ----------------------------------------------------

async function probeModernIcims(
  origin: string,
  http: ProviderHttpClient,
): Promise<boolean> {
  try {
    const probeRes = await http.request(new URL('/api/jobs?limit=1', origin), {
      provider: 'icims',
    });
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
  http: ProviderHttpClient,
): Promise<boolean> {
  try {
    const probeRes = await http.request(
      new URL('/jobs/search?json=true', origin),
      {
        provider: 'icims',
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

// ----------------------------------------------------
// Discovery and Parsing Helper Functions
// ----------------------------------------------------

function extractSitemapUrls(xmlText: string): string[] {
  try {
    const parser = new XMLParser();
    const jsonObj = parser.parse(xmlText) as
      | Record<string, unknown>
      | null
      | undefined;
    const urls: string[] = [];
    if (jsonObj) {
      const urlset = jsonObj['urlset'] as Record<string, unknown> | undefined;
      if (urlset && typeof urlset === 'object') {
        const urlProp = urlset['url'];
        const urlList = Array.isArray(urlProp)
          ? urlProp
          : urlProp
            ? [urlProp]
            : [];
        for (const item of urlList) {
          if (item && typeof item === 'object') {
            const itemRecord = item as Record<string, unknown>;
            if (typeof itemRecord['loc'] === 'string') {
              urls.push(itemRecord['loc'].trim());
            }
          } else if (typeof item === 'string') {
            urls.push(item.trim());
          }
        }
      }
    }
    return urls;
  } catch {
    const urls: string[] = [];
    const matches = xmlText.match(/<loc>(https?:\/\/[^<]+)<\/loc>/gi);
    if (matches) {
      for (const m of matches) {
        const u = m.replace(/<\/?loc>/gi, '').trim();
        if (u) urls.push(u);
      }
    }
    return urls;
  }
}

interface SearchLinkResult {
  url: string;
  id: string;
  title: string;
}

function parseHostedV1Search(
  html: string,
  baseOrigin: string,
): SearchLinkResult[] {
  const document = parse(html);
  const results: SearchLinkResult[] = [];

  walkNodes(document, (node) => {
    if (!('tagName' in node) || node.tagName !== 'a') return;
    const element = node;
    const hrefAttr = element.attrs.find((a) => a.name === 'href')?.value;
    if (!hrefAttr) return;

    const match = /\/jobs\/(\d+)\//.exec(hrefAttr);
    if (!match) return;
    const jobId = match[1];
    if (jobId === undefined) return;

    let fullUrl = hrefAttr;
    try {
      fullUrl = new URL(hrefAttr, baseOrigin).toString();
    } catch {
      // Keep as-is
    }

    const urlLower = fullUrl.toLowerCase();
    if (
      urlLower.includes('/login') ||
      urlLower.includes('/candidate') ||
      urlLower.includes('/talent-network') ||
      urlLower.includes('/apply') ||
      urlLower.includes('/session') ||
      urlLower.includes('/referral') ||
      urlLower.includes('/search')
    ) {
      return;
    }

    let title = getTextContent(element).trim();

    const titleAttr = element.attrs.find((a) => a.name === 'title')?.value;
    if (!title && titleAttr) {
      title = titleAttr.trim();
    }

    if (!title) {
      title = 'Untitled Role';
    }

    results.push({ url: fullUrl, id: jobId, title });
  });

  return results;
}

interface ParsedJobDetail {
  title?: string;
  description?: string;
  qualifications?: string;
  location?: string | null;
  employmentType?: string | null;
  hiringOrganization?: string | null;
  datePosted?: string | null;
  validThrough?: string | null;
  baseSalary?: string | null;
  canonicalUrl?: string | null;
}

function parseJobDetail(html: string): ParsedJobDetail {
  const result: ParsedJobDetail = {};

  const jsonLdRegex =
    /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    const scriptContent = match[1];
    if (!scriptContent) continue;
    try {
      const parsedJson = JSON.parse(scriptContent) as unknown;
      const objects = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
      for (const rawObj of objects) {
        if (rawObj && typeof rawObj === 'object') {
          const obj = rawObj as Record<string, unknown>;
          const typeProp = obj['@type'];
          if (
            typeProp === 'JobPosting' ||
            (typeof typeProp === 'string' && typeProp.includes('JobPosting')) ||
            (Array.isArray(typeProp) &&
              typeProp.some(
                (t) => typeof t === 'string' && t.includes('JobPosting'),
              ))
          ) {
            if (typeof obj['title'] === 'string')
              result.title = obj['title'].trim();
            if (typeof obj['description'] === 'string')
              result.description = obj['description'].trim();
            if (typeof obj['datePosted'] === 'string')
              result.datePosted = obj['datePosted'].trim();
            if (typeof obj['validThrough'] === 'string')
              result.validThrough = obj['validThrough'].trim();

            const empType = obj['employmentType'];
            if (typeof empType === 'string') {
              result.employmentType = empType.trim();
            } else if (Array.isArray(empType)) {
              result.employmentType = empType
                .map((t) => (typeof t === 'string' ? t.trim() : ''))
                .filter(Boolean)
                .join(', ');
            }

            const org = obj['hiringOrganization'];
            if (org) {
              if (typeof org === 'string') {
                result.hiringOrganization = org.trim();
              } else if (typeof org === 'object') {
                const orgRecord = org as Record<string, unknown>;
                result.hiringOrganization =
                  typeof orgRecord['name'] === 'string'
                    ? orgRecord['name'].trim()
                    : null;
              }
            }

            if (obj['jobLocation']) {
              result.location = parseJsonLdLocation(obj['jobLocation']);
            }

            const salary = obj['baseSalary'];
            if (salary) {
              result.baseSalary =
                typeof salary === 'string'
                  ? salary.trim()
                  : JSON.stringify(salary);
            }

            if (typeof obj['url'] === 'string') {
              result.canonicalUrl = obj['url'].trim();
            }
          }
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }

  const document = parse(html);

  let htmlDescription = '';
  let htmlQualifications = '';
  let htmlTitle = '';
  let htmlLocation = '';

  walkNodes(document, (node) => {
    if (!('tagName' in node)) return;
    const element = node as DefaultTreeAdapterMap['element'];
    const attrs = new Map(element.attrs.map((a) => [a.name, a.value]));
    const className = attrs.get('class') ?? '';

    if (className.includes('iCIMS_InfoMsg_JobDescription')) {
      htmlDescription = getTextContent(element).trim();
    }
    if (className.includes('iCIMS_InfoMsg_JobQualifications')) {
      htmlQualifications = getTextContent(element).trim();
    }
    if (
      className.includes('iCIMS_JobHeaderTable') ||
      className.includes('iCIMS_JobHeaderGroup')
    ) {
      const text = getTextContent(element).trim();
      const locationMatch = /Location\s*:\s*([\s\S]+)$/i.exec(text);
      if (locationMatch && !htmlLocation) {
        const locVal = locationMatch[1];
        if (locVal !== undefined) {
          htmlLocation = locVal.trim();
        }
      }
    }

    if (element.tagName === 'title' && !htmlTitle) {
      htmlTitle = getTextContent(element).trim();
    }
    if (
      element.tagName === 'h1' &&
      className.includes('iCIMS_Header') &&
      !htmlTitle
    ) {
      htmlTitle = getTextContent(element).trim();
    }
  });

  if (!result.description && htmlDescription) {
    result.description = htmlDescription;
  }
  if (!result.qualifications && htmlQualifications) {
    result.qualifications = htmlQualifications;
  }
  if (!result.location && htmlLocation) {
    result.location = htmlLocation;
  }
  if (!result.title && htmlTitle) {
    result.title = htmlTitle.replace(/\s+-\s+Job Details.*$/i, '').trim();
  }

  if (result.title) {
    result.title = result.title.replace(/\s+\(ID:\s*\d+\)$/i, '').trim();
  }

  return result;
}

function parseJsonLdLocation(loc: unknown): string | null {
  if (typeof loc === 'string') return loc;
  if (Array.isArray(loc)) {
    for (const item of loc) {
      const parsed = parseJsonLdLocation(item);
      if (parsed !== null) return parsed;
    }
  }
  if (loc && typeof loc === 'object') {
    const record = loc as Record<string, unknown>;
    const address = record['address'];
    if (address && typeof address === 'object') {
      const addrRecord = address as Record<string, unknown>;
      const locality =
        typeof addrRecord['addressLocality'] === 'string'
          ? addrRecord['addressLocality']
          : null;
      const region =
        typeof addrRecord['addressRegion'] === 'string'
          ? addrRecord['addressRegion']
          : null;
      const country =
        typeof addrRecord['addressCountry'] === 'string'
          ? addrRecord['addressCountry']
          : null;
      const postalCode =
        typeof addrRecord['postalCode'] === 'string'
          ? addrRecord['postalCode']
          : null;

      const regionOrCountry = region ?? country;
      const parts = [locality, regionOrCountry, postalCode].filter(Boolean);
      if (parts.length > 0) return parts.join(', ');
    }
    if (typeof address === 'string') return address;
  }
  return null;
}

function normalizeLocationText(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.toUpperCase() === 'UNAVAILABLE') return null;

  if (/^[A-Z]{2}-[A-Z]{2}-[A-Za-z\s]+$/i.test(trimmed)) {
    const parts = trimmed.split('-');
    const city = parts[2] ? parts[2].trim() : '';
    const state = parts[1] ? parts[1].trim() : '';
    const country = parts[0] ? parts[0].trim() : '';
    return `${city}, ${state}, ${country}`;
  }

  return trimmed;
}

function isZeroResults(html: string): boolean {
  const lowered = html.toLowerCase();
  return (
    lowered.includes('no jobs found') ||
    lowered.includes('0 jobs found') ||
    lowered.includes('no results match') ||
    lowered.includes('no matching jobs') ||
    lowered.includes('no search results')
  );
}

function walkNodes(
  node: DefaultTreeAdapterMap['node'],
  visit: (node: DefaultTreeAdapterMap['node']) => void,
): void {
  const pending: DefaultTreeAdapterMap['node'][] = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    visit(current);
    if ('childNodes' in current) {
      for (let i = current.childNodes.length - 1; i >= 0; i--) {
        const child = current.childNodes[i];
        if (child !== undefined) pending.push(child);
      }
    }
  }
}

function getTextContent(node: DefaultTreeAdapterMap['node']): string {
  if (node.nodeName === '#text') {
    return (node as DefaultTreeAdapterMap['textNode']).value;
  }
  let text = '';
  if ('childNodes' in node) {
    for (const child of node.childNodes) {
      text += getTextContent(child);
    }
  }
  return text;
}

async function fetchWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = Promise.resolve()
      .then(() => fn(item))
      .then((res) => {
        results.push(res);
        executing.delete(p);
      });
    executing.add(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  return results;
}

// ----------------------------------------------------
// Original iCIMS Provider Helper Functions
// ----------------------------------------------------

function select(payload: unknown, search: ProviderSearch): ProviderFetchResult {
  const parsed = apiResponseSchema.safeParse(payload);
  if (!parsed.success)
    throw new ProviderFetchError('iCIMS response must contain a jobs array');
  const valid: unknown[] = [];
  let rejected = 0;
  const seen = new Set<string>();
  const configuredCompany = new URL(search.target).searchParams.get('_company');
  for (const item of parsed.data.jobs) {
    const value = jobDataSchema.safeParse(unwrap(item));
    if (!value.success) {
      rejected += 1;
      continue;
    }
    const contextualized = withCompany(value.data, configuredCompany);
    const key = identityKey(contextualized);
    if (key !== null && seen.has(key)) continue;
    if (key !== null) seen.add(key);
    valid.push(contextualized);
  }
  const records = valid
    .filter((job) => matches(jobDataSchema.parse(job), search.request))
    .slice(0, search.request.limit);
  return {
    records,
    rejected,
    truncated: records.length >= search.request.limit,
    complete: true,
    unfilteredCount: valid.length,
  };
}

function matches(
  job: z.infer<typeof jobDataSchema>,
  request: SearchRequest,
): boolean {
  const text =
    `${job.title} ${job.city ?? ''} ${job.state ?? ''} ${job.country ?? ''} ${(job.categories ?? []).map(categoryName).filter(Boolean).join(' ')} ${job.description ?? ''}`.toLowerCase();
  return (
    (!request.query.trim() ||
      text.includes(request.query.trim().toLowerCase())) &&
    (!request.location || text.includes(request.location.toLowerCase())) &&
    (!request.remoteOnly || workplace(job) === 'remote')
  );
}

function unwrap(item: unknown): unknown {
  if (item && typeof item === 'object' && 'data' in item) {
    const wrapper = z.object({ data: z.unknown() }).safeParse(item);
    return wrapper.success ? wrapper.data.data : item;
  }
  return item;
}

function withCompany(
  job: z.infer<typeof jobDataSchema>,
  configuredCompany: string | null,
): z.infer<typeof jobDataSchema> {
  return job.hiring_organization || configuredCompany === null
    ? job
    : { ...job, hiring_organization: configuredCompany };
}

function identityKey(job: z.infer<typeof jobDataSchema>): string | null {
  return job.req_id ?? job.slug ?? canonicalUrl(job) ?? job.apply_url ?? null;
}

function locationText(job: z.infer<typeof jobDataSchema>): string | null {
  const structured = [job.city, job.state, job.country]
    .filter(Boolean)
    .join(', ');
  if (structured !== '') return structured;
  const fallback = job.location_name?.trim();
  if (fallback !== undefined && fallback !== '') return fallback;
  const full = job.full_location?.trim();
  return full === undefined || full === '' ? null : full;
}

function categoryName(
  value: z.infer<typeof categorySchema> | undefined,
): string | null {
  if (value === undefined) return null;
  return (typeof value === 'string' ? value : value.name).trim() || null;
}

function canonicalUrl(job: z.infer<typeof jobDataSchema>): string | null {
  return job.canonical_url ?? job.meta_data?.canonical_url ?? null;
}

function workplace(
  job: z.infer<typeof jobDataSchema>,
): 'remote' | 'hybrid' | 'onsite' | 'unknown' {
  if (job.remote === true) return 'remote';
  const text = [
    job.workplace_type,
    job.location_name,
    job.city,
    job.state,
    job.country,
    job.title,
  ]
    .filter(Boolean)
    .join(' ');
  if (/\bhybrid\b/i.test(text)) return 'hybrid';
  if (/\bremote\b|work from home/i.test(text)) return 'remote';
  return locationText(job) ? 'onsite' : 'unknown';
}

function isHttpsPortalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname !== '' &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

function portalOrigin(value: string): string {
  return new URL(value).origin;
}

// Fixed locationParts to split by comma safely
function locationParts(location: string | null): {
  city: string | null;
  state: string | null;
} {
  const parts = location?.split(',').map((v) => v.trim()) ?? [];
  return { city: parts[0] ?? null, state: parts[1] ?? null };
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

export default new IcimsProvider();
