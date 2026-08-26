import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderFetchError } from '../src/providers/baseProvider.js';
import { GreenhouseProvider } from '../src/providers/greenhouse.provider.js';
import { providerTestClient } from './provider-test-client.js';

const request = {
  query: 'security',
  location: null,
  remoteOnly: true,
  limit: 10,
} as const;
const configuration = { boardToken: 'example', company: 'Example Company' };

afterEach(() => vi.unstubAllGlobals());

describe('GreenhouseProvider', () => {
  it('strictly validates configuration and builds the official endpoint', async () => {
    const provider = new GreenhouseProvider();
    await expect(
      provider.validateConfiguration(configuration),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      provider.validateConfiguration({ boardToken: 'bad/token' }),
    ).resolves.toMatchObject({ valid: false });
    await expect(
      provider.validateConfiguration({ boardToken: 'example', extra: true }),
    ).resolves.toMatchObject({ valid: false });
    const search = await provider.search(request, {
      fixtureOnly: true,
      configuration,
    });
    expect(search.target).toContain(
      'https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true',
    );
  });

  it('filters missing fields and normalizes fixture data', async () => {
    const provider = new GreenhouseProvider();
    const search = await provider.search(request, {
      fixtureOnly: true,
      configuration,
    });
    const jobs = await provider.fetch(search);
    expect(jobs.records).toHaveLength(1);
    expect(
      provider.validate(
        provider.normalize(jobs.records[0], '2026-07-18T12:00:00.000Z'),
      ),
    ).toMatchObject({
      externalId: '101',
      title: 'Security Engineer',
      company: 'Example Company',
      remoteType: 'remote',
      employmentType: 'full-time',
      postingUrl: 'https://boards.greenhouse.io/example/jobs/101',
      description: 'Build and operate cloud security controls.',
      datePosted: '2026-07-17T18:00:00.000Z',
    });
  });

  it('reports invalid payloads and request failures', async () => {
    const responses = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{}', {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockRejectedValueOnce(new Error('offline'));
    const provider = new GreenhouseProvider(providerTestClient(responses));
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration,
    });
    await expect(provider.fetch(search)).rejects.toThrow('jobs array');
    await expect(provider.fetch(search)).rejects.toBeInstanceOf(
      ProviderFetchError,
    );
  });

  it('uses a larger but bounded limit for full-board responses', async () => {
    type HttpRequest = (
      url: URL,
      options: { maxResponseBytes?: number },
    ) => Promise<{ status: number; json: () => unknown }>;
    const httpRequest = vi.fn<HttpRequest>().mockResolvedValue({
      status: 200,
      json: () => ({ jobs: [] }),
    });
    const provider = new GreenhouseProvider({ request: httpRequest } as never);
    const search = await provider.search(request, {
      fixtureOnly: false,
      configuration,
    });

    await provider.fetch(search);

    expect(httpRequest).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        maxResponseBytes: expect.any(Number) as unknown as number,
      }),
    );
    const callArgs = httpRequest.mock.calls[0] as
      | [URL, { maxResponseBytes?: number }]
      | undefined;
    expect(callArgs?.[1].maxResponseBytes).toBeGreaterThan(5 * 1024 * 1024);
  });
});
