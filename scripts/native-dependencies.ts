import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const commandEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => key.toLowerCase() !== 'npm_config_allow_scripts',
  ),
);

const BACKUP_DIRECTORY = resolve(
  process.env['LOCALAPPDATA'] ?? process.cwd(),
  'job-browser-native-backups',
);

/**
 * Reads the installed Electron version from `node_modules/electron/package.json`
 * rather than hardcoding a target ABI. The Electron ABI is tied to its
 * release line, so we read the actual version that will run against the
 * native binary and ask `prebuild-install` for a matching one.
 */
export function resolveElectronVersion(): string {
  const pkgPath = resolve('node_modules', 'electron', 'package.json');
  const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    version?: unknown;
  };
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error(
      `Could not resolve Electron version from ${pkgPath}`,
    );
  }
  return parsed.version;
}

/**
 * Saves a durable copy of the current better-sqlite3 binary before
 * swapping it for the Electron runtime. A bare `finally` block cannot
 * recover from an abrupt computer shutdown, so the backup must live
 * on disk outside the working tree and be re-applied even if the
 * process is killed mid-flight.
 */
export function backupCurrentNativeBinary(
  label: string,
  betterSqliteRoot = resolve('node_modules', 'better-sqlite3'),
): string {
  const source = resolve(betterSqliteRoot, 'build', 'Release', 'better_sqlite3.node');
  if (!existsSync(source)) {
    throw new Error(`Cannot find better_sqlite3.node at ${source}`);
  }
  mkdirSync(BACKUP_DIRECTORY, { recursive: true });
  const target = resolve(
    BACKUP_DIRECTORY,
    `better_sqlite3-${label}-${statSync(source).mtimeMs}.node`,
  );
  copyFileSync(source, target);
  return target;
}

function prebuildInstall(args: string[]): void {
  execFileSync(
    process.execPath,
    [resolve('node_modules', 'prebuild-install', 'bin.js'), ...args],
    {
      cwd: resolve('node_modules', 'better-sqlite3'),
      env: commandEnvironment,
      stdio: 'inherit',
    },
  );
}

export function installElectronNativeDependencies(): void {
  prebuildInstall(['--runtime=electron', `--target=${resolveElectronVersion()}`]);
}

/**
 * Restores a Node.js-compatible better-sqlite3 binary. We use the
 * package's own `prebuild-install` helper with `--runtime=node` instead
 * of `npm rebuild` so:
 *
 *   1. The matching Node prebuild is downloaded rather than built from
 *      source, which on Windows requires Python + MSVC and frequently
 *      fails in CI.
 *   2. Restoration is fast and deterministic.
 *
 * If a Node prebuild is unavailable for the host Node version, this
 * throws rather than silently leaving the Electron binary in place.
 */
export function restoreNodeNativeDependencies(): void {
  prebuildInstall(['--runtime=node']);
}

/**
 * Applies a previously-saved backup of the better-sqlite3 binary. This
 * is the recovery mechanism for an abrupt shutdown that interrupted
 * `restoreNodeNativeDependencies` mid-flight: a `finally` block alone
 * is insufficient.
 */
export function restoreNativeBinaryFromBackup(
  backupPath: string,
  betterSqliteRoot = resolve('node_modules', 'better-sqlite3'),
): void {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup not found at ${backupPath}`);
  }
  const target = resolve(betterSqliteRoot, 'build', 'Release', 'better_sqlite3.node');
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(backupPath, target);
}
