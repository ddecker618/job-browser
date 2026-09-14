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
  | 'native-module-load-failed'
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

/**
 * Codes that indicate the startup failure is in the verification
 * infrastructure itself (native module ABI mismatch, missing dependency)
 * rather than in the database files. When these are detected, we must
 * not present the failure as database corruption/recovery: the database
 * is untouched.
 */
const NATIVE_MODULE_ERROR_CODES: readonly string[] = [
  'ERR_DLOPEN_FAILED',
  'MODULE_NOT_FOUND',
];

function isNativeModuleLoadFailure(error: DatabaseRecoveryError): boolean {
  if (NATIVE_MODULE_ERROR_CODES.some((code) => error.sqliteCode === code)) {
    return true;
  }
  // Defensive: some Node versions prefix `code` differently. Inspect the
  // chain of causes so the classification stays accurate even when the
  // recovery wrapper only forwards a generic message.
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      if (NATIVE_MODULE_ERROR_CODES.includes(code)) return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function databaseStartupError(
  error: unknown,
): DesktopStartupError | null {
  if (!(error instanceof DatabaseRecoveryError)) return null;

  // Native-module load failures must be reported accurately: the
  // database files were not touched, but the verification infrastructure
  // could not run. Distinguishing this from a database integrity
  // failure prevents unnecessary quarantine, repair, or recovery
  // actions against the user's data.
  if (isNativeModuleLoadFailure(error)) {
    return new DesktopStartupError(
      'native-module-load-failed',
      'Job Browser could not load a required native module to verify the database. The database files were not modified. This is typically caused by a Node.js / Electron version mismatch in the native dependency (for example, after an interrupted `npm rebuild` or `prebuild-install` run). Reinstall the application or run `npm rebuild better-sqlite3` against the current runtime, then restart Job Browser.',
      { cause: error },
    );
  }

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
  if (/ERR_DLOPEN_FAILED|MODULE_NOT_FOUND|native module/i.test(message))
    return 'Job Browser could not load a required native module. Your database files were not modified. Reinstall or run `npm rebuild better-sqlite3` against the current runtime, then restart Job Browser.';
  return 'Job Browser could not finish starting. Your existing data has not been deleted or replaced.';
}
