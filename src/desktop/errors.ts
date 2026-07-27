export type StartupErrorCode =
  | 'database-unavailable'
  | 'database-invalid'
  | 'migration-failed'
  | 'backend-failed'
  | 'health-timeout'
  | 'assets-missing'
  | 'unknown';

export class DesktopStartupError extends Error {
  public constructor(
    public readonly code: StartupErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DesktopStartupError';
  }
}

export function userFacingError(error: unknown): string {
  if (error instanceof DesktopStartupError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (/locked|busy/i.test(message))
    return 'The Job Browser database is currently in use by another process.';
  if (/readonly|read-only/i.test(message))
    return 'Job Browser cannot write to the selected data directory.';
  if (/malformed|corrupt|integrity/i.test(message))
    return 'The Job Browser database could not pass its integrity check.';
  return 'Job Browser could not finish starting. Your existing data has not been deleted or replaced.';
}
