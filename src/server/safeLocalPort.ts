import type { AddressInfo } from 'node:net';

/** Fetch/Chromium ports that cannot be used by browser fetch requests. */
const FETCH_BLOCKED_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77,
  79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135,
  137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531,
  532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720,
  1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6697, 10080,
]);

export const DEFAULT_SAFE_LOCAL_PORT_ATTEMPTS = 8;

export interface SafeLocalServer {
  address(): AddressInfo | string | null;
  close(callback: (error?: Error) => void): void;
}

export type LocalServerListener<T extends SafeLocalServer> = (
  port: number,
  host: string,
) => Promise<T>;

export function isFetchBlockedPort(port: number): boolean {
  return FETCH_BLOCKED_PORTS.has(port);
}

/**
 * Binds on the requested host, replacing only an ephemeral port allocation
 * that Fetch/Chromium would reject. Rejected listeners are fully closed before
 * the next allocation is attempted.
 */
export async function listenOnSafeLocalPort<T extends SafeLocalServer>(
  host: string,
  requestedPort: number,
  listen: LocalServerListener<T>,
  maxAttempts = DEFAULT_SAFE_LOCAL_PORT_ATTEMPTS,
): Promise<T> {
  if (
    !Number.isInteger(requestedPort) ||
    requestedPort < 0 ||
    requestedPort > 65_535
  ) {
    throw new RangeError(
      'Local server port must be an integer from 0 to 65535.',
    );
  }
  if (requestedPort !== 0) {
    if (isFetchBlockedPort(requestedPort)) {
      throw new Error(
        `Port ${String(requestedPort)} is blocked by Fetch and cannot host the local API server.`,
      );
    }
    return listen(requestedPort, host);
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(
      'Safe local port attempts must be a positive integer.',
    );
  }

  let lastBlockedPort: number | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const server = await listen(0, host);
    const address = server.address();
    if (address === null || typeof address === 'string') {
      await closeListener(server);
      throw new Error('Local API server did not bind a TCP port.');
    }
    if (!isFetchBlockedPort(address.port)) return server;

    lastBlockedPort = address.port;
    await closeListener(server);
  }

  throw new Error(
    `Unable to allocate a Fetch-compatible local port after ${String(maxAttempts)} attempts${lastBlockedPort === null ? '' : `; the last assigned port ${String(lastBlockedPort)} is blocked`}.`,
  );
}

function closeListener(server: SafeLocalServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
