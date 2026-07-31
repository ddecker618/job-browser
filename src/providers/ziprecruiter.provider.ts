import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';
import type { Page } from 'playwright';

import type {
  DiscoveryOptions,
  ProviderFetchResult,
  ProviderSearch,
  SearchRequest,
} from '../models/discovery.js';
import type {
  ProviderConfiguration,
  ProviderType,
  ValidationResult,
} from '../models/source-management.js';
import { normalizeJob } from '../normalizer/jobNormalizer.js';
import type { NormalizedJob } from '../schemas/normalized-job.js';
import { BaseProvider } from './baseProvider.js';
import {
  extractJsonLdJobPosting,
  idFromUrl,
  inferEmploymentType,
  inferRemoteType,
  inferSeniority,
  jobPostingDetails,
  mergeJobPosting,
  parseSalaryText,
  runBrowserSearch,
  safeUrl,
  splitLocation,
  toIsoDate,
} from './browserJobBoard.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/ziprecruiter-search-response.json', import.meta.url),
);

const querySchema = z.strictObject({
  keywords: z.string().trim().min(1),
  location: z.string().optional().default(''),
});

const configurationSchema = z.strictObject({
  searchKeywords: z.string().trim().min(1).default('systems administrator'),
  location: z.string().optional().default(''),
  queries: z
    .array(querySchema)
    .optional()
    .default([
      { keywords: 'systems administrator', location: '' },
      { keywords: 'network administrator', location: '' },
      { keywords: 'network analyst', location: '' },
      { keywords: 'SOC analyst', location: '' },
    ]),
  remoteFilter: z
    .enum(['remote', 'hybrid', 'onsite', ''])
    .optional()
    .default(''),
  datePosted: z
    .enum(['24h', 'week', 'month', 'any'])
    .optional()
    .default('month'),
  maxResults: z.number().int().min(1).max(100).optional().default(50),
  browserProfileDir: z.string().optional(),
  keepBrowserOpen: z.boolean().optional().default(true),
});

const rawJobSchema = z.object({
  jobId: z.string().nullable(),
  title: z.string().nullable(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  salaryText: z.string().nullable(),
  salaryMinimum: z.number().nullable(),
  salaryMaximum: z.number().nullable(),
  description: z.string().nullable(),
  requirements: z.string().nullable(),
  preferredQualifications: z.string().nullable(),
  postingUrl: z.string().nullable(),
  postedDate: z.string().nullable(),
  employmentType: z.string().nullable(),
  workplaceType: z.string().nullable(),
  seniorityLevel: z.string().nullable(),
});

type ZipRecruiterConfiguration = z.infer<typeof configurationSchema>;
type ZipRecruiterJob = z.infer<typeof rawJobSchema>;

export class ZipRecruiterProvider extends BaseProvider {
  public readonly id = 'ziprecruiter';
  public readonly name = 'ZipRecruiter';
  public readonly type: ProviderType = 'job-board';
  public readonly capabilities = {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: false,
    compensation: true,
    requiresCredentials: false,
    structuredPreview: true,
    interactiveBrowser: true,
  } as const;

  private browserProfileDir: string | null = null;
  private cancelRequested = false;

  public setBrowserProfileDir(directory: string): void {
    this.browserProfileDir = directory;
  }

  public requestCancel(): void {
    this.cancelRequested = true;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public override async validateConfiguration(
    configuration: ProviderConfiguration,
  ): Promise<ValidationResult> {
    const parsed = configurationSchema.safeParse(configuration);
    return {
      valid: parsed.success,
      message: parsed.success
        ? 'ZipRecruiter configuration is valid. A visible browser session is used for discovery.'
        : `ZipRecruiter configuration error: ${parsed.error.message}`,
      normalizedConfiguration: parsed.success ? parsed.data : null,
      preview: null,
    };
  }

  public search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    const rawConfiguration = options.configuration ?? {};
    const parsed = configurationSchema.parse(rawConfiguration);
    const configuration = effectiveConfiguration(
      parsed,
      rawConfiguration,
      request,
    );
    const firstQuery = configuration.queries[0];
    const query = firstQuery?.keywords ?? configuration.searchKeywords;
    const location = firstQuery?.location ?? configuration.location;
    return Promise.resolve({
      request,
      target: buildSearchUrl(query, location, configuration),
      fixturePath: options.fixtureOnly
        ? (options.fixturePath ?? DEFAULT_FIXTURE_PATH)
        : null,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      configuration: configuration as unknown as Record<string, unknown>,
    });
  }

  public async fetch(search: ProviderSearch): Promise<ProviderFetchResult> {
    this.cancelRequested = false;
    if (search.fixturePath !== null) return this.fetchFixture(search);

    const configuration = configurationSchema.parse(search.configuration ?? {});
    const queries = resolveQueries(configuration, search.request);
    const maxResultsPerQuery = Math.min(
      configuration.maxResults,
      Math.max(1, search.request.limit),
    );
    const result = await runBrowserSearch<ZipRecruiterJob>({
      providerName: this.name,
      profileDir: resolve(
        process.cwd(),
        configuration.browserProfileDir ?? this.resolveBrowserProfileDir(),
      ),
      keepBrowserOpen: configuration.keepBrowserOpen,
      goBackAfterEnrich: true,
      securityTimeout: 300_000,
      maxResultsPerQuery,
      queries: queries.map((q) => q.keywords),
      queryLocations: queries.map((q) => q.location),
      waitForResults: waitForZipRecruiterResults,
      buildSearchUrl: (query, location) => {
        const matchingQuery = queries.find((item) => item.keywords === query);
        return buildSearchUrl(
          query,
          location ?? matchingQuery?.location ?? configuration.location,
          configuration,
        );
      },
      extractCards: extractZipRecruiterCards,
      enrichCard: enrichZipRecruiterCard,
      signal: search.signal,
      isCancelled: () => this.cancelRequested,
    });
    const filtered = result.records.filter((record) =>
      matchesRequest(record, search.request),
    );
    return {
      records: filtered,
      rejected: 0,
      truncated: result.completedQueries > 0 && result.truncatedQueries > 0,
      complete: result.complete,
      queryDiagnostics: result.queryDiagnostics,
      plannedQueries: result.plannedQueries,
      completedQueries: result.completedQueries,
      failedQueries: result.failedQueries,
      truncatedQueries: result.truncatedQueries,
    };
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const job = rawJobSchema.parse(rawJob);
    const postingUrl = safeUrl(job.postingUrl);
    const locationParts = splitLocation(job.location);
    return normalizeJob({
      externalId: job.jobId ?? idFromUrl(postingUrl),
      title: job.title ?? 'Untitled Position',
      company: job.company ?? 'Unknown Company',
      location: job.location,
      city: locationParts.city,
      state: locationParts.state,
      remoteType: inferRemoteType(
        `${job.workplaceType ?? ''} ${job.location ?? ''} ${job.description ?? ''}`,
      ),
      employmentType: inferEmploymentType(
        `${job.employmentType ?? ''} ${job.title ?? ''}`,
      ),
      salaryMinimum:
        job.salaryMinimum ?? parseSalaryText(job.salaryText).minimum,
      salaryMaximum:
        job.salaryMaximum ?? parseSalaryText(job.salaryText).maximum,
      salaryText: job.salaryText,
      description: job.description,
      requirements: job.requirements,
      preferredQualifications: job.preferredQualifications,
      postingUrl,
      applicationUrls: postingUrl === null ? [] : [postingUrl],
      providerId: this.id,
      providerName: this.name,
      datePosted: toIsoDate(job.postedDate),
      discoveredAt,
      seniorityLevel: inferSeniority(
        `${job.seniorityLevel ?? ''} ${job.title ?? ''}`,
      ),
    });
  }

  private resolveBrowserProfileDir(): string {
    return (
      this.browserProfileDir ??
      process.env['JOB_BROWSER_ZIPRECRUITER_PROFILE'] ??
      resolve(process.cwd(), 'ziprecruiter-profile')
    );
  }

  private fetchFixture(search: ProviderSearch): ProviderFetchResult {
    return {
      records: [fixtureJob(search.request)],
      rejected: 0,
      truncated: false,
      complete: true,
    };
  }
}

async function extractZipRecruiterCards(
  page: Page,
): Promise<readonly ZipRecruiterJob[]> {
  const cards = await page.evaluate(() => {
    const seen = new Set<string>();
    const output: ZipRecruiterJob[] = [];
    const detailUrls: string[] = [];
    for (const script of Array.from(document.scripts)) {
      if (script.type !== 'application/ld+json') continue;
      try {
        const parsed = JSON.parse(script.textContent) as unknown;
        if (typeof parsed !== 'object' || parsed === null) continue;
        const itemListElement = (parsed as Record<string, unknown>)[
          'itemListElement'
        ];
        if (!Array.isArray(itemListElement)) continue;
        for (const item of itemListElement) {
          if (typeof item !== 'object' || item === null) continue;
          const url = (item as Record<string, unknown>)['url'];
          if (typeof url === 'string' && url.trim()) detailUrls.push(url);
        }
      } catch {
        // Ignore malformed structured data and use the card URL fallback.
      }
    }
    const articles = Array.from(
      document.querySelectorAll<HTMLElement>('article[id^="job-card-"]'),
    );
    for (const card of articles) {
      const jobId = card.id.slice('job-card-'.length).trim();
      if (!jobId || seen.has(jobId)) continue;
      const titleElement = card.querySelector('h2[aria-label]');
      const title = (
        titleElement?.getAttribute('aria-label') ??
        card.querySelector('h2, h3, h4')?.textContent ??
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();
      if (!title || title.length < 2) continue;
      const fallbackUrl = new URL(location.href);
      fallbackUrl.searchParams.set('lk', jobId);
      const postingUrl = detailUrls[output.length] ?? fallbackUrl.toString();
      const cardText = card.textContent.replace(/\s+/g, ' ').trim();
      const company = card.querySelector('[data-testid="job-card-company"]');
      const locationElement = card.querySelector(
        '[data-testid="job-card-location"]',
      );
      const companyText = company?.textContent ?? '';
      const locationText = locationElement?.textContent ?? '';
      const normalizedCompany = companyText.replace(/\s+/g, ' ').trim();
      const normalizedLocation = locationText.replace(/\s+/g, ' ').trim();
      output.push({
        jobId,
        title,
        company: normalizedCompany === '' ? null : normalizedCompany,
        location: normalizedLocation === '' ? null : normalizedLocation,
        salaryText:
          /\$\s*[\d,.]+(?:\s*[kK])?(?:\s*-\s*\$?\s*[\d,.]+(?:\s*[kK])?)?(?:\s*\/\s*(?:yr|year|hr|hour))?/i.exec(
            cardText,
          )?.[0] ?? null,
        salaryMinimum: null,
        salaryMaximum: null,
        description: null,
        requirements: null,
        preferredQualifications: null,
        postingUrl,
        postedDate:
          /(?:just now|\d+\+?\s+(?:minute|hour|day|week|month)s?\s+ago)/i.exec(
            cardText,
          )?.[0] ?? null,
        employmentType:
          /(?:full[- ]time|part[- ]time|contract|temporary|internship)/i.exec(
            cardText,
          )?.[0] ?? null,
        workplaceType: /remote|hybrid|on[- ]?site/i.exec(cardText)?.[0] ?? null,
        seniorityLevel: null,
      });
      seen.add(jobId);
    }
    return output;
  });
  return cards;
}

async function waitForZipRecruiterResults(page: Page): Promise<void> {
  await page
    .waitForSelector('article[id^="job-card-"]', {
      state: 'attached',
      timeout: 30_000,
    })
    .catch(() => undefined);
}

async function enrichZipRecruiterCard(
  page: Page,
  card: ZipRecruiterJob,
): Promise<ZipRecruiterJob> {
  const posting = await extractJsonLdJobPosting(page);
  if (posting !== null) {
    return mergeJobPosting(card, jobPostingDetails(posting, card.postingUrl));
  }
  const detail = await extractZipRecruiterDetail(page, card.title);
  return {
    ...card,
    title: detail.title ?? card.title,
    company: detail.company ?? card.company,
  };
}

async function extractZipRecruiterDetail(
  page: Page,
  expectedTitle: string | null,
): Promise<Pick<ZipRecruiterJob, 'title' | 'company'>> {
  return page.evaluate((title) => {
    if (!title) return { title: null, company: null };

    const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
    let heading: Element | undefined;
    for (const candidate of headings) {
      const candidateTitle = candidate.textContent.replace(/\s+/g, ' ').trim();
      if (candidateTitle !== title) continue;
      heading ??= candidate;
      if (
        candidate.tagName === 'H3' ||
        candidate.className.includes('text-header-md')
      ) {
        heading = candidate;
        break;
      }
    }
    if (!heading) return { title: null, company: null };

    let parent: HTMLElement | null = heading.parentElement;
    for (let level = 0; parent !== null && level < 5; level += 1) {
      const company =
        parent.querySelector<HTMLAnchorElement>('a[href*="/co/"]');
      const companyName = (
        company?.textContent ??
        company?.getAttribute('aria-label') ??
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();
      if (companyName) return { title, company: companyName };
      parent = parent.parentElement;
    }
    return { title, company: null };
  }, expectedTitle);
}

function buildSearchUrl(
  query: string,
  location: string,
  configuration: ZipRecruiterConfiguration,
): string {
  const url = new URL('https://www.ziprecruiter.com/jobs-search');
  url.searchParams.set('search', query.trim());
  if (location.trim()) url.searchParams.set('location', location.trim());
  if (configuration.remoteFilter)
    url.searchParams.set('remote', configuration.remoteFilter);
  if (configuration.datePosted !== 'any') {
    const days =
      configuration.datePosted === '24h'
        ? '1'
        : configuration.datePosted === 'week'
          ? '7'
          : '30';
    url.searchParams.set('days', days);
  }
  return url.toString();
}

function resolveQueries(
  configuration: ZipRecruiterConfiguration,
  request: SearchRequest,
): { keywords: string; location: string }[] {
  if (configuration.queries.length > 0) return configuration.queries;
  return [
    {
      keywords:
        configuration.searchKeywords ||
        request.query ||
        'systems administrator',
      location: configuredLocation(configuration.location, request.location),
    },
  ];
}

function effectiveConfiguration(
  configuration: ZipRecruiterConfiguration,
  raw: ProviderConfiguration,
  request: SearchRequest,
): ZipRecruiterConfiguration {
  if (
    configuration.queries.length === 0 &&
    typeof raw['searchKeywords'] !== 'string' &&
    request.query.trim()
  ) {
    return {
      ...configuration,
      searchKeywords: request.query.trim(),
      location: configuredLocation(configuration.location, request.location),
    };
  }
  return configuration;
}

function matchesRequest(job: ZipRecruiterJob, request: SearchRequest): boolean {
  const text = [
    job.title,
    job.company,
    job.location,
    job.workplaceType,
    job.description,
  ]
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLowerCase();
  const query = request.query.trim().toLowerCase();
  const location = request.location?.trim().toLowerCase() ?? '';
  return (
    (query === '' || text.includes(query)) &&
    (location === '' || text.includes(location)) &&
    (!request.remoteOnly ||
      inferRemoteType(`${text} ${job.workplaceType ?? ''}`) === 'remote')
  );
}

function configuredLocation(
  configured: string,
  requested: string | null,
): string {
  return configured.trim() ? configured : (requested ?? '');
}

function fixtureJob(request: SearchRequest): ZipRecruiterJob {
  return {
    jobId: 'ziprecruiter-fixture-1',
    title: request.query || 'Software Engineer',
    company: 'Example Employer',
    location: request.location,
    salaryText: '$120,000 - $160,000',
    salaryMinimum: 120_000,
    salaryMaximum: 160_000,
    description: 'Example ZipRecruiter job description.',
    requirements: null,
    preferredQualifications: null,
    postingUrl: 'https://www.ziprecruiter.com/jobs/ziprecruiter-fixture-1',
    postedDate: new Date(Date.now() - 172_800_000).toISOString(),
    employmentType: 'full-time',
    workplaceType: 'remote',
    seniorityLevel: null,
  };
}

export default new ZipRecruiterProvider();
