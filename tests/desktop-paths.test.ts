import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  initializeDesktopPaths,
  assertDatabaseOutsideInstallDirectory,
  resolveDesktopPaths,
  saveRuntimeDatabase,
} from '../src/desktop/paths.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('desktop paths', () => {
  it('uses Electron userData in production and preserves existing configuration', () => {
    const root = temporary('desktop-paths-');
    const defaults = temporary('desktop-defaults-');
    writeFileSync(join(defaults, 'candidate-profile.json'), '{"default":true}');
    writeFileSync(join(defaults, 'scoring-config.json'), '{"weights":true}');
    const paths = resolveDesktopPaths({
      isPackaged: true,
      userDataPath: root,
      resourcesPath: join(root, 'resources'),
      projectRoot: join(root, 'app'),
    });
    initializeDesktopPaths(paths, defaults);
    writeFileSync(paths.candidateProfile, '{"custom":true}');
    initializeDesktopPaths(paths, defaults);

    expect(paths.database).toBe(join(root, 'data', 'jobs.sqlite'));
    expect(paths.handshakeProfile).toBe(join(root, 'handshake-profile'));
    expect(existsSync(paths.handshakeProfile)).toBe(true);
    expect(paths.databaseQuarantine).toBe(join(root, 'quarantine', 'database'));
    expect(existsSync(paths.databaseQuarantine)).toBe(true);
    expect(readFileSync(paths.candidateProfile, 'utf8')).toBe(
      '{"custom":true}',
    );
    expect(existsSync(paths.backups)).toBe(true);
  });

  it('uses repository-local storage in development and honors runtime database settings', () => {
    const root = temporary('desktop-dev-');
    const first = resolveDesktopPaths({
      isPackaged: false,
      userDataPath: join(root, 'user'),
      resourcesPath: join(root, 'resources'),
      projectRoot: root,
    });
    initializeDesktopPaths(first, join(process.cwd(), 'config'));
    const custom = join(root, 'custom.sqlite');
    saveRuntimeDatabase(first.runtimeSettings, custom);
    const second = resolveDesktopPaths({
      isPackaged: false,
      userDataPath: join(root, 'user'),
      resourcesPath: join(root, 'resources'),
      projectRoot: root,
    });
    expect(second.root).toBe(join(root, 'data', 'desktop-dev'));
    expect(second.database).toBe(custom);
  });

  it('rejects and ignores packaged database paths inside the replaceable install directory', () => {
    const root = temporary('desktop-safe-database-');
    const userData = join(root, 'user-data');
    const install = join(root, 'install');
    const resources = join(install, 'resources');
    const first = resolveDesktopPaths({
      isPackaged: true,
      userDataPath: userData,
      resourcesPath: resources,
      projectRoot: install,
    });
    initializeDesktopPaths(first, join(process.cwd(), 'config'));
    saveRuntimeDatabase(first.runtimeSettings, join(install, 'data', 'jobs.sqlite'));

    expect(() =>
      assertDatabaseOutsideInstallDirectory(
        join(install, 'data', 'jobs.sqlite'),
        resources,
      ),
    ).toThrow('outside the Job Browser installation directory');
    expect(
      resolveDesktopPaths({
        isPackaged: true,
        userDataPath: userData,
        resourcesPath: resources,
        projectRoot: install,
      }).database,
    ).toBe(join(userData, 'data', 'jobs.sqlite'));
    expect(() =>
      assertDatabaseOutsideInstallDirectory(
        join(root, 'external', 'jobs.sqlite'),
        resources,
      ),
    ).not.toThrow();
  });
});

function temporary(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}
