import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { LogWriter } from '../logging/logger.js';
import { sanitizeLogContext } from '../logging/sanitizeContext.js';

export function createDesktopLogger(logDirectory: string): {
  log: LogWriter;
  path: string;
} {
  mkdirSync(logDirectory, { recursive: true });
  const path = resolve(
    logDirectory,
    `job-browser-${new Date().toISOString().slice(0, 10)}.log`,
  );
  return {
    path,
    log(level, message, context = {}) {
      const sanitized = sanitizeLogContext(context);
      appendFileSync(
        path,
        `${JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...sanitized })}\n`,
        'utf8',
      );
    },
  };
}
