import {
  fromLegacyPreferences,
  toLegacyPreferences,
  type LegacyPreferences,
} from './profilePreferencesAdapters.js';
import { ProfilePreferencesStore } from './profilePreferencesStore.js';
import type { ProfilePreferences } from '../schemas/profile-preferences.js';

export function loadUnifiedProfilePreferences(
  path: string | undefined,
): ProfilePreferences | null {
  if (path === undefined) return null;
  try {
    return new ProfilePreferencesStore(path).load();
  } catch {
    return null;
  }
}

export function loadUnifiedLegacyPreferences(
  path: string | undefined,
): LegacyPreferences | null {
  const document = loadUnifiedProfilePreferences(path);
  return document === null ? null : toLegacyPreferences(document);
}

export function saveUnifiedProfilePreferences(
  path: string | undefined,
  preferences: LegacyPreferences,
): void {
  if (path === undefined) return;
  new ProfilePreferencesStore(path).save(fromLegacyPreferences(preferences));
}
