import {
  ProviderHttpClient,
  type ProviderHttpTransport,
} from '../src/providers/providerHttpClient.js';

export type ProviderTestFetch = (
  url: URL,
  init: RequestInit & { signal: AbortSignal },
) => Promise<Response>;

export function providerTestClient(
  fetch: ProviderTestFetch,
): ProviderHttpClient {
  const transport: ProviderHttpTransport = (_resolved, url, init) =>
    fetch(url, init);
  return new ProviderHttpClient({
    timeoutMs: 1_000,
    maxRetries: 0,
    resolver: (url) => Promise.resolve({ pinned: url.hostname }),
    transport,
    writeLog: () => undefined,
  });
}
