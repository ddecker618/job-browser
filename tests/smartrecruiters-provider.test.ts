import { afterEach, describe, expect, it, vi } from 'vitest';

import { SmartRecruitersProvider } from '../src/providers/smartRecruiters.provider.js';
import type { ProviderHttpTransport } from '../src/providers/providerHttpClient.js';
import { providerTestClient } from './provider-test-client.js';

const request = {
  query: 'target-role',
  location: null,
  remoteOnly: false,
  limit: 20,
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

function smartJob(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name,
    company: { identifier: 'acme', name: 'Acme, Inc.' },
    location: { city: 'Boston', region: 'Massachusetts', country: 'US' },
    releasedDate: '2026-07-17T12:00:00Z',
    typeOfEmployment: { label: 'Full-time' },
    postingUrl: `https://jobs.smartrecruiters.com/acme/${id}`,
    ...overrides,
  };
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SmartRecruiters provider', () => {
  it('loads its fixture, filters, and normalizes the public posting id', async () => {
    const provider = new SmartRecruitersProvider();
    const search = await provider.search(
      { query: 'security', location: null, remoteOnly: false, limit: 20 },
      {
        fixtureOnly: true,
        configuration: { companyIdentifier: 'FixtureCorp', company: 'Fixture Corp' },
      },
    );
    expect(search.target).toBe(
      'https://api.smartrecruiters.com/v1/companies/FixtureCorp/postings?_company=Fixture+Corp',
    );
    const result = await provider.fetch(search);
    expect(result).toMatchObject({ rejected: 1, complete: true });
    expect(
      provider.normalize(result.records[0], '2026-07-19T12:00:00.000Z'),
    ).toMatchObject({
      title: 'Senior Security Engineer',
      postingUrl: 'https://jobs.smartrecruiters.com/FixtureCorp/sec-101',
    });
  });

  it('accepts careers URLs and extracts the company identifier', async () => {
    const provider = new SmartRecruitersProvider();
    const cases: [string, string][] = [
      ['boschgroup', 'boschgroup'],
      ['https://jobs.smartrecruiters.com/boschgroup', 'boschgroup'],
      ['https://jobs.smartrecruiters.com/boschgroup/74400001', 'boschgroup'],
      ['https://careers.smartrecruiters.com/Bosch-Group', 'Bosch-Group'],
      ['https://careers.smartrecruiters.com/Bosch-Group/74400001', 'Bosch-Group'],
    ];
    for (const [input, expected] of cases) {
      await expect(
        provider.validateConfiguration({ companyIdentifier: input }),
      ).resolves.toMatchObject({
        valid: true,
        normalizedConfiguration: { companyIdentifier: expected },
      });
    }
  });

  it('rejects non-SmartRecruiters URLs and bare hostnames', async () => {
    const provider = new SmartRecruitersProvider();
    for (const input of [
      '',
      'https://evil.example.com/boschgroup',
      'http://jobs.smartrecruiters.com/boschgroup',
      'https://jobs.smartrecruiters.com',
      'https://careers.smartrecruiters.com',
    ]) {
      await expect(
        provider.validateConfiguration({ companyIdentifier: input }),
      ).resolves.toMatchObject({ valid: false });
    }
  });

  it('validates a live company and reports its open job count and preview', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', 'false');
    const provider = new SmartRecruitersProvider(
      providerTestClient(() =>
        Promise.resolve(
          response({
            content: [
              smartJob('1', 'Security Engineer'),
              smartJob('2', 'Platform Engineer'),
              smartJob('3', 'Data Engineer'),
            ],
            totalFound: 42,
          }),
        ),
      ),
    );
    const result = await provider.validateConfiguration({
      companyIdentifier: 'acme',
    });
    expect(result).toMatchObject({
      valid: true,
      message: expect.stringContaining('42 open jobs') as string,
      normalizedConfiguration: { companyIdentifier: 'acme' },
      preview: {
        format: 'SmartRecruiters Public API',
        jobCount: 42,
      },
    });
    expect(result.preview?.samples[0]).toMatchObject({
      title: 'Security Engineer',
      company: 'Acme, Inc.',
    });
  });

  it('reports a valid company with no open jobs', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', 'false');
    const provider = new SmartRecruitersProvider(
      providerTestClient(() =>
        Promise.resolve(response({ content: [], totalFound: 0 })),
      ),
    );
    await expect(
      provider.validateConfiguration({ companyIdentifier: 'acme' }),
    ).resolves.toMatchObject({
      valid: true,
      message: expect.stringContaining('no open jobs') as string,
      preview: { jobCount: 0 },
    });
  });

  it('reports an unknown company as not found', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', 'false');
    const provider = new SmartRecruitersProvider(
      providerTestClient(() =>
        Promise.resolve(new Response('Not Found', { status: 404 })),
      ),
    );
    await expect(
      provider.validateConfiguration({ companyIdentifier: 'nope' }),
    ).resolves.toMatchObject({
      valid: false,
      message: expect.stringContaining('was not found') as string,
    });
  });

  it('keeps earlier pages when a later page fails', async () => {
    const calls: URL[] = [];
    const transport = vi.fn<ProviderHttpTransport>((_resolved, url) => {
      calls.push(new URL(url));
      if (url.searchParams.has('limit')) {
        const offset = Number(url.searchParams.get('offset'));
        if (offset === 0) {
          return Promise.resolve(
            response({
              content: [
                smartJob('1', 'target-role Engineer'),
                smartJob('2', 'target-role Analyst'),
                smartJob('3', 'target-role Architect'),
                ...Array.from({ length: 97 }, (_, index) =>
                  smartJob(String(index + 4), `Engineer ${String(index + 4)}`),
                ),
              ],
              totalFound: 150,
            }),
          );
        }
        return Promise.resolve(new Response('unavailable', { status: 503 }));
      }
      const id = url.pathname.split('/').filter(Boolean).pop() ?? '1';
      return Promise.resolve(response(smartJob(id, 'target-role Engineer')));
    });
    const provider = new SmartRecruitersProvider(
      providerTestClient((url, init) => transport({}, url, init)),
    );
    const search = await provider.search(
      { query: 'target-role', location: null, remoteOnly: false, limit: 250 },
      {
        fixtureOnly: false,
        configuration: { companyIdentifier: 'acme' },
      },
    );
    const result = await provider.fetch(search);
    expect(result.records).toHaveLength(3);
    expect(result).toMatchObject({
      complete: false,
      truncated: true,
      unfilteredCount: 100,
    });
    expect(
      calls.some((url) => url.searchParams.get('offset') === '100'),
    ).toBe(true);
  });

  it('fails the run when the first page fails', async () => {
    const provider = new SmartRecruitersProvider(
      providerTestClient(() =>
        Promise.resolve(new Response('boom', { status: 500 })),
      ),
    );
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration: { companyIdentifier: 'acme' },
    });
    await expect(provider.fetch(search)).rejects.toThrow(
      'SmartRecruiters (HTTP 500)',
    );
  });

  it('rejects a malformed first page', async () => {
    const provider = new SmartRecruitersProvider(
      providerTestClient(() => Promise.resolve(response({ jobs: null }))),
    );
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration: { companyIdentifier: 'acme' },
    });
    await expect(provider.fetch(search)).rejects.toThrow(
      'SmartRecruiters response must contain a content array',
    );
  });

  it('paginates across full pages and reports completion', async () => {
    const calls: URL[] = [];
    const provider = new SmartRecruitersProvider(
      providerTestClient((url) => {
        calls.push(new URL(url));
        if (url.searchParams.has('limit')) {
          const offset = Number(url.searchParams.get('offset'));
          return Promise.resolve(
            response({
              content: Array.from({ length: 100 }, (_, index) =>
                smartJob(String(offset + index + 1), `Engineer ${String(offset + index + 1)}`),
              ),
              totalFound: 150,
            }),
          );
        }
        const id = url.pathname.split('/').filter(Boolean).pop() ?? '1';
        return Promise.resolve(response(smartJob(id, `Engineer ${id}`)));
      }),
    );
    const search = await provider.search(
      { query: 'Engineer', location: null, remoteOnly: false, limit: 250 },
      {
        fixtureOnly: false,
        configuration: { companyIdentifier: 'acme' },
      },
    );
    const result = await provider.fetch(search);
    expect(result.records).toHaveLength(100);
    expect(result).toMatchObject({
      complete: true,
      truncated: false,
      unfilteredCount: 200,
    });
    expect(
      calls.some((url) => url.searchParams.get('offset') === '0'),
    ).toBe(true);
    expect(
      calls.some((url) => url.searchParams.get('offset') === '100'),
    ).toBe(true);
  });
});
