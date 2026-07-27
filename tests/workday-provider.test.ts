import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderFetchError } from '../src/providers/baseProvider.js';
import { WorkdayProvider } from '../src/providers/workday.provider.js';
import { providerTestClient } from './provider-test-client.js';

const request = {
  query: 'security',
  location: null,
  remoteOnly: true,
  limit: 10,
} as const;
const configuration = {
  origin: 'https://example.wd1.myworkdayjobs.com',
  tenant: 'example',
  site: 'careers',
  company: 'Example Workday Company',
};

afterEach(() => vi.unstubAllGlobals());

describe('WorkdayProvider', () => {
  it('only accepts official Workday origins and strict slugs', async () => {
    const provider = new WorkdayProvider();
    await expect(
      provider.validateConfiguration(configuration),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      provider.validateConfiguration({
        ...configuration,
        origin: 'https://example.com',
      }),
    ).resolves.toMatchObject({ valid: false });
    await expect(
      provider.validateConfiguration({ ...configuration, site: '../careers' }),
    ).resolves.toMatchObject({ valid: false });
  });

  it('filters missing fields and creates official detail URLs', async () => {
    const provider = new WorkdayProvider();
    const jobs = await provider.fetch(
      await provider.search(request, { fixtureOnly: true, configuration }),
    );
    expect(jobs.records).toHaveLength(1);
    expect(
      provider.validate(
        provider.normalize(jobs.records[0], '2026-07-18T12:00:00.000Z'),
      ),
    ).toMatchObject({
      externalId: 'R101',
      title: 'Information Security Engineer',
      company: 'Example Workday Company',
      remoteType: 'remote',
      employmentType: 'full-time',
      postingUrl:
        'https://example.wd1.myworkdayjobs.com/en-US/careers/job/Remote/Information-Security-Engineer_R101',
    });
  });

  it('posts bounded CXS pages', async () => {
    const makeJob = (index: number) => ({
      title: `Job ${String(index)}`,
      externalPath: `/en-US/careers/job/job-${String(index)}`,
      jobId: `R${String(index)}`,
    });
    let listPage = 0;
    const fetchMock = vi.fn((_url: URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const payload =
          listPage++ === 0
            ? {
                total: 21,
                jobPostings: Array.from({ length: 20 }, (_, index) =>
                  makeJob(index),
                ),
              }
            : { total: 21, jobPostings: [makeJob(20)] };
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jobPostingInfo: {
              jobDescription: 'Salary range: $90,000 - $120,000 annually',
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });
    const provider = new WorkdayProvider(providerTestClient(fetchMock));
    const jobs = await provider.fetch(
      await provider.search(
        { ...request, query: '', remoteOnly: false, limit: 21 },
        { fixtureOnly: false, configuration },
      ),
    );
    expect(jobs.records).toHaveLength(21);
    const postCalls = fetchMock.mock.calls.filter(
      (call) => call[1]?.method === 'POST',
    );
    expect(postCalls).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(23);
    expect(jobs.records[0]).toMatchObject({
      salaryMinimum: 90000,
      salaryMaximum: 120000,
    });
    const secondOptions = postCalls[1]?.[1];
    if (typeof secondOptions?.body !== 'string')
      throw new Error('Expected a JSON request body');
    expect(JSON.parse(secondOptions.body)).toMatchObject({
      limit: 20,
      offset: 20,
      searchText: '',
    });
    expect(postCalls[0]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('wraps CXS failures', async () => {
    const provider = new WorkdayProvider(
      providerTestClient(() => Promise.reject(new Error('timeout'))),
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
