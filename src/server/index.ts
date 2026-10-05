import { resolve } from 'node:path';

import { log } from '../logging/logger.js';
import { startBackend } from './backend.js';

const production = process.env['NODE_ENV'] === 'production';
const databasePath = process.env['JOB_BROWSER_DB_PATH']
  ? resolve(process.cwd(), process.env['JOB_BROWSER_DB_PATH'])
  : undefined;
const profilePreferencesPath = process.env['PROFILE_PREFERENCES_PATH']
  ? resolve(process.cwd(), process.env['PROFILE_PREFERENCES_PATH'])
  : resolve(process.cwd(), 'data', 'settings', 'profile-preferences.json');

const backend = await startBackend({
  host: process.env['HOST'] ?? '0.0.0.0',
  port: Number(process.env['PORT'] ?? 3000),
  development: !production,
  clientDirectory: resolve(process.cwd(), 'dist', 'client'),
  seedDefaultSources: true,
  ...(databasePath !== undefined ? { databasePath } : {}),
  profilePreferencesPath,
  backupDirectory: resolve(process.cwd(), 'data', 'backups'),
  resumeDirectory: resolve(process.cwd(), 'data', 'resumes'),
  snapshotDirectory: resolve(process.cwd(), 'data', 'snapshots'),
  candidateProfilePath: resolve(
    process.cwd(),
    'config',
    'candidate-profile.json',
  ),
  scoringConfigPath: resolve(process.cwd(), 'config', 'scoring-config.json'),
});
log('info', 'Job Browser dashboard started', { url: backend.url });

async function shutdown(): Promise<void> {
  await backend.stop();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
