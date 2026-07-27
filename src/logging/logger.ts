export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogWriter = (
  level: LogLevel,
  message: string,
  context?: Readonly<Record<string, unknown>>,
) => void;

export function log(
  level: LogLevel,
  message: string,
  context: Readonly<Record<string, unknown>> = {},
): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...sanitizeLogContext(context),
  });

  if (level === 'error') {
    console.error(entry);
  } else {
    console.log(entry);
  }
}
import { sanitizeLogContext } from './sanitizeContext.js';
