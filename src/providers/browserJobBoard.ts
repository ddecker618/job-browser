import type { Page } from 'playwright';

import type {
  EmploymentType,
  RemoteType,
  SeniorityLevel,
} from '../domain/job.js';
import { htmlToText } from '../utils/html.js';
import { log } from '../logging/logger.js';
import {
  closeBrowserSession,
  launchBrowserSession,
  navigateWithRetry,
} from './linkedIn/browserSession.js';

export interface BrowserJobRecord {
  jobId: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  salaryText: string | null;
  salaryMinimum: number | null;
  salaryMaximum: number | null;
  description: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
  postingUrl: string | null;
  postedDate: string | null;
  employmentType: string | null;
  workplaceType: string | null;
  seniorityLevel: string | null;
}

export interface BrowserSearchOptions<T extends BrowserJobRecord> {
  providerName: string;
  profileDir: string;
  keepBrowserOpen: boolean;
  maxResults: number;
  queries: readonly string[];
  buildSearchUrl: (query: string) => string;
  waitForResults?: (page: Page) => Promise<void>;
  extractCards: (page: Page) => Promise<readonly T[]>;
  enrichCard: (page: Page, card: T) => Promise<T>;
  signal?: AbortSignal | undefined;
  isCancelled?: () => boolean;
  securityTimeout?: number;
  goBackAfterEnrich?: boolean;
}

export async function runBrowserSearch<T extends BrowserJobRecord>(
  options: BrowserSearchOptions<T>,
): Promise<T[]> {
  const checkCancelled = (): void => {
    if (options.signal?.aborted === true || options.isCancelled?.() === true) {
      throw new Error(`${options.providerName} search cancelled`);
    }
  };

  checkCancelled();
  const { page } = await launchBrowserSession({
    profileDir: options.profileDir,
    headless: false,
  });
  const keepBrowserOpen = options.keepBrowserOpen;

  try {
    const collected: T[] = [];
    const seen = new Set<string>();

    for (const query of options.queries) {
      checkCancelled();
      const url = options.buildSearchUrl(query);
      log('info', `${options.providerName}: searching for "${query}"`);
      await navigateWithRetry(page, url, { retries: 3 });
      await waitForSecurityChallenge(
        page,
        options.providerName,
        options.securityTimeout,
      );
      await options.waitForResults?.(page);
      await page.waitForTimeout(2_000);

      let staleScrolls = 0;
      while (collected.length < options.maxResults && staleScrolls < 3) {
        checkCancelled();
        const cards = await options.extractCards(page);
        const previousCount = collected.length;
        for (const card of cards) {
          const key =
            card.jobId ??
            card.postingUrl ??
            `${card.company ?? ''}-${card.title ?? ''}`;
          if (key && !seen.has(key)) {
            seen.add(key);
            collected.push(card);
            if (collected.length >= options.maxResults) break;
          }
        }

        if (collected.length >= options.maxResults) break;
        await page.evaluate(() =>
          window.scrollBy(0, Math.max(window.innerHeight, 800)),
        );
        await page.waitForTimeout(1_500);
        staleScrolls =
          collected.length === previousCount ? staleScrolls + 1 : 0;
      }

      if (collected.length >= options.maxResults) break;
    }

    const enriched: T[] = [];
    for (const card of collected.slice(0, options.maxResults)) {
      checkCancelled();
      if (card.postingUrl === null) {
        enriched.push(card);
        continue;
      }
      try {
        await navigateWithRetry(page, card.postingUrl, { retries: 2 });
        await waitForSecurityChallenge(
          page,
          options.providerName,
          options.securityTimeout,
        );
        await page.waitForTimeout(1_000);
        enriched.push(await options.enrichCard(page, card));
        if (options.goBackAfterEnrich) {
          await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
          await page.waitForTimeout(1_500);
        }
      } catch (error) {
        log('warn', `${options.providerName}: detail page failed`, {
          url: card.postingUrl,
          error: error instanceof Error ? error.message : String(error),
        });
        enriched.push(card);
      }
    }

    return enriched;
  } finally {
    if (!keepBrowserOpen) await closeBrowserSession().catch(() => undefined);
  }
}

export async function waitForSecurityChallenge(
  page: Page,
  providerName: string,
  timeoutMs = 45_000,
): Promise<void> {
  const startedAt = Date.now();
  let reported = false;
  let bannerInjected = false;
  while (await pageHasSecurityChallenge(page)) {
    if (!reported) {
      log('warn', `${providerName}: waiting for browser security check`);
      reported = true;
    }
    if (!bannerInjected) {
      await page
        .evaluate(() => {
          if (document.getElementById('__jbs_banner')) return;
          const win = window as unknown as Record<string, unknown>;
          win['__jbs_dismiss'] = false;
          const banner = document.createElement('div');
          banner.id = '__jbs_banner';
          banner.style.cssText =
            'position:fixed;top:0;left:0;right:0;z-index:999999;background:#cc0000;color:#fff;padding:18px 20px;font:bold 16px/1.4 Arial,sans-serif;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,0.5)';
          banner.innerHTML =
            '<div style="margin-bottom:10px">SECURITY CHECK DETECTED \u2014 Complete the challenge in the browser window, then click <b>Continue</b> below.</div>' +
            '<button id="__jbs_continue" style="background:#fff;color:#cc0000;border:none;border-radius:4px;padding:10px 32px;font:bold 15px Arial,sans-serif;cursor:pointer">Continue</button>' +
            '<div style="margin-top:8px;font-size:12px;opacity:0.7">Or press Ctrl+Shift+C</div>';
          document.body.prepend(banner);
          const btn = document.getElementById('__jbs_continue');
          if (btn) {
            btn.addEventListener('click', function () {
              win['__jbs_dismiss'] = true;
            });
          }
          document.addEventListener('keydown', function (e) {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
              win['__jbs_dismiss'] = true;
            }
          });
        })
        .catch(() => undefined);
      bannerInjected = true;
    }
    const dismissed = await page
      .evaluate(
        () =>
          (window as unknown as Record<string, unknown>)['__jbs_dismiss'] ===
          true,
      )
      .catch(() => false);
    if (dismissed) break;
    if (Date.now() - startedAt >= timeoutMs) {
      await page
        .evaluate(() => document.getElementById('__jbs_banner')?.remove())
        .catch(() => undefined);
      throw new Error(
        `${providerName} security check did not clear after ${String(Math.round(timeoutMs / 1000))}s. Complete it in the browser and try again, or increase the timeout.`,
      );
    }
    await page.waitForTimeout(500);
  }
  if (bannerInjected) {
    await page
      .evaluate(() => document.getElementById('__jbs_banner')?.remove())
      .catch(() => undefined);
  }
}

export async function pageHasSecurityChallenge(page: Page): Promise<boolean> {
  try {
    const url = page.url().toLowerCase();
    if (/captcha|challenge|verify/.test(url)) return true;
    const text = (
      (await page.textContent('body').catch(() => null)) ?? ''
    ).toLowerCase();
    return /checking your browser|verify you are human|performing security verification|unusual traffic/.test(
      text,
    );
  } catch {
    return false;
  }
}

export async function extractJsonLdJobPosting(
  page: Page,
): Promise<Record<string, unknown> | null> {
  const blocks = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    ).map((script) => script.textContent),
  );
  for (const block of blocks) {
    try {
      const posting = findJobPosting(JSON.parse(block) as unknown);
      if (posting !== null) return posting;
    } catch {
      // Ignore malformed structured data and use DOM fallbacks.
    }
  }
  return null;
}

export interface JobPostingDetails {
  jobId: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  salaryText: string | null;
  salaryMinimum: number | null;
  salaryMaximum: number | null;
  description: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
  postingUrl: string | null;
  postedDate: string | null;
  employmentType: string | null;
  workplaceType: string | null;
}

export function jobPostingDetails(
  posting: Record<string, unknown>,
  fallbackUrl: string | null,
): JobPostingDetails {
  const identifier = textValue(posting['identifier']);
  const identifierValue = isRecord(posting['identifier'])
    ? textValue(posting['identifier']['value'])
    : null;
  const location = locationValue(posting['jobLocation']);
  const salary = salaryValue(posting['baseSalary']);
  const organization = isRecord(posting['hiringOrganization'])
    ? posting['hiringOrganization']
    : null;
  const jobLocationType = textValue(posting['jobLocationType']);
  const description = cleanHtmlValue(posting['description']);
  const qualifications = cleanHtmlValue(posting['qualifications']);
  const experience = cleanHtmlValue(posting['experienceRequirements']);

  return {
    jobId:
      identifier ??
      identifierValue ??
      idFromUrl(textValue(posting['url']) ?? fallbackUrl),
    title: textValue(posting['title']),
    company: organization === null ? null : textValue(organization['name']),
    location,
    salaryText: salary.label,
    salaryMinimum: salary.minimum,
    salaryMaximum: salary.maximum,
    description,
    requirements: qualifications ?? experience,
    preferredQualifications: null,
    postingUrl: safeUrl(textValue(posting['url']) ?? fallbackUrl),
    postedDate: textValue(posting['datePosted']),
    employmentType: textValue(posting['employmentType']),
    workplaceType: /telecommute|remote/i.test(jobLocationType ?? '')
      ? 'remote'
      : inferRemoteType(
          `${jobLocationType ?? ''} ${location ?? ''} ${description ?? ''}`,
        ),
  };
}

export async function extractBasicDetail(
  page: Page,
  selectors: {
    title: readonly string[];
    company: readonly string[];
    location: readonly string[];
    salary: readonly string[];
    description: readonly string[];
  },
): Promise<Partial<BrowserJobRecord>> {
  return page.evaluate((input) => {
    const firstText = (values: readonly string[]): string | null => {
      for (const selector of values) {
        const element = document.querySelector(selector);
        const text = element?.textContent.trim() ?? '';
        if (text) return text;
      }
      return null;
    };
    return {
      title: firstText(input.title),
      company: firstText(input.company),
      location: firstText(input.location),
      salaryText: firstText(input.salary),
      description: firstText(input.description),
    };
  }, selectors);
}

export function mergeJobPosting<T extends BrowserJobRecord>(
  card: T,
  details: JobPostingDetails,
): T {
  return {
    ...card,
    jobId: details.jobId ?? card.jobId,
    title: details.title ?? card.title,
    company: details.company ?? card.company,
    location: details.location ?? card.location,
    salaryText: details.salaryText ?? card.salaryText,
    salaryMinimum: details.salaryMinimum ?? card.salaryMinimum,
    salaryMaximum: details.salaryMaximum ?? card.salaryMaximum,
    description: details.description ?? card.description,
    requirements: details.requirements ?? card.requirements,
    preferredQualifications:
      details.preferredQualifications ?? card.preferredQualifications,
    postingUrl: details.postingUrl ?? card.postingUrl,
    postedDate: details.postedDate ?? card.postedDate,
    employmentType: details.employmentType ?? card.employmentType,
    workplaceType: details.workplaceType ?? card.workplaceType,
  };
}

export function parseSalaryText(text: string | null): {
  minimum: number | null;
  maximum: number | null;
} {
  if (!text) return { minimum: null, maximum: null };
  const matches = text.match(/\$?\s*\d[\d,.]*(?:\s*[kK])?/g) ?? [];
  const values = matches
    .map((match) => {
      const isThousands = /k/i.test(match);
      const value = Number(match.replace(/[$,\s]/g, '').replace(/[kK]$/i, ''));
      return isThousands ? value * 1_000 : value;
    })
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) return { minimum: null, maximum: null };
  return {
    minimum: Math.min(...values),
    maximum: values.length > 1 ? Math.max(...values) : null,
  };
}

export function inferRemoteType(text: string | null): RemoteType {
  const normalized = (text ?? '').toLowerCase();
  if (normalized.includes('hybrid')) return 'hybrid';
  if (/remote|work from home|telecommute|anywhere/.test(normalized))
    return 'remote';
  if (/on[- ]?site|onsite/.test(normalized)) return 'onsite';
  return 'unknown';
}

export function inferEmploymentType(text: string | null): EmploymentType {
  const normalized = (text ?? '').toLowerCase();
  if (normalized.includes('intern')) return 'internship';
  if (/part[- ]time/.test(normalized)) return 'part-time';
  if (/contract|freelance/.test(normalized)) return 'contract';
  if (/temporary|seasonal/.test(normalized)) return 'temporary';
  if (/full[- ]time/.test(normalized)) return 'full-time';
  return 'unknown';
}

export function inferSeniority(text: string | null): SeniorityLevel {
  const normalized = (text ?? '').toLowerCase();
  if (/chief|cto|ceo|cfo|executive/.test(normalized)) return 'executive';
  if (/director|vice president|vp/.test(normalized)) return 'director';
  if (normalized.includes('manager')) return 'manager';
  if (/lead|principal|staff/.test(normalized)) return 'lead';
  if (/senior|sr\.?/.test(normalized)) return 'senior';
  if (/junior|jr\.?/.test(normalized)) return 'junior';
  if (/entry|associate|intern|graduate/.test(normalized)) return 'entry';
  if (/mid[- ]level|mid[- ]career/.test(normalized)) return 'mid';
  return 'unknown';
}

export function splitLocation(location: string | null): {
  city: string | null;
  state: string | null;
} {
  if (!location || inferRemoteType(location) === 'remote') {
    return { city: null, state: null };
  }
  const parts = location
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    city: parts[0] ?? null,
    state: parts.length > 1 ? (parts[1] ?? null) : null,
  };
}

export function toIsoDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return new Date(timestamp).toISOString();
  const relative = /^(\d+)\+?\s+(minute|hour|day|week|month)s?\s+ago$/i.exec(
    value.trim(),
  );
  if (relative?.[1] === undefined || relative[2] === undefined) {
    return /^just now$/i.test(value.trim()) ? new Date().toISOString() : null;
  }
  const amount = Number(relative[1]);
  const unit = relative[2].toLowerCase();
  const milliseconds =
    unit === 'minute'
      ? amount * 60_000
      : unit === 'hour'
        ? amount * 3_600_000
        : unit === 'day'
          ? amount * 86_400_000
          : unit === 'week'
            ? amount * 604_800_000
            : amount * 2_592_000_000;
  return new Date(Date.now() - milliseconds).toISOString();
}

export function idFromUrl(value: string | null): string | null {
  if (!value) return null;
  const parts = value.split(/[/?#]/).filter(Boolean);
  const last = parts.at(-1);
  return last && !/^jobs?$/.test(last) ? last : null;
}

export function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0 && visited < 2_000) {
    const current = pending.pop();
    visited += 1;
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
      continue;
    }
    if (!isRecord(current)) continue;
    const type = current['@type'];
    if (
      type === 'JobPosting' ||
      (Array.isArray(type) && type.includes('JobPosting'))
    ) {
      return current;
    }
    for (const key of ['@graph', 'itemListElement', 'mainEntity', 'item']) {
      const nested = current[key];
      if (nested !== undefined) pending.push(nested);
    }
  }
  return null;
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const cleaned = value.trim();
    return cleaned || null;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

function cleanHtmlValue(value: unknown): string | null {
  const text = textValue(value);
  return text === null ? null : htmlToText(text);
}

function locationValue(value: unknown): string | null {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'string') return first.trim() || null;
  if (!isRecord(first)) return null;
  const address = first['address'];
  if (typeof address === 'string') return address.trim() || null;
  if (isRecord(address)) {
    const parts = [
      textValue(address['streetAddress']),
      textValue(address['addressLocality']),
      textValue(address['addressRegion']),
      textValue(address['postalCode']),
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  return textValue(first['name']);
}

function salaryValue(value: unknown): {
  label: string | null;
  minimum: number | null;
  maximum: number | null;
} {
  if (!isRecord(value)) return { label: null, minimum: null, maximum: null };
  const currency = textValue(value['currency']) ?? 'USD';
  const salaryValue = value['value'];
  if (typeof salaryValue === 'number') {
    return {
      label: `$${salaryValue.toLocaleString('en-US')} ${currency}`,
      minimum: salaryValue,
      maximum: null,
    };
  }
  if (isRecord(salaryValue)) {
    const minimum = numberValue(salaryValue['minValue']);
    const maximum = numberValue(salaryValue['maxValue']);
    const unit = textValue(salaryValue['unitText']);
    const values = [minimum, maximum]
      .filter((item): item is number => item !== null)
      .map((item) => `$${item.toLocaleString('en-US')}`);
    return {
      label:
        values.length > 0 ? `${values.join(' - ')} ${unit ?? currency}` : null,
      minimum,
      maximum,
    };
  }
  return { label: null, minimum: null, maximum: null };
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
