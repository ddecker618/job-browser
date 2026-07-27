import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { resolvePublicUrl, type ResolvedPublicUrl } from './publicUrlPolicy.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface PublicFetchResponse {
  url: string;
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: Uint8Array;
  text(): string;
}

export interface PublicTransportResponse {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: AsyncIterable<Uint8Array>;
}

export type PublicFetchResolver = (
  value: string | URL,
) => Promise<ResolvedPublicUrl>;
export type PublicFetchTransport = (
  target: ResolvedPublicUrl,
  signal: AbortSignal,
) => Promise<PublicTransportResponse>;

export interface BoundedPublicFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  resolve?: PublicFetchResolver;
  transport?: PublicFetchTransport;
}

export class BoundedPublicFetchError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'BoundedPublicFetchError';
  }
}

export async function boundedPublicFetch(
  input: string | URL,
  options: BoundedPublicFetchOptions = {},
): Promise<PublicFetchResponse> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 3;
  const resolve = options.resolve ?? resolvePublicUrl;
  const transport = options.transport ?? nodeTransport;
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal =
    options.signal === undefined
      ? timeoutController.signal
      : AbortSignal.any([timeoutController.signal, options.signal]);

  try {
    let current: string | URL = input;
    for (let redirects = 0; ; redirects += 1) {
      let target: ResolvedPublicUrl;
      try {
        target = await abortable(resolve(current), signal);
      } catch {
        if (signal.aborted)
          throw new BoundedPublicFetchError('Public request timed out');
        throw new BoundedPublicFetchError('Public URL validation failed');
      }
      let response: PublicTransportResponse;
      try {
        response = await abortable(transport(target, signal), signal);
      } catch {
        if (signal.aborted)
          throw new BoundedPublicFetchError('Public request timed out');
        throw new BoundedPublicFetchError('Public request failed');
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers['location'];
        if (location === undefined) {
          throw new BoundedPublicFetchError(
            'Redirect response has no location',
          );
        }
        if (redirects >= maxRedirects) {
          throw new BoundedPublicFetchError(
            'Public request exceeded redirect limit',
          );
        }
        try {
          current = new URL(location, target.url);
        } catch {
          throw new BoundedPublicFetchError('Redirect location is invalid');
        }
        await response.body[Symbol.asyncIterator]().return?.();
        continue;
      }

      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        await response.body[Symbol.asyncIterator]().return?.();
        throw new BoundedPublicFetchError(
          'Public response exceeded size limit',
        );
      }
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        const iterator = response.body[Symbol.asyncIterator]();
        for (;;) {
          const next = await abortable(iterator.next(), signal);
          if (next.done === true) break;
          const chunk = next.value;
          length += chunk.byteLength;
          if (length > maxBytes) {
            await iterator.return?.();
            throw new BoundedPublicFetchError(
              'Public response exceeded size limit',
            );
          }
          chunks.push(chunk);
        }
      } catch (error) {
        if (error instanceof BoundedPublicFetchError) throw error;
        if (signal.aborted)
          throw new BoundedPublicFetchError('Public request timed out');
        throw new BoundedPublicFetchError('Public response could not be read');
      }
      const body = Buffer.concat(chunks, length);
      return {
        url: target.url.toString(),
        status: response.status,
        headers: response.headers,
        body,
        text: () => body.toString('utf8'),
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Request aborted'));
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new Error('Request aborted'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error instanceof Error ? error : new Error('Operation failed'));
      },
    );
  });
}

function nodeTransport(
  target: ResolvedPublicUrl,
  signal: AbortSignal,
): Promise<PublicTransportResponse> {
  return new Promise((resolve, reject) => {
    const address = target.addresses[0];
    if (address === undefined) {
      reject(new Error('No resolved address'));
      return;
    }
    const request = (
      target.url.protocol === 'https:' ? httpsRequest : httpRequest
    )(
      {
        protocol: target.url.protocol,
        hostname: address.address,
        port: target.url.port || undefined,
        method: 'GET',
        path: `${target.url.pathname}${target.url.search}`,
        servername:
          target.url.protocol === 'https:' ? target.url.hostname : undefined,
        headers: {
          Accept:
            'application/ld+json, application/json, application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.9',
          Host: target.url.host,
          'User-Agent': 'job-browser/1.0 (structured public source)',
        },
        signal,
      },
      (response) => {
        const headers: Record<string, string | undefined> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          headers[name] = Array.isArray(value) ? value.join(', ') : value;
        }
        resolve({
          status: response.statusCode ?? 0,
          headers,
          body: response,
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}
