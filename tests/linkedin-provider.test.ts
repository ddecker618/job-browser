import { describe, it, expect, vi } from 'vitest';
import { LinkedInProvider } from '../src/providers/linkedIn.provider.js';
import {
  extractJobIdFromUrl,
  extractJobIdFromCard,
  parseRelativeDate,
  buildLinkedInSearchUrl,
  buildJobDetailUrl,
} from '../src/providers/linkedIn/searchUrlBuilder.js';
import {
  parseSalaryFromText,
  parseSeniorityLevel,
  parseEmploymentType,
  parseWorkplaceType,
} from '../src/providers/linkedIn/jobDetailExtractor.js';
import { LINKEDIN_SELECTORS } from '../src/providers/linkedIn/selectors.js';

vi.mock('playwright', () => ({
  chromium: {
    launchPersistentContext: vi.fn(),
  },
}));

vi.mock('../../src/logging/logger.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../src/utilities/files.js', () => ({
  ensureDir: vi.fn(),
}));

vi.mock('../../src/utils/fixtureLoader.js', () => ({
  loadJsonFixture: vi.fn(() => '<html><body>Mock fixture</body></html>'),
}));

vi.mock('../../src/repositories/job-repository.js', () => ({
  JobRepository: vi.fn(),
}));

describe('LinkedIn URL parsing', () => {
  it('extracts job ID from standard LinkedIn job URL', () => {
    expect(
      extractJobIdFromUrl('https://www.linkedin.com/jobs/view/1234567890/'),
    ).toBe('1234567890');
  });

  it('extracts job ID from URL without trailing slash', () => {
    expect(
      extractJobIdFromUrl('https://www.linkedin.com/jobs/view/987654321'),
    ).toBe('987654321');
  });

  it('returns null for non-job URLs', () => {
    expect(extractJobIdFromUrl('https://www.linkedin.com/feed/')).toBeNull();
    expect(extractJobIdFromUrl('https://www.google.com')).toBeNull();
    expect(extractJobIdFromUrl('')).toBeNull();
  });

  it('extracts job ID from URL with query parameters', () => {
    expect(
      extractJobIdFromUrl(
        'https://www.linkedin.com/jobs/view/555555/?refId=abc123',
      ),
    ).toBe('555555');
  });
});

describe('extractJobIdFromCard', () => {
  it('uses dataId when available', () => {
    expect(
      extractJobIdFromCard({
        dataId: '111111',
        href: 'https://www.linkedin.com/jobs/view/222222/',
      }),
    ).toBe('111111');
  });

  it('falls back to href when no dataId', () => {
    expect(
      extractJobIdFromCard({
        href: 'https://www.linkedin.com/jobs/view/333333/',
      }),
    ).toBe('333333');
  });

  it('extracts from entityUrn in dataset', () => {
    expect(
      extractJobIdFromCard({
        dataset: { entityUrn: 'urn:li:jobPosting:444444' },
      }),
    ).toBe('444444');
  });

  it('returns null when no identifiers available', () => {
    expect(extractJobIdFromCard({})).toBeNull();
  });
});

describe('buildLinkedInSearchUrl', () => {
  it('builds basic search URL with keywords', () => {
    const url = buildLinkedInSearchUrl({
      keywords: 'software engineer',
      location: null,
      remoteFilter: null,
      distance: null,
      datePosted: null,
      experienceLevel: null,
      employmentType: null,
      salary: null,
      sortBy: 'DD',
      page: 1,
    });
    expect(url).toContain('keywords=software+engineer');
    expect(url).toContain('keywords=software+engineer');
  });

  it('includes location parameter', () => {
    const url = buildLinkedInSearchUrl({
      keywords: 'developer',
      location: 'New York',
      remoteFilter: null,
      distance: null,
      datePosted: null,
      experienceLevel: null,
      employmentType: null,
      salary: null,
      sortBy: 'DD',
      page: 1,
    });
    expect(url).toContain('location=New+York');
  });

  it('includes remote filter', () => {
    const url = buildLinkedInSearchUrl({
      keywords: 'engineer',
      location: null,
      remoteFilter: '3',
      distance: null,
      datePosted: null,
      experienceLevel: null,
      employmentType: null,
      salary: null,
      sortBy: 'DD',
      page: 1,
    });
    expect(url).toContain('f_WT=3');
  });

  it('includes date posted filter', () => {
    const url = buildLinkedInSearchUrl({
      keywords: 'engineer',
      location: null,
      remoteFilter: null,
      distance: null,
      datePosted: 'r604800',
      experienceLevel: null,
      employmentType: null,
      salary: null,
      sortBy: 'DD',
      page: 1,
    });
    expect(url).toContain('f_TPR=r604800');
  });

  it('includes experience level', () => {
    const url = buildLinkedInSearchUrl({
      keywords: 'engineer',
      location: null,
      remoteFilter: null,
      distance: null,
      datePosted: null,
      experienceLevel: '2,3,4',
      employmentType: null,
      salary: null,
      sortBy: 'DD',
      page: 1,
    });
    expect(url).toContain('f_E=2%2C3%2C4');
  });

  it('includes employment type', () => {
    const url = buildLinkedInSearchUrl({
      keywords: 'engineer',
      location: null,
      remoteFilter: null,
      distance: null,
      datePosted: null,
      experienceLevel: null,
      employmentType: 'F,C',
      salary: null,
      sortBy: 'DD',
      page: 1,
    });
    expect(url).toContain('f_JT=F%2CC');
  });

  it('includes salary filter', () => {
    const url = buildLinkedInSearchUrl({
      keywords: 'engineer',
      location: null,
      remoteFilter: null,
      distance: null,
      datePosted: null,
      experienceLevel: null,
      employmentType: null,
      salary: 100000,
      sortBy: 'DD',
      page: 1,
    });
    expect(url).toContain('f_SB2=100000');
  });

  it('includes distance', () => {
    const url = buildLinkedInSearchUrl({
      keywords: 'engineer',
      location: 'San Francisco',
      remoteFilter: null,
      distance: 50,
      datePosted: null,
      experienceLevel: null,
      employmentType: null,
      salary: null,
      sortBy: 'DD',
      page: 1,
    });
    expect(url).toContain('distance=50');
  });

  it('includes page offset for page > 1', () => {
    const url = buildLinkedInSearchUrl({
      keywords: 'engineer',
      location: null,
      remoteFilter: null,
      distance: null,
      datePosted: null,
      experienceLevel: null,
      employmentType: null,
      salary: null,
      sortBy: 'DD',
      page: 2,
    });
    expect(url).toContain('start=25');
  });

  it('does not include start for page 1', () => {
    const url = buildLinkedInSearchUrl({
      keywords: 'engineer',
      location: null,
      remoteFilter: null,
      distance: null,
      datePosted: null,
      experienceLevel: null,
      employmentType: null,
      salary: null,
      sortBy: 'DD',
      page: 1,
    });
    expect(url).not.toContain('start=');
  });
});

describe('buildJobDetailUrl', () => {
  it('builds correct job detail URL', () => {
    expect(buildJobDetailUrl('123456')).toBe(
      'https://www.linkedin.com/jobs/view/123456/',
    );
  });
});

describe('parseRelativeDate', () => {
  it('parses "3 days ago"', () => {
    const result = parseRelativeDate('3 days ago');
    expect(result.text).toBe('3 days ago');
    expect(result.estimated).not.toBeNull();
    const estimated = new Date(result.estimated!).getTime();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    expect(Math.abs(Date.now() - estimated - threeDaysMs)).toBeLessThan(5000);
  });

  it('parses "1 day ago"', () => {
    const result = parseRelativeDate('1 day ago');
    expect(result.text).toBe('1 day ago');
    expect(result.estimated).not.toBeNull();
  });

  it('parses "Just now"', () => {
    const result = parseRelativeDate('Just now');
    expect(result.text).toBe('Just now');
    expect(result.estimated).not.toBeNull();
  });

  it('parses "30+ days ago"', () => {
    const result = parseRelativeDate('30+ days ago');
    expect(result.text).toBe('30+ days ago');
    expect(result.estimated).not.toBeNull();
  });

  it('parses "Week ago"', () => {
    const result = parseRelativeDate('1 week ago');
    expect(result.text).toBe('1 week ago');
    expect(result.estimated).not.toBeNull();
  });

  it('returns null for unrecognized date format', () => {
    const result = parseRelativeDate('Posted on LinkedIn');
    expect(result.estimated).toBeNull();
    expect(result.text).toBe('Posted on LinkedIn');
  });

  it('handles empty string', () => {
    const result = parseRelativeDate('');
    expect(result.estimated).toBeNull();
  });
});

describe('LinkedInProvider normalization', () => {
  const provider = new LinkedInProvider();

  it('normalizes a complete job record', () => {
    const raw = {
      jobId: '123456789',
      title: 'Senior Software Engineer',
      company: 'Test Corp',
      location: 'San Francisco, CA',
      salaryText: '$150,000 - $200,000',
      datePostedEstimated: new Date(Date.now() - 86400000).toISOString(),
      href: 'https://www.linkedin.com/jobs/view/123456789',
      workplaceType: 'remote',
      employmentType: 'full-time',
      seniorityLevel: 'Senior',
      description: 'We are looking for a senior engineer...',
      promoted: false,
      easyApply: true,
      applicantCount: '50 applicants',
      providerId: 'linkedin',
      providerName: 'LinkedIn Jobs',
      source: 'LinkedIn',
    };

    const result = provider.normalize(raw, new Date().toISOString());
    expect(result.title).toBe('Senior Software Engineer');
    expect(result.company).toBe('Test Corp');
    expect(result.location).toBe('San Francisco, CA');
    expect(result.remoteType).toBe('remote');
    expect(result.employmentType).toBe('full-time');
    expect(result.seniorityLevel).toBe('senior');
    expect(result.salaryMinimum).toBe(150000);
    expect(result.salaryMaximum).toBe(200000);
    expect(result.salaryText).toBe('$150,000 - $200,000');
    expect(result.description).toBe('We are looking for a senior engineer...');
    expect(result.externalId).toBe('123456789');
    expect(result.sourceName).toBe('LinkedIn Jobs');
    expect(result.sourceType).toBe('linkedin');
    expect(result.postingUrl).toBe(
      'https://www.linkedin.com/jobs/view/123456789',
    );
  });

  it('handles missing optional fields', () => {
    const raw = {
      jobId: null,
      title: 'Engineer',
      company: 'Startup',
      location: null,
      salaryText: null,
      datePostedEstimated: null,
      href: null,
      workplaceType: null,
      employmentType: null,
      seniorityLevel: null,
      description: null,
      providerId: 'linkedin',
      providerName: 'LinkedIn Jobs',
      source: 'LinkedIn',
    };

    const result = provider.normalize(raw, new Date().toISOString());
    expect(result.title).toBe('Engineer');
    expect(result.company).toBe('Startup');
    expect(result.location).toBeNull();
    expect(result.remoteType).toBe('unknown');
    expect(result.employmentType).toBe('unknown');
    expect(result.seniorityLevel).toBe('unknown');
    expect(result.externalId).toBeNull();
    expect(result.salaryMinimum).toBeNull();
    expect(result.salaryMaximum).toBeNull();
    expect(result.salaryText).toBeNull();
    expect(result.description).toBeNull();
    expect(result.postingUrl).toBeNull();
  });

  it('generates a valid fingerprint', () => {
    const raw = {
      jobId: '999',
      title: 'Data Scientist',
      company: 'AI Corp',
      location: 'Seattle, WA',
      salaryText: null,
      datePostedEstimated: null,
      href: 'https://www.linkedin.com/jobs/view/999',
      workplaceType: 'hybrid',
      employmentType: 'full-time',
      seniorityLevel: null,
      description: 'ML role',
      providerId: 'linkedin',
      providerName: 'LinkedIn Jobs',
      source: 'LinkedIn',
    };

    const result = provider.normalize(raw, new Date().toISOString());
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses externalId as primary duplicate key', () => {
    const raw1 = {
      jobId: '101',
      title: 'Backend Engineer',
      company: 'Tech Inc',
      location: 'New York, NY',
      salaryText: null,
      datePostedEstimated: null,
      href: 'https://www.linkedin.com/jobs/view/101',
      workplaceType: 'onsite',
      employmentType: 'full-time',
      seniorityLevel: null,
      description: 'Backend role',
      providerId: 'linkedin',
      providerName: 'LinkedIn Jobs',
      source: 'LinkedIn',
    };

    const raw2 = {
      jobId: '101',
      title: 'Backend Engineer ',
      company: 'tech inc',
      location: 'New York, NY',
      salaryText: null,
      datePostedEstimated: null,
      href: 'https://www.linkedin.com/jobs/view/101',
      workplaceType: 'onsite',
      employmentType: 'full-time',
      seniorityLevel: null,
      description: 'Backend role (different detail)',
      providerId: 'linkedin',
      providerName: 'LinkedIn Jobs',
      source: 'LinkedIn',
    };

    const result1 = provider.normalize(raw1, new Date().toISOString());
    const result2 = provider.normalize(raw2, new Date().toISOString());
    expect(result1.externalId).toBe(result2.externalId);
  });

  it('preserves raw date-posted text and estimated date', () => {
    const raw = {
      jobId: '202',
      title: 'Frontend Developer',
      company: 'Web Co',
      location: 'Remote',
      salaryText: null,
      datePostedEstimated: new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      href: 'https://www.linkedin.com/jobs/view/202',
      workplaceType: 'remote',
      employmentType: 'contract',
      seniorityLevel: null,
      description: null,
      providerId: 'linkedin',
      providerName: 'LinkedIn Jobs',
      source: 'LinkedIn',
    };

    const result = provider.normalize(raw, new Date().toISOString());
    expect(result.datePosted).not.toBeNull();
    const dateDiff = Date.now() - new Date(result.datePosted!).getTime();
    expect(dateDiff).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(dateDiff).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  });
});

describe('Seniority level parsing', () => {
  it('detects senior level', () => {
    expect(parseSeniorityLevel('Senior Engineer')).toBe('senior');
    expect(parseSeniorityLevel('Sr. Developer')).toBe('senior');
  });

  it('detects entry level', () => {
    expect(parseSeniorityLevel('Internship')).toBe('entry');
    expect(parseSeniorityLevel('Entry Level')).toBe('entry');
  });

  it('detects mid level', () => {
    expect(parseSeniorityLevel('Mid-Senior')).toBe('mid');
    expect(parseSeniorityLevel('Associate')).toBe('mid');
  });

  it('detects director level', () => {
    expect(parseSeniorityLevel('Director of Engineering')).toBe('director');
  });

  it('returns unknown for unrecognized level', () => {
    expect(parseSeniorityLevel('Some random text')).toBe('unknown');
  });

  it('returns unknown for null', () => {
    expect(parseSeniorityLevel(null)).toBe('unknown');
  });
});

describe('Employment type parsing', () => {
  it('detects full-time', () => {
    expect(parseEmploymentType('Full-time')).toBe('full-time');
  });

  it('detects part-time', () => {
    expect(parseEmploymentType('Part-time')).toBe('part-time');
  });

  it('detects contract', () => {
    expect(parseEmploymentType('Contract')).toBe('contract');
  });

  it('returns unknown for null', () => {
    expect(parseEmploymentType(null)).toBe('unknown');
  });
});

describe('Workplace type parsing', () => {
  it('detects remote', () => {
    expect(parseWorkplaceType('Remote')).toBe('remote');
  });

  it('detects hybrid', () => {
    expect(parseWorkplaceType('Hybrid')).toBe('hybrid');
  });

  it('detects onsite', () => {
    expect(parseWorkplaceType('On-site')).toBe('onsite');
    expect(parseWorkplaceType('Onsite')).toBe('onsite');
  });

  it('returns unknown for null', () => {
    expect(parseWorkplaceType(null)).toBe('unknown');
  });
});

describe('Salary parsing from text', () => {
  it('parses range format', () => {
    const result = parseSalaryFromText('$100,000 - $150,000');
    expect(result.minimum).toBe(100000);
    expect(result.maximum).toBe(150000);
  });

  it('parses single salary', () => {
    const result = parseSalaryFromText('$120,000/yr');
    expect(result.minimum).toBe(120000);
    expect(result.maximum).toBeNull();
  });

  it('parses K-notation', () => {
    const result = parseSalaryFromText('$100K - $130K');
    expect(result.minimum).toBe(100000);
    expect(result.maximum).toBe(130000);
  });

  it('returns null for empty text', () => {
    const result = parseSalaryFromText(null);
    expect(result.minimum).toBeNull();
    expect(result.maximum).toBeNull();
  });

  it('returns null for text without numbers', () => {
    const result = parseSalaryFromText('Competitive salary');
    expect(result.minimum).toBeNull();
    expect(result.maximum).toBeNull();
  });
});

describe('LinkedIn selectors', () => {
  it('has all required selectors defined', () => {
    expect(LINKEDIN_SELECTORS.loginEmail).toBeTruthy();
    expect(LINKEDIN_SELECTORS.loginPassword).toBeTruthy();
    expect(LINKEDIN_SELECTORS.jobCard).toBeTruthy();
    expect(LINKEDIN_SELECTORS.jobCardTitle).toBeTruthy();
    expect(LINKEDIN_SELECTORS.jobCardCompany).toBeTruthy();
    expect(LINKEDIN_SELECTORS.jobCardLocation).toBeTruthy();
    expect(LINKEDIN_SELECTORS.jobDetailTitle).toBeTruthy();
    expect(LINKEDIN_SELECTORS.jobDetailDescription).toBeTruthy();
    expect(LINKEDIN_SELECTORS.paginationNext).toBeTruthy();
    expect(LINKEDIN_SELECTORS.securityChallenge).toBeTruthy();
  });
});

describe('Provider configuration validation', () => {
  const provider = new LinkedInProvider();

  it('accepts valid configuration', async () => {
    const result = await provider.validateConfiguration({
      searchKeywords: 'software engineer',
      location: 'San Francisco',
      maxResults: 50,
    });
    expect(result.valid).toBe(true);
  });

  it('accepts empty configuration with defaults', async () => {
    const result = await provider.validateConfiguration({});
    expect(result.valid).toBe(true);
  });

  it('rejects invalid maxResults', async () => {
    const result = await provider.validateConfiguration({
      searchKeywords: 'engineer',
      maxResults: 0,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects negative distance', async () => {
    const result = await provider.validateConfiguration({
      searchKeywords: 'engineer',
      distance: -1,
    });
    expect(result.valid).toBe(false);
  });

  it('accepts valid remote filter', async () => {
    const result = await provider.validateConfiguration({
      searchKeywords: 'engineer',
      remoteFilter: 'remote',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects invalid remote filter', async () => {
    const result = await provider.validateConfiguration({
      searchKeywords: 'engineer',
      remoteFilter: 'invalid',
    });
    expect(result.valid).toBe(false);
  });
});

describe('Provider identity', () => {
  const provider = new LinkedInProvider();

  it('has correct id', () => {
    expect(provider.id).toBe('linkedin');
  });

  it('has correct name', () => {
    expect(provider.name).toBe('LinkedIn Jobs');
  });

  it('is a job-board type', () => {
    expect(provider.type).toBe('job-board');
  });

  it('supports keyword search', () => {
    expect(provider.capabilities.keywordSearch).toBe(true);
  });

  it('supports location search', () => {
    expect(provider.capabilities.locationSearch).toBe(true);
  });

  it('supports remote filter', () => {
    expect(provider.capabilities.remoteFilter).toBe(true);
  });

  it('does not require credentials', () => {
    expect(provider.capabilities.requiresCredentials).toBe(false);
  });
});

describe('Provider fetch with fixture', () => {
  const provider = new LinkedInProvider();

  it('returns fixture result when fixture path provided', async () => {
    const result = await provider.fetch({
      request: { query: 'test', location: null, remoteOnly: false, limit: 25 },
      target: 'https://www.linkedin.com/jobs/search/',
      fixturePath: '/mock/fixture/path',
      configuration: {},
    });
    expect(result.records).toHaveLength(1);
    expect((result.records[0] as Record<string, unknown>)['jobId']).toBe(
      '123456',
    );
    expect((result.records[0] as Record<string, unknown>)['title']).toBe(
      'Software Engineer',
    );
    expect(result.complete).toBe(true);
  });
});
