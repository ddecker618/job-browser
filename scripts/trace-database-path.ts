import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import Database from 'better-sqlite3';

interface SettingRow {
  setting_key: string;
  setting_value_json: string;
}

const userDataPath = requiredEnvironment('JOB_BROWSER_USER_DATA');
const settingsPath = join(userDataPath, 'settings');
const runtimePath = join(settingsPath, 'runtime.json');
const runtime = readJson(runtimePath);
const runtimeDatabasePath =
  typeof runtime?.['databasePath'] === 'string' &&
  runtime['databasePath'].length > 0
    ? runtime['databasePath']
    : join(userDataPath, 'data', 'jobs.sqlite');
const databasePath = resolve(runtimeDatabasePath);
const database = new Database(databasePath, {
  readonly: true,
  fileMustExist: true,
});

try {
  const settings = new Map(
    database
      .prepare<[], SettingRow>(
        'SELECT setting_key, setting_value_json FROM app_settings',
      )
      .all()
      .map((row) => [row.setting_key, parseJson(row.setting_value_json)]),
  );
  const appDatabaseLocation = settings.get('databaseLocation');
  const runtimeLabel = normalizePath(runtimeDatabasePath);
  const appLabel =
    typeof appDatabaseLocation === 'string'
      ? normalizePath(appDatabaseLocation)
      : 'absent-or-non-string';
  const references = traceSourceReferences(resolve(process.cwd(), 'src'));
  const overridePresent = process.env['JOB_BROWSER_DB_PATH'] !== undefined;

  console.log(`TRACE_RUNTIME_DATABASE_PATH=${runtimeLabel}`);
  console.log(`TRACE_APP_DATABASE_LOCATION=${appLabel}`);
  console.log(
    `TRACE_VALUES_MATCH=${appDatabaseLocation === runtimeDatabasePath ? '1' : '0'}`,
  );
  console.log(
    `TRACE_STARTUP_SELECTOR=${overridePresent ? 'JOB_BROWSER_DB_PATH override' : 'runtime.json.databasePath with packaged fallback'}`,
  );
  console.log('TRACE_RUNTIME_ROLE=active-startup-database-selector');
  console.log(
    'TRACE_APP_SETTING_ROLE=database-setting-read-for-api-display-and-persisted-settings',
  );
  console.log(
    'TRACE_APP_SETTING_MIRROR=PUT_api_settings_callback_writes_runtime_json',
  );
  console.log(`TRACE_REFERENCE_COUNT=${String(references.length)}`);
  for (const reference of references) {
    console.log(
      `TRACE_REFERENCE=${reference.file}:${String(reference.line)}:${reference.kind}`,
    );
  }
  console.log(`TRACE_RUNTIME_FILE_PRESENT=${existsSync(runtimePath) ? '1' : '0'}`);
  console.log(`TRACE_RUNTIME_DATABASE_BASENAME=${basename(databasePath)}`);
} finally {
  database.close();
}

function traceSourceReferences(sourceRoot: string): {
  file: string;
  line: number;
  kind: 'read' | 'write' | 'definition';
}[] {
  const references: {
    file: string;
    line: number;
    kind: 'read' | 'write' | 'definition';
  }[] = [];
  for (const file of walkTypeScriptFiles(sourceRoot)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (
        !line.includes('databasePath') &&
        !line.includes('databaseLocation') &&
        !line.includes('runtime.json')
      )
        return;
      const kind = classifyReference(line);
      references.push({
        file: relative(process.cwd(), file).replaceAll('\\', '/'),
        line: index + 1,
        kind,
      });
    });
  }
  return references;
}

function classifyReference(line: string): 'read' | 'write' | 'definition' {
  if (
    line.includes('writeFileSync') ||
    line.includes('saveRuntimeDatabase') ||
    line.includes('saveSettings') ||
    line.includes('onSettingsSaved') ||
    line.includes('.run(')
  )
    return 'write';
  if (
    line.includes('readFileSync') ||
    line.includes('readRuntimeDatabase') ||
    line.includes('openDatabase') ||
    line.includes('getSettings') ||
    line.includes('getSetting') ||
    line.includes('paths.database') ||
    line.includes('defaultDatabasePath')
  )
    return 'read';
  return 'definition';
}

function normalizePath(value: string): string {
  const normalized = resolve(value);
  const root = resolve(userDataPath);
  const relativePath = relative(root, normalized).replaceAll('\\', '/');
  if (relativePath === '' || (!relativePath.startsWith('../') && relativePath !== '..'))
    return `<userData>/${relativePath}`;
  return `<external>/${basename(normalized)}`;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function walkTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkTypeScriptFiles(path));
    else if (entry.isFile() && path.endsWith('.ts')) files.push(path);
  }
  return files;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
