import { describe, expect, it, vi } from 'vitest';

import {
  databaseStartupError,
  DesktopStartupError,
} from '../src/desktop/errors.js';
import { STARTUP_STAGES, waitForHealth } from '../src/desktop/startup.js';
import { DatabaseRecoveryError } from '../src/db/database-recovery.js';

describe('desktop startup health checks', () => {
  it('orders recovery, backup, and migration progress explicitly', () => {
    expect(STARTUP_STAGES.indexOf('Checking database')).toBeLessThan(
      STARTUP_STAGES.indexOf('Backing up database'),
    );
    expect(STARTUP_STAGES.indexOf('Backing up database')).toBeLessThan(
      STARTUP_STAGES.indexOf('Applying database updates'),
    );
  });

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

  it('classifies a preserved database set as quarantined', () => {
    const recovery = new DatabaseRecoveryError(
      'database-integrity-failed',
      'integrity',
      'SQLite integrity check failed',
      true,
      {
        quarantine: {
          directory: 'C:\\data\\quarantine\\incident',
          metadataPath: 'C:\\data\\quarantine\\incident\\metadata.json',
          files: [],
        },
      },
    );
    const startup = databaseStartupError(recovery);

    expect(startup?.code).toBe('database-quarantined');
    expect(startup?.quarantinePath).toBe('C:\\data\\quarantine\\incident');
    expect(startup?.message).toContain('recovery copy');
    expect(startup?.message).toContain('not deleted or replaced');
  });

  it('classifies a failed quarantine separately', () => {
    const recovery = new DatabaseRecoveryError(
      'database-integrity-failed',
      'quarantine',
      'Recovery copy failed',
      true,
      { quarantineFailed: true },
    );

    expect(databaseStartupError(recovery)?.code).toBe(
      'database-quarantine-failed',
    );
  });
});
