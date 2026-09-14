import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import { openDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { createScoreVersion } from '../src/intelligence/scoreIdentity.js';
import { resolveCliProfilePreferencesPath } from '../src/preferences/cliProfilePreferences.js';
import { saveUnifiedProfilePreferences } from '../src/preferences/profilePreferencesRuntime.js';
import { candidateProfileSchema } from '../src/schemas/candidate-profile.js';
import { scoringConfigSchema } from '../src/schemas/scoring-config.js';
import { DEFAULT_SEARCH_PROFILE } from '../src/config/search-profile.js';
import { startBackend, type BackendHandle } from '../src/server/backend.js';

const directories: string[] = [];
const handles: BackendHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stop();
  for (const directory of directories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

interface DivergentFixtures {
  directory: string;
  legacyCandidatePath: string;
  legacyScoringPath: string;
  unifiedPreferencesPath: string;
  unifiedVersion: string;
  legacyVersion: string;
}

function divergentFixtures(prefix: string): DivergentFixtures {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  const legacyCandidate = candidateProfileSchema.parse({
    id: 'legacy-candidate',
    name: 'Legacy Candidate',
    preferredLocations: [{ city: 'Legacy City', state: 'LC' }],
    searchRadiusMiles: 25,
    secondarySearchRadiusMiles: 50,
    remotePreference: 'preferred',
    desiredSalary: {
      minimum: 60_000,
      target: 70_000,
      currency: 'USD',
    },
    certifications: [],
    degrees: [],
    skills: ['Legacy Skill'],
    clearanceEligibility: 'unknown',
    yearsOfExperience: 3,
    desiredJobTitles: ['Legacy Engineer'],
    excludedJobTitles: [],
    desiredEmploymentTypes: ['full-time'],
  });
  const unifiedCandidate = candidateProfileSchema.parse({
    id: 'unified-candidate',
    name: 'Unified Candidate',
    preferredLocations: [{ city: 'Unified City', state: 'UC' }],
    searchRadiusMiles: 10,
    secondarySearchRadiusMiles: 20,
    remotePreference: 'accepted',
    desiredSalary: {
      minimum: 80_000,
      target: 90_000,
      currency: 'USD',
    },
    certifications: [],
    degrees: [],
    skills: ['Unified Skill', 'Different Skill'],
    clearanceEligibility: 'eligible',
    yearsOfExperience: 7,
    desiredJobTitles: ['Unified Engineer'],
    excludedJobTitles: [],
    desiredEmploymentTypes: ['full-time'],
  });
  const buildScoring = (
    applyImmediately: number,
    strongMatch: number,
  ): ReturnType<typeof scoringConfigSchema.parse> =>
    scoringConfigSchema.parse({
      weights: {
        title: 20,
        skills: 25,
        certifications: 10,
        location: 10,
        remotePreference: 10,
        salary: 10,
        experience: 5,
        employmentType: 5,
        recency: 5,
      },
      recommendationThresholds: {
        applyImmediately,
        strongMatch,
        possibleMatch: 50,
      },
      recency: { freshDays: 7, recentDays: 30 },
      skills: [{ name: 'Different Skill', aliases: ['Different Skill Alias'] }],
      certifications: [],
    });
  const legacyScoring = buildScoring(80, 60);
  const unifiedScoring = buildScoring(95, 75);

  const legacyCandidatePath = join(directory, 'candidate-profile.json');
  const legacyScoringPath = join(directory, 'scoring-config.json');
  const unifiedPreferencesPath = join(directory, 'profile-preferences.json');

  writeFileSync(legacyCandidatePath, JSON.stringify(legacyCandidate));
  writeFileSync(legacyScoringPath, JSON.stringify(legacyScoring));
  saveUnifiedProfilePreferences(unifiedPreferencesPath, {
    candidateProfile: unifiedCandidate,
    searchProfile: DEFAULT_SEARCH_PROFILE,
    sourceQueryRoles: ['Unified Engineer'],
    scoringConfig: unifiedScoring,
  });

  const unifiedVersion = createScoreVersion(
    loadCandidateProfile(legacyCandidatePath, unifiedPreferencesPath),
    loadScoringConfig(legacyScoringPath, unifiedPreferencesPath),
  );
  const legacyVersion = createScoreVersion(
    loadCandidateProfile(legacyCandidatePath),
    loadScoringConfig(legacyScoringPath),
  );

  return {
    directory,
    legacyCandidatePath,
    legacyScoringPath,
    unifiedPreferencesPath,
    unifiedVersion,
    legacyVersion,
  };
}

function seedPendingJob(databasePath: string, jobId: string): void {
  const database = openDatabase(databasePath);
  try {
    runMigrations(database);
    database.exec(`
      INSERT INTO jobs (
        id, title, normalized_title, company, normalized_company,
        remote_type, employment_type, source_name, source_type,
        first_seen_at, last_seen_at, active, seniority_level, status,
        created_at, updated_at
      ) VALUES (
        '${jobId}', 'Unified Engineer', 'unified engineer',
        'Unified Employer', 'unified employer',
        'remote', 'full-time', 'Fixture', 'fixture',
        '2026-07-18T12:00:00.000Z', '2026-07-18T12:00:00.000Z', 1,
        'mid', 'new',
        '2026-07-18T12:00:00.000Z', '2026-07-18T12:00:00.000Z'
      );
    `);
  } finally {
    database.close();
  }
}

describe('consistent preference resolution (Package B)', () => {
  it('resolveCliProfilePreferencesPath returns undefined when no flag/env is set', () => {
    expect(
      resolveCliProfilePreferencesPath(['node', 'cli.js'], {}),
    ).toBeUndefined();
  });

  it(
    'startup reconcile writes the unified score version when a profile-preferences path is provided',
    { timeout: 60_000 },
    async () => {
      const fixtures = divergentFixtures('job-browser-package-b-reconcile-');
      const databasePath = join(fixtures.directory, 'jobs.sqlite');
      seedPendingJob(databasePath, 'pending-job');

      const handle = await startBackend({
        databasePath,
        backupDirectory: join(fixtures.directory, 'backups'),
        candidateProfilePath: fixtures.legacyCandidatePath,
        scoringConfigPath: fixtures.legacyScoringPath,
        profilePreferencesPath: fixtures.unifiedPreferencesPath,
        resumeDirectory: join(fixtures.directory, 'resumes'),
        clientDirectory: join(process.cwd(), 'dist', 'client'),
        host: '127.0.0.1',
        port: 0,
        startupMaintenanceDelayMs: 0,
      });
      handles.push(handle);
      await handle.startupMaintenance;

      const stored = handle.database
        .prepare<
          [string],
          { score_version: string | null }
        >('SELECT score_version FROM jobs WHERE id = ?')
        .get('pending-job');
      expect(stored?.score_version).toBe(fixtures.unifiedVersion);
      expect(stored?.score_version).not.toBe(fixtures.legacyVersion);
    },
  );

  it(
    'startup reconcile falls back to the legacy version when no profile-preferences path is provided',
    { timeout: 60_000 },
    async () => {
      const fixtures = divergentFixtures('job-browser-package-b-fallback-');
      const databasePath = join(fixtures.directory, 'jobs.sqlite');
      seedPendingJob(databasePath, 'pending-job');

      const handle = await startBackend({
        databasePath,
        backupDirectory: join(fixtures.directory, 'backups'),
        candidateProfilePath: fixtures.legacyCandidatePath,
        scoringConfigPath: fixtures.legacyScoringPath,
        resumeDirectory: join(fixtures.directory, 'resumes'),
        clientDirectory: join(process.cwd(), 'dist', 'client'),
        host: '127.0.0.1',
        port: 0,
        startupMaintenanceDelayMs: 0,
      });
      handles.push(handle);
      await handle.startupMaintenance;

      const stored = handle.database
        .prepare<
          [string],
          { score_version: string | null }
        >('SELECT score_version FROM jobs WHERE id = ?')
        .get('pending-job');
      expect(stored?.score_version).toBe(fixtures.legacyVersion);
    },
  );
});
