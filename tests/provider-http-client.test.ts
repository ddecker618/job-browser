import { describe, expect, it, vi } from 'vitest';

import { ProviderFetchError } from '../src/providers/baseProvider.js';
import {
  ProviderHttpClient,
  type ProviderHttpResolver,
  type ProviderHttpTransport,
} from '../src/providers/providerHttpClient.js';

const jsonHeaders = { 'Content-Type': 'application/json' };
const silentLog = vi.fn();

describe('ProviderHttpClient', () => {
  it('requires a positive timeout and composes caller cancellation', async () => {
    expect(() => new ProviderHttpClient({ timeoutMs: 0 })).toThrow('timeout');
    const controller = new AbortController();
    const transport: ProviderHttpTransport = (_target, _url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new Error('secret')),
        );
      });
    const client = createClient({ transport });
    const pending = client.request('https://example.test/jobs', {
      provider: 'Example',
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow('request was cancelled');
  });

  it('caps Retry-After and retries only bounded transient statuses', async () => {
    const delays: number[] = [];
    const transport = vi
      .fn<ProviderHttpTransport>()
      .mockResolvedValueOnce(
        new Response('busy secret body', {
          status: 503,
          headers: { 'Retry-After': '60' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: jsonHeaders }),
      );
    const client = createClient({
      transport,
      maxRetryAfterMs: 1_000,
      sleep: (delay) => {
        delays.push(delay);
        return Promise.resolve();
      },
    });
    await expect(
      client.request('https://example.test/jobs', { provider: 'Example' }),
    ).resolves.toMatchObject({ status: 200 });
    expect(delays).toEqual([1_000]);
    expect(transport).toHaveBeenCalledTimes(2);

    const noRetry = vi
      .fn<ProviderHttpTransport>()
      .mockResolvedValue(new Response('private', { status: 500 }));
    const error = await createClient({ transport: noRetry })
      .request('https://example.test/jobs', { provider: 'Example' })
      .catch((caught: unknown) => caught);
    expect(noRetry).toHaveBeenCalledOnce();
    expect(error).toBeInstanceOf(ProviderFetchError);
    expect(JSON.stringify(error)).not.toContain('private');
  });

  it('bounds redirects, response bytes, and allowed content types', async () => {
    const redirect: ProviderHttpTransport = () =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { Location: '/again' } }),
      );
    await expect(
      createClient({ transport: redirect, maxRedirects: 1 }).request(
        'https://example.test/jobs',
        { provider: 'Example' },
      ),
    ).rejects.toThrow('redirect limit');

    const oversized: ProviderHttpTransport = () =>
      Promise.resolve(
        new Response('123456', {
          headers: { ...jsonHeaders, 'Content-Length': '6' },
        }),
      );
    await expect(
      createClient({ transport: oversized, maxResponseBytes: 5 }).request(
        'https://example.test/jobs',
        { provider: 'Example' },
      ),
    ).rejects.toThrow('size limit');

    const text: ProviderHttpTransport = () =>
      Promise.resolve(
        new Response('{}', { headers: { 'Content-Type': 'text/plain' } }),
      );
    await expect(
      createClient({ transport: text }).request('https://example.test/jobs', {
        provider: 'Example',
      }),
    ).rejects.toThrow('content type');
  });

  it('injects the resolver and never logs query strings or headers', async () => {
    const resolve = vi.fn((url: URL) => Promise.resolve({ pinned: url.host }));
    const transport = vi.fn<ProviderHttpTransport>(() =>
      Promise.resolve(new Response('{}', { headers: jsonHeaders })),
    );
    const writeLog = vi.fn();
    const client = createClient({ resolver: resolve, transport, writeLog });
    await client.request('https://example.test/jobs?apiKey=private', {
      provider: 'Example',
      headers: { Authorization: 'secret' },
    });
    expect(resolve).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[0]).toEqual({ pinned: 'example.test' });
    const logged = JSON.stringify(writeLog.mock.calls);
    expect(logged).not.toContain('private');
    expect(logged).not.toContain('secret');
  });

  it('validates every redirect target and preserves POST headers and bodies', async () => {
    const resolver = vi.fn<ProviderHttpResolver>((url) => {
      if (url.hostname === '127.0.0.1')
        return Promise.reject(new Error('non-public'));
      return Promise.resolve({ pinned: url.hostname });
    });
    const transport = vi.fn<ProviderHttpTransport>().mockResolvedValueOnce(
      new Response(null, {
        status: 307,
        headers: { Location: 'http://127.0.0.1/private' },
      }),
    );
    const client = createClient({ resolver, transport });
    await expect(
      client.request('https://workday.example/jobs', {
        provider: 'Workday',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Test': 'present' },
        body: '{"searchText":"security"}',
      }),
    ).rejects.toThrow('request failed');
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[2]).toMatchObject({
      method: 'POST',
      body: '{"searchText":"security"}',
      headers: { 'Content-Type': 'application/json', 'X-Test': 'present' },
      redirect: 'manual',
    });
  });

  it('rejects a private initial URL with the production resolver', async () => {
    const transport = vi.fn<ProviderHttpTransport>();
    await expect(
      new ProviderHttpClient({ timeoutMs: 1_000, transport }).request(
        'http://169.254.169.254/latest/meta-data',
        { provider: 'Example' },
      ),
    ).rejects.toThrow('request failed');
    expect(transport).not.toHaveBeenCalled();
  });

  it('enforces configurable per-origin concurrency', async () => {
    let active = 0;
    let maximum = 0;
    const releases: (() => void)[] = [];
    const transport: ProviderHttpTransport = async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return new Response('{}', { headers: jsonHeaders });
    };
    const client = createClient({
      transport,
      globalConcurrency: 2,
      perOriginConcurrency: 1,
    });
    const first = client.request('https://example.test/one', {
      provider: 'Example',
    });
    const second = client.request('https://example.test/two', {
      provider: 'Example',
    });
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await Promise.all([first, second]);
    expect(maximum).toBe(1);
  });

  it('limits the actual redirect origin rather than the initial origins', async () => {
    let targetActive = 0;
    let targetMaximum = 0;
    const releases: (() => void)[] = [];
    const transport: ProviderHttpTransport = async (_resolved, url) => {
      if (url.hostname !== 'shared.example')
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://shared.example/jobs' },
        });
      targetActive += 1;
      targetMaximum = Math.max(targetMaximum, targetActive);
      await new Promise<void>((resolve) => releases.push(resolve));
      targetActive -= 1;
      return new Response('{}', { headers: jsonHeaders });
    };
    const client = createClient({
      transport,
      globalConcurrency: 2,
      perOriginConcurrency: 1,
    });
    const first = client.request('https://one.example/jobs', {
      provider: 'Example',
    });
    const second = client.request('https://two.example/jobs', {
      provider: 'Example',
    });
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await Promise.all([first, second]);
    expect(targetMaximum).toBe(1);
  });
});

function createClient(
  options: Partial<ConstructorParameters<typeof ProviderHttpClient>[0]>,
): ProviderHttpClient {
  return new ProviderHttpClient({
    timeoutMs: 1_000,
    maxRetries: 2,
    writeLog: silentLog,
    resolver: (url) => Promise.resolve({ pinned: url.hostname }),
    ...options,
  });
}
