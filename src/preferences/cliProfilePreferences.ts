/**
 * Resolves the optional unified profile-preferences path for CLI entry points.
 *
 * The auxiliary CLIs (analyze, verified-matches report, role-details backfill)
 * run in their own data context: the project's `config/` directory and the
 * default database. They do not automatically inherit the desktop's
 * `settings/profile-preferences.json` path, which lives in a per-user data
 * directory that may not exist or may belong to a different deployment.
 *
 * Callers that want the CLIs to read the same unified preferences the desktop
 * uses must pass the path explicitly via `--profile-preferences=<path>` or the
 * `PROFILE_PREFERENCES_PATH` environment variable. When neither is provided,
 * the CLIs fall back to the legacy `config/candidate-profile.json` and
 * `config/scoring-config.json` files, preserving prior behavior.
 */
export function resolveCliProfilePreferencesPath(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): string | undefined {
  for (const argument of argv) {
    if (argument.startsWith('--profile-preferences=')) {
      const value = argument.slice('--profile-preferences='.length).trim();
      if (value.length > 0) return value;
    }
  }
  const fromEnv = env['PROFILE_PREFERENCES_PATH'];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return undefined;
}
