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

  it('classifies a native-module load failure as native-module-load-failed, not database recovery', () => {
    // This is the exact ERR_DLOPEN_FAILED shape that occurs when the
    // better-sqlite3 binary was compiled for a different ABI than the
    // runtime (for example, a Node-built binary being loaded by
    // Electron's bundled Node). The recovery wrapper would otherwise
    // surface this as `database-recovery-failed`, leading the user to
    // quarantine, repair, or delete a healthy database.
    const dlopen = new Error(
      "The module '...\\better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 137. This version of Node.js requires NODE_MODULE_VERSION 146.",
    );
    (dlopen as Error & { code?: string }).code = 'ERR_DLOPEN_FAILED';
    const recovery = new DatabaseRecoveryError(
      'database-open-failed',
      'integrity',
      `Unable to open SQLite database: ${dlopen.message}`,
      false,
      { cause: dlopen, sqliteCode: 'ERR_DLOPEN_FAILED' },
    );

    const mapped = databaseStartupError(recovery);

    expect(mapped?.code).toBe('native-module-load-failed');
    expect(mapped?.message).toContain('native module');
    expect(mapped?.message).not.toContain('verify the existing database');
    expect(mapped?.message).toContain('not modified');
  });

  it('walks the cause chain to detect native-module failures when the recovery wrapper drops the code', () => {
    // Some Node errors carry the code on the inner cause, not on the
    // top-level Error. The classifier must still catch them.
    const inner = new Error('inner') as Error & { code?: string };
    inner.code = 'MODULE_NOT_FOUND';
    const outer = Object.assign(new Error('outer'), { cause: inner });
    const recovery = new DatabaseRecoveryError(
      'database-open-failed',
      'integrity',
      'Unable to open SQLite database',
      false,
      { cause: outer },
    );

    expect(databaseStartupError(recovery)?.code).toBe(
      'native-module-load-failed',
    );
  });

  it('does not classify genuine integrity failures as native-module errors', () => {
    const recovery = new DatabaseRecoveryError(
      'database-integrity-failed',
      'integrity',
      'SQLite integrity check failed at jobs.sqlite: database disk image is malformed',
      true,
      { integrityMessages: ['database disk image is malformed'] },
    );

    expect(databaseStartupError(recovery)?.code).toBe(
      'database-recovery-failed',
    );
  });
});
