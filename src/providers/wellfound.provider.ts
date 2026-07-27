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
  new URL('../fixtures/wellfound-search-response.json', import.meta.url),
);

const querySchema = z.strictObject({
  keywords: z.string().trim().min(1),
  location: z.string().optional().default(''),
});

const configurationSchema = z.strictObject({
  searchKeywords: z.string().trim().min(1).default('software engineer'),
  location: z.string().optional().default(''),
  queries: z.array(querySchema).optional().default([]),
  remoteFilter: z
    .enum(['remote', 'hybrid', 'onsite', ''])
    .optional()
    .default(''),
  datePosted: z.enum(['24h', 'week', 'month', 'any']).optional().default('any'),
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

type WellfoundConfiguration = z.infer<typeof configurationSchema>;
type WellfoundJob = z.infer<typeof rawJobSchema>;

export class WellfoundProvider extends BaseProvider {
  public readonly id = 'wellfound';
  public readonly name = 'Wellfound';
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
        ? 'Wellfound configuration is valid. A visible browser session is used for discovery.'
        : `Wellfound configuration error: ${parsed.error.message}`,
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
    const maxResults = Math.min(
      configuration.maxResults,
      Math.max(1, search.request.limit),
    );
    const records = await runBrowserSearch<WellfoundJob>({
      providerName: this.name,
      profileDir: resolve(
        process.cwd(),
        configuration.browserProfileDir ?? this.resolveBrowserProfileDir(),
      ),
      keepBrowserOpen: configuration.keepBrowserOpen,
      maxResults,
      queries: queries.map((query) => query.keywords),
      buildSearchUrl: (query) => {
        const matchingQuery = queries.find((item) => item.keywords === query);
        return buildSearchUrl(
          query,
          matchingQuery?.location ?? configuration.location,
          configuration,
        );
      },
      extractCards: extractWellfoundCards,
      enrichCard: enrichWellfoundCard,
      signal: search.signal,
      isCancelled: () => this.cancelRequested,
    });
    return {
      records: records.filter((record) =>
        matchesRequest(record, search.request),
      ),
      rejected: 0,
      truncated: records.length >= maxResults,
      complete: records.length < maxResults,
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
      process.env['JOB_BROWSER_WELLFOUND_PROFILE'] ??
      resolve(process.cwd(), 'wellfound-profile')
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

async function extractWellfoundCards(
  page: Page,
): Promise<readonly WellfoundJob[]> {
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
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        'a[href*="/jobs/"], a[href*="/job/"]',
      ),
    ).filter((link) => !/\/jobs\/(?:list|search)/.test(link.pathname));
    const seen = new Set<string>();
    const output: WellfoundJob[] = [];
    for (const link of links) {
      const card =
        link.closest(
          'article, li, [data-test*="job"], [data-testid*="job"], [class*="job-card"]',
        ) ?? link;
      const postingUrl = link.href;
      if (seen.has(postingUrl)) continue;
      const title =
        firstText(card, [
          '[data-test*="title"]',
          '[data-testid*="title"]',
          'h1',
          'h2',
          'h3',
          'h4',
        ]) ?? clean(link.textContent);
      if (!title || title.length < 2) continue;
      seen.add(postingUrl);
      const cardText = clean(card.textContent) ?? '';
      output.push({
        jobId: postingUrl.split(/[/?#]/).filter(Boolean).at(-1) ?? null,
        title,
        company: firstText(card, [
          '[data-test*="company"]',
          '[data-testid*="company"]',
          '[class*="company"]',
        ]),
        location: firstText(card, [
          '[data-test*="location"]',
          '[data-testid*="location"]',
          '[class*="location"]',
        ]),
        salaryText: firstText(card, [
          '[data-test*="salary"]',
          '[data-testid*="salary"]',
          '[class*="salary"]',
        ]),
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
        employmentType: null,
        workplaceType: /remote|hybrid|on[- ]?site/i.exec(cardText)?.[0] ?? null,
        seniorityLevel: null,
      });
    }
    return output;
  });
  return cards;
}

async function enrichWellfoundCard(
  page: Page,
  card: WellfoundJob,
): Promise<WellfoundJob> {
  const posting = await extractJsonLdJobPosting(page);
  if (posting !== null) {
    return mergeJobPosting(card, jobPostingDetails(posting, card.postingUrl));
  }
  const basic = await extractBasicDetail(page, {
    title: ['h1', '[data-test*="title"]', '[data-testid*="title"]'],
    company: [
      '[data-test*="company"]',
      '[data-testid*="company"]',
      '[class*="company"]',
    ],
    location: [
      '[data-test*="location"]',
      '[data-testid*="location"]',
      '[class*="location"]',
    ],
    salary: [
      '[data-test*="salary"]',
      '[data-testid*="salary"]',
      '[class*="salary"]',
    ],
    description: [
      '[data-test*="description"]',
      '[data-testid*="description"]',
      'main',
    ],
  });
  const salary = parseSalaryText(basic.salaryText ?? card.salaryText);
  return {
    ...card,
    title: basic.title ?? card.title,
    company: basic.company ?? card.company,
    location: basic.location ?? card.location,
    salaryText: basic.salaryText ?? card.salaryText,
    salaryMinimum: salary.minimum ?? card.salaryMinimum,
    salaryMaximum: salary.maximum ?? card.salaryMaximum,
    description: basic.description ?? card.description,
  };
}

function buildSearchUrl(
  query: string,
  location: string,
  configuration: WellfoundConfiguration,
): string {
  const url = new URL('https://wellfound.com/jobs/list');
  url.searchParams.set('query', query.trim());
  if (location.trim()) url.searchParams.set('location', location.trim());
  if (configuration.remoteFilter)
    url.searchParams.set('remote', configuration.remoteFilter);
  if (configuration.datePosted !== 'any')
    url.searchParams.set('datePosted', configuration.datePosted);
  return url.toString();
}

function resolveQueries(
  configuration: WellfoundConfiguration,
  request: SearchRequest,
): { keywords: string; location: string }[] {
  if (configuration.queries.length > 0) return configuration.queries;
  return [
    {
      keywords:
        configuration.searchKeywords || request.query || 'software engineer',
      location: configuredLocation(configuration.location, request.location),
    },
  ];
}

function effectiveConfiguration(
  configuration: WellfoundConfiguration,
  raw: ProviderConfiguration,
  request: SearchRequest,
): WellfoundConfiguration {
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

function matchesRequest(job: WellfoundJob, request: SearchRequest): boolean {
  const text = [job.title, job.company, job.location, job.description]
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

function fixtureJob(request: SearchRequest): WellfoundJob {
  return {
    jobId: 'wellfound-fixture-1',
    title: request.query || 'Software Engineer',
    company: 'Example Startup',
    location: request.location,
    salaryText: '$130,000 - $170,000',
    salaryMinimum: 130_000,
    salaryMaximum: 170_000,
    description: 'Example Wellfound job description.',
    requirements: null,
    preferredQualifications: null,
    postingUrl: 'https://wellfound.com/jobs/123456-example',
    postedDate: new Date(Date.now() - 86_400_000).toISOString(),
    employmentType: 'full-time',
    workplaceType: 'remote',
    seniorityLevel: null,
  };
}

export default new WellfoundProvider();
