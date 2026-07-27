import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderFetchError } from '../src/providers/baseProvider.js';
import { LeverProvider } from '../src/providers/lever.provider.js';
import { providerTestClient } from './provider-test-client.js';

const request = {
  query: 'security',
  location: null,
  remoteOnly: true,
  limit: 10,
} as const;
const configuration = { site: 'example', company: 'Example Lever Company' };

afterEach(() => vi.unstubAllGlobals());

describe('LeverProvider', () => {
  it('strictly validates site slugs', async () => {
    const provider = new LeverProvider();
    await expect(
      provider.validateConfiguration(configuration),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      provider.validateConfiguration({ site: 'https://jobs.lever.co/example' }),
    ).resolves.toMatchObject({ valid: false });
    await expect(provider.validateConfiguration({})).resolves.toMatchObject({
      valid: false,
    });
  });

  it('filters missing fields and normalizes fixture data', async () => {
    const provider = new LeverProvider();
    const jobs = await provider.fetch(
      await provider.search(request, { fixtureOnly: true, configuration }),
    );
    expect(jobs.records).toHaveLength(1);
    expect(
      provider.validate(
        provider.normalize(jobs.records[0], '2026-07-18T12:00:00.000Z'),
      ),
    ).toMatchObject({
      title: 'Security Analyst',
      company: 'Example Lever Company',
      remoteType: 'remote',
      employmentType: 'full-time',
      salaryMinimum: 80000,
      salaryMaximum: 100000,
      postingUrl: 'https://jobs.lever.co/example/lever-101/apply',
    });
  });

  it('uses bounded pagination', async () => {
    const makeJob = (index: number) => ({
      id: String(index),
      text: `Job ${String(index)}`,
      hostedUrl: `https://jobs.lever.co/example/${String(index)}`,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            Array.from({ length: 100 }, (_, index) => makeJob(index)),
          ),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([makeJob(100)]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const provider = new LeverProvider(providerTestClient(fetchMock));
    const jobs = await provider.fetch(
      await provider.search(
        { ...request, query: '', remoteOnly: false, limit: 101 },
        { fixtureOnly: false, configuration },
      ),
    );
    expect(jobs.records).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get('skip'),
    ).toBe('100');
  });

  it('continues upstream pagination when filters reject an early page', async () => {
    const makeJob = (index: number, title: string) => ({
      id: String(index),
      text: title,
      hostedUrl: `https://jobs.lever.co/example/${String(index)}`,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            Array.from({ length: 100 }, (_, index) =>
              makeJob(index, 'Sales role'),
            ),
          ),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([makeJob(100, 'Security Engineer')]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const provider = new LeverProvider(providerTestClient(fetchMock));
    const result = await provider.fetch(
      await provider.search(
        { ...request, remoteOnly: false, limit: 1 },
        { fixtureOnly: false, configuration },
      ),
    );
    expect(result.records).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('wraps HTTP failures', async () => {
    const provider = new LeverProvider(
      providerTestClient(() =>
        Promise.resolve(new Response('unavailable', { status: 503 })),
      ),
    );
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration,
    });
    await expect(provider.fetch(search)).rejects.toBeInstanceOf(
      ProviderFetchError,
    );
  });
});
