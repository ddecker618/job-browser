import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  candidateProfileSchema,
  type CandidateProfile,
} from '../schemas/candidate-profile.js';
import { loadUnifiedLegacyPreferences } from '../preferences/profilePreferencesRuntime.js';

export function loadCandidateProfile(
  profilePath = resolve(process.cwd(), 'config', 'candidate-profile.json'),
  profilePreferencesPath?: string,
): CandidateProfile {
  const unified = loadUnifiedLegacyPreferences(profilePreferencesPath);
  if (unified !== null) return unified.candidateProfile;
  try {
    const contents = readFileSync(profilePath, 'utf8');
    return candidateProfileSchema.parse(JSON.parse(contents) as unknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to load candidate profile at ${profilePath}: ${message}`,
      {
        cause: error,
      },
    );
  }
}
