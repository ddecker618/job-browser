import { describe, expect, it, vi } from 'vitest';

import {
  boundedPublicFetch,
  type PublicFetchResolver,
  type PublicFetchTransport,
} from '../src/security/boundedPublicFetch.js';
import { validatePublicUrl } from '../src/security/publicUrlPolicy.js';

const encoder = new TextEncoder();

const resolver: PublicFetchResolver = (value) =>
  Promise.resolve({
    url: validatePublicUrl(value),
    addresses: [{ address: '8.8.8.8', family: 4 }],
  });

function body(...chunks: string[]): AsyncIterable<Uint8Array> {
  const encoded = chunks.map((chunk) => encoder.encode(chunk));
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next: () =>
          Promise.resolve(
            index < encoded.length
              ? { done: false as const, value: encoded[index++]! }
              : { done: true as const, value: undefined },
          ),
      };
    },
  };
}

describe('boundedPublicFetch', () => {
  it('follows at most three redirects and revalidates each location', async () => {
    const resolve = vi.fn(resolver);
    const transport: PublicFetchTransport = (target) => {
      const step = Number(target.url.searchParams.get('step') ?? '0');
      return Promise.resolve(
        step < 3
          ? {
              status: 302,
              headers: { location: `?step=${String(step + 1)}` },
              body: body(),
            }
          : { status: 200, headers: {}, body: body('ok') },
      );
    };
    const response = await boundedPublicFetch(
      'https://example.com/feed?step=0',
      {
        resolve,
        transport,
      },
    );
    expect(response.text()).toBe('ok');
    expect(resolve).toHaveBeenCalledTimes(4);

    const alwaysRedirect: PublicFetchTransport = () =>
      Promise.resolve({
        status: 302,
        headers: { location: '/again' },
        body: body(),
      });
    await expect(
      boundedPublicFetch('https://example.com/feed', {
        resolve: resolver,
        transport: alwaysRedirect,
      }),
    ).rejects.toThrow('redirect limit');
  });

  it('blocks a redirect to a private target before transport', async () => {
    const transport = vi.fn<PublicFetchTransport>(() =>
      Promise.resolve({
        status: 302,
        headers: { location: 'http://127.0.0.1/admin' },
        body: body(),
      }),
    );
    await expect(
      boundedPublicFetch('https://example.com/feed', {
        resolve: resolver,
        transport,
      }),
    ).rejects.toThrow('validation failed');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('enforces declared and streaming response size limits', async () => {
    const declared: PublicFetchTransport = () =>
      Promise.resolve({
        status: 200,
        headers: { 'content-length': '6' },
        body: body('ignored'),
      });
    await expect(
      boundedPublicFetch('https://example.com/feed', {
        maxBytes: 5,
        resolve: resolver,
        transport: declared,
      }),
    ).rejects.toThrow('size limit');

    const streamed: PublicFetchTransport = () =>
      Promise.resolve({
        status: 200,
        headers: {},
        body: body('123', '456'),
      });
    await expect(
      boundedPublicFetch('https://example.com/feed', {
        maxBytes: 5,
        resolve: resolver,
        transport: streamed,
      }),
    ).rejects.toThrow('size limit');
  });

  it('times out stalled operations and does not expose low-level errors', async () => {
    const stalled: PublicFetchTransport = () => new Promise(() => undefined);
    await expect(
      boundedPublicFetch('https://example.com/feed', {
        timeoutMs: 5,
        resolve: resolver,
        transport: stalled,
      }),
    ).rejects.toThrow('timed out');

    const failing: PublicFetchTransport = () =>
      Promise.reject(
        new Error('connect ECONNREFUSED secret.internal:8443 token=private'),
      );
    const error = await boundedPublicFetch('https://example.com/feed', {
      resolve: resolver,
      transport: failing,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Public request failed');
    expect((error as Error).message).not.toContain('secret.internal');
  });
});
