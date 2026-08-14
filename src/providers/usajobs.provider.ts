import { fileURLToPath } from 'node:url';

import { z } from 'zod';
import type { Page } from 'playwright';

import type {
  DiscoveryOptions,
  ProviderFetchResult,
  ProviderSearch,
  SearchRequest,
  QueryDiagnostics,
} from '../models/discovery.js';
import type {
  ProviderCapabilities,
  ProviderConfiguration,
  ProviderType,
  ValidationResult,
} from '../models/source-management.js';
import { normalizeJob } from '../normalizer/jobNormalizer.js';
import type { NormalizedJob } from '../schemas/normalized-job.js';
import { nowUtc } from '../utilities/timestamps.js';
import { log } from '../logging/logger.js';
import { BaseProvider } from './baseProvider.js';
import {
  launchBrowserSession,
  closeBrowserSession,
  navigateWithRetry,
} from './linkedIn/browserSession.js';
import { ensureUsaJobsLogin } from './usajobs/browserSession.js';
import { extractSearchPage } from './usajobs/searchResultExtractor.js';
import { extractJobDetail } from './usajobs/jobDetailExtractor.js';
import { parseSalaryText, toIsoDate } from './browserJobBoard.js';

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/usajobs-browser-fixture.json', import.meta.url),
);

const MAX_PAGES_PER_QUERY = 25;
const MAX_DETAILS = 60;
const MAX_UNIQUE_RESULTS = 200;

const usajobsQuerySchema = z.strictObject({
  keywords: z.string().trim().min(1, 'Keywords are required'),
  location: z.string().optional().default(''),
});

const configurationSchema = z.strictObject({
  searchKeywords: z.string().trim().min(1).default('systems administrator'),
  location: z.string().optional().default(''),
  queries: z
    .array(usajobsQuerySchema)
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
  datePosted: z.enum(['24h', 'week', 'month', 'any']).optional().default('any'),
  maxResults: z.number().int().min(1).max(100).optional().default(50),
  browserProfileDir: z.string().optional(),
  keepBrowserOpen: z.boolean().optional().default(false),
  debugMode: z.boolean().optional().default(false),
});

type UsaJobsConfiguration = z.infer<typeof configurationSchema>;

interface ResolvedQuery {
  keywords: string;
  location: string;
}

interface UsaJobsRawJob {
  jobId: string;
  title: string;
  agency: string;
  department: string;
  location: string;
  dateText: string;
  salaryText: string | null;
  workSchedule: string | null;
  appointmentType: string | null;
  postingUrl: string;
  description: string | null;
  detailPairs: { label: string; value: string }[];
  detailText: string;
  applyUrls: string[];
}

export class UsaJobsProvider extends BaseProvider {
  public readonly id = 'usajobs';
  public readonly name = 'USAJOBS';
  public readonly type: ProviderType = 'government';
  public readonly capabilities: ProviderCapabilities = {
    keywordSearch: true,
    locationSearch: true,
    remoteFilter: true,
    pagination: true,
    compensation: true,
    requiresCredentials: false,
    structuredPreview: false,
    interactiveBrowser: true,
  };

  private browserProfileDir: string | null = null;
  private cancelRequested = false;

  public setBrowserProfileDir(dir: string): void {
    this.browserProfileDir = dir;
  }

  private resolveBrowserProfileDir(): string {
    return (
      this.browserProfileDir ??
      process.env['JOB_BROWSER_USAJOBS_PROFILE'] ??
      resolveProfileDefault()
    );
  }

  private resolveQueries(config: UsaJobsConfiguration): ResolvedQuery[] {
    if (config.queries.length > 0) {
      return config.queries.map((q) => ({
        keywords: q.keywords,
        location: q.location || config.location,
      }));
    }
    return [
      {
        keywords: config.searchKeywords,
        location: config.location || '',
      },
    ];
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
        ? 'USAJOBS configuration is valid'
        : `USAJOBS configuration error: ${parsed.error.message}`,
      normalizedConfiguration: parsed.success
        ? (parsed.data as unknown as Record<string, unknown>)
        : null,
      preview: null,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async search(
    request: SearchRequest,
    options: DiscoveryOptions,
  ): Promise<ProviderSearch> {
    const rawConfiguration = options.configuration ?? {};
    const config = this.parseConfig(rawConfiguration);
    const firstQuery = config.queries[0] ?? {
      keywords:
        typeof rawConfiguration['searchKeywords'] === 'string'
          ? rawConfiguration['searchKeywords']
          : request.query.trim(),
      location:
        typeof rawConfiguration['location'] === 'string'
          ? rawConfiguration['location']
          : (request.location ?? ''),
    };

    return {
      request,
      target: this.buildSearchUrl(firstQuery.keywords, firstQuery.location),
      fixturePath: options.fixtureOnly
        ? (options.fixturePath ?? DEFAULT_FIXTURE_PATH)
        : null,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      configuration: config as unknown as Record<string, unknown>,
    };
  }

  public async fetch(search: ProviderSearch): Promise<ProviderFetchResult> {
    this.cancelRequested = false;
    if (search.fixturePath !== null) return this.fetchFixture();

    const config = search.configuration as unknown as UsaJobsConfiguration;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!config) throw new Error('USAJOBS configuration is missing');

    const profileDir = this.resolveBrowserProfileDir();
    const maxResultsPerQuery = config.maxResults;
    const keepBrowserOpen = config.keepBrowserOpen;

    const signal = search.signal;
    const checkCancelled = (): void => {
      if (this.cancelRequested || signal?.aborted)
        throw new Error('USAJOBS search cancelled');
    };

    checkCancelled();

    try {
      const { page } = await launchBrowserSession({
        profileDir,
        headless: false,
      });
      checkCancelled();

      const loggedIn = await ensureUsaJobsLogin(page, 300_000);
      if (!loggedIn) {
        log(
          'warn',
          'USAJOBS login not completed; continuing with public search results',
        );
      }

      checkCancelled();

      const queries = this.resolveQueries(config);
      const remoteOnly =
        config.remoteFilter === 'remote' || search.request.remoteOnly;
      const allUnique: UsaJobsRawJob[] = [];
      const seen = new Set<string>();
      const diagnostics: QueryDiagnostics[] = [];
      let completedQueries = 0;
      let failedQueries = 0;
      let truncatedQueries = 0;

      for (const q of queries) {
        checkCancelled();

        const queryStarted = nowUtc();
        const queryStartMs = Date.now();
        let terminationReason: QueryDiagnostics['terminationReason'] =
          'exhausted_results';
        const queryErrors: string[] = [];
        const queryCards: UsaJobsRawJob[] = [];
        let dedupedCount = 0;

        const url = this.buildSearchUrl(q.keywords, q.location);

        log('info', `USAJOBS: searching for "${q.keywords}"`);
        try {
          await navigateWithRetry(page, url, { retries: 3 });
          await page.waitForTimeout(5000);

          const cards = await this.collectCards(
            page,
            maxResultsPerQuery,
            remoteOnly,
            checkCancelled,
          );
          for (const card of cards) {
            const key = card.jobId || card.postingUrl;
            if (key && !seen.has(key)) {
              seen.add(key);
              queryCards.push(card);
            } else if (key && seen.has(key)) {
              dedupedCount++;
            }
          }

          if (queryCards.length >= maxResultsPerQuery) {
            terminationReason = 'per_query_limit';
            truncatedQueries++;
          }

          for (const card of queryCards) {
            allUnique.push(card);
          }

          if (allUnique.length >= MAX_UNIQUE_RESULTS) {
            terminationReason = 'global_unique_limit';
          }

          completedQueries++;
        } catch (error) {
          failedQueries++;
          terminationReason =
            error instanceof Error && error.message.includes('cancelled')
              ? 'cancelled'
              : 'provider_error';
          const message =
            error instanceof Error ? error.message : String(error);
          queryErrors.push(message);
          log('warn', `USAJOBS: query "${q.keywords}" failed: ${message}`);
        }

        log(
          'info',
          `USAJOBS: found ${String(queryCards.length)} unique jobs for "${q.keywords}"`,
        );

        diagnostics.push({
          provider: this.name,
          searchTerm: q.keywords,
          location: q.location,
          requestStarted: queryStarted,
          requestCompleted: nowUtc(),
          rawResultsReturned:
            queryCards.length + dedupedCount + queryCards.length,
          uniqueResultsRetained: queryCards.length,
          duplicatesRemoved: dedupedCount,
          errors: queryErrors,
          durationMs: Date.now() - queryStartMs,
          terminationReason,
        });

        if (allUnique.length >= MAX_UNIQUE_RESULTS) break;
      }

      checkCancelled();

      const enriched = await this.enrichWithDetails(
        page,
        allUnique,
        checkCancelled,
      );

      if (!keepBrowserOpen) {
        await closeBrowserSession().catch(() => undefined);
      }

      const records = enriched.map((job) => ({
        ...job,
        providerId: this.id,
        providerName: this.name,
        searchQuery: search.request,
        discoveredAt: new Date().toISOString(),
        source: 'USAJOBS',
      }));

      return {
        records,
        rejected: 0,
        truncated: truncatedQueries > 0,
        complete: failedQueries === 0 && completedQueries === queries.length,
        queryDiagnostics: diagnostics,
        plannedQueries: queries.length,
        completedQueries,
        failedQueries,
        truncatedQueries,
      };
    } catch (error) {
      await closeBrowserSession().catch(() => undefined);
      if (
        error instanceof Error &&
        error.message === 'USAJOBS search cancelled'
      ) {
        return { records: [], rejected: 0, truncated: false, complete: false };
      }
      throw error;
    }
  }

  public normalize(rawJob: unknown, discoveredAt: string): NormalizedJob {
    const job = rawJob as Record<string, unknown>;
    const title = typeof job['title'] === 'string' ? job['title'] : '';
    const agency = typeof job['agency'] === 'string' ? job['agency'] : '';
    const department =
      typeof job['department'] === 'string' ? job['department'] : null;
    const location =
      typeof job['location'] === 'string' ? job['location'] : null;
    const externalId = typeof job['jobId'] === 'string' ? job['jobId'] : null;
    const postingUrl =
      typeof job['postingUrl'] === 'string' ? job['postingUrl'] : null;
    const salaryText =
      typeof job['salaryText'] === 'string' ? job['salaryText'] : null;
    const workSchedule =
      typeof job['workSchedule'] === 'string' ? job['workSchedule'] : null;
    const appointmentType =
      typeof job['appointmentType'] === 'string'
        ? job['appointmentType']
        : null;
    const description =
      typeof job['description'] === 'string' ? job['description'] : null;
    const dateText = typeof job['dateText'] === 'string' ? job['dateText'] : '';
    const detailPairs = Array.isArray(job['detailPairs'])
      ? (job['detailPairs'] as { label: string; value: string }[])
      : [];
    const detailText =
      typeof job['detailText'] === 'string' ? job['detailText'] : '';
    const applyUrls = Array.isArray(job['applyUrls'])
      ? (job['applyUrls'] as string[])
      : [];

    const salary = parseSalaryText(salaryText);
    const remoteJob = pairValue(detailPairs, 'Remote job');
    const teleworkEligible = pairValue(detailPairs, 'Telework eligible');
    const grade = parseGrade(pairValue(detailPairs, 'Pay scale & grade'));
    const city = location?.includes(',')
      ? (location.split(',')[0]?.trim() ?? null)
      : null;
    const state = location?.includes(',')
      ? (location.split(',')[1]?.trim() ?? null)
      : null;
    const openingDate =
      parseDatePart(dateText, 'Posted') ?? parseDatePart(dateText, 'Open');
    const closingDate =
      parseDatePart(dateText, 'Apply by') ??
      parseDatePart(dateText, 'to') ??
      pairValue(detailPairs, 'Close date') ??
      parseDatePart(detailText, 'Apply by');

    return normalizeJob({
      externalId,
      title: title || 'Untitled Position',
      company: agency || 'Unknown Agency',
      location,
      city,
      state,
      remoteType: inferRemoteType(remoteJob, teleworkEligible),
      employmentType: inferEmploymentType(workSchedule, appointmentType),
      salaryMinimum: salary.minimum,
      salaryMaximum: salary.maximum,
      salaryText,
      description,
      requirements: detailText.length > 0 ? detailText : null,
      preferredQualifications: null,
      postingUrl,
      providerId: this.id,
      providerName: this.name,
      datePosted: openingDate,
      discoveredAt,
      agency: agency || null,
      department,
      gradeLow: grade.low,
      gradeHigh: grade.high,
      payPlan: grade.payPlan,
      appointmentType,
      workSchedule,
      teleworkEligible: parseYesNo(teleworkEligible),
      openingDate,
      closingDate,
      closingDatePrecision: closingDate === null ? null : 'date',
      applicationUrls: applyUrls,
    });
  }

  private async collectCards(
    page: Page,
    maxResults: number,
    remoteOnly: boolean,
    checkCancelled: () => void,
  ): Promise<UsaJobsRawJob[]> {
    try {
      await page.waitForSelector(
        '#search-results .page-section, #no-search-results',
        {
          timeout: 20_000,
        },
      );
    } catch {
      return [];
    }

    const jobs: UsaJobsRawJob[] = [];
    const seenIds = new Set<string>();
    let pageNumber = 1;

    while (jobs.length < maxResults && pageNumber <= MAX_PAGES_PER_QUERY) {
      checkCancelled();

      const data = await extractSearchPage(page);

      if (data.noResults && jobs.length === 0) break;

      for (const card of data.cards) {
        if (remoteOnly && !/remote/i.test(card.location)) continue;
        const id = card.id;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          jobs.push({
            jobId: id,
            title: card.title,
            agency: card.agency,
            department: card.department,
            location: card.location,
            dateText: card.dateText,
            salaryText: card.salaryText,
            workSchedule: card.workSchedule,
            appointmentType: card.appointmentType,
            postingUrl: absolutePostingUrl(card.href),
            description: null,
            detailPairs: [],
            detailText: '',
            applyUrls: [],
          });
        }
      }

      if (jobs.length >= maxResults || !data.hasNext) break;

      const firstHref = data.cards[0]?.href ?? '';
      const clicked = await clickNextPage(page).catch(() => false);
      if (!clicked) break;

      const swapped = await waitForPageSwap(page, firstHref, 15_000).catch(
        () => false,
      );
      if (!swapped) break;

      pageNumber++;
    }

    return jobs;
  }

  private async enrichWithDetails(
    page: Page,
    jobs: UsaJobsRawJob[],
    checkCancelled: () => void,
  ): Promise<UsaJobsRawJob[]> {
    const toEnrich = jobs.slice(0, MAX_DETAILS);
    for (const job of toEnrich) {
      checkCancelled();

      if (!job.postingUrl) continue;

      try {
        await page.goto(job.postingUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        await page.waitForTimeout(2500);

        const detail = await extractJobDetail(page);
        job.description = summaryFromText(detail.text) ?? job.description;
        job.detailPairs = detail.pairs;
        job.detailText = detail.text;
        job.applyUrls = detail.applyLinks;

        await page
          .goBack({ waitUntil: 'domcontentloaded' })
          .catch(() => undefined);
        await page.waitForTimeout(1500);
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));
      } catch {
        // skip detail loading failures
      }
    }
    return jobs;
  }

  private buildSearchUrl(keywords: string, location: string): string {
    const url = new URL('https://www.usajobs.gov/Search/Results');
    url.searchParams.set('k', keywords);
    if (location.trim()) url.searchParams.set('l', location.trim());
    url.searchParams.set('p', '1');
    return url.toString();
  }

  private parseConfig(
    configuration: Record<string, unknown>,
  ): UsaJobsConfiguration {
    return configurationSchema.parse(configuration);
  }

  private fetchFixture(): ProviderFetchResult {
    const now = new Date();
    return {
      records: [
        {
          jobId: '815000001',
          title: 'Network Administrator',
          agency: 'Veterans Health Administration',
          department: 'Department of Veterans Affairs',
          location: 'Amarillo, TX',
          dateText: `Posted ${monthDay(now)} · Apply by ${monthDay(addDays(now, 14))}`,
          salaryText: '$82,764 - $107,590 Per Year',
          workSchedule: 'Full-time',
          appointmentType: 'Permanent',
          postingUrl: 'https://www.usajobs.gov/job/815000001',
          description:
            'Provides network administration for the Amarillo VA Health Care System.',
          detailPairs: [
            { label: 'Salary', value: '$82,764 - $107,590 Per Year' },
            { label: 'Pay scale & grade', value: 'GS 11' },
            { label: 'Remote job', value: 'No' },
            { label: 'Telework eligible', value: 'Yes' },
            { label: 'Work schedule', value: 'Full-time' },
            { label: 'Appointment type', value: 'Permanent' },
          ],
          detailText: [
            'Network Administrator',
            'Department of Veterans Affairs',
            'Veterans Health Administration',
            'Summary',
            'Provides network administration for the Amarillo VA Health Care System.',
          ].join('\n'),
          applyUrls: ['https://www.usajobs.gov/apply/815000001'],
        },
        {
          jobId: '815000002',
          title: 'IT Specialist (SysAdmin)',
          agency: 'U.S. Cyber Command',
          department: 'Department of Defense',
          location: 'Remote',
          dateText: 'Posted this month',
          salaryText: '$117,962 - $181,216 Per Year',
          workSchedule: 'Full-time',
          appointmentType: 'Permanent',
          postingUrl: 'https://www.usajobs.gov/job/815000002',
          description: 'System administration for cyber mission teams.',
          detailPairs: [
            { label: 'Salary', value: '$117,962 - $181,216 Per Year' },
            { label: 'Pay scale & grade', value: 'GS 13-14' },
            { label: 'Remote job', value: 'Yes' },
            { label: 'Telework eligible', value: 'No' },
            { label: 'Work schedule', value: 'Full-time' },
            { label: 'Appointment type', value: 'Permanent' },
          ],
          detailText: [
            'IT Specialist (SysAdmin)',
            'Department of Defense',
            'U.S. Cyber Command',
            'Summary',
            'System administration for cyber mission teams.',
          ].join('\n'),
          applyUrls: ['https://www.usajobs.gov/apply/815000002'],
        },
      ],
      rejected: 0,
      truncated: false,
      complete: true,
      queryDiagnostics: [],
      plannedQueries: 1,
      completedQueries: 1,
      failedQueries: 0,
      truncatedQueries: 0,
    };
  }
}

function resolveProfileDefault(): string {
  return 'usajobs-profile';
}

function absolutePostingUrl(href: string): string {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  return `https://www.usajobs.gov${href}`;
}

async function clickNextPage(page: Page): Promise<boolean> {
  try {
    await page.click('#page-m-next', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function waitForPageSwap(
  page: Page,
  previousFirstHref: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await page.waitForFunction(
      (prev: string) => {
        const link = document.querySelector(
          '#search-results h2 a[href*="/job/"]',
        );
        if (!link) return false;
        return (link.getAttribute('href') ?? '') !== prev;
      },
      previousFirstHref,
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}

function pairValue(
  pairs: { label: string; value: string }[],
  labelPrefix: string,
): string | null {
  const lower = labelPrefix.toLowerCase();
  const match = pairs.find((pair) =>
    pair.label.toLowerCase().startsWith(lower),
  );
  return match ? clean(match.value) : null;
}

function parseGrade(value: string | null): {
  payPlan: string | null;
  low: string | null;
  high: string | null;
} {
  if (!value) return { payPlan: null, low: null, high: null };
  const match = /^([A-Za-z]+)\s*(\d+)\s*(?:[-–]\s*(\d+))?/.exec(value);
  if (!match) return { payPlan: null, low: null, high: null };
  return {
    payPlan: match[1]?.toUpperCase() ?? null,
    low: match[2] ?? null,
    high: match[3] ?? match[2] ?? null,
  };
}

function parseDatePart(
  text: string | null,
  label: 'Posted' | 'Apply by' | 'Open' | 'to',
): string | null {
  if (!text) return null;
  const relative = toIsoDate(text);
  const re = new RegExp(`${label}\\s+(\\d{1,2}/\\d{1,2}/\\d{2,4})`, 'i');
  const match = text.match(re);
  if (!match?.[1]) return relative;
  const [month, day, year] = match[1].split('/');
  const yy = Number(year);
  const fullYear = yy < 100 ? 2000 + yy : yy;
  const date = new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? relative : date.toISOString();
}

function inferRemoteType(
  remoteJob: string | null,
  telework: string | null,
): NormalizedJob['remoteType'] {
  if (remoteJob !== null && /^yes/i.test(remoteJob)) return 'remote';
  if (telework !== null && /^yes/i.test(telework)) return 'hybrid';
  if (remoteJob !== null || telework !== null) return 'onsite';
  return 'unknown';
}

function inferEmploymentType(
  schedule: string | null,
  appointmentType: string | null,
): NormalizedJob['employmentType'] {
  const value = `${schedule ?? ''} ${appointmentType ?? ''}`.toLowerCase();
  if (value.includes('part time') || value.includes('part-time'))
    return 'part-time';
  if (value.includes('intern')) return 'internship';
  if (value.includes('temporary')) return 'temporary';
  if (value.includes('contract')) return 'contract';
  if (value.includes('full time') || value.includes('full-time'))
    return 'full-time';
  return 'unknown';
}

function parseYesNo(value: string | null): boolean | null {
  if (value === null) return null;
  if (/^yes/i.test(value)) return true;
  if (/^no/i.test(value)) return false;
  return null;
}

function summaryFromText(text: string): string | null {
  if (!text) return null;
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const index = lines.findIndex((line) => line.toLowerCase() === 'summary');
  if (index === -1) return null;
  const after = lines
    .slice(index + 1)
    .find((line) => !/^[A-Z]/.test(line) && line.length > 0);
  return after ?? null;
}

function clean(value: string): string | null {
  const cleaned = value.trim();
  return cleaned.length === 0 ? null : cleaned;
}

function monthDay(date: Date): string {
  return `${String(date.getMonth() + 1)}/${String(date.getDate())}/${String(date.getFullYear())}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export { UsaJobsProvider as USAJobsProvider };
export default new UsaJobsProvider();
