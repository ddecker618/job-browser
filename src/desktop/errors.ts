import { DatabaseRecoveryError } from '../db/database-recovery.js';

export type StartupErrorCode =
  | 'database-unavailable'
  | 'database-invalid'
  | 'database-recovery-failed'
  | 'database-quarantined'
  | 'database-quarantine-failed'
  | 'migration-failed'
  | 'backend-failed'
  | 'health-timeout'
  | 'assets-missing'
  | 'unknown';

interface DesktopStartupErrorOptions extends ErrorOptions {
  quarantinePath?: string;
}

export class DesktopStartupError extends Error {
  public readonly quarantinePath: string | undefined;

  public constructor(
    public readonly code: StartupErrorCode,
    message: string,
    options: DesktopStartupErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'DesktopStartupError';
    this.quarantinePath = options.quarantinePath;
  }
}

export function databaseStartupError(
  error: unknown,
): DesktopStartupError | null {
  if (!(error instanceof DatabaseRecoveryError)) return null;

  if (error.quarantine !== undefined) {
    return new DesktopStartupError(
      'database-quarantined',
      'Job Browser could not safely open the existing database. A recovery copy of the database set was preserved in the application data quarantine folder. The original files were not deleted or replaced, and startup stopped before backup or database updates.',
      { cause: error, quarantinePath: error.quarantine.directory },
    );
  }

  if (error.quarantineFailed) {
    return new DesktopStartupError(
      'database-quarantine-failed',
      'Job Browser could not safely open the existing database and could not complete a recovery copy. The original files were not deleted or replaced. Startup stopped before backup or database updates.',
      { cause: error },
    );
  }

  if (
    error.sqliteCode?.includes('BUSY') === true ||
    error.sqliteCode?.includes('LOCKED') === true
  ) {
    return new DesktopStartupError(
      'database-unavailable',
      'The Job Browser database is currently in use by another process. No database files were deleted or replaced.',
      { cause: error },
    );
  }

  if (
    error.sqliteCode?.includes('READONLY') === true ||
    error.sqliteCode?.includes('PERM') === true ||
    error.sqliteCode?.includes('CANTOPEN') === true
  ) {
    return new DesktopStartupError(
      'database-unavailable',
      'Job Browser cannot safely access the selected database location. No database files were deleted or replaced.',
      { cause: error },
    );
  }

  return new DesktopStartupError(
    'database-recovery-failed',
    'Job Browser could not safely verify the existing database. The files were left in place, and startup stopped before backup or database updates.',
    { cause: error },
  );
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
