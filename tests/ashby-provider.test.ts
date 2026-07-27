import { afterEach, describe, expect, it, vi } from 'vitest';

import { AshbyProvider } from '../src/providers/ashby.provider.js';
import { ProviderFetchError } from '../src/providers/baseProvider.js';
import { providerTestClient } from './provider-test-client.js';

const request = {
  query: 'security',
  location: null,
  remoteOnly: true,
  limit: 10,
} as const;
const configuration = {
  boardName: 'example',
  company: 'Example Ashby Company',
};

afterEach(() => vi.unstubAllGlobals());

describe('AshbyProvider', () => {
  it('strictly validates board names and uses the complete-list endpoint', async () => {
    const provider = new AshbyProvider();
    await expect(
      provider.validateConfiguration(configuration),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      provider.validateConfiguration({ boardName: '../example' }),
    ).resolves.toMatchObject({ valid: false });
    await expect(
      provider.validateConfiguration({ boardName: 'example', unknown: 1 }),
    ).resolves.toMatchObject({ valid: false });
    const search = await provider.search(request, {
      fixtureOnly: true,
      configuration,
    });
    expect(search.target).toContain(
      'https://api.ashbyhq.com/posting-api/job-board/example?includeCompensation=true',
    );
    expect(provider.capabilities.pagination).toBe(false);
  });

  it('filters missing fields and normalizes fixture data', async () => {
    const provider = new AshbyProvider();
    const jobs = await provider.fetch(
      await provider.search(request, { fixtureOnly: true, configuration }),
    );
    expect(jobs.records).toHaveLength(1);
    expect(
      provider.validate(
        provider.normalize(jobs.records[0], '2026-07-18T12:00:00.000Z'),
      ),
    ).toMatchObject({
      title: 'Cloud Security Engineer',
      company: 'Example Ashby Company',
      department: 'Engineering',
      remoteType: 'remote',
      employmentType: 'full-time',
      salaryMinimum: 120000,
      salaryMaximum: 150000,
      postingUrl: 'https://jobs.ashbyhq.com/example/ashby-101/application',
      description: 'Protect production cloud infrastructure.',
    });
  });

  it('rejects malformed responses and wraps transport failures', async () => {
    const responses = vi
      .fn()
      .mockResolvedValueOnce(new Response('not-json'))
      .mockResolvedValueOnce(new Response('denied', { status: 403 }));
    const provider = new AshbyProvider(providerTestClient(responses));
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration,
    });
    await expect(provider.fetch(search)).rejects.toBeInstanceOf(
      ProviderFetchError,
    );
    await expect(provider.fetch(search)).rejects.toThrow('HTTP 403');
  });
});
