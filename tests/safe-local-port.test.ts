import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

import {
  isFetchBlockedPort,
  listenOnSafeLocalPort,
  type SafeLocalServer,
} from '../src/server/safeLocalPort.js';

interface FakeServer extends SafeLocalServer {
  port: number;
  closed: boolean;
  closeCalls: number;
}

function fakeServer(port: number): FakeServer {
  return {
    port,
    closed: false,
    closeCalls: 0,
    address: () =>
      ({ address: '127.0.0.1', family: 'IPv4', port }) as AddressInfo,
    close(callback) {
      this.closed = true;
      this.closeCalls += 1;
      callback();
    },
  };
}

describe('safe local server ports', () => {
  it.each([0, 1, 7, 53, 161, 1720, 6667, 10080])(
    'classifies Fetch-blocked port %i',
    (port) => {
      expect(isFetchBlockedPort(port)).toBe(true);
    },
  );

  it.each([80, 3000, 6783, 45_000, 65_535])(
    'allows Fetch-compatible port %i',
    (port) => {
      expect(isFetchBlockedPort(port)).toBe(false);
    },
  );

  it('closes a prohibited ephemeral allocation before retrying on the requested host', async () => {
    const servers: FakeServer[] = [];
    const allocations = [1720, 34_567];
    const listen = vi.fn((port: number, host: string) => {
      expect(port).toBe(0);
      expect(host).toBe('127.0.0.1');
      if (servers.length > 0) expect(servers[0]?.closed).toBe(true);
      const server = fakeServer(allocations[servers.length] ?? 34_568);
      servers.push(server);
      return Promise.resolve(server);
    });

    const result = await listenOnSafeLocalPort('127.0.0.1', 0, listen, 3);

    expect(result.port).toBe(34_567);
    expect(servers).toHaveLength(2);
    expect(servers[0]?.closeCalls).toBe(1);
    expect(servers[1]?.closed).toBe(false);
    expect(listen).toHaveBeenCalledTimes(2);
  });

  it('fails after a bounded number of prohibited ephemeral allocations', async () => {
    const servers: FakeServer[] = [];
    const listen = vi.fn(() => {
      const server = fakeServer(1720);
      servers.push(server);
      return Promise.resolve(server);
    });

    await expect(
      listenOnSafeLocalPort('127.0.0.1', 0, listen, 3),
    ).rejects.toThrow(/after 3 attempts.*1720 is blocked/);
    expect(listen).toHaveBeenCalledTimes(3);
    expect(
      servers.every((server) => server.closed && server.closeCalls === 1),
    ).toBe(true);
  });

  it('rejects an explicitly requested blocked port without changing it', async () => {
    const listen = vi.fn((port: number) => Promise.resolve(fakeServer(port)));

    await expect(
      listenOnSafeLocalPort('127.0.0.1', 1720, listen),
    ).rejects.toThrow(/Port 1720 is blocked by Fetch/);
    expect(listen).not.toHaveBeenCalled();
  });

  it('preserves an explicitly requested allowed port', async () => {
    const listen = vi.fn((port: number) => Promise.resolve(fakeServer(port)));

    const result = await listenOnSafeLocalPort('127.0.0.1', 6783, listen);

    expect(result.port).toBe(6783);
    expect(listen).toHaveBeenCalledExactlyOnceWith(6783, '127.0.0.1');
  });
});
