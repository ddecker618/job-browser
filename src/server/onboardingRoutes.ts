import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import { z } from 'zod';

import type { JobDatabase } from '../db/database.js';
import { providerRegistry } from '../providers/providerRegistry.js';
import {
  loadOnboardingProgress,
  resetOnboardingProgress,
  saveOnboardingProgress,
  type OnboardingProgressLoadResult,
  type OnboardingProgressStore,
} from '../repositories/onboarding-repository.js';
import { createDatabaseOnboardingProgressStore } from '../repositories/onboarding-repository.js';
import { SourceRepository } from '../repositories/source-repository.js';
import { loadCandidateProfile } from '../config/candidate-profile.js';
import {
  loadUnifiedLegacyPreferences,
  saveUnifiedProfilePreferences,
} from '../preferences/profilePreferencesRuntime.js';
import {
  applyConfirmedReviewItems,
  resumeOnboardingProgress,
} from '../onboarding/onboarding-service.js';
import { buildOnboardingSearchPlan } from '../onboarding/search-plan-service.js';
import {
  onboardingProgressSnapshotSchema,
  onboardingValidatedPreferencesSchema,
} from '../schemas/onboarding.js';
import { onboardingReviewItemSchema } from '../schemas/onboarding.js';
import type { DiscoveryCoordinator } from '../discovery/discoveryCoordinator.js';
import type { CredentialResolver } from '../discovery/credentialResolver.js';
import type {
  OnboardingProgressSnapshot,
  OnboardingQuestion,
  OnboardingReviewItem,
  OnboardingSearchPlan,
  OnboardingValidatedPreferences,
} from '../models/onboarding.js';
import { DEFAULT_SEARCH_PROFILE } from '../config/search-profile.js';
import { translateError } from '../discovery/discoveryCoordinator.js';

export interface OnboardingRouteOptions {
  database: JobDatabase;
  coordinator?: DiscoveryCoordinator;
  credentialResolver?: CredentialResolver;
  candidateProfilePath?: string;
  profilePreferencesPath?: string;
}

/**
 * Public onboarding status projection. The wire shape deliberately omits
 * raw `Error.message`, stack traces, filesystem paths, URLs with
 * secrets, credentials, or database details. Blocked variants carry
 * only a bounded human-readable message and the original kind so the
 * client can surface a distinct screen.
 */
export interface OnboardingStatusResponse {
  readonly state: 'not-started' | 'in-progress' | 'completed' | 'blocked';
  readonly profileId: string;
  readonly onboardingStep?: OnboardingProgressSnapshot['onboardingStep'];
  readonly question?: OnboardingQuestion | null;
  readonly resumeKind?: 'stored' | 'fresh';
  readonly snapshot?: OnboardingProgressSnapshot;
  readonly plan?: OnboardingSearchPlan;
  readonly blockKind?: 'malformed' | 'unsupported-version' | 'storage-failure';
  readonly blockMessage?: string;
  readonly completion: {
    readonly completed: boolean;
    readonly completedAt: string | null;
  };
}

/**
 * Completion marker key scoped to the candidate profile. The marker
 * distinguishes "onboarding finished" from "onboarding progress
 * missing" without exposing the raw stored row to the client.
 */
export function onboardingCompletionKey(profileId: string): string {
  if (profileId.trim() === '') throw new Error('A profile id is required.');
  return `onboardingCompletion:${profileId}`;
}

function safeBlockMessage(error: Error): string {
  // The client must never see raw diagnostic content. Map common
  // patterns to bounded, user-readable phrases.
  const message = error.message;
  if (message.toLowerCase().includes('json')) {
    return 'Stored onboarding progress is unreadable.';
  }
  if (message.toLowerCase().includes('schema')) {
    return 'Stored onboarding progress does not match the current schema.';
  }
  if (
    message.toLowerCase().includes('disk') ||
    message.toLowerCase().includes('i/o') ||
    message.toLowerCase().includes('io') ||
    message.toLowerCase().includes('econn')
  ) {
    return 'Onboarding progress could not be read from storage.';
  }
  return 'Onboarding progress could not be loaded.';
}

function safeSaveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.toLowerCase().includes('disk') ||
    message.toLowerCase().includes('i/o') ||
    message.toLowerCase().includes('econn')
  ) {
    return 'Onboarding progress could not be saved to storage.';
  }
  if (message.toLowerCase().includes('explicitly reset')) {
    return 'Existing onboarding progress must be reset before it can be replaced.';
  }
  return 'Onboarding progress could not be saved.';
}

function safeCompletionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.toLowerCase().includes('profile') ||
    message.toLowerCase().includes('preferences')
  ) {
    return 'Onboarding could not be saved to your profile preferences.';
  }
  return 'Onboarding could not be completed.';
}

function readCompletionMarker(
  database: JobDatabase,
  profileId: string,
): { completed: boolean; completedAt: string | null } {
  const row = database
    .prepare<
      [string],
      { setting_value_json: string } | undefined
    >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
    .get(onboardingCompletionKey(profileId));
  if (row === undefined) return { completed: false, completedAt: null };
  try {
    const parsed = JSON.parse(row.setting_value_json) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'completedAt' in parsed &&
      typeof (parsed as { completedAt: unknown }).completedAt === 'string'
    ) {
      return {
        completed: true,
        completedAt: (parsed as { completedAt: string }).completedAt,
      };
    }
  } catch {
    // fall through
  }
  return { completed: false, completedAt: null };
}

function writeCompletionMarker(
  database: JobDatabase,
  profileId: string,
): string {
  const completedAt = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO app_settings (setting_key, setting_value_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(setting_key) DO UPDATE SET
         setting_value_json = excluded.setting_value_json,
         updated_at = excluded.updated_at`,
    )
    .run(onboardingCompletionKey(profileId), JSON.stringify({ completedAt }));
  return completedAt;
}

function loadStore(database: JobDatabase): OnboardingProgressStore {
  return createDatabaseOnboardingProgressStore(database);
}

function buildStatus(
  database: JobDatabase,
  profileId: string,
  load: OnboardingProgressLoadResult,
  plan: OnboardingSearchPlan | null,
): OnboardingStatusResponse {
  const completion = readCompletionMarker(database, profileId);
  const base = { profileId, completion };
  // The completion marker is authoritative. A stored completion
  // marker always means "onboarding finished" regardless of the
  // progress row state, so we report `completed` first.
  if (completion.completed) {
    return {
      ...base,
      state: 'completed',
    };
  }
  if (load.kind === 'valid') {
    const resumed = resumeOnboardingProgress(
      load,
      load.snapshot.answers, // answers already live on the stored snapshot
    );
    const question = resumed.kind === 'ready' ? resumed.question : null;
    return {
      ...base,
      state: 'in-progress',
      onboardingStep: load.snapshot.onboardingStep,
      question,
      resumeKind: 'stored',
      snapshot: load.snapshot,
      ...(plan === null ? {} : { plan }),
    };
  }
  if (load.kind === 'missing') {
    return {
      ...base,
      state: 'not-started',
      question: null,
      ...(plan === null ? {} : { plan }),
    };
  }
  if (load.kind === 'malformed') {
    return {
      ...base,
      state: 'blocked',
      blockKind: 'malformed',
      blockMessage: safeBlockMessage(load.error),
    };
  }
  if (load.kind === 'unsupported-version') {
    return {
      ...base,
      state: 'blocked',
      blockKind: 'unsupported-version',
      blockMessage: `Stored onboarding progress uses an unsupported version (${String(load.version)}).`,
    };
  }
  return {
    ...base,
    state: 'blocked',
    blockKind: 'storage-failure',
    blockMessage: safeBlockMessage(load.error),
  };
}

const saveRequestSchema = z.strictObject({
  snapshot: onboardingProgressSnapshotSchema,
});

const completeRequestSchema = z.strictObject({
  preferences: onboardingValidatedPreferencesSchema,
  reviewItems: z.array(onboardingReviewItemSchema),
});

const resetRequestSchema = z.strictObject({}).optional();

const asyncRoute =
  (handler: (request: Request, response: Response) => void | Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    const result = handler(request, response);
    if (result instanceof Promise) {
      result.catch(next);
    }
  };

export function createOnboardingRouter(
  options: OnboardingRouteOptions,
): Router {
  const router = express.Router();
  const {
    database,
    coordinator,
    candidateProfilePath,
    profilePreferencesPath,
  } = options;
  const store = loadStore(database);
  const sourceRepository = new SourceRepository(
    database,
    profilePreferencesPath,
  );

  function currentProfileId(): string {
    const profile = loadCandidateProfile(
      candidateProfilePath,
      profilePreferencesPath,
    );
    if (profile.id.trim() === '') {
      throw new Error('Active candidate profile has no id.');
    }
    return profile.id;
  }

  async function buildPlan(
    validatedPreferences: OnboardingValidatedPreferences,
    confirmedTitles: readonly string[],
  ): Promise<OnboardingSearchPlan> {
    const unified = loadUnifiedLegacyPreferences(profilePreferencesPath);
    const searchProfile = unified?.searchProfile ?? DEFAULT_SEARCH_PROFILE;
    const sources = sourceRepository.list();
    await providerRegistry.loadProviders();
    const providerDescriptors = providerRegistry.list().map((provider) => ({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      capabilities: provider.capabilities,
      credentialStatus: { configured: true, available: true },
      supportState:
        provider.capabilities.interactiveBrowser === true
          ? ('supported-with-configuration' as const)
          : ('supported' as const),
    }));
    return buildOnboardingSearchPlan({
      preferences: validatedPreferences,
      confirmedTitles,
      searchProfile: { maxQueriesPerRun: searchProfile.maxQueriesPerRun },
      sources,
      providerDescriptors,
    });
  }

  router.get(
    '/status',
    asyncRoute(async (_request, response) => {
      let profileId: string;
      try {
        profileId = currentProfileId();
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_profile_unavailable',
        });
        return;
      }
      const load = loadOnboardingProgress(store, profileId);
      // The plan is always returned with the current authoritative
      // sources/providers so the client cannot authorize against a
      // stale preview. Empty confirmedTitles are fine here because
      // the plan is informational until confirmation.
      let plan: OnboardingSearchPlan | null = null;
      try {
        const unified = loadCandidateProfile(
          candidateProfilePath,
          profilePreferencesPath,
        );
        const preferences = {
          preferredLocations: unified.preferredLocations,
          searchRadiusMiles: unified.searchRadiusMiles,
          secondarySearchRadiusMiles: unified.secondarySearchRadiusMiles,
          remotePreference: unified.remotePreference,
          desiredSalary: unified.desiredSalary,
          desiredJobTitles: unified.desiredJobTitles,
          desiredEmploymentTypes: unified.desiredEmploymentTypes,
        };
        plan = await buildPlan(preferences, preferences.desiredJobTitles);
      } catch {
        plan = null;
      }
      response.json(buildStatus(database, profileId, load, plan));
    }),
  );

  router.post(
    '/save',
    asyncRoute((request, response) => {
      let profileId: string;
      try {
        profileId = currentProfileId();
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_profile_unavailable',
        });
        return;
      }
      const parsed = saveRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: 'Onboarding progress payload is invalid.',
          code: 'onboarding_save_validation_failed',
        });
        return;
      }
      try {
        saveOnboardingProgress(
          store,
          profileId,
          parsed.data.snapshot as OnboardingProgressSnapshot,
        );
        response.json({ ok: true });
      } catch (error) {
        response.status(409).json({
          error: safeSaveError(error),
          code: 'onboarding_save_failed',
        });
      }
    }),
  );

  router.post(
    '/reset',
    asyncRoute((request, response) => {
      resetRequestSchema.parse(request.body ?? {});
      let profileId: string;
      try {
        profileId = currentProfileId();
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_profile_unavailable',
        });
        return;
      }
      try {
        resetOnboardingProgress(store, profileId);
      } catch (error) {
        response.status(500).json({
          error: safeSaveError(error),
          code: 'onboarding_reset_failed',
        });
        return;
      }
      try {
        database
          .prepare('DELETE FROM app_settings WHERE setting_key = ?')
          .run(onboardingCompletionKey(profileId));
      } catch {
        // best effort; completion marker absence is harmless
      }
      response.json({ ok: true });
    }),
  );

  router.post(
    '/complete',
    asyncRoute(async (request, response) => {
      let profileId: string;
      try {
        profileId = currentProfileId();
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_profile_unavailable',
        });
        return;
      }
      const parsed = completeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: 'Onboarding completion payload is invalid.',
          code: 'onboarding_complete_validation_failed',
        });
        return;
      }
      const { preferences, reviewItems } = parsed.data;

      // Step 1 — rebuild the plan from current authoritative inputs so
      // a stale client preview cannot authorize outdated sources.
      let appliedQueries: readonly string[];
      try {
        const plan = await buildPlan(preferences, preferences.desiredJobTitles);
        appliedQueries = plan.appliedQueries;
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_plan_failed',
        });
        return;
      }

      // Step 2 — persist confirmed preferences and review items.
      try {
        const unified = loadUnifiedLegacyPreferences(profilePreferencesPath);
        if (unified === null) {
          response.status(409).json({
            error: 'Unified profile preferences are not available.',
            code: 'onboarding_complete_no_unified',
          });
          return;
        }
        const existing = loadCandidateProfile(
          candidateProfilePath,
          profilePreferencesPath,
        );
        const { desiredSalary, ...rest } = preferences;
        const merged: typeof existing = {
          ...existing,
          ...rest,
          ...(desiredSalary !== null ? { desiredSalary } : {}),
        };
        const nextProfile = applyConfirmedReviewItems(
          merged,
          reviewItems as readonly OnboardingReviewItem[],
        );
        saveUnifiedProfilePreferences(profilePreferencesPath, {
          ...unified,
          candidateProfile: nextProfile,
          sourceQueryRoles: [...appliedQueries],
        });
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_complete_persist_failed',
        });
        return;
      }

      // Step 3 — cascade the executable query list through the
      // existing SourceRepository behavior so source searchCriteria
      // pick up the new titles.
      try {
        if (appliedQueries.length > 0) {
          sourceRepository.cascadeTargetRoles([...appliedQueries]);
        }
      } catch {
        // Cascade failure must not roll back the persistence that
        // already succeeded; surface a bounded error and keep the
        // search plan intact. The user can fix sources from the
        // workspace and retry the search.
        const completedAt = writeCompletionMarker(database, profileId);
        try {
          resetOnboardingProgress(store, profileId);
        } catch {
          // best effort; the completion marker already records the
          // outcome and the user can leave and resume.
        }
        response.json({
          ok: true,
          discoveryStarted: false,
          completion: { completed: true, completedAt },
          cascadeError: 'Source query roles could not be cascaded.',
          saveError: undefined,
        });
        return;
      }

      // Step 4 — record completion and clear progress.
      const completedAt = writeCompletionMarker(database, profileId);
      try {
        resetOnboardingProgress(store, profileId);
      } catch {
        // best effort; the completion marker is authoritative.
      }

      // Step 5 — trigger discovery exactly once through the existing
      // coordinator. A discovery failure must not undo completion:
      // preferences remain saved, progress remains cleared, and the
      // client is offered a search-only retry path.
      if (coordinator === undefined) {
        response.json({
          ok: true,
          discoveryStarted: false,
          completion: { completed: true, completedAt },
          cascadeError: undefined,
          saveError: undefined,
        });
        return;
      }
      try {
        const summaries = await coordinator.runAll();
        response.json({
          ok: true,
          discoveryStarted: true,
          summaries,
          completion: { completed: true, completedAt },
          cascadeError: undefined,
          saveError: undefined,
        });
      } catch (error) {
        response.json({
          ok: true,
          discoveryStarted: false,
          discoveryError: translateError(error),
          completion: { completed: true, completedAt },
          cascadeError: undefined,
          saveError: undefined,
        });
      }
    }),
  );

  // Idempotent search-only retry used by the client when discovery
  // failed after a successful completion. Does not touch progress,
  // does not rewrite preferences, does not clear completion.
  router.post(
    '/discovery/retry',
    asyncRoute(async (_request, response) => {
      let profileId: string;
      try {
        profileId = currentProfileId();
      } catch (error) {
        response.status(500).json({
          error: safeCompletionError(error),
          code: 'onboarding_profile_unavailable',
        });
        return;
      }
      const completion = readCompletionMarker(database, profileId);
      if (!completion.completed) {
        response.status(409).json({
          error: 'Onboarding has not been completed yet.',
          code: 'onboarding_retry_not_completed',
        });
        return;
      }
      if (coordinator === undefined) {
        response.status(409).json({
          error: 'Discovery coordinator is unavailable.',
          code: 'onboarding_retry_no_coordinator',
        });
        return;
      }
      try {
        const summaries = await coordinator.runAll();
        response.json({ ok: true, summaries });
      } catch (error) {
        response.json({
          ok: false,
          error: translateError(error),
        });
      }
    }),
  );

  return router;
}
