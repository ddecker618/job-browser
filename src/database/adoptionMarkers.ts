import type { JobDatabase } from '../db/database.js';
import { nowUtc } from '../utilities/timestamps.js';

export const ADOPTION_INSTALLED_AT_KEY = 'adoption.installedAt';
export const ADOPTION_FIRST_SOURCE_AT_KEY = 'adoption.firstSourceAt';

function readSetting(database: JobDatabase, key: string): string | null {
  const raw =
    database
      .prepare<
        [string],
        { setting_value_json: string } | undefined
      >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
      .get(key)?.setting_value_json ?? null;
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function writeSetting(
  database: JobDatabase,
  key: string,
  timestamp: string,
): void {
  database
    .prepare(
      `INSERT INTO app_settings (setting_key, setting_value_json, updated_at)
       VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET
       setting_value_json = excluded.setting_value_json,
       updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(timestamp), nowUtc());
}

export function ensureInstalledAt(
  database: JobDatabase,
  timestamp = nowUtc(),
): void {
  if (readSetting(database, ADOPTION_INSTALLED_AT_KEY) === null) {
    writeSetting(database, ADOPTION_INSTALLED_AT_KEY, timestamp);
  }
}

export function markFirstSourceAt(
  database: JobDatabase,
  timestamp = nowUtc(),
): void {
  if (readSetting(database, ADOPTION_FIRST_SOURCE_AT_KEY) !== null) return;
  const count =
    database
      .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM sources')
      .get()?.count ?? 0;
  if (count === 1) {
    writeSetting(database, ADOPTION_FIRST_SOURCE_AT_KEY, timestamp);
  }
}

export function readAdoptionMarkers(database: JobDatabase): {
  installedAt: string | null;
  firstSourceAt: string | null;
} {
  return {
    installedAt: readSetting(database, ADOPTION_INSTALLED_AT_KEY),
    firstSourceAt: readSetting(database, ADOPTION_FIRST_SOURCE_AT_KEY),
  };
}
