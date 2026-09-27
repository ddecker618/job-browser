import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/server/app.js';
import { createTestDatabase } from './helpers/test-database.js';
import { SourceRepository } from '../src/repositories/source-repository.js';
import type { JobDatabase } from '../src/db/database.js';
import { candidateProfileSchema } from '../src/schemas/candidate-profile.js';
import { scoringConfigSchema } from '../src/schemas/scoring-config.js';
import { DEFAULT_SEARCH_PROFILE } from '../src/config/search-profile.js';
import { createEmptyPreferencesDraft } from '../src/schemas/onboarding.js';
import { ONBOARDING_SEARCH_PLAN_VERSION } from '../src/models/onboarding.js';
import { providerRegistry } from '../src/providers/providerRegistry.js';
import { BuiltInProvider } from '../src/providers/builtin.provider.js';
import {
  fromLegacyPreferences,
  type LegacyPreferences,
} from '../src/preferences/profilePreferencesAdapters.js';
import { profilePreferencesSchema } from '../src/schemas/profile-preferences.js';
import type { DiscoveryCoordinator } from '../src/discovery/discoveryCoordinator.js';
import type { CredentialResolver } from '../src/discovery/credentialResolver.js';
import type { DiscoverySummary } from '../src/models/discovery.js';
import type {
  OnboardingPreferencesDraft,
  OnboardingProgressSnapshot,
} from '../src/models/onboarding.js';
import { computeOnboardingPlanToken } from '../src/server/onboardingRoutes.js';
import type {
  OnboardingCompleteResponse,
  OnboardingPreviewResponse,
  OnboardingStatusResponse,
} from '../src/server/onboardingRoutes.js';
import { ONBOARDING_PROGRESS_SETTING_PREFIX } from '../src/repositories/onboarding-repository.js';
import {
  createDatabaseOnboardingProgressStore,
  resetOnboardingProgress,
  saveOnboardingProgress,
  type OnboardingProgressStore,
} from '../src/repositories/onboarding-repository.js';
import { loadUnifiedLegacyPreferences } from '../src/preferences/profilePreferencesRuntime.js';

interface BackendHandle {
  baseUrl: string;
  close: () => Promise<void>;
}

interface StartOptions {
  noCoordinator?: boolean;
  profileOverrides?: Record<string, unknown>;
  withReadySource?: boolean;
  withCredentialRequiredSource?: boolean;
  progressStore?: OnboardingProgressStore;
  saveProfilePreferences?: (
    path: string | undefined,
    prefs: LegacyPreferences,
  ) => void;
  cascadeTargetRoles?: (roles: readonly string[]) => void;
  deleteOnboardingProgress?: (profileId: string) => void;
  credentialResolver?: CredentialResolver;
  providerDescriptors?: readonly Parameters<
    typeof import('../src/onboarding/search-plan-service.js').buildOnboardingSearchPlan
  >[0]['providerDescriptors'][number][];
}

const handles: BackendHandle[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeCoordinator(
  options: {
    runAll?: () => Promise<DiscoverySummary[]>;
    runSource?: (id: string) => Promise<DiscoverySummary[]>;
    status?: () => Record<string, unknown>;
    stop?: () => Promise<void>;
    healthCheck?: (id: string) => Promise<Record<string, unknown>>;
    validateSource?: (
      id: string,
      cfg: unknown,
    ) => Promise<Record<string, unknown>>;
    recentRuns?: (id?: string) => unknown[];
  } = {},
): Partial<
  Pick<
    DiscoveryCoordinator,
    | 'runAll'
    | 'runSource'
    | 'status'
    | 'stop'
    | 'healthCheck'
    | 'validateSource'
    | 'recentRuns'
  >
> {
  return {
    runAll: (options.runAll ??
      (() => Promise.resolve([]))) as DiscoveryCoordinator['runAll'],
    runSource: (options.runSource ??
      vi.fn(() => Promise.resolve([]))) as DiscoveryCoordinator['runSource'],
    status: (options.status ??
      (() => ({
        running: false,
        queuedSourceIds: [],
        activeSourceId: null,
        startedAt: null,
        completedSources: 0,
        totalSources: 0,
        lastError: null,
      }))) as unknown as DiscoveryCoordinator['status'],
    stop: (options.stop ??
      (() => Promise.resolve())) as DiscoveryCoordinator['stop'],
    healthCheck: (options.healthCheck ??
      (() =>
        Promise.resolve({
          status: 'healthy' as const,
          message: 'ok',
          checkedAt: new Date().toISOString(),
        }))) as DiscoveryCoordinator['healthCheck'],
    validateSource: (options.validateSource ??
      (() =>
        Promise.resolve({
          valid: true,
          message: '',
          preview: null,
          normalizedConfiguration: {},
        }))) as DiscoveryCoordinator['validateSource'],
    recentRuns: (options.recentRuns ??
      (() => [])) as DiscoveryCoordinator['recentRuns'],
  };
}

async function startBackend(
  coordinator?: Partial<
    Pick<
      DiscoveryCoordinator,
      | 'runAll'
      | 'runSource'
      | 'status'
      | 'stop'
      | 'healthCheck'
      | 'validateSource'
      | 'recentRuns'
    >
  >,
  options: StartOptions = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'job-browser-onboarding-api-'));
  directories.push(directory);
  const profilePreferencesPath = join(directory, 'profile-preferences.json');

  const candidate = candidateProfileSchema.parse({
    id: 'candidate-api-one',
    name: 'API Candidate',
    preferredLocations: [{ city: 'Example City', state: 'EX' }],
    searchRadiusMiles: 20,
    secondarySearchRadiusMiles: 40,
    remotePreference: 'accepted',
    desiredSalary: null,
    certifications: [],
    degrees: [],
    skills: [],
    clearanceEligibility: 'unknown',
    yearsOfExperience: null,
    desiredJobTitles: ['Network Engineer'],
    excludedJobTitles: [],
    desiredEmploymentTypes: ['full-time'],
    degreeRequired: false,
    degreeInProgressOk: true,
    maxTravelPercent: 0,
    noWeekends: false,
    noOnCall: false,
    noRotatingShifts: false,
    noOvernightShifts: false,
    ...(options.profileOverrides ?? {}),
  });

  const scoring = scoringConfigSchema.parse({
    weights: {
      title: 20,
      skills: 20,
      certifications: 10,
      location: 15,
      remotePreference: 10,
      salary: 10,
      experience: 5,
      employmentType: 5,
      recency: 5,
    },
    recommendationThresholds: {
      applyImmediately: 85,
      strongMatch: 70,
      possibleMatch: 50,
    },
    recency: { freshDays: 7, recentDays: 30 },
    skills: [],
    certifications: [],
  });

  const legacy: LegacyPreferences = {
    candidateProfile: candidate,
    searchProfile: DEFAULT_SEARCH_PROFILE,
    sourceQueryRoles: [],
    scoringConfig: scoring,
  };
  const unified = fromLegacyPreferences(legacy);
  const validated = profilePreferencesSchema.parse(unified);
  writeFileSync(profilePreferencesPath, JSON.stringify(validated));

  const candidateProfilePath = join(directory, 'candidate-profile.json');
  writeFileSync(candidateProfilePath, JSON.stringify(candidate));

  if (!providerRegistry.list().some((p) => p.id === 'builtin')) {
    providerRegistry.register(new BuiltInProvider());
  }

  const database = createTestDatabase();

  if (options.withReadySource === true) {
    const sourceRepository = new SourceRepository(
      database,
      profilePreferencesPath,
    );
    sourceRepository.create(
      {
        displayName: 'Ready Source',
        employer: 'Ready Employer',
        providerId: 'builtin',
        careersUrl: 'https://example.com/jobs',
        enabled: true,
        configuration: {},
        searchCriteria: {
          query: 'example',
          location: null,
          remoteOnly: false,
          limit: 50,
          maxAgeDays: 30,
        },
        schedule: {
          enabled: false,
          cadence: 'manual',
          dailyLocalTime: null,
        },
      },
      'valid',
    );
  }
  if (options.withCredentialRequiredSource === true) {
    const sourceRepository = new SourceRepository(
      database,
      profilePreferencesPath,
    );
    sourceRepository.create(
      {
        displayName: 'Credential Source',
        employer: 'Credential Employer',
        providerId: 'credential-provider',
        careersUrl: 'https://example.com/credential-jobs',
        enabled: true,
        configuration: {},
        searchCriteria: {
          query: 'example',
          location: null,
          remoteOnly: false,
          limit: 50,
          maxAgeDays: 30,
        },
        schedule: {
          enabled: false,
          cadence: 'manual',
          dailyLocalTime: null,
        },
      },
      'valid',
    );
  }
  const coordinatorArg = options.noCoordinator
    ? undefined
    : (coordinator ?? makeCoordinator());
  const app = createApp(database, {
    profilePreferencesPath,
    candidateProfilePath,
    ...(coordinatorArg === undefined
      ? {}
      : { coordinator: coordinatorArg as unknown as DiscoveryCoordinator }),
    ...(options.progressStore === undefined
      ? {}
      : { onboardingProgressStore: options.progressStore }),
    ...(options.saveProfilePreferences === undefined
      ? {}
      : { saveProfilePreferences: options.saveProfilePreferences }),
    ...(options.cascadeTargetRoles === undefined
      ? {}
      : { cascadeTargetRoles: options.cascadeTargetRoles }),
    ...(options.deleteOnboardingProgress === undefined
      ? {}
      : { deleteOnboardingProgress: options.deleteOnboardingProgress }),
    ...(options.credentialResolver === undefined
      ? {}
      : { credentialResolver: options.credentialResolver }),
    ...(options.providerDescriptors === undefined
      ? {}
      : { providerDescriptors: options.providerDescriptors }),
  });

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;
  const handle: BackendHandle = {
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      database.close();
    },
  };
  handles.push(handle);
  return { handle, database, profilePreferencesPath, candidateProfilePath };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function get(handle: BackendHandle, path: string): Promise<Response> {
  return fetch(`${handle.baseUrl}${path}`);
}

async function postJson(
  handle: BackendHandle,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${handle.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const basePreferences = {
  preferredLocations: [{ city: 'Example City', state: 'EX' }],
  searchRadiusMiles: 25,
  secondarySearchRadiusMiles: 50,
  remotePreference: 'preferred' as const,
  desiredSalary: null,
  desiredJobTitles: ['Network Engineer'],
  desiredEmploymentTypes: ['full-time' as const],
};

const snapshotV2: OnboardingProgressSnapshot = {
  version: 2,
  onboardingStep: 'preferences',
  currentQuestion: 'desired-work',
  answers: createEmptyPreferencesDraft(),
  reviewItems: [],
};

function markCompleted(database: JobDatabase): void {
  database
    .prepare(
      `INSERT OR REPLACE INTO app_settings (setting_key, setting_value_json, updated_at)
       VALUES (?, ?, datetime('now'))`,
    )
    .run(
      'onboardingCompletion:candidate-api-one',
      JSON.stringify({ completedAt: '2026-09-24T00:00:00.000Z' }),
    );
}

describe('onboarding API — load/status', () => {
  it('returns not-started for a fresh profile', async () => {
    const { handle } = await startBackend();
    const response = await get(handle, '/api/onboarding/status');
    expect(response.status).toBe(200);
    const body = await readJson<OnboardingStatusResponse>(response);
    expect(body.state).toBe('not-started');
    expect(body.profileId).toBe('candidate-api-one');
    expect(body.completion.completed).toBe(false);
    expect(body.editSession.editing).toBe(false);
  });

  it('prefills the draft and plan token for a fresh profile', async () => {
    const { handle } = await startBackend();
    const response = await get(handle, '/api/onboarding/status');
    expect(response.status).toBe(200);
    const body = await readJson<OnboardingStatusResponse>(response);
    expect(body.state).toBe('not-started');
    expect(body.prefilledDraft).toBeDefined();
    expect(body.prefilledDraft?.desiredJobTitles).toEqual(['Network Engineer']);
    expect(body.planToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it('distinguishes malformed / unsupported-version from genuine storage failures', async () => {
    const { handle, database } = await startBackend();
    // malformed
    database
      .prepare(
        `INSERT OR REPLACE INTO app_settings (setting_key, setting_value_json, updated_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(
        `${ONBOARDING_PROGRESS_SETTING_PREFIX}candidate-api-one`,
        '{not-json',
      );
    const malformed = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(malformed.state).toBe('blocked');
    expect(malformed.blockKind).toBe('malformed');
    expect(malformed.blockMessage).toMatch(/unreadable/);

    // unsupported version
    database
      .prepare(
        `INSERT OR REPLACE INTO app_settings (setting_key, setting_value_json, updated_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(
        `${ONBOARDING_PROGRESS_SETTING_PREFIX}candidate-api-one`,
        JSON.stringify({ version: 99 }),
      );
    const unsupported = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(unsupported.state).toBe('blocked');
    expect(unsupported.blockKind).toBe('unsupported-version');
    expect(unsupported.blockMessage).toMatch(/unsupported version \(99\)/);
  });

  it('reports a genuine storage read failure through the progress store seam', async () => {
    const throwingStore: OnboardingProgressStore = {
      getSetting: () => {
        throw new Error('disk i/o boom');
      },
      saveSetting: () => {
        throw new Error('unused');
      },
      deleteSetting: () => {
        throw new Error('unused');
      },
    };
    const { handle } = await startBackend(undefined, {
      progressStore: throwingStore,
    });
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('blocked');
    expect(status.blockKind).toBe('storage-failure');
    expect(status.blockMessage).toBe(
      'Onboarding progress could not be loaded.',
    );
    // No diagnostic details leak.
    expect(status.blockMessage).not.toMatch(/boom/);
    expect(status.blockMessage).not.toMatch(/stack/i);
    expect(status.blockMessage).not.toMatch(/i\/o/i);
    // Completion marker and edit session remain readable; they are
    // independent of the throwing progress store.
    expect(status.completion.completed).toBe(false);
    expect(status.editSession.editing).toBe(false);
  });

  it('requires an explicit reset before replacing invalid progress', async () => {
    const { handle } = await startBackend();
    const firstSave = await postJson(handle, '/api/onboarding/save', {
      snapshot: snapshotV2,
    });
    expect(firstSave.status).toBe(200);

    const secondSave = await postJson(handle, '/api/onboarding/save', {
      snapshot: { ...snapshotV2, currentQuestion: 'location' },
    });
    expect(secondSave.status).toBe(200);

    const reset = await fetch(`${handle.baseUrl}/api/onboarding/reset`, {
      method: 'POST',
    });
    expect(reset.status).toBe(200);
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('not-started');
    expect(status.completion.completed).toBe(false);
  });

  it('rejects save with invalid bodies', async () => {
    const { handle } = await startBackend();
    const response = await postJson(handle, '/api/onboarding/save', {
      wrong: 'shape',
    });
    expect(response.status).toBe(400);
    const body = await readJson<{ code: string }>(response);
    expect(body.code).toBe('onboarding_save_validation_failed');
  });
});

describe('onboarding API — completed user can edit', () => {
  it('returns an editable wizard with a prefilled draft once editSession.editing is true', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-completed',
    });
    // Start an edit session explicitly (the client does this from
    // the completed view's "Edit search setup" button).
    const start = await postJson(handle, '/api/onboarding/edit/start', {});
    expect(start.status).toBe(200);

    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.editSession.editing).toBe(true);
    // Completion marker remains preserved while editing.
    expect(status.completion.completed).toBe(true);
    // Wizard state takes precedence over the completed view.
    expect(status.state).toBe('in-progress');
    // No resumable snapshot was stored (completion cleared progress);
    // the prefilled draft comes from the current saved profile.
    expect(status.prefilledDraft).toBeDefined();
    expect(status.prefilledDraft?.desiredJobTitles).toEqual([
      'Network Engineer',
    ]);
  });

  it('discarding an edit preserves the completion marker and returns to completed', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-completed',
    });
    await postJson(handle, '/api/onboarding/edit/start', {});
    // Discard the edit (keepProgress:false clears the snapshot but
    // preserves the completion marker).
    const discard = await postJson(handle, '/api/onboarding/edit/end', {
      keepProgress: false,
    });
    expect(discard.status).toBe(200);
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('completed');
    expect(status.completion.completed).toBe(true);
    expect(status.editSession.editing).toBe(false);
  });

  it('clearing blocked progress by default preserves completed history', async () => {
    const { handle, database } = await startBackend(makeCoordinator());
    markCompleted(database);
    await postJson(handle, '/api/onboarding/edit/start', {});
    const reset = await postJson(handle, '/api/onboarding/reset', {});
    expect(reset.status).toBe(200);
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.completion.completed).toBe(true);
    expect(status.editSession.editing).toBe(false);
    expect(status.editSession.resumable).toBe(false);
    expect(status.state).toBe('completed');
  });

  it('saves, leaves, resumes, and completes an established user edit', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const { handle, profilePreferencesPath } = await startBackend(
      makeCoordinator({ runAll }),
      { withReadySource: true },
    );
    const initialPreview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const initialCompletion = await postJson(
      handle,
      '/api/onboarding/complete',
      {
        preferences: basePreferences,
        reviewItems: [],
        planToken: initialPreview.planToken,
        attemptId: 'established-initial',
      },
    );
    expect(initialCompletion.status).toBe(200);

    await postJson(handle, '/api/onboarding/edit/start', {});
    const editedSnapshot: OnboardingProgressSnapshot = {
      version: 2,
      onboardingStep: 'review',
      currentQuestion: 'location',
      answers: {
        ...createEmptyPreferencesDraft(),
        desiredJobTitles: ['Cloud Support Engineer'],
        preferredLocations: [{ city: 'Example City', state: 'EX' }],
        searchRadiusMiles: '25',
        secondarySearchRadiusMiles: '50',
        remotePreference: 'preferred',
        answers: {
          remotePreference: 'answered',
          desiredSalary: 'unanswered',
        },
        desiredEmploymentTypes: ['full-time'],
      },
      reviewItems: [],
    };
    const save = await postJson(handle, '/api/onboarding/save', {
      snapshot: editedSnapshot,
    });
    expect(save.status).toBe(200);
    const leave = await postJson(handle, '/api/onboarding/edit/end', {
      keepProgress: true,
    });
    expect(leave.status).toBe(200);

    // Simulate reload: completion history remains but the saved edit is
    // returned as an editable in-progress wizard at the exact state.
    const resumed = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(resumed.completion.completed).toBe(true);
    expect(resumed.editSession).toMatchObject({
      editing: false,
      resumable: true,
    });
    expect(resumed.state).toBe('in-progress');
    expect(resumed.snapshot).toEqual(editedSnapshot);
    const resumedAgain = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(resumedAgain.snapshot).toEqual(editedSnapshot);

    const editedPreferences = {
      ...basePreferences,
      desiredJobTitles: ['Cloud Support Engineer'],
    };
    const editedPreview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: editedPreferences,
        confirmedTitles: editedPreferences.desiredJobTitles,
      }),
    );
    const completeEdit = await postJson(handle, '/api/onboarding/complete', {
      preferences: editedPreferences,
      reviewItems: [],
      planToken: editedPreview.planToken,
      attemptId: 'established-edit',
    });
    expect(completeEdit.status).toBe(200);
    const finalStatus = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(finalStatus.state).toBe('completed');
    expect(finalStatus.completion.completed).toBe(true);
    expect(finalStatus.editSession.resumable).toBe(false);
    expect(
      loadUnifiedLegacyPreferences(profilePreferencesPath)?.candidateProfile
        .desiredJobTitles,
    ).toEqual(['Cloud Support Engineer']);
  });
});

describe('onboarding API — preview and completion', () => {
  it('builds a preview from the validated current draft and exposes a plan token', async () => {
    const { handle } = await startBackend(makeCoordinator(), {
      withReadySource: true,
    });
    const response = await postJson(handle, '/api/onboarding/preview', {
      preferences: basePreferences,
      confirmedTitles: ['Network Engineer'],
    });
    expect(response.status).toBe(200);
    const body = await readJson<OnboardingPreviewResponse>(response);
    expect(body.plan.version).toBe(ONBOARDING_SEARCH_PLAN_VERSION);
    expect(body.plan.appliedQueries).toEqual(['Network Engineer']);
    expect(body.planToken).toMatch(/^[a-f0-9]{64}$/);
    expect(body.confirmationAllowed).toBe(true);
  });

  it('builds a draft from the existing profile', async () => {
    const { handle } = await startBackend(makeCoordinator(), {
      profileOverrides: {
        preferredLocations: [
          { city: 'Austin', state: 'TX' },
          { city: 'Remote', state: 'TX' },
        ],
        searchRadiusMiles: 35,
        secondarySearchRadiusMiles: 75,
        remotePreference: 'not-preferred',
        desiredSalary: { minimum: 65000, target: 90000, currency: 'USD' },
        desiredJobTitles: ['Systems Administrator', 'Network Engineer'],
        desiredEmploymentTypes: ['full-time', 'contract'],
      },
    });
    const response = await fetch(
      `${handle.baseUrl}/api/onboarding/draft-from-profile`,
      { method: 'POST' },
    );
    expect(response.status).toBe(200);
    const body = await readJson<{
      draft: OnboardingPreferencesDraft;
      planToken: string;
      confirmationAllowed: boolean;
    }>(response);
    expect(body.draft.desiredJobTitles).toEqual([
      'Systems Administrator',
      'Network Engineer',
    ]);
    expect(body.draft.preferredLocations).toEqual([
      { city: 'Austin', state: 'TX' },
      { city: 'Remote', state: 'TX' },
    ]);
    expect(body.draft.searchRadiusMiles).toBe('35');
    expect(body.draft.secondarySearchRadiusMiles).toBe('75');
    expect(body.draft.remotePreference).toBe('not-preferred');
    expect(body.draft.desiredEmploymentTypes).toEqual([
      'full-time',
      'contract',
    ]);
    expect(body.draft.desiredSalary).toEqual({
      minimum: '65000',
      target: '90000',
      currency: 'USD',
    });
    expect(body.draft.answers.desiredSalary).toBe('answered');
    expect(body.planToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it('initializes unified preferences from current authorities on a genuinely fresh install', async () => {
    const { handle, profilePreferencesPath } = await startBackend(undefined, {
      withReadySource: true,
      noCoordinator: true,
    });
    rmSync(profilePreferencesPath, { force: true });

    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: basePreferences.desiredJobTitles,
      }),
    );
    expect(preview.confirmationAllowed).toBe(true);

    const response = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'fresh-install-first-completion',
    });

    expect(response.status).toBe(200);
    const body = await readJson<OnboardingCompleteResponse>(response);
    expect(body.ok).toBe(true);
    expect(body.discoveryOutcome.state).toBe('unavailable');
    expect(existsSync(profilePreferencesPath)).toBe(true);
    const stored = profilePreferencesSchema.parse(
      JSON.parse(readFileSync(profilePreferencesPath, 'utf8')) as unknown,
    );
    expect(stored.candidate.id).toBe('candidate-api-one');
    expect(stored.jobPreferences.desiredJobTitles).toEqual([
      'Network Engineer',
    ]);
    expect(stored.discovery.sourceQueryRoles).toEqual(['Network Engineer']);
  });

  it('completes onboarding once with a matching plan token and persists the outcome', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const attemptId = 'attempt-a';
    const response = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(response.status).toBe(200);
    const body = await readJson<OnboardingCompleteResponse>(response);
    expect(body.ok).toBe(true);
    expect(body.idempotent).toBe(false);
    expect(body.discoveryOutcome.state).toBe('succeeded');
    expect(body.discoveryOutcome.attemptId).toBe(attemptId);
    expect(runAll).toHaveBeenCalledTimes(1);

    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('completed');
    expect(status.completion.completed).toBe(true);
    expect(status.discoveryOutcome.state).toBe('succeeded');
  });

  it('is idempotent for a completed attemptId', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const attemptId = 'attempt-b';
    const first = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(first.status).toBe(200);
    const firstBody = await readJson<OnboardingCompleteResponse>(first);
    expect(runAll).toHaveBeenCalledTimes(1);

    const second = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(second.status).toBe(200);
    const secondBody = await readJson<OnboardingCompleteResponse>(second);
    expect(secondBody).toEqual(firstBody);
    // No duplicate discovery run.
    expect(runAll).toHaveBeenCalledTimes(1);
  });

  it('rejects completion with a stale plan token and returns a refreshed plan', async () => {
    const { handle } = await startBackend(makeCoordinator(), {
      withReadySource: true,
    });
    const stalePreferences = {
      ...basePreferences,
      desiredJobTitles: ['Network Engineer', 'Cloud Support Engineer'],
    };
    const stalePreview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: stalePreferences,
        confirmedTitles: stalePreferences.desiredJobTitles,
      }),
    );
    const response = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: stalePreview.planToken,
      attemptId: 'attempt-stale',
    });
    expect(response.status).toBe(409);
    const body = await readJson<{
      code: string;
      planToken: string;
      plan: { appliedQueries: string[] };
    }>(response);
    expect(body.code).toBe('onboarding_complete_stale_plan');
    expect(body.planToken).not.toBe(stalePreview.planToken);
    expect(body.plan.appliedQueries).toEqual(['Network Engineer']);
  });

  it('rejects completion when confirmationAllowed is false (zero ready sources)', async () => {
    const { handle } = await startBackend(makeCoordinator());
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    expect(preview.confirmationAllowed).toBe(false);
    const response = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-no-confirm',
    });
    expect(response.status).toBe(409);
    const body = await readJson<{ code: string }>(response);
    expect(body.code).toBe('onboarding_complete_not_confirmable');
  });

  it('does not run discovery when profile persistence fails (real seam)', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const cascadeTargetRoles = vi.fn();
    const throwingSave: (
      path: string | undefined,
      prefs: LegacyPreferences,
    ) => void = () => {
      throw new Error('disk i/o profile preferences boom');
    };
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
      saveProfilePreferences: throwingSave,
      cascadeTargetRoles,
    });
    const savedProgress = await postJson(handle, '/api/onboarding/save', {
      snapshot: snapshotV2,
    });
    expect(savedProgress.status).toBe(200);
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const response = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-persist-fail',
    });
    expect(response.status).toBe(500);
    const body = await readJson<{ code: string; error: string }>(response);
    expect(body.code).toBe('onboarding_complete_persist_failed');
    expect(body.error).toBe(
      'Onboarding could not be saved to your profile preferences.',
    );
    expect(cascadeTargetRoles).not.toHaveBeenCalled();
    expect(runAll).not.toHaveBeenCalled();
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.completion.completed).toBe(false);
    expect(status.state).toBe('in-progress');
    expect(status.snapshot).toEqual(snapshotV2);
  });

  it('reports a bounded discovery error and supports search-only retry', async () => {
    const runAll = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom timeout'))
      .mockResolvedValueOnce([]);
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const response = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-disc-fail',
    });
    expect(response.status).toBe(200);
    const body = await readJson<OnboardingCompleteResponse>(response);
    expect(body.ok).toBe(true);
    expect(body.discoveryOutcome.state).toBe('failed');
    expect(body.discoveryOutcome.message).toBe(
      'Discovery could not complete. Review Sources and retry.',
    );

    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('completed');
    expect(status.discoveryOutcome.state).toBe('failed');

    const retry = await fetch(
      `${handle.baseUrl}/api/onboarding/discovery/retry`,
      { method: 'POST' },
    );
    expect(retry.status).toBe(200);
    expect(runAll).toHaveBeenCalledTimes(2);
    const retryBody = await readJson<OnboardingCompleteResponse>(retry);
    expect(retryBody.ok).toBe(true);
    expect(retryBody.discoveryOutcome.state).toBe('succeeded');
    expect(runAll).toHaveBeenCalledTimes(2);

    const statusAfter = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(statusAfter.discoveryOutcome.state).toBe('succeeded');
  });

  it('rejects search-only retry when onboarding has not been completed', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
    });
    const retry = await fetch(
      `${handle.baseUrl}/api/onboarding/discovery/retry`,
      { method: 'POST' },
    );
    expect(retry.status).toBe(409);
    expect(runAll).not.toHaveBeenCalled();
  });

  it('recovers from a one-shot cascade failure using the same completion attempt', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    let failCascade = true;
    let sourceRepository: SourceRepository | null = null;
    const cascadeTargetRoles = (roles: readonly string[]) => {
      if (failCascade) throw new Error('boom cascade');
      if (sourceRepository === null)
        throw new Error('test source repository missing');
      sourceRepository.cascadeTargetRoles([...roles]);
    };
    const { handle, database, profilePreferencesPath } = await startBackend(
      makeCoordinator({ runAll }),
      {
        withReadySource: true,
        cascadeTargetRoles,
      },
    );
    sourceRepository = new SourceRepository(database, profilePreferencesPath);
    const progressSave = await postJson(handle, '/api/onboarding/save', {
      snapshot: snapshotV2,
    });
    expect(progressSave.status).toBe(200);
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const response = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-cascade-fail',
    });
    expect(response.status).toBe(500);
    const body = await readJson<{
      code: string;
      error: string;
      ok: boolean;
    }>(response);
    expect(body.code).toBe('onboarding_complete_cascade_failed');
    expect(body.error).toBe('Source query roles could not be cascaded.');
    expect(body.ok).toBe(false);
    expect(runAll).not.toHaveBeenCalled();
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.completion.completed).toBe(false);
    expect(status.state).toBe('in-progress');
    expect(status.snapshot).toEqual(snapshotV2);

    // Removing the one-shot failure allows the same attempt ID to retry
    // persistence/cascade/finalization and launch discovery exactly once.
    failCascade = false;
    const recovered = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-cascade-fail',
    });
    expect(recovered.status).toBe(200);
    const recoveredBody = await readJson<OnboardingCompleteResponse>(recovered);
    expect(recoveredBody.ok).toBe(true);
    expect(recoveredBody.idempotent).toBe(false);
    expect(runAll).toHaveBeenCalledTimes(1);
    const cascadedSource = sourceRepository.list()[0];
    expect(cascadedSource?.searchCriteria.queries).toEqual([
      'Network Engineer',
    ]);
  });

  it('computes a deterministic plan token', () => {
    const planA = {
      version: 1 as const,
      confirmedTitles: ['Engineer'],
      appliedQueries: ['Engineer'],
      omittedTitles: [],
      preferredLocations: [{ city: 'Austin', state: 'TX' }],
      remotePreference: 'preferred' as const,
      primaryRadiusMiles: 25,
      secondaryRadiusMiles: 50,
      sources: [],
      totalSourceCount: 0,
      readySourceCount: 0,
      needsAttentionSourceCount: 0,
      excludedSourceCount: 0,
      warnings: [],
      confirmationAllowed: true,
    };
    expect(computeOnboardingPlanToken(planA)).toBe(
      computeOnboardingPlanToken(planA),
    );
    expect(computeOnboardingPlanToken(planA)).not.toBe(
      computeOnboardingPlanToken({
        ...planA,
        appliedQueries: ['Engineer', 'Other'],
      }),
    );
  });

  it('refuses a repeated attemptId while another completion attempt is in progress', async () => {
    let releaseDiscovery!: (value: DiscoverySummary[]) => void;
    const discoveryPromise = new Promise<DiscoverySummary[]>((resolve) => {
      releaseDiscovery = resolve;
    });
    const runAll = vi.fn(() => discoveryPromise);
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const attemptId = 'attempt-concurrent';
    // Start the first call; do NOT await it (it blocks on discovery).
    void postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    // Poll until the in-progress attempt record has been persisted so
    // the second call observes a concurrent attempt rather than racing
    // the router's body execution.
    const deadline = Date.now() + 1000;
    let observed = false;
    while (Date.now() < deadline) {
      const probe = await get(handle, '/api/onboarding/status');
      const probeBody = await readJson<OnboardingStatusResponse>(probe);
      void probeBody;
      // The discovery outcome transitions to 'running' on first call.
      if (probeBody.discoveryOutcome.state === 'running') {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(observed).toBe(true);

    const second = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(second.status).toBe(409);
    const body = await readJson<{ code: string }>(second);
    expect(body.code).toBe('onboarding_complete_attempt_in_progress');

    releaseDiscovery([]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(runAll).toHaveBeenCalledTimes(1);
  });

  it('refuses a different attemptId while the same profile is completing', async () => {
    let releaseDiscovery!: (value: DiscoverySummary[]) => void;
    const discoveryPromise = new Promise<DiscoverySummary[]>((resolve) => {
      releaseDiscovery = resolve;
    });
    const runAll = vi.fn(() => discoveryPromise);
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );

    void postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-profile-first',
    });
    const deadline = Date.now() + 1000;
    let observed = false;
    while (Date.now() < deadline) {
      const status = await readJson<OnboardingStatusResponse>(
        await get(handle, '/api/onboarding/status'),
      );
      if (status.discoveryOutcome.state === 'running') {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(observed).toBe(true);

    const second = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-profile-second',
    });
    releaseDiscovery([]);
    expect(second.status).toBe(409);
    expect((await readJson<{ code: string }>(second)).code).toBe(
      'onboarding_complete_profile_in_progress',
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(runAll).toHaveBeenCalledTimes(1);
  });

  it('rejects a new completion attempt after completion unless an edit was started', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const first = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-first-completion',
    });
    expect(first.status).toBe(200);

    const duplicate = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-second-completion',
    });
    expect(duplicate.status).toBe(409);
    expect((await readJson<{ code: string }>(duplicate)).code).toBe(
      'onboarding_complete_already_completed',
    );
    expect(runAll).toHaveBeenCalledTimes(1);

    expect(
      (await postJson(handle, '/api/onboarding/edit/start', {})).status,
    ).toBe(200);
    const edited = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-approved-edit',
    });
    expect(edited.status).toBe(200);
    expect(runAll).toHaveBeenCalledTimes(2);
  });

  it('bounds completion attempt ids and edit-start validation errors', async () => {
    const { handle } = await startBackend(makeCoordinator(), {
      withReadySource: true,
    });
    const invalidAttempt = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: 'token',
      attemptId: 'x'.repeat(129),
    });
    expect(invalidAttempt.status).toBe(400);
    expect((await readJson<{ code: string }>(invalidAttempt)).code).toBe(
      'onboarding_complete_validation_failed',
    );

    const invalidEditStart = await postJson(
      handle,
      '/api/onboarding/edit/start',
      { unexpected: true },
    );
    expect(invalidEditStart.status).toBe(400);
    expect((await readJson<{ code: string }>(invalidEditStart)).code).toBe(
      'onboarding_edit_start_validation_failed',
    );
  });
});

describe('onboarding API — staged attempt retry semantics', () => {
  it('remembers a failed-retryable attempt and allows the same attempt id to succeed once the failure is removed', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    let cascadeShouldThrow = true;
    let realSourceRepository: SourceRepository | null = null;
    const cascadeTargetRoles = (roles: readonly string[]) => {
      if (cascadeShouldThrow) throw new Error('boom cascade');
      if (realSourceRepository === null) {
        throw new Error('test source repository is unavailable');
      }
      realSourceRepository.cascadeTargetRoles([...roles]);
    };
    const { handle, database, profilePreferencesPath } = await startBackend(
      makeCoordinator({ runAll }),
      {
        withReadySource: true,
        cascadeTargetRoles,
      },
    );
    realSourceRepository = new SourceRepository(
      database,
      profilePreferencesPath,
    );
    const savedProgress = await postJson(handle, '/api/onboarding/save', {
      snapshot: snapshotV2,
    });
    expect(savedProgress.status).toBe(200);
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const attemptId = 'attempt-retry';
    // First call: cascade fails → 500, not 200.
    const failed = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(failed.status).toBe(500);
    expect(runAll).not.toHaveBeenCalled();
    const failedBody = await readJson<{ ok: boolean }>(failed);
    expect(failedBody.ok).toBe(false);
    const statusAfterFail = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(statusAfterFail.completion.completed).toBe(false);
    expect(statusAfterFail.state).toBe('in-progress');
    expect(statusAfterFail.snapshot).toEqual(snapshotV2);
    // The stored record is `failed-retryable`, not a fake success. A
    // replay does not return HTTP 200.
    const replayWhileStillFailing = await postJson(
      handle,
      '/api/onboarding/complete',
      {
        preferences: basePreferences,
        reviewItems: [],
        planToken: preview.planToken,
        attemptId,
      },
    );
    expect(replayWhileStillFailing.status).toBe(500);

    // Remove the cascade failure and retry the same attempt id.
    cascadeShouldThrow = false;
    const ok = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(ok.status).toBe(200);
    const okBody = await readJson<OnboardingCompleteResponse>(ok);
    expect(okBody.ok).toBe(true);
    expect(okBody.idempotent).toBe(false);
    expect(runAll).toHaveBeenCalledTimes(1);
    expect(realSourceRepository.list()[0]?.searchCriteria.queries).toEqual([
      'Network Engineer',
    ]);
    // A third replay of the same attempt id is idempotent.
    const replay = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(replay.status).toBe(200);
    const replayBody = await readJson<OnboardingCompleteResponse>(replay);
    expect(replayBody).toEqual(okBody);
    expect(runAll).toHaveBeenCalledTimes(1);
  });

  it('marks a persistence failure as failed-retryable so the next call can succeed', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    let saveShouldThrow = true;
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
      saveProfilePreferences: () => {
        if (saveShouldThrow) throw new Error('boom persist');
      },
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const attemptId = 'attempt-persist-retry';
    const failed = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(failed.status).toBe(500);
    expect(runAll).not.toHaveBeenCalled();
    saveShouldThrow = false;
    const ok = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(ok.status).toBe(200);
    const okBody = await readJson<OnboardingCompleteResponse>(ok);
    expect(okBody.ok).toBe(true);
    expect(runAll).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// MR1-06 third correction pass — deterministic coverage of every
// release-blocking defect listed in the Codex review.
// ---------------------------------------------------------------------------

describe('onboarding API — authoritative credential resolution', () => {
  it('refreshes credential status for every plan path and rejects/reviews a token when availability changes', async () => {
    let credentialAvailable = false;
    const credentialStatus = vi.fn(() =>
      Promise.resolve({
        configured: credentialAvailable,
        available: credentialAvailable,
      }),
    );
    const descriptors = [
      {
        id: 'credential-provider',
        name: 'Credential Provider',
        type: 'job-board' as const,
        capabilities: {
          keywordSearch: true,
          locationSearch: true,
          remoteFilter: true,
          pagination: true,
          compensation: true,
          requiresCredentials: true,
          structuredPreview: false,
        },
        // This intentionally says available=true. The server must
        // ignore it and ask the resolver every time.
        credentialStatus: { configured: true, available: true },
        supportState: 'supported' as const,
      },
    ];
    const runAll = vi.fn(() => Promise.resolve([]));
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withCredentialRequiredSource: true,
      providerDescriptors: descriptors,
      credentialResolver: {
        status: credentialStatus,
        resolve: () => Promise.resolve(null),
      },
    });

    const unavailablePreview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    expect(credentialStatus).toHaveBeenCalled();
    expect(unavailablePreview.plan.readySourceCount).toBe(0);
    expect(unavailablePreview.plan.sources[0]?.state).toBe('needs-attention');
    expect(unavailablePreview.confirmationAllowed).toBe(false);
    expect(JSON.stringify(unavailablePreview)).not.toContain(
      'configured":true',
    );

    // Status prefill uses the same asynchronous plan path. A second
    // request must query the resolver again, not reuse a router-lifetime
    // cache.
    const callsBeforeStatus = credentialStatus.mock.calls.length;
    await get(handle, '/api/onboarding/status');
    expect(credentialStatus.mock.calls.length).toBeGreaterThan(
      callsBeforeStatus,
    );
    const callsBeforeDraft = credentialStatus.mock.calls.length;
    await fetch(`${handle.baseUrl}/api/onboarding/draft-from-profile`, {
      method: 'POST',
    });
    expect(credentialStatus.mock.calls.length).toBeGreaterThan(
      callsBeforeDraft,
    );
    // Credentials become available while the process is open.
    credentialAvailable = true;
    const availablePreview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    expect(availablePreview.plan.readySourceCount).toBe(1);
    expect(availablePreview.confirmationAllowed).toBe(true);
    expect(availablePreview.planToken).not.toBe(unavailablePreview.planToken);

    // The old token is stale; the server returns the freshly rebuilt
    // plan and requires the user to review it again.
    const stale = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: unavailablePreview.planToken,
      attemptId: 'credential-attempt',
    });
    expect(stale.status).toBe(409);
    const staleBody = await readJson<{ code: string; planToken: string }>(
      stale,
    );
    expect(staleBody.code).toBe('onboarding_complete_stale_plan');
    expect(staleBody.planToken).toBe(availablePreview.planToken);

    // Reusing the same retryable attempt with the reviewed fresh token
    // succeeds, and preview + completion token calculations match when
    // credential status is unchanged.
    const completed = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: availablePreview.planToken,
      attemptId: 'credential-attempt',
    });
    expect(completed.status).toBe(200);
    expect(runAll).toHaveBeenCalledTimes(1);
  });

  it('preview and completion use the same credential status without a false stale-plan response', async () => {
    const statusSpy = vi.fn(() =>
      Promise.resolve({ configured: true, available: true }),
    );
    const descriptors = [
      {
        id: 'credential-provider',
        name: 'Credential Provider',
        type: 'job-board' as const,
        capabilities: {
          keywordSearch: true,
          locationSearch: true,
          remoteFilter: true,
          pagination: true,
          compensation: true,
          requiresCredentials: true,
          structuredPreview: false,
        },
        credentialStatus: { configured: false, available: false },
        supportState: 'supported' as const,
      },
    ];
    const runAll = vi.fn(() => Promise.resolve([]));
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withCredentialRequiredSource: true,
      providerDescriptors: descriptors,
      credentialResolver: {
        status: statusSpy,
        resolve: () => Promise.resolve(null),
      },
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    expect(preview.confirmationAllowed).toBe(true);
    const completed = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'credential-stable-attempt',
    });
    expect(completed.status).toBe(200);
    expect(statusSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(runAll).toHaveBeenCalledTimes(1);
  });
});

describe('onboarding API — buildStatus precedence for invalid progress', () => {
  it('reports blocked/malformed even with an active edit session', async () => {
    const { handle, database } = await startBackend(makeCoordinator());
    markCompleted(database);
    // Insert malformed progress.
    database
      .prepare(
        `INSERT OR REPLACE INTO app_settings (setting_key, setting_value_json, updated_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(
        `${ONBOARDING_PROGRESS_SETTING_PREFIX}candidate-api-one`,
        '{not-json',
      );
    // Start an edit session explicitly.
    await postJson(handle, '/api/onboarding/edit/start', {});
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('blocked');
    expect(status.blockKind).toBe('malformed');
    expect(status.editSession.editing).toBe(true);
    // Completion marker remains preserved.
    expect(status.completion.completed).toBe(true);
  });

  it('reports blocked/unsupported-version even with an active edit session', async () => {
    const { handle, database } = await startBackend(makeCoordinator());
    markCompleted(database);
    database
      .prepare(
        `INSERT OR REPLACE INTO app_settings (setting_key, setting_value_json, updated_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(
        `${ONBOARDING_PROGRESS_SETTING_PREFIX}candidate-api-one`,
        JSON.stringify({ version: 99 }),
      );
    await postJson(handle, '/api/onboarding/edit/start', {});
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('blocked');
    expect(status.blockKind).toBe('unsupported-version');
    expect(status.completion.completed).toBe(true);
    expect(status.editSession.editing).toBe(true);
  });

  it('reports blocked/storage-failure even with an active edit session', async () => {
    const getSetting = vi.fn(() => {
      throw new Error('disk i/o boom');
    });
    const saveSetting = vi.fn();
    const deleteSetting = vi.fn();
    const throwingStore: OnboardingProgressStore = {
      getSetting,
      saveSetting,
      deleteSetting,
    };
    const { handle, database } = await startBackend(undefined, {
      progressStore: throwingStore,
    });
    markCompleted(database);
    await postJson(handle, '/api/onboarding/edit/start', {});
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.state).toBe('blocked');
    expect(status.blockKind).toBe('storage-failure');
    expect(status.editSession.editing).toBe(true);
    expect(status.completion.completed).toBe(true);
    expect(status.blockMessage).toBe(
      'Onboarding progress could not be loaded.',
    );
    expect(status.blockMessage).not.toContain('disk');
    expect(getSetting).toHaveBeenCalledTimes(1);
    expect(saveSetting).not.toHaveBeenCalled();
    expect(deleteSetting).not.toHaveBeenCalled();
  });
});

describe('onboarding API — terminal attempt replay is idempotent', () => {
  it('stores the terminal response inside the attempt record and replays it', async () => {
    const runAll = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom timeout'))
      .mockResolvedValueOnce([]);
    const saveSpy = vi.fn(() => undefined);
    const cascadeSpy = vi.fn();
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
      saveProfilePreferences: saveSpy,
      cascadeTargetRoles: cascadeSpy,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    // Completion with discovery failure is stored as a terminal
    // `completed` attempt whose response includes the failed
    // discovery outcome.
    const first = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-terminal-a',
    });
    expect(first.status).toBe(200);
    const firstBody = await readJson<OnboardingCompleteResponse>(first);
    expect(firstBody.ok).toBe(true);
    expect(firstBody.discoveryOutcome.state).toBe('failed');
    expect(runAll).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(cascadeSpy).toHaveBeenCalledTimes(1);

    // A search-only retry overwrites the mutable global outcome with a
    // different attempt ID.
    const retry = await fetch(
      `${handle.baseUrl}/api/onboarding/discovery/retry`,
      { method: 'POST' },
    );
    expect(retry.status).toBe(200);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(cascadeSpy).toHaveBeenCalledTimes(1);

    // Replay of the original completion attempt must return the stored
    // terminal response (failed), NOT the newer retry outcome.
    const replay = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-terminal-a',
    });
    expect(replay.status).toBe(200);
    const replayBody = await readJson<OnboardingCompleteResponse>(replay);
    expect(replayBody).toEqual(firstBody);
    // Discovery was NOT re-run for the replay.
    // The second call was the explicit search-only retry above; replay
    // itself did not add a third discovery run.
    expect(runAll).toHaveBeenCalledTimes(2);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(cascadeSpy).toHaveBeenCalledTimes(1);
  });

  it('treats a discovery-failed completion as terminal; a second /complete does not re-run discovery', async () => {
    const runAll = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom timeout'))
      .mockResolvedValueOnce([]);
    const { handle } = await startBackend(makeCoordinator({ runAll }), {
      withReadySource: true,
    });
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const attemptId = 'attempt-discovery-failed';
    const first = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(first.status).toBe(200);
    const firstBody = await readJson<OnboardingCompleteResponse>(first);
    expect(firstBody.ok).toBe(true);
    expect(firstBody.discoveryOutcome.state).toBe('failed');
    expect(runAll).toHaveBeenCalledTimes(1);

    const replay = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId,
    });
    expect(replay.status).toBe(200);
    const replayBody = await readJson<OnboardingCompleteResponse>(replay);
    expect(replayBody).toEqual(firstBody);
    expect(runAll).toHaveBeenCalledTimes(1);

    // /discovery/retry runs discovery a second time and can succeed.
    const retry = await fetch(
      `${handle.baseUrl}/api/onboarding/discovery/retry`,
      { method: 'POST' },
    );
    expect(retry.status).toBe(200);
    const retryBody = await readJson<OnboardingCompleteResponse>(retry);
    expect(retryBody.discoveryOutcome.state).toBe('succeeded');
    expect(runAll).toHaveBeenCalledTimes(2);
  });
});

describe('onboarding API — discard and finalization cleanup failures', () => {
  it('returns a bounded failure when discard cannot clear resumable progress', async () => {
    let databaseRef: JobDatabase | null = null;
    let failDelete = false;
    const { handle, database } = await startBackend(makeCoordinator(), {
      withReadySource: true,
      deleteOnboardingProgress: (profileId) => {
        if (failDelete) throw new Error('disk on fire');
        if (databaseRef === null) throw new Error('test database missing');
        resetOnboardingProgress(
          createDatabaseOnboardingProgressStore(databaseRef),
          profileId,
        );
      },
    });
    databaseRef = database;
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const completed = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'discard-setup-complete',
    });
    expect(completed.status).toBe(200);
    await postJson(handle, '/api/onboarding/edit/start', {});
    const progress = await postJson(handle, '/api/onboarding/save', {
      snapshot: snapshotV2,
    });
    expect(progress.status).toBe(200);

    failDelete = true;
    const discard = await postJson(handle, '/api/onboarding/edit/end', {
      keepProgress: false,
    });
    expect(discard.status).toBe(500);
    const discardBody = await readJson<{ code: string; error: string }>(
      discard,
    );
    expect(discardBody.code).toBe('onboarding_edit_discard_failed');
    expect(discardBody.error).toMatch(/discard/i);
    // Completion history and edit marker survive the failed discard.
    const status = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(status.completion.completed).toBe(true);
    expect(status.editSession.editing).toBe(true);
    expect(status.state).toBe('in-progress');
    expect(status.snapshot).toEqual(snapshotV2);
  });

  it('rolls back finalization and does not run discovery when progress delete fails', async () => {
    const runAll = vi.fn(() => Promise.resolve([]));
    let databaseRef: JobDatabase | null = null;
    let failDelete = true;
    const { handle, database } = await startBackend(
      makeCoordinator({ runAll }),
      {
        withReadySource: true,
        deleteOnboardingProgress: (profileId: string) => {
          if (failDelete) throw new Error('disk on fire');
          if (databaseRef === null) throw new Error('test database missing');
          resetOnboardingProgress(
            createDatabaseOnboardingProgressStore(databaseRef),
            profileId,
          );
        },
      },
    );
    databaseRef = database;
    // Pre-seed a valid v2 progress snapshot so the earlier `save`
    // step in the completion handler does not fail before
    // finalization.
    saveOnboardingProgressForTest(database);
    await postJson(handle, '/api/onboarding/edit/start', {});
    const preview = await readJson<OnboardingPreviewResponse>(
      await postJson(handle, '/api/onboarding/preview', {
        preferences: basePreferences,
        confirmedTitles: ['Network Engineer'],
      }),
    );
    const response = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-finalize-fail',
    });
    expect(response.status).toBe(500);
    const body = await readJson<{ code: string }>(response);
    expect(body.code).toBe('onboarding_complete_finalize_failed');
    expect(runAll).not.toHaveBeenCalled();
    // Completion marker was rolled back.
    const completionRow = database
      .prepare<
        [string],
        { setting_value_json: string } | undefined
      >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
      .get(`onboardingCompletion:candidate-api-one`);
    expect(completionRow).toBeUndefined();
    const blockedStatus = await readJson<OnboardingStatusResponse>(
      await get(handle, '/api/onboarding/status'),
    );
    expect(blockedStatus.completion.completed).toBe(false);
    expect(blockedStatus.editSession.editing).toBe(true);
    expect(blockedStatus.state).toBe('in-progress');
    expect(blockedStatus.snapshot).toBeDefined();
    // The attempt is failed-retryable so the next call can retry
    // after the injected failure is removed.
    const attemptRow = database
      .prepare<
        [string],
        { setting_value_json: string } | undefined
      >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
      .get(`onboardingAttempt:candidate-api-one:attempt-finalize-fail`);
    expect(attemptRow).toBeDefined();
    const parsed = JSON.parse(attemptRow!.setting_value_json) as {
      state: string;
    };
    expect(parsed.state).toBe('failed-retryable');

    // Retrying the same attempt after removing the injected failure
    // successfully finalizes and starts discovery exactly once.
    failDelete = false;
    const retry = await postJson(handle, '/api/onboarding/complete', {
      preferences: basePreferences,
      reviewItems: [],
      planToken: preview.planToken,
      attemptId: 'attempt-finalize-fail',
    });
    expect(retry.status).toBe(200);
    expect(runAll).toHaveBeenCalledTimes(1);
  });
});

function saveOnboardingProgressForTest(database: JobDatabase): void {
  // Helper used by the finalization-failure test to pre-seed a valid
  // v2 progress snapshot so the earlier `save` step in the completion
  // handler does not fail before finalization.
  saveOnboardingProgress(
    createDatabaseOnboardingProgressStore(database),
    'candidate-api-one',
    {
      version: 2,
      onboardingStep: 'preferences',
      currentQuestion: 'desired-work',
      answers: createEmptyPreferencesDraft(),
      reviewItems: [],
    },
  );
}
