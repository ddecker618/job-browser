import { afterEach, describe, expect, it, vi } from 'vitest';

import { UsaJobsProvider } from '../src/providers/usajobs.provider.js';
import { providerTestClient } from './provider-test-client.js';

const request = {
  query: ' information security ',
  location: ' Virginia ',
  remoteOnly: true,
  limit: 25,
} as const;

const credentials = {
  email: 'developer@example.test',
  apiKey: 'not-a-real-secret-key',
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UsaJobsProvider', () => {
  it('validates source configuration without requiring credentials', async () => {
    const provider = new UsaJobsProvider();

    await expect(provider.validateConfiguration({})).resolves.toMatchObject({
      valid: true,
    });
    await expect(
      provider.validateConfiguration({ page: 0, resultsPerPage: 501 }),
    ).resolves.toMatchObject({ valid: false });
    await expect(
      provider.validateConfiguration({ apiKey: credentials.apiKey }),
    ).resolves.toMatchObject({ valid: false });
  });

  it('requires valid live credentials but permits credential-free fixtures', async () => {
    const provider = new UsaJobsProvider();

    await expect(
      provider.search(request, { fixtureOnly: false }),
    ).rejects.toThrow('credentials are required');
    await expect(
      provider.search(request, {
        fixtureOnly: false,
        credentials: { email: 'not-an-email', apiKey: 'key' },
      }),
    ).rejects.toThrow('credentials are required');
    const fixtureSearch = await provider.search(request, { fixtureOnly: true });
    expect(typeof fixtureSearch.fixturePath).toBe('string');
  });

  it('builds bounded keyword, location, remote, and pagination criteria', async () => {
    const provider = new UsaJobsProvider();
    const search = await provider.search(request, {
      fixtureOnly: false,
      credentials,
      configuration: { page: 3, resultsPerPage: 500 },
    });
    const target = new URL(search.target);

    expect(target.origin + target.pathname).toBe(
      'https://data.usajobs.gov/api/Search',
    );
    expect(Object.fromEntries(target.searchParams)).toEqual({
      Keyword: 'information security',
      LocationName: 'Virginia',
      RemoteIndicator: 'true',
      Page: '3',
      ResultsPerPage: '25',
    });
    expect(JSON.stringify(search)).not.toContain(credentials.apiKey);
    expect(JSON.stringify(provider)).not.toContain(credentials.apiKey);
  });

  it('loads and normalizes fixture salary, agency, grade, dates, and URLs', async () => {
    const provider = new UsaJobsProvider();
    const search = await provider.search(request, { fixtureOnly: true });
    const records = await provider.fetch(search);
    const job = provider.validate(
      provider.normalize(records.records[0], '2026-07-19T12:00:00.000Z'),
    );

    expect(records.records).toHaveLength(2);
    expect(job).toMatchObject({
      company: 'Cybersecurity and Infrastructure Security Agency',
      agency: 'Cybersecurity and Infrastructure Security Agency',
      department: 'Department of Homeland Security',
      gradeLow: '13',
      gradeHigh: '14',
      payPlan: 'GS',
      salaryMinimum: 117962,
      salaryMaximum: 181216,
      salaryText: '$117,962 - $181,216 Per Year',
      appointmentType: 'Permanent',
      workSchedule: 'Full-time',
      remoteType: 'remote',
      teleworkEligible: true,
      openingDate: '2026-07-15T04:00:00.000Z',
      closingDate: '2026-07-30T03:59:59.000Z',
      datePosted: '2026-07-15T04:00:00.000Z',
      postingUrl: 'https://www.usajobs.gov/job/800000001',
      applicationUrls: [
        'https://www.usajobs.gov/apply/800000001',
        'https://agency.example.test/apply?announcement=CY-2026-0001',
      ],
    });
  });

  it('sends credentials as headers without exposing them in provider state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ SearchResult: { SearchResultItems: [] } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    const provider = new UsaJobsProvider(providerTestClient(fetchMock));
    const search = await provider.search(request, {
      fixtureOnly: false,
      credentials,
    });

    await expect(provider.fetch(search)).resolves.toMatchObject({
      records: [],
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({
      'User-Agent': credentials.email,
      'Authorization-Key': credentials.apiKey,
    });
    expect(JSON.stringify(provider)).not.toContain(credentials.apiKey);
  });

  it('fetches configured pages until the requested result limit', async () => {
    const descriptor = (id: string) => ({
      PositionID: id,
      PositionTitle: `Security role ${id}`,
      PositionURI: `https://www.usajobs.gov/job/${id}`,
      OrganizationName: 'Example Agency',
    });
    const fetchMock = vi.fn((url: URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            SearchResult: {
              SearchResultCountAll: 2,
              SearchResultItems: [
                {
                  MatchedObjectDescriptor: descriptor(
                    new URL(url).searchParams.get('Page') ?? 'unknown',
                  ),
                },
              ],
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const provider = new UsaJobsProvider(providerTestClient(fetchMock));
    const result = await provider.fetch(
      await provider.search(
        { ...request, limit: 2 },
        {
          fixtureOnly: false,
          credentials,
          configuration: { resultsPerPage: 1, pageCount: 2 },
        },
      ),
    );
    expect(result.records).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = fetchMock.mock.calls[1]?.[0];
    if (secondUrl === undefined) throw new Error('Expected a second page');
    expect(new URL(secondUrl).searchParams.get('Page')).toBe('2');
  });

  it('reports rate limiting without response content or secrets', async () => {
    const provider = new UsaJobsProvider(
      providerTestClient(() =>
        Promise.resolve(
          new Response(`echoed ${credentials.apiKey}`, { status: 429 }),
        ),
      ),
    );
    const search = await provider.search(request, {
      fixtureOnly: false,
      credentials,
    });

    let thrown: unknown;
    try {
      await provider.fetch(search);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toContain('rate limit');
    expect(JSON.stringify(thrown)).not.toContain(credentials.apiKey);
    expect(
      (thrown as { htmlSnapshot?: string | null }).htmlSnapshot,
    ).toBeNull();
  });

  it('sanitizes network errors that contain credentials', async () => {
    const provider = new UsaJobsProvider(
      providerTestClient(() => Promise.reject(new Error(credentials.apiKey))),
    );
    const search = await provider.search(request, {
      fixtureOnly: false,
      credentials,
    });

    await expect(provider.fetch(search)).rejects.toThrow(
      'USAJOBS request failed',
    );
    try {
      await provider.fetch(search);
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(credentials.apiKey);
    }
  });
});
