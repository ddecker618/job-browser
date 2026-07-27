import { resolve } from 'node:path';

import { log } from '../logging/logger.js';
import { startBackend } from './backend.js';

const production = process.env['NODE_ENV'] === 'production';
const backend = await startBackend({
  host: '127.0.0.1',
  port: Number(process.env['PORT'] ?? 4173),
  development: !production,
  clientDirectory: resolve(process.cwd(), 'dist', 'client'),
});
log('info', 'Job Browser dashboard started', { url: backend.url });

async function shutdown(): Promise<void> {
  await backend.stop();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
