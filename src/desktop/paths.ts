import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

export interface DesktopPathInput {
  isPackaged: boolean;
  userDataPath: string;
  resourcesPath: string;
  projectRoot: string;
  databaseOverride?: string;
}

export interface DesktopPaths {
  root: string;
  data: string;
  database: string;
  resumes: string;
  logs: string;
  backups: string;
  diagnostics: string;
  settings: string;
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
  indeedProfile: string;
  wellfoundProfile: string;
  ziprecruiterProfile: string;
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
  return {
    root,
    data: resolve(root, 'data'),
    database:
      input.databaseOverride ??
      runtimeDatabase ??
      resolve(root, 'data', 'jobs.sqlite'),
    resumes: resolve(root, 'resumes'),
    logs: resolve(root, 'logs'),
    backups: resolve(root, 'backups'),
    diagnostics: resolve(root, 'diagnostics'),
    settings,
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
    indeedProfile: resolve(root, 'indeed-profile'),
    wellfoundProfile: resolve(root, 'wellfound-profile'),
    ziprecruiterProfile: resolve(root, 'ziprecruiter-profile'),
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
    paths.logs,
    paths.backups,
    paths.diagnostics,
    paths.settings,
    paths.linkedinProfile,
    paths.diceProfile,
    paths.indeedProfile,
    paths.wellfoundProfile,
    paths.ziprecruiterProfile,
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
