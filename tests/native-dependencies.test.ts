import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  backupCurrentNativeBinary,
  resolveElectronVersion,
  restoreNativeBinaryFromBackup,
} from '../scripts/native-dependencies.js';

const directories: string[] = [];

afterEach(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

function makeFakeBetterSqliteRoot(binaryBytes: Uint8Array): string {
  const root = mkdtempSync(join(tmpdir(), 'native-deps-test-'));
  directories.push(root);
  mkdirSync(join(root, 'build', 'Release'), { recursive: true });
  writeFileSync(
    join(root, 'build', 'Release', 'better_sqlite3.node'),
    binaryBytes,
  );
  return root;
}

describe('native-dependencies helpers', () => {
  it('reads the installed Electron version', () => {
    const version = resolveElectronVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('throws when given a root without the native binary', () => {
    const root = mkdtempSync(join(tmpdir(), 'native-deps-test-'));
    directories.push(root);
    expect(() => backupCurrentNativeBinary('label', root)).toThrow(
      /Cannot find better_sqlite3\.node/,
    );
  });

  it('backs up the current binary to a durable location', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const root = makeFakeBetterSqliteRoot(bytes);
    const backup = backupCurrentNativeBinary('test', root);
    expect(existsSync(backup)).toBe(true);
    const read = readFileSync(backup);
    expect(Array.from(read)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('round-trips a backup through restoreNativeBinaryFromBackup', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    const replacement = new Uint8Array([9, 9, 9]);
    const root = makeFakeBetterSqliteRoot(original);
    const backup = backupCurrentNativeBinary('round-trip', root);
    // Simulate the binary being swapped to something else.
    writeFileSync(
      join(root, 'build', 'Release', 'better_sqlite3.node'),
      replacement,
    );
    expect(
      Array.from(
        readFileSync(join(root, 'build', 'Release', 'better_sqlite3.node')),
      ),
    ).toEqual([9, 9, 9]);
    restoreNativeBinaryFromBackup(backup, root);
    expect(
      Array.from(
        readFileSync(join(root, 'build', 'Release', 'better_sqlite3.node')),
      ),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it('refuses to restore a missing backup rather than silently doing nothing', () => {
    const root = makeFakeBetterSqliteRoot(new Uint8Array([0]));
    expect(() =>
      restoreNativeBinaryFromBackup(resolve(root, 'does-not-exist.node'), root),
    ).toThrow(/Backup not found/);
  });
});
