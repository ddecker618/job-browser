import { describe, expect, it, vi } from 'vitest';

import { DesktopStartupError } from '../src/desktop/errors.js';
import { waitForHealth } from '../src/desktop/startup.js';

describe('desktop startup health checks', () => {
  it('accepts a healthy loopback backend', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(
      waitForHealth('http://127.0.0.1:1234', 100, fetcher),
    ).resolves.toBeUndefined();
  });

  it('returns a recoverable timeout error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('not ready'));
    try {
      await waitForHealth('http://127.0.0.1:1234', 20, fetcher);
      throw new Error('Expected health timeout');
    } catch (error) {
      expect(error).toBeInstanceOf(DesktopStartupError);
      expect((error as DesktopStartupError).code).toBe('health-timeout');
    }
  });
});
