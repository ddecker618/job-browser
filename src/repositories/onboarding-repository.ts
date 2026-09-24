import type { JobDatabase } from '../db/database.js';
import type { OnboardingProgressSnapshot } from '../models/onboarding.js';
import { onboardingProgressSnapshotSchema } from '../schemas/onboarding.js';

export const ONBOARDING_PROGRESS_SETTING_PREFIX = 'onboardingProgress:';

export type OnboardingProgressLoadResult =
  | { kind: 'missing' }
  | { kind: 'valid'; snapshot: OnboardingProgressSnapshot }
  | { kind: 'malformed'; error: Error }
  | { kind: 'unsupported-version'; version: number }
  | { kind: 'storage-failure'; error: Error };

export interface OnboardingProgressStore {
  getSetting(key: string): string | null;
  saveSetting(key: string, valueJson: string): void;
  deleteSetting?: (key: string) => void;
}

export function onboardingProgressKey(profileId: string): string {
  if (profileId.trim() === '') throw new Error('A profile id is required.');
  return `${ONBOARDING_PROGRESS_SETTING_PREFIX}${profileId}`;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function loadOnboardingProgress(
  store: OnboardingProgressStore,
  profileId: string,
): OnboardingProgressLoadResult {
  let raw: string | null;
  try {
    raw = store.getSetting(onboardingProgressKey(profileId));
  } catch (error) {
    return { kind: 'storage-failure', error: asError(error) };
  }
  if (raw === null || raw === 'null') return { kind: 'missing' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { kind: 'malformed', error: asError(error) };
  }
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'version' in parsed &&
    typeof parsed.version === 'number' &&
    parsed.version > 2
  ) {
    return { kind: 'unsupported-version', version: parsed.version };
  }
  const result = onboardingProgressSnapshotSchema.safeParse(parsed);
  if (!result.success) {
    return { kind: 'malformed', error: new Error(result.error.message) };
  }
  return { kind: 'valid', snapshot: result.data };
}

export function saveOnboardingProgress(
  store: OnboardingProgressStore,
  profileId: string,
  snapshot: OnboardingProgressSnapshot,
): void {
  const key = onboardingProgressKey(profileId);
  const existing = loadOnboardingProgress(store, profileId);
  if (
    existing.kind === 'malformed' ||
    existing.kind === 'unsupported-version'
  ) {
    throw new Error(
      'Existing onboarding progress must be explicitly reset before replacement.',
    );
  }
  if (existing.kind === 'storage-failure') throw existing.error;
  const validated = onboardingProgressSnapshotSchema.parse(snapshot);
  store.saveSetting(key, JSON.stringify(validated));
}

export function resetOnboardingProgress(
  store: OnboardingProgressStore,
  profileId: string,
): void {
  const key = onboardingProgressKey(profileId);
  if (store.deleteSetting !== undefined) store.deleteSetting(key);
  else store.saveSetting(key, 'null');
}

export function createDatabaseOnboardingProgressStore(
  database: JobDatabase,
): OnboardingProgressStore {
  return {
    getSetting: (key) => {
      const row = database
        .prepare<
          [string],
          { setting_value_json: string } | undefined
        >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
        .get(key);
      return row?.setting_value_json ?? null;
    },
    saveSetting: (key, valueJson) => {
      database
        .prepare(
          `INSERT INTO app_settings (setting_key, setting_value_json, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(setting_key) DO UPDATE SET
           setting_value_json = excluded.setting_value_json,
           updated_at = excluded.updated_at`,
        )
        .run(key, valueJson);
    },
    deleteSetting: (key) => {
      database
        .prepare('DELETE FROM app_settings WHERE setting_key = ?')
        .run(key);
    },
  };
}
