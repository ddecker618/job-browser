import type { Page } from 'playwright';
import { log } from '../../logging/logger.js';

interface DiceJsonLd {
  [key: string]: unknown;
  title?: string;
  description?: string;
  datePosted?: string;
  url?: string;
  hiringOrganization?: { name?: string; logo?: string };
  jobLocation?: {
    address?: {
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string;
    };
  };
  employmentType?: string;
  baseSalary?: { currency?: string; value?: number };
}

export interface DiceJobDetail {
  description: string | null;
  salaryText: string | null;
  salaryMinimum: number | null;
  salaryMaximum: number | null;
  workplaceType: string | null;
  employmentType: string | null;
  postedDate: string | null;
  companyName: string | null;
  companyLogo: string | null;
  location: string | null;
  jobTitle: string | null;
  employmentDetails: string[];
}

export async function extractJobDetail(page: Page): Promise<DiceJobDetail> {
  const jsonld = await extractJsonLd(page);

  const result: DiceJobDetail = jsonld
    ? extractFromJsonLd(jsonld)
    : {
        description: null,
        salaryText: null,
        salaryMinimum: null,
        salaryMaximum: null,
        workplaceType: null,
        employmentType: null,
        postedDate: null,
        companyName: null,
        companyLogo: null,
        location: null,
        jobTitle: null,
        employmentDetails: [],
      };

  if (!jsonld) {
    try {
      result.description = await extractDescription(page);
      result.companyName = await extractCompanyName(page);
      result.companyLogo = await extractCompanyLogo(page);
      result.jobTitle = await extractJobTitle(page);
    } catch {
      // partial ok
    }
  }

  try {
    const badges = await extractBadges(page);
    for (const badge of badges) {
      const lower = badge.toLowerCase();
      if (!result.workplaceType) {
        if (lower.includes('remote')) result.workplaceType = 'remote';
        else if (lower.includes('hybrid')) result.workplaceType = 'hybrid';
        else if (lower.includes('on-site') || lower.includes('onsite'))
          result.workplaceType = 'onsite';
      }
      if (!result.employmentType && !jsonld) {
        if (lower.includes('full-time')) result.employmentType = 'full-time';
        else if (lower.includes('part-time'))
          result.employmentType = 'part-time';
        else if (lower.includes('contract')) result.employmentType = 'contract';
      }
      result.employmentDetails.push(badge);
    }
  } catch {
    // badges optional
  }

  try {
    const headerText = await extractHeaderText(page);
    if (headerText) {
      const salaryMatch =
        /\$[\d,]+(?:\.\d{2})?\s*-\s*\$?[\d,]+(?:\.\d{2})?/.exec(headerText);
      if (salaryMatch && !result.salaryText) result.salaryText = salaryMatch[0];
      if (!result.postedDate) {
        const postedMatch = /Posted\s+(\d+\s+\w+\s+ago)/i.exec(headerText);
        if (postedMatch) result.postedDate = postedMatch[1] ?? null;
      }
      if (!result.location) {
        const locMatch = /^[^•]+/.exec(headerText);
        if (locMatch) result.location = locMatch[0].trim();
      }
    }
  } catch {
    // header optional
  }

  return result;
}

function extractFromJsonLd(jsonld: DiceJsonLd): DiceJobDetail {
  const org = jsonld.hiringOrganization;
  const addr = jsonld.jobLocation?.address;

  let location: string | null = null;
  if (addr?.addressLocality || addr?.addressRegion) {
    location = [addr.addressLocality, addr.addressRegion]
      .filter(Boolean)
      .join(', ');
  }

  const employmentType = mapEmploymentType(jsonld.employmentType);

  let salaryText: string | null = null;
  let salaryMin: number | null = null;
  if (jsonld.baseSalary?.value) {
    salaryText = `$${jsonld.baseSalary.value.toLocaleString()} ${jsonld.baseSalary.currency ?? ''}`;
    salaryMin = jsonld.baseSalary.value;
  }

  return {
    description: jsonld.description ?? null,
    salaryText,
    salaryMinimum: salaryMin,
    salaryMaximum: null,
    workplaceType: null,
    employmentType,
    postedDate: jsonld.datePosted ?? null,
    companyName: org?.name ?? null,
    companyLogo: org?.logo ?? null,
    location,
    jobTitle: jsonld.title ?? null,
    employmentDetails: [],
  };
}

function mapEmploymentType(diceType: string | undefined): string | null {
  if (!diceType) return null;
  switch (diceType.toUpperCase()) {
    case 'FULL_TIME':
      return 'full-time';
    case 'PART_TIME':
      return 'part-time';
    case 'CONTRACTOR':
    case 'CONTRACT':
      return 'contract';
    case 'TEMPORARY':
      return 'temporary';
    case 'INTERN':
    case 'INTERNSHIP':
      return 'internship';
    default:
      return null;
  }
}

async function extractJsonLd(page: Page): Promise<DiceJsonLd | null> {
  try {
    const script = await page.$('[data-testid="jobDetailStructuredData"]');
    if (script) {
      const text = await script.textContent();
      if (text) {
        const parsed = JSON.parse(text) as DiceJsonLd;
        if ((parsed as Record<string, string>)['@type'] === 'JobPosting')
          return parsed;
      }
    }
  } catch (error) {
    log('warn', 'Failed to parse Dice JSON-LD', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
}

async function extractBadges(page: Page): Promise<string[]> {
  const items: string[] = [];
  try {
    const badges = await page.$$('[data-testid="locationTypeBadge"]');
    for (const b of badges) {
      const text = await b.textContent();
      if (text?.trim()) items.push(text.trim());
    }
  } catch {
    // ignore
  }
  return items;
}

async function extractHeaderText(page: Page): Promise<string | null> {
  try {
    const header = await page.$('[data-testid="job-detail-header-card"]');
    if (header) return await header.textContent();
  } catch {
    // ignore
  }
  return null;
}

async function extractDescription(page: Page): Promise<string | null> {
  try {
    const script = await page.$('[data-testid="jobDetailStructuredData"]');
    if (script) {
      const text = await script.textContent();
      if (text) {
        const parsed = JSON.parse(text) as DiceJsonLd;
        if (parsed.description) return parsed.description;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

async function extractCompanyName(page: Page): Promise<string | null> {
  try {
    const el = await page.$(
      '[data-testid="job-detail-header-card"] a[data-wa-click="djv-job-company-profile-click"]',
    );
    if (el) return await el.textContent();
  } catch {
    // ignore
  }
  return null;
}

async function extractCompanyLogo(page: Page): Promise<string | null> {
  try {
    const header = await page.$('[data-testid="job-detail-header-card"]');
    if (header) {
      const img = await header.$('img[alt]');
      if (img) return await img.getAttribute('src');
    }
  } catch {
    // ignore
  }
  return null;
}

async function extractJobTitle(page: Page): Promise<string | null> {
  try {
    const el = await page.$('h1');
    if (el) return await el.textContent();
  } catch {
    // ignore
  }
  return null;
}
