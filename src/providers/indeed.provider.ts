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
  extractBasicDetail,
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
  new URL('../fixtures/indeed-search-response.json', import.meta.url),
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

type IndeedConfiguration = z.infer<typeof configurationSchema>;
type IndeedJob = z.infer<typeof rawJobSchema>;

export class IndeedProvider extends BaseProvider {
  public readonly id = 'indeed';
  public readonly name = 'Indeed';
  public readonly type: ProviderType = 'job-board';
  public readonly capabilities = {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: true,
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
        ? 'Indeed configuration is valid. A visible browser session is used for discovery.'
        : `Indeed configuration error: ${parsed.error.message}`,
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
    const result = await runBrowserSearch<IndeedJob>({
      providerName: this.name,
      profileDir: resolve(
        process.cwd(),
        configuration.browserProfileDir ?? this.resolveBrowserProfileDir(),
      ),
      keepBrowserOpen: configuration.keepBrowserOpen,
      goBackAfterEnrich: true,
      maxResultsPerQuery,
      queries: queries.map((q) => q.keywords),
      queryLocations: queries.map((q) => q.location),
      buildSearchUrl: (query, location) => {
        const matchingQuery = queries.find((q) => q.keywords === query);
        return buildSearchUrl(
          query,
          location ?? matchingQuery?.location ?? configuration.location,
          configuration,
        );
      },
      extractCards: extractIndeedCards,
      enrichCard: enrichIndeedCard,
      signal: search.signal,
      isCancelled: () => this.cancelRequested,
    });
    return {
      records: result.records,
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
      process.env['JOB_BROWSER_INDEED_PROFILE'] ??
      resolve(process.cwd(), 'indeed-profile')
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

async function extractIndeedCards(page: Page): Promise<readonly IndeedJob[]> {
  const cards = await page.evaluate(() => {
    const clean = (value: string | null | undefined): string | null => {
      const text = value?.replace(/\s+/g, ' ').trim() ?? '';
      return text || null;
    };
    const firstText = (
      root: Element,
      selectors: readonly string[],
    ): string | null => {
      for (const selector of selectors) {
        const element = root.querySelector(selector);
        const text = clean(element?.textContent);
        if (text) return text;
      }
      return null;
    };

    const links = document.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/viewjob"], a[href*="jk="], a[id*="job"], a[class*="jobTitle"], a[class*="title"]',
    );
    const seen = new Set<string>();
    const output: IndeedJob[] = [];
    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href?.includes('jk=')) continue;
      const jobKey = new URL(
        href.startsWith('http')
          ? href
          : `https://www.indeed.com${href.startsWith('/') ? '' : '/'}${href}`,
      ).searchParams.get('jk');
      if (!jobKey) continue;
      const postingUrl = `https://www.indeed.com/viewjob?jk=${jobKey}`;
      if (seen.has(postingUrl)) continue;
      seen.add(postingUrl);
      const card = link.closest('li, div[class*="job"], article') ?? link;
      const title = link.textContent.trim() || null;
      if (title === null || title.length < 2) continue;
      const cardText = clean(card.textContent) ?? '';
      output.push({
        jobId: jobKey,
        title,
        company: firstText(card, [
          '[data-testid*="company"]',
          '[class*="company"]',
          '[class*="employer"]',
          'span[class*="name"]',
        ]),
        location: firstText(card, [
          '[data-testid*="location"]',
          '[class*="location"]',
          '[class*="loc"]',
        ]),
        salaryText: firstText(card, [
          '[data-testid*="salary"]',
          '[class*="salary"]',
          '[class*="wage"]',
        ]),
        salaryMinimum: null,
        salaryMaximum: null,
        description: null,
        requirements: null,
        preferredQualifications: null,
        postingUrl,
        postedDate:
          /(\d+\+?\s+(minute|hour|day|week|month)s?\s+ago|just now|today|30\+)/i.exec(
            cardText,
          )?.[0] ?? null,
        employmentType: null,
        workplaceType: null,
        seniorityLevel: null,
      });
    }
    return output;
  });
  return cards;
}

async function enrichIndeedCard(
  page: Page,
  card: IndeedJob,
): Promise<IndeedJob> {
  const posting = await extractJsonLdJobPosting(page);
  if (posting !== null) {
    return mergeJobPosting(card, jobPostingDetails(posting, card.postingUrl));
  }
  const basic = await extractBasicDetail(page, {
    title: [
      'h1[class*="title"]',
      '[data-testid*="title"]',
      '[class*="jobTitle"]',
      'h1',
    ],
    company: [
      '[data-testid*="company"]',
      '[class*="company"]',
      '[class*="employer"]',
    ],
    location: [
      '[data-testid*="location"]',
      '[class*="location"]',
      '[class*="loc"]',
    ],
    salary: ['[data-testid*="salary"]', '[class*="salary"]', '[id*="salary"]'],
    description: [
      '[id*="description"]',
      '[class*="description"]',
      '[class*="jobBody"]',
      'main',
    ],
  });
  const salary = parseSalaryText(basic.salaryText ?? card.salaryText);
  let remote: string | null = null;
  if (card.location) {
    const locLower = card.location.toLowerCase();
    if (locLower.includes('remote')) remote = 'remote';
    else if (locLower.includes('hybrid')) remote = 'hybrid';
  }
  return {
    ...card,
    title: basic.title ?? card.title,
    company: basic.company ?? card.company,
    location: basic.location ?? card.location,
    salaryText: basic.salaryText ?? card.salaryText,
    salaryMinimum: salary.minimum ?? card.salaryMinimum,
    salaryMaximum: salary.maximum ?? card.salaryMaximum,
    description: basic.description ?? card.description,
    workplaceType: remote,
  };
}

function buildSearchUrl(
  query: string,
  location: string,
  configuration: IndeedConfiguration,
): string {
  const url = new URL('https://www.indeed.com/jobs');
  url.searchParams.set('q', query.trim());
  if (location.trim()) url.searchParams.set('l', location.trim());
  url.searchParams.set('sort', 'date');
  if (configuration.remoteFilter === 'remote') {
    url.searchParams.set('sc', '0kf%3Aattr(DSQF7)%3B');
  } else if (configuration.remoteFilter === 'hybrid') {
    url.searchParams.set('sc', '0kf%3Aattr(DSQF7)%3Battr(DSQF7H)%3B');
  }
  if (configuration.datePosted === '24h') {
    url.searchParams.set('fromage', '1');
  } else if (configuration.datePosted === 'week') {
    url.searchParams.set('fromage', '7');
  } else if (configuration.datePosted === 'month') {
    url.searchParams.set('fromage', '14');
  }
  return url.toString();
}

function resolveQueries(
  configuration: IndeedConfiguration,
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
  configuration: IndeedConfiguration,
  raw: ProviderConfiguration,
  request: SearchRequest,
): IndeedConfiguration {
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

function configuredLocation(
  configured: string,
  requested: string | null,
): string {
  return configured.trim() ? configured : (requested ?? '');
}

function fixtureJob(request: SearchRequest): IndeedJob {
  return {
    jobId: 'indeed-fixture-1',
    title: request.query || 'Software Engineer',
    company: 'Example Corp',
    location: request.location ?? 'Remote',
    salaryText: '$120,000 - $160,000',
    salaryMinimum: 120_000,
    salaryMaximum: 160_000,
    description: 'Example Indeed job description with cybersecurity focus.',
    requirements: null,
    preferredQualifications: null,
    postingUrl: 'https://www.indeed.com/viewjob?jk=indeed-fixture-1',
    postedDate: new Date(Date.now() - 43_200_000).toISOString(),
    employmentType: 'full-time',
    workplaceType: 'remote',
    seniorityLevel: null,
  };
}

export default new IndeedProvider();
