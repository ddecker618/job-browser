import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

export interface DesktopPathInput {
  isPackaged: boolean;
  userDataPath: string;
  resourcesPath: string;
  projectRoot: string;
  databaseOverride?: string;
}

export interface DesktopPaths {
  root: string;
  resources: string;
  data: string;
  database: string;
  resumes: string;
  snapshots: string;
  logs: string;
  backups: string;
  databaseQuarantine: string;
  diagnostics: string;
  settings: string;
  profilePreferences: string;
  candidateProfile: string;
  scoringConfig: string;
  runtimeSettings: string;
  credentials: string;
  windowState: string;
  migrations: string;
  client: string;
  startupHtml: string;
  icon: string;
  linkedinProfile: string;
  diceProfile: string;
  handshakeProfile: string;
  indeedProfile: string;
  wellfoundProfile: string;
  ziprecruiterProfile: string;
  usaJobsProfile: string;
}

export function resolveDesktopPaths(input: DesktopPathInput): DesktopPaths {
  const root = input.isPackaged
    ? input.userDataPath
    : resolve(input.projectRoot, 'data', 'desktop-dev');
  const settings = resolve(root, 'settings');
  const assets = input.isPackaged
    ? resolve(input.resourcesPath, 'assets')
    : resolve(input.projectRoot);
  const runtimeSettings = resolve(settings, 'runtime.json');
  const runtimeDatabase = readRuntimeDatabase(runtimeSettings);
  const safeRuntimeDatabase =
    input.isPackaged &&
    runtimeDatabase !== null &&
    isWithin(dirname(input.resourcesPath), runtimeDatabase)
      ? null
      : runtimeDatabase;
  return {
    root,
    resources: input.resourcesPath,
    data: resolve(root, 'data'),
    database:
      input.databaseOverride ??
      safeRuntimeDatabase ??
      resolve(root, 'data', 'jobs.sqlite'),
    resumes: resolve(root, 'resumes'),
    snapshots: resolve(root, 'snapshots'),
    logs: resolve(root, 'logs'),
    backups: resolve(root, 'backups'),
    databaseQuarantine: resolve(root, 'quarantine', 'database'),
    diagnostics: resolve(root, 'diagnostics'),
    settings,
    profilePreferences: resolve(settings, 'profile-preferences.json'),
    candidateProfile: resolve(settings, 'candidate-profile.json'),
    scoringConfig: resolve(settings, 'scoring-config.json'),
    runtimeSettings,
    credentials: resolve(settings, 'credentials.json'),
    windowState: resolve(settings, 'window-state.json'),
    migrations: input.isPackaged
      ? resolve(assets, 'migrations')
      : resolve(input.projectRoot, 'src', 'db', 'migrations'),
    client: resolve(input.projectRoot, 'dist', 'client'),
    startupHtml: input.isPackaged
      ? resolve(assets, 'startup', 'startup.html')
      : resolve(input.projectRoot, 'src', 'desktop', 'startup.html'),
    icon: input.isPackaged
      ? resolve(input.resourcesPath, 'icon.png')
      : resolve(input.projectRoot, 'build', 'icon.png'),
    linkedinProfile: resolve(root, 'linkedin-profile'),
    diceProfile: resolve(root, 'dice-profile'),
    handshakeProfile: resolve(root, 'handshake-profile'),
    indeedProfile: resolve(root, 'indeed-profile'),
    wellfoundProfile: resolve(root, 'wellfound-profile'),
    ziprecruiterProfile: resolve(root, 'ziprecruiter-profile'),
    usaJobsProfile: resolve(root, 'usajobs-profile'),
  };
}

export function initializeDesktopPaths(
  paths: DesktopPaths,
  defaultsRoot: string,
): void {
  for (const directory of [
    paths.root,
    paths.data,
    paths.resumes,
    paths.snapshots,
    paths.logs,
    paths.backups,
    paths.databaseQuarantine,
    paths.diagnostics,
    paths.settings,
    paths.linkedinProfile,
    paths.diceProfile,
    paths.handshakeProfile,
    paths.indeedProfile,
    paths.wellfoundProfile,
    paths.ziprecruiterProfile,
    paths.usaJobsProfile,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  copyDefault(
    resolve(defaultsRoot, 'candidate-profile.json'),
    paths.candidateProfile,
  );
  copyDefault(
    resolve(defaultsRoot, 'scoring-config.json'),
    paths.scoringConfig,
  );
}

export function saveRuntimeDatabase(path: string, databasePath: string): void {
  writeFileSync(path, `${JSON.stringify({ databasePath }, null, 2)}\n`, 'utf8');
}

export function assertDatabaseOutsideInstallDirectory(
  databasePath: string,
  resourcesPath: string,
): void {
  if (isWithin(dirname(resourcesPath), databasePath)) {
    throw new Error(
      'Database location must be outside the Job Browser installation directory',
    );
  }
}

function copyDefault(source: string, destination: string): void {
  if (!existsSync(destination)) copyFileSync(source, destination);
}

function readRuntimeDatabase(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      databasePath?: unknown;
    };
    return typeof parsed.databasePath === 'string' &&
      parsed.databasePath.length > 0
      ? parsed.databasePath
      : null;
  } catch {
    return null;
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(resolve(parent), resolve(candidate));
  return path === '' || (!path.startsWith('..') && !path.includes(':'));
}
