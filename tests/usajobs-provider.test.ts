import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/providers/linkedIn/browserSession.js', () => ({
  launchBrowserSession: vi.fn(async () => ({
    page: {
      waitForTimeout: vi.fn(async () => undefined),
      goto: vi.fn(async () => undefined),
      goBack: vi.fn(async () => undefined),
      url: vi.fn(() => 'https://www.usajobs.gov/Search/Results?k=test'),
      waitForSelector: vi.fn(async () => true),
      click: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => true),
    } as unknown as import('playwright').Page,
    context: {} as any,
    profileDir: '/mock/profile',
    persistentContext: {} as any,
    underlyingBrowser: {} as any,
  })),
  closeBrowserSession: vi.fn(async () => undefined),
  navigateWithRetry: vi.fn(async () => undefined),
  takeDiagnosticScreenshot: vi.fn(async () => undefined),
}));

vi.mock('../src/providers/usajobs/browserSession.js', () => ({
  ensureUsaJobsLogin: vi.fn(async () => false),
}));

vi.mock('../src/providers/usajobs/searchResultExtractor.js', () => ({
  extractSearchPage: vi.fn(),
}));

import { UsaJobsProvider } from '../src/providers/usajobs.provider.js';
import type { ProviderSearch } from '../src/models/discovery.js';

const request = {
  query: ' information security ',
  location: ' Virginia ',
  remoteOnly: true,
  limit: 25,
} as const;

const rawFixtureRecord = {
  jobId: '815000001',
  title: 'Network Administrator',
  agency: 'Veterans Health Administration',
  department: 'Department of Veterans Affairs',
  location: 'Amarillo, TX',
  dateText: 'Posted 7/31/26 · Apply by 8/14/26',
  salaryText: '$82,764 - $107,590 Per Year',
  workSchedule: 'Full-time',
  appointmentType: 'Permanent',
  postingUrl: 'https://www.usajobs.gov/job/815000001',
  description: 'Provides network administration for the Amarillo VA.',
  detailPairs: [
    { label: 'Salary', value: '$82,764 - $107,590 Per Year' },
    { label: 'Pay scale & grade', value: 'GS 11' },
    { label: 'Remote job', value: 'No' },
    { label: 'Telework eligible', value: 'Yes' },
    { label: 'Work schedule', value: 'Full-time' },
    { label: 'Appointment type', value: 'Permanent' },
  ],
  detailText:
    'Network Administrator\nDepartment of Veterans Affairs\nVeterans Health Administration\nSummary\nProvides network administration for the Amarillo VA.',
  applyUrls: ['https://www.usajobs.gov/apply/815000001'],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UsaJobsProvider', () => {
  it('validates configuration without credentials and reports browser capabilities', async () => {
    const provider = new UsaJobsProvider();

    await expect(provider.validateConfiguration({})).resolves.toMatchObject({
      valid: true,
    });
    await expect(
      provider.validateConfiguration({ maxResults: 0 }),
    ).resolves.toMatchObject({ valid: false });
    expect(provider.capabilities.requiresCredentials).toBe(false);
    expect(provider.capabilities.interactiveBrowser).toBe(true);
    expect(provider.type).toBe('government');
  });

  it('builds a public search URL and exposes fixture path', async () => {
    const provider = new UsaJobsProvider();

    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration: { queries: [] },
    });
    const target = new URL(search.target);
    expect(target.origin + target.pathname).toBe(
      'https://www.usajobs.gov/Search/Results',
    );
    expect(target.searchParams.get('k')).toBe('information security');
    expect(target.searchParams.get('l')).toBe('Virginia');

    const fixtureSearch = await provider.search(request, { fixtureOnly: true });
    expect(typeof fixtureSearch.fixturePath).toBe('string');
  });

  it('loads and normalizes fixture salary, grade, remote, dates, and URLs', async () => {
    const provider = new UsaJobsProvider();
    const search = await provider.search(request, { fixtureOnly: true });
    const records = await provider.fetch(search);
    const job = provider.validate(
      provider.normalize(rawFixtureRecord, '2026-07-19T12:00:00.000Z'),
    );

    expect(records.records).toHaveLength(2);
    expect(job).toMatchObject({
      company: 'Veterans Health Administration',
      agency: 'Veterans Health Administration',
      department: 'Department of Veterans Affairs',
      city: 'Amarillo',
      state: 'TX',
      gradeLow: '11',
      gradeHigh: '11',
      payPlan: 'GS',
      salaryMinimum: 82764,
      salaryMaximum: 107590,
      salaryText: '$82,764 - $107,590 Per Year',
      appointmentType: 'Permanent',
      workSchedule: 'Full-time',
      remoteType: 'hybrid',
      teleworkEligible: true,
      openingDate: '2026-07-31T00:00:00.000Z',
      closingDate: '2026-08-14T00:00:00.000Z',
      datePosted: '2026-07-31T00:00:00.000Z',
      postingUrl: 'https://www.usajobs.gov/job/815000001',
      applicationUrls: ['https://www.usajobs.gov/apply/815000001'],
    });
    expect(job.description).toContain('network administration');
  });

  it('normalizes a remote job without telework as remote', async () => {
    const provider = new UsaJobsProvider();
    const job = provider.normalize(
      {
        ...rawFixtureRecord,
        jobId: '815000002',
        title: 'IT Specialist (SysAdmin)',
        agency: 'U.S. Cyber Command',
        department: 'Department of Defense',
        location: 'Remote',
        dateText: 'Posted this month',
        detailPairs: [
          { label: 'Salary', value: '$117,962 - $181,216 Per Year' },
          { label: 'Pay scale & grade', value: 'GS 13-14' },
          { label: 'Remote job', value: 'Yes' },
          { label: 'Telework eligible', value: 'No' },
        ],
      },
      '2026-07-19T12:00:00.000Z',
    );
    expect(job).toMatchObject({
      remoteType: 'remote',
      gradeLow: '13',
      gradeHigh: '14',
      city: null,
      state: null,
      openingDate: null,
      closingDate: null,
    });
  });

  it('all queries complete returns complete=true', async () => {
    const provider = new UsaJobsProvider();
    vi.spyOn(provider as any, 'collectCards').mockResolvedValue([
      rawFixtureRecord,
    ]);
    vi.spyOn(provider as any, 'enrichWithDetails').mockImplementation(
      async (_page: unknown, ...args: unknown[]) => args[0],
    );
    const result = await provider.fetch(makeSearch());
    expect(result.complete).toBe(true);
    expect(result.completedQueries).toBe(4);
    expect(result.failedQueries).toBe(0);
  });

  it('one failing query returns complete=false', async () => {
    const provider = new UsaJobsProvider();
    let callCount = 0;
    vi.spyOn(provider as any, 'collectCards').mockImplementation(async () => {
      callCount++;
      if (callCount === 2) throw new Error('Collect failed');
      return [{ ...rawFixtureRecord, jobId: `job-${callCount}` }];
    });
    vi.spyOn(provider as any, 'enrichWithDetails').mockImplementation(
      async (_page: unknown, ...args: unknown[]) => args[0],
    );
    const result = await provider.fetch(makeSearch());
    expect(result.complete).toBe(false);
    expect(result.completedQueries).toBe(3);
    expect(result.failedQueries).toBe(1);
  });

  it('duplicates are consolidated across queries', async () => {
    const provider = new UsaJobsProvider();
    let callCount = 0;
    vi.spyOn(provider as any, 'collectCards').mockImplementation(async () => {
      callCount++;
      return [
        rawFixtureRecord,
        { ...rawFixtureRecord, jobId: `unique-${callCount}` },
      ];
    });
    vi.spyOn(provider as any, 'enrichWithDetails').mockImplementation(
      async (_page: unknown, ...args: unknown[]) => args[0],
    );
    const result = await provider.fetch(makeSearch());
    const uniqueIds = new Set(result.records.map((r: any) => r.jobId));
    expect(uniqueIds.size).toBe(result.records.length);
    expect(uniqueIds.has('815000001')).toBe(true);
  });

  it('filters non-remote cards when remoteOnly is requested', async () => {
    const { extractSearchPage } =
      await import('../src/providers/usajobs/searchResultExtractor.js');
    vi.mocked(extractSearchPage).mockResolvedValue({
      cards: [
        {
          id: 'remote-job',
          title: 'Remote Admin',
          href: '/job/remote-job',
          agency: 'U.S. Cyber Command',
          department: 'Department of Defense',
          location: 'Remote',
          dateText: 'Posted this month',
          salaryText: null,
          workSchedule: 'Full-time',
          appointmentType: 'Permanent',
        },
        {
          id: 'onsite-job',
          title: 'Onsite Admin',
          href: '/job/onsite-job',
          agency: 'Veterans Health Administration',
          department: 'Department of Veterans Affairs',
          location: 'Amarillo, TX',
          dateText: 'Posted this month',
          salaryText: null,
          workSchedule: 'Full-time',
          appointmentType: 'Permanent',
        },
      ],
      hasNext: false,
      noResults: false,
    });
    const provider = new UsaJobsProvider();
    const result = await provider.fetch(
      makeSearch({
        configuration: {
          ...makeSearch().configuration,
          remoteFilter: 'remote',
        },
      }),
    );
    const ids = result.records.map((r: any) => r.jobId);
    expect(ids).toContain('remote-job');
    expect(ids).not.toContain('onsite-job');
  });
});

function makeSearch(overrides: Partial<ProviderSearch> = {}): ProviderSearch {
  return {
    request: {
      query: 'systems administrator',
      location: null,
      remoteOnly: false,
      limit: 25,
      maxAgeDays: 30,
    },
    target: 'https://www.usajobs.gov/Search/Results',
    fixturePath: null,
    configuration: {
      searchKeywords: 'systems administrator',
      location: '',
      queries: [
        { keywords: 'systems administrator', location: '' },
        { keywords: 'network administrator', location: '' },
        { keywords: 'network analyst', location: '' },
        { keywords: 'SOC analyst', location: '' },
      ],
      remoteFilter: '',
      datePosted: 'any',
      maxResults: 25,
      browserProfileDir: '/mock/usajobs-profile',
      keepBrowserOpen: false,
      debugMode: false,
    },
    ...overrides,
  };
}
