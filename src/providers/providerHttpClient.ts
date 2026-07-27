import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

import { log, type LogWriter } from '../logging/logger.js';
import {
  resolvePublicUrl,
  type ResolvedPublicUrl,
} from '../security/publicUrlPolicy.js';
import { ProviderFetchError } from './baseProvider.js';

const RETRYABLE = new Set([429, 502, 503, 504]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const DEFAULT_CONTENT_TYPES = [
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/atom+xml',
  'application/rss+xml',
  'text/xml',
  'text/html',
];

export interface ProviderHttpResponse {
  url: string;
  status: number;
  headers: Headers;
  body: Uint8Array;
  text(): string;
  json(): unknown;
}

export interface ProviderHttpRequest {
  provider: string;
  method?: 'GET' | 'POST';
  headers?: Readonly<Record<string, string>>;
  body?: string;
  signal?: AbortSignal | undefined;
  contentTypes?: readonly string[];
}

export type ProviderHttpResolver = (
  url: URL,
  signal: AbortSignal,
) => Promise<unknown>;
export type ProviderHttpTransport = (
  resolved: unknown,
  url: URL,
  init: RequestInit & { signal: AbortSignal },
) => Promise<Response>;

export interface ProviderHttpClientOptions {
  timeoutMs: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  maxRetries?: number;
  maxRetryAfterMs?: number;
  globalConcurrency?: number;
  perOriginConcurrency?: number;
  contentTypes?: readonly string[];
  transport?: ProviderHttpTransport;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  resolver?: ProviderHttpResolver;
  writeLog?: LogWriter;
}

class Limiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  public constructor(private readonly maximum: number) {}

  public async acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw abortError(signal);
    if (this.active >= this.maximum) {
      await new Promise<void>((resolve, reject) => {
        const ready = (): void => {
          signal.removeEventListener('abort', aborted);
          resolve();
        };
        const aborted = (): void => {
          const index = this.waiting.indexOf(ready);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(abortError(signal));
        };
        this.waiting.push(ready);
        signal.addEventListener('abort', aborted, { once: true });
      });
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}

const sharedGlobalLimiter = new Limiter(6);
const sharedOriginLimiters = new Map<string, Limiter>();

export class ProviderHttpClient {
  private readonly globalLimiter: Limiter;
  private readonly originLimiters = new Map<string, Limiter>();
  private readonly usesSharedConcurrency: boolean;
  private readonly options: Required<
    Pick<
      ProviderHttpClientOptions,
      | 'maxResponseBytes'
      | 'maxRedirects'
      | 'maxRetries'
      | 'maxRetryAfterMs'
      | 'perOriginConcurrency'
    >
  > &
    ProviderHttpClientOptions;

  public constructor(options: ProviderHttpClientOptions) {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
      throw new Error('Provider HTTP timeout must be positive');
    this.options = {
      maxResponseBytes: 5 * 1024 * 1024,
      maxRedirects: 3,
      maxRetries: 2,
      maxRetryAfterMs: 5_000,
      perOriginConcurrency: 2,
      ...options,
    };
    for (const [name, value] of [
      ['maxResponseBytes', this.options.maxResponseBytes],
      ['globalConcurrency', options.globalConcurrency ?? 6],
      ['perOriginConcurrency', this.options.perOriginConcurrency],
    ] as const) {
      if (!Number.isInteger(value) || value <= 0)
        throw new Error(`Provider HTTP ${name} must be a positive integer`);
    }
    this.usesSharedConcurrency =
      options.globalConcurrency === undefined &&
      options.perOriginConcurrency === undefined;
    this.globalLimiter = this.usesSharedConcurrency
      ? sharedGlobalLimiter
      : new Limiter(options.globalConcurrency ?? 6);
  }

  public async request(
    input: string | URL,
    request: ProviderHttpRequest,
  ): Promise<ProviderHttpResponse> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const signal =
      request.signal === undefined
        ? timeout
        : AbortSignal.any([request.signal, timeout]);
    const initial = new URL(input);
    let releaseGlobal: (() => void) | undefined;
    try {
      releaseGlobal = await this.globalLimiter.acquire(signal);
      return await this.execute(initial, request, signal);
    } catch (error) {
      if (error instanceof ProviderFetchError) throw error;
      if (request.signal?.aborted === true)
        throw new ProviderFetchError(
          `${request.provider} request was cancelled`,
        );
      if (signal.aborted)
        throw new ProviderFetchError(`${request.provider} request timed out`);
      throw new ProviderFetchError(`${request.provider} request failed`);
    } finally {
      releaseGlobal?.();
    }
  }

  private async execute(
    initial: URL,
    request: ProviderHttpRequest,
    signal: AbortSignal,
  ): Promise<ProviderHttpResponse> {
    let url = initial;
    let redirects = 0;
    let retry = 0;
    for (;;) {
      const releaseOrigin = await this.getOriginLimiter(url.origin).acquire(
        signal,
      );
      try {
        const response = await this.send(url, request, signal);
        if (REDIRECTS.has(response.status)) {
          await response.body?.cancel();
          if (redirects >= this.options.maxRedirects)
            throw new ProviderFetchError(
              `${request.provider} request exceeded redirect limit`,
            );
          const location = response.headers.get('location');
          if (location === null)
            throw new ProviderFetchError(
              `${request.provider} returned an invalid redirect`,
            );
          try {
            url = new URL(location, url);
          } catch {
            throw new ProviderFetchError(
              `${request.provider} returned an invalid redirect`,
            );
          }
          redirects += 1;
          continue;
        }
        if (RETRYABLE.has(response.status) && retry < this.options.maxRetries) {
          await response.body?.cancel();
          const delay = retryDelay(
            response.headers.get('retry-after'),
            retry,
            this.options.maxRetryAfterMs,
          );
          this.writeLog('warn', 'Provider HTTP request retrying', {
            provider: request.provider,
            origin: url.origin,
            path: url.pathname,
            status: response.status,
            retry: retry + 1,
            delayMs: delay,
          });
          await (this.options.sleep ?? defaultSleep)(delay, signal);
          retry += 1;
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          const suffix = response.status === 429 ? ' rate limited' : '';
          throw new ProviderFetchError(
            `${request.provider}${suffix} (HTTP ${String(response.status)})`,
          );
        }
        const allowed =
          request.contentTypes ??
          this.options.contentTypes ??
          DEFAULT_CONTENT_TYPES;
        const contentType = response.headers
          .get('content-type')
          ?.split(';')[0]
          ?.trim()
          .toLowerCase();
        if (
          contentType === undefined ||
          !allowed.some((value) => value.toLowerCase() === contentType)
        ) {
          throw new ProviderFetchError(
            `${request.provider} returned an unsupported content type`,
          );
        }
        const body = await readBoundedBody(
          response,
          this.options.maxResponseBytes,
          request.provider,
          signal,
        );
        this.writeLog('debug', 'Provider HTTP request completed', {
          provider: request.provider,
          origin: url.origin,
          path: url.pathname,
          status: response.status,
          responseBytes: body.byteLength,
          retries: retry,
          redirects,
        });
        return makeResponse(
          url,
          response.status,
          response.headers,
          body,
          request.provider,
        );
      } finally {
        releaseOrigin();
      }
    }
  }

  private async send(
    url: URL,
    request: ProviderHttpRequest,
    signal: AbortSignal,
  ): Promise<Response> {
    const resolved = await withAbort(
      (this.options.resolver ?? defaultResolver)(url, signal),
      signal,
    );
    return withAbort(
      (this.options.transport ?? fetchTransport)(resolved, url, {
        method: request.method ?? 'GET',
        ...(request.headers === undefined ? {} : { headers: request.headers }),
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: 'manual',
        signal,
      }),
      signal,
    );
  }

  private getOriginLimiter(origin: string): Limiter {
    const map = this.usesSharedConcurrency
      ? sharedOriginLimiters
      : this.originLimiters;
    let limiter = map.get(origin);
    if (limiter === undefined) {
      limiter = new Limiter(this.options.perOriginConcurrency);
      map.set(origin, limiter);
    }
    return limiter;
  }

  private writeLog(...parameters: Parameters<LogWriter>): void {
    (this.options.writeLog ?? log)(...parameters);
  }
}

function defaultResolver(url: URL): Promise<ResolvedPublicUrl> {
  return resolvePublicUrl(url);
}

function fetchTransport(
  resolved: unknown,
  url: URL,
  init: RequestInit,
): Promise<Response> {
  const target = resolved as ResolvedPublicUrl;
  const address = target.addresses[0];
  if (address === undefined)
    return Promise.reject(new Error('No resolved address'));
  return new Promise((resolve, reject) => {
    const headers = new Headers(init.headers);
    headers.set('Host', url.host);
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      {
        protocol: url.protocol,
        hostname: address.address,
        port: url.port || undefined,
        method: init.method ?? 'GET',
        path: `${url.pathname}${url.search}`,
        servername: url.protocol === 'https:' ? url.hostname : undefined,
        headers: Object.fromEntries(headers.entries()),
        signal: init.signal ?? undefined,
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined)
            responseHeaders.set(
              name,
              Array.isArray(value) ? value.join(', ') : value,
            );
        }
        resolve(
          new Response(Readable.toWeb(incoming) as ReadableStream, {
            status: incoming.statusCode ?? 0,
            headers: responseHeaders,
          }),
        );
      },
    );
    request.on('error', reject);
    if (typeof init.body === 'string' || init.body instanceof Uint8Array)
      request.write(init.body);
    request.end();
  });
}

async function readBoundedBody(
  response: Response,
  maximum: number,
  provider: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum)
    throw new ProviderFetchError(`${provider} response exceeded size limit`);
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await withAbort(reader.read(), signal);
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximum)
        throw new ProviderFetchError(
          `${provider} response exceeded size limit`,
        );
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function makeResponse(
  url: URL,
  status: number,
  headers: Headers,
  body: Uint8Array,
  provider: string,
): ProviderHttpResponse {
  return {
    url: url.toString(),
    status,
    headers,
    body,
    text: () => new TextDecoder().decode(body),
    json: () => {
      try {
        return JSON.parse(new TextDecoder().decode(body)) as unknown;
      } catch {
        throw new ProviderFetchError(`${provider} returned invalid JSON`);
      }
    },
  };
}

function retryDelay(value: string | null, retry: number, cap: number): number {
  if (value !== null) {
    const seconds = Number(value);
    const dateDelay = Date.parse(value) - Date.now();
    const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : dateDelay;
    if (Number.isFinite(milliseconds))
      return Math.max(0, Math.min(cap, milliseconds));
  }
  return Math.min(cap, 250 * 2 ** retry);
}

function defaultSleep(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError(signal));
      },
      { once: true },
    );
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Request aborted');
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(abortError(signal));
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error instanceof Error ? error : new Error('Request failed'));
      },
    );
  });
}

export const providerHttpClient = new ProviderHttpClient({ timeoutMs: 15_000 });
