import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

export function assertDisposableManualAcceptancePaths(
  userDataRoot: string | undefined,
  databasePath: string | undefined,
): void {
  try {
    if (userDataRoot === undefined || databasePath === undefined)
      throw new Error();
    const temporaryRoot = realpathSync.native(tmpdir());
    const canonicalUserDataRoot = realpathSync.native(userDataRoot);
    const canonicalDatabasePath = resolve(databasePath);
    if (
      !isPathWithin(temporaryRoot, canonicalUserDataRoot) ||
      !isPathWithin(canonicalUserDataRoot, canonicalDatabasePath)
    ) {
      throw new Error();
    }
    let existingDatabaseParent = dirname(canonicalDatabasePath);
    while (
      !existsSync(existingDatabaseParent) &&
      existingDatabaseParent !== dirname(existingDatabaseParent)
    ) {
      existingDatabaseParent = dirname(existingDatabaseParent);
    }
    const canonicalDatabaseParent = realpathSync.native(existingDatabaseParent);
    if (!isPathWithin(canonicalUserDataRoot, canonicalDatabaseParent)) {
      throw new Error();
    }
    if (
      existsSync(canonicalDatabasePath) &&
      !isPathWithin(
        canonicalUserDataRoot,
        realpathSync.native(canonicalDatabasePath),
      )
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      'Disposable onboarding acceptance mode requires temporary user-data and database paths.',
    );
  }
}

function isPathWithin(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return (
    path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  );
}
