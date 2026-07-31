import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  profilePreferencesSchema,
  type ProfilePreferences,
} from '../schemas/profile-preferences.js';

export function serializeProfilePreferences(
  document: ProfilePreferences,
): string {
  return `${JSON.stringify(profilePreferencesSchema.parse(document), null, 2)}\n`;
}

export function deserializeProfilePreferences(
  contents: string,
): ProfilePreferences {
  return profilePreferencesSchema.parse(JSON.parse(contents) as unknown);
}

export class ProfilePreferencesStore {
  public constructor(private readonly path: string) {}

  public load(): ProfilePreferences | null {
    if (!existsSync(this.path)) return null;
    return deserializeProfilePreferences(readFileSync(this.path, 'utf8'));
  }

  public save(document: ProfilePreferences): void {
    const directory = dirname(this.path);
    mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, serializeProfilePreferences(document), {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(temporaryPath, this.path);
    } catch (error) {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
      throw error;
    }
  }
}
