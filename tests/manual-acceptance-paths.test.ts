import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertDisposableManualAcceptancePaths } from '../src/desktop/manualAcceptancePaths.js';

describe('manual onboarding acceptance path guard', () => {
  it('accepts a database nested under a disposable OS temp root', () => {
    const root = mkdtempSync(join(tmpdir(), 'job-browser-acceptance-paths-'));
    const userDataRoot = join(root, 'user-data');
    mkdirSync(join(userDataRoot, 'data'), { recursive: true });
    try {
      assertDisposableManualAcceptancePaths(
        userDataRoot,
        join(userDataRoot, 'data', 'jobs.sqlite'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a missing path or database path outside the isolated user-data root', () => {
    const root = mkdtempSync(join(tmpdir(), 'job-browser-acceptance-paths-'));
    try {
      expect(() =>
        assertDisposableManualAcceptancePaths(undefined, undefined),
      ).toThrow('Disposable onboarding acceptance mode requires temporary');
      expect(() =>
        assertDisposableManualAcceptancePaths(
          join(root, 'user-data'),
          join(root, 'database.sqlite'),
        ),
      ).toThrow('Disposable onboarding acceptance mode requires temporary');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects user-data roots outside the operating-system temp directory', () => {
    expect(() =>
      assertDisposableManualAcceptancePaths(
        join(process.cwd(), 'manual-acceptance-user-data'),
        join(process.cwd(), 'manual-acceptance-user-data', 'jobs.sqlite'),
      ),
    ).toThrow('Disposable onboarding acceptance mode requires temporary');
  });
});
