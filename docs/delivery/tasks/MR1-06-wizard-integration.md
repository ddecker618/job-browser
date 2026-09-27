# MR1-06 — Connect the onboarding wizard to saved preferences and real discovery

**Current status/owner:** See [`docs/JOB_BROWSER_DELIVERY_BOARD.md`](../../JOB_BROWSER_DELIVERY_BOARD.md).
**Dependencies:** MR0-01, MR1-01, MR1-02, MR1-03, MR1-04, MR1-05
**Implementation owner:** OpenCode
**Reviewer:** Codex
**Expected size:** one focused session (this task)

## Status

- **Implementation complete** — claimed by OpenCode 2026-09-24
  (after Codex accepted MR1-05).
- **First correction pass complete** on 2026-09-24 — OpenCode applied
  the Codex review findings (plan preview, idempotency, entry points,
  prefill).
- **Correction passes complete** through 2026-09-26 — OpenCode applied
  the plan-authority/credential, invalid-progress precedence,
  terminal-attempt replay, save-and-leave, and cleanup-transaction
  findings. Codex then added a profile-scoped completion guard so
  distinct attempt IDs cannot launch duplicate discovery, bounded the
  attempt-ID contract, and made edit-start validation return safe JSON.
- **Accepted and Done** — Codex re-review completed 2026-09-26. The
  reviewed correction is committed at `df829b9`; the installed visual,
  narrow-window, and 200% zoom checks remain owned by MR1-07.
- Validated on the accepted 2026-09-26 state: `npm run verify`
  **1826/1826 PASS** across 180 files (legal notices, format, lint,
  typecheck, and full test suite); focused onboarding suite **220/220
  PASS** across 8 files; `npm run privacy:check` **12/12 PASS**;
  `npm run nlp:security-audit` **3/3 PASS**; `git diff --check` clean.

## Outcome

The accepted `PreferencesStep`, `ReviewStep`, and `SearchPlanStep`
components are wired into one working flow that prepares and starts a
real Job Browser search. The flow:

1. Loads or restores onboarding progress through a narrow, versioned
   API.
2. Walks the user through job preferences one question at a time
   using the existing `PreferencesStep` contract.
3. Surfaces any supported skills / certification evidence through the
   existing `ReviewStep` contract.
4. Rebuilds the bounded search/source plan on the server from
   authoritative inputs and renders it through the existing
   `SearchPlanStep` contract.
5. Requires explicit confirmation.
6. Saves the confirmed profile and query scope through the existing
   unified profile-preferences authority.
7. Starts discovery through the existing `DiscoveryCoordinator` only
   after confirmation succeeds.
8. Preserves retry/cancel behavior for persistence and discovery
   failures.
9. Lets the user leave and resume without losing accepted progress.

## Reuse existing authorities

- `CandidateProfile`, `LegacyPreferences`, `ProfilePreferencesStore`
  from `src/schemas/candidate-profile.ts` and
  `src/preferences/profilePreferencesAdapters.ts`.
- `OnboardingProgressStore`,
  `loadOnboardingProgress` / `saveOnboardingProgress` /
  `resetOnboardingProgress` from
  `src/repositories/onboarding-repository.ts`.
- `resumeOnboardingProgress`, `applyConfirmedReviewItems` from
  `src/onboarding/onboarding-service.ts`.
- `buildOnboardingSearchPlan` from
  `src/onboarding/search-plan-service.ts` (MR1-05).
- `SourceRepository.list`, `SourceRepository.cascadeTargetRoles` from
  `src/repositories/source-repository.ts`.
- `DiscoveryCoordinator.runAll` from
  `src/discovery/discoveryCoordinator.ts`.
- `providerRegistry.list` / `providerRegistry.loadProviders` from
  `src/providers/providerRegistry.ts`.
- `translateError` for safe discovery error wording from
  `src/discovery/discoveryCoordinator.ts`.
- `loadCandidateProfile`, `loadUnifiedLegacyPreferences`,
  `saveUnifiedProfilePreferences` from
  `src/config/candidate-profile.ts` and
  `src/preferences/profilePreferencesRuntime.ts`.

No second profile store, source registry, discovery engine,
scheduler, or search configuration authority is introduced.

## API contract

The integration lives behind a narrow Express router mounted at
`/api/onboarding`. Every endpoint returns safe, bounded JSON and
never serializes raw `Error.message`, stack traces, filesystem paths,
URLs with secrets, credentials, or database details.

### `GET /api/onboarding/status`

Returns an `OnboardingStatusResponse`:

```ts
{
  state: 'not-started' | 'in-progress' | 'completed' | 'blocked';
  profileId: string;
  onboardingStep?: 'experience' | 'preferences' | 'review' | 'search-plan';
  question?: OnboardingQuestion | null;
  resumeKind?: 'stored' | 'fresh' | 'editing-existing';
  snapshot?: OnboardingProgressSnapshot;
  planToken?: string;
  prefilledDraft?: OnboardingPreferencesDraft;
  discoveryOutcome: {
    state: 'not-started' | 'running' | 'succeeded' | 'failed' | 'unavailable';
    message: string | null;
    summariesCount: number;
    completedAt: string | null;
    attemptId: string | null;
  };
  editSession: { editing: boolean; resumable: boolean; startedAt: string | null };
  blockKind?: 'malformed' | 'unsupported-version' | 'storage-failure';
  blockMessage?: string;
  completion: { completed: boolean; completedAt: string | null };
}
```

The plan is always rebuilt from current authoritative sources and
provider descriptors so the client cannot authorize against a stale
preview.

### `POST /api/onboarding/preview`

Strictly validates the current preferences and confirmed titles, rebuilds
the plan using current source/provider/credential state, and returns the
plan, its SHA-256 `planToken`, and `confirmationAllowed`. Completion must
present the exact reviewed token; a changed plan requires re-review.

### `POST /api/onboarding/draft-from-profile`

Returns a draft derived from the active candidate profile plus a freshly
built plan token and `confirmationAllowed`. This supplies the initial
draft for a new or completed-user edit when no saved onboarding snapshot
exists; it does not create or save progress.

### `POST /api/onboarding/save`

Strictly validates the body against
`onboardingProgressSnapshotSchema` and writes through the existing
profile-scoped `OnboardingProgressStore`. A failed save leaves the
previous stored snapshot intact and returns a safe 409.

### `POST /api/onboarding/reset`

Explicit recovery action. By default clears only progress and the edit
session; it preserves a historical completion marker. The marker and
discovery outcome are erased only when the separately named request
field `resetCompletion: true` is supplied. The ordinary wizard footer
does not expose a full-completion reset. No reset alters the candidate
profile, sources, jobs, applications, scoring, or NLP data.

### `POST /api/onboarding/edit/start` and `/edit/end`

Starting an edit records an active resumable edit session while retaining
the historical completion marker. Ending with `keepProgress: true`
leaves the session inactive but resumable; ending with `false` deletes
the edit progress first and then clears the session. A progress-delete
failure leaves the edit session intact and returns a bounded error.

### `POST /api/onboarding/complete`

Body:

```ts
{
  preferences: OnboardingValidatedPreferences;
  reviewItems: readonly OnboardingReviewItem[];
  planToken: string;
  attemptId: string;
}
```

Strict request validation through `onboardingValidatedPreferencesSchema`
and `onboardingReviewItemSchema`.

Confirmation ordering (see `src/server/onboardingRoutes.ts`):

1. Strictly validate the request.
2. Rebuild the plan from current authoritative inputs and compare its
   SHA-256 token with the exact plan token the user reviewed. Token
   mismatch → safe 409 + refreshed plan; the user must review again.
3. Reject when `confirmationAllowed === false`.
4. Persist the candidate profile through
   `saveUnifiedProfilePreferences`, merging validated preferences and
   applying confirmed review items.
5. Set `sourceQueryRoles` to exactly `plan.appliedQueries` and call
   `sourceRepository.cascadeTargetRoles`.
6. In one database transaction, write the completion marker, delete
   progress, and end the edit session. A progress-delete failure rolls
   back the completion marker and edit-session mutation.
7. Invoke `coordinator.runAll()` exactly once.

Failure handling:

- Profile persistence failure → 500, no completion marker, no
  progress cleared, no discovery, draft preserved on the client.
- Cascade failure → safe 500 `onboarding_complete_cascade_failed`; no
  completion marker, no progress cleared, no discovery. The attempt is
  `failed-retryable`, and retrying the same `attemptId` retries profile
  persistence + cascade safely.
- Completion finalization failure → the transaction rolls back the
  marker and edit-session clearing; progress remains; safe 500
  `onboarding_complete_finalize_failed`; no discovery. The attempt is
  `failed-retryable` and can be retried.
- Discovery failure → completion marker and progress clearing
  succeed; a bounded generic discovery message is persisted in the
  `failed` outcome. The completion attempt is terminal `completed` and
  the exact terminal response is stored on the attempt record. Replaying
  the same `attemptId` returns that exact response without rewriting,
  cascading, or running discovery. Search-only retry is available only
  through `POST /api/onboarding/discovery/retry`.

### `POST /api/onboarding/discovery/retry`

Search-only retry used by the client when discovery failed after a
successful completion. Does not touch progress, does not rewrite
preferences, and does not clear the completion marker. A persisted
`running` state blocks concurrent retry calls with HTTP 409. Success
or failure updates only the durable discovery outcome.

## First-run / manual-entry behavior

- The client `OnboardingPage` is reachable from a new `/onboarding`
  route.
- The page does not forcibly redirect established installations
  merely because the completion marker is absent. Auto-entry is
  allowed only when the backend can prove an unambiguous
  `not-started` state for the active candidate profile; in every
  other case the page renders a voluntary entry point.
- A stored disabled `salary` position recovers through the accepted
  MR1-04 behavior (the wizard resumes at the first unresolved
  enabled question).
- A completed user can select **Edit search setup**. This calls
  `POST /api/onboarding/edit/start`; status then gives the active edit
  session precedence over the historical completion marker and
  returns a profile-derived draft when no edit snapshot exists.
- Returning to `/onboarding` resumes an edit whose `editSession` is
  resumable even after the completed user left the page.
- `Save and leave` persists the exact current snapshot, ends the
  active edit while retaining resumability and completion history,
  then navigates to `/jobs`. A save or edit-end failure keeps the
  wizard open, preserves entered values, and does not navigate.
- **Discard current edit** clears only the resumable edit progress,
  ends the editing marker, and retains the previously completed
  configuration. It does not save the snapshot first.
- Malformed/unsupported progress can be cleared with the explicit
  **Clear broken progress** action. This preserves any previous
  completion marker by default; storage-failure offers Retry/Leave,
  never destructive reset.
- Back navigation preserves the draft and review edits.

## Progress-save boundaries

Progress is saved at every navigation boundary
(Continue, Back, Cancel and leave) and on Confirm. The component
does **not** claim that every keystroke is durable; only the
navigation boundary and the explicit save are durable.

## Blocked resume behavior

Distinct screens for each blocked kind:

- `malformed` → "Onboarding progress is unreadable".
- `unsupported-version` → "Onboarding progress uses an unsupported
  version".
- `storage-failure` → "Onboarding progress could not be loaded".

Malformed and unsupported-version screens offer an explicit **Clear
broken progress** action and a link to the Sources workspace.
Storage-failure offers **Retry** and **Leave** only; it does not offer
Reset. No blocked state may appear as an empty first-run wizard. A
failed retry leaves the same blocked state and all markers intact.

## Completion marker behavior

A completion marker (`app_settings.onboardingCompletion:<profileId>`)
is written only after profile persistence, source-query cascading, and
progress deletion succeed. It distinguishes "completed" from "missing
progress". Completed setup may enter an explicit edit session without
erasing the marker; leaving an edit preserves it, completing the edit
replaces its completion timestamp, and discarding the edit retains the
previous completion. A failed persistence, cascade, progress deletion,
or marker write does not report completion.

## Confirmation and discovery ordering

The `/api/onboarding/complete` endpoint is the single ordered
authority:

1. Revalidate and rebuild the plan (server-side, authoritative).
2. Compare the exact reviewed `planToken`; require a re-review on
   mismatch.
3. Verify that the rebuilt plan is confirmable.
4. Save confirmed profile preferences and executable query scope.
5. Cascade source query roles through the existing SourceRepository.
6. Transactionally write the completion marker, delete progress, and
   end the editing session.
7. Invoke the existing `DiscoveryCoordinator.runAll` exactly once.

## Retry / cancel semantics

- Save failure (during navigation or confirm) → the client keeps the
  user's draft and review state and surfaces a safe retryable error.
  Discovery is never invoked.
- Discovery failure after a successful completion → completion and
  progress clearing stand; the client surfaces the translated
  discovery error and exposes a search-only `Retry search` button
  that calls `/api/onboarding/discovery/retry`.
- `Save and leave` → save the destination snapshot, end the active edit
  with progress retained, then navigate to `/jobs`. If either save or
  edit-end fails, remain in the wizard and show a safe retryable error.
- `Discard current edit` → clear resumable progress, end the edit, keep
  the historical completion marker; no save occurs first.
- `Clear broken progress` → explicit blocked-state action; clears only
  the progress and edit-session markers by default and preserves any
  prior completion marker. Storage failure offers Retry/Leave only.
- Full completion-marker erasure is not exposed in the ordinary wizard.

## Failure-state wording

All client-visible strings are bounded, user-readable phrases. Raw
`Error.message`, stack traces, filesystem paths, URLs with secrets,
credentials, or database details are never serialized. Discovery
errors are translated through the existing `translateError` helper.

## Files owned by this task

| File                                               | Existing/new | Intended change                                                                                                                               |
| -------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/onboardingRoutes.ts`                   | new          | Narrow Express router implementing the API contract.                                                                                          |
| `src/server/app.ts`                                | existing     | Mount the onboarding router under `/api/onboarding`.                                                                                          |
| `src/client/pages/OnboardingPage.tsx`              | new          | Parent wizard page wiring `PreferencesStep`, `ReviewStep`, and `SearchPlanStep` through the API.                                              |
| `src/client/App.tsx`                               | existing     | Add `/onboarding` route.                                                                                                                      |
| `src/client/api.ts`                                | existing     | Add `onboardingStatus`, `saveOnboardingProgress`, `resetOnboardingProgress`, `completeOnboarding`, `retryOnboardingDiscovery` client methods. |
| `src/schemas/onboarding.ts`                        | existing     | Export `onboardingReviewItemSchema` for API strict validation.                                                                                |
| `src/client/styles/onboarding.css`                 | existing     | Add `onboarding-wizard`, `onboarding-step-nav`, `onboarding-blocked`, `onboarding-completed` scoped classes.                                  |
| `tests/onboarding-api.test.ts`                     | new          | Server endpoint tests with a temporary database and a mocked discovery coordinator.                                                           |
| `tests/onboarding-flow.test.tsx`                   | new          | Client flow tests using a controlled harness over the wizard page.                                                                            |
| `docs/delivery/tasks/MR1-06-wizard-integration.md` | new          | This task card.                                                                                                                               |
| `docs/JOB_BROWSER_DELIVERY_BOARD.md`               | existing     | Move MR1-06 row to **Review** when work is complete; session-log row appended.                                                                |
| `SESSION_HANDOFF.md`                               | existing     | Status pointer for the new active task.                                                                                                       |

## Shared files — integration owner only

The page consumes the existing `PreferencesStep`, `ReviewStep`, and
`SearchPlanStep` components; it does not modify them. The router
mounting in `src/server/app.ts` adds a single `app.use` call; no
existing route is changed.

## Tests

- `tests/onboarding-api.test.ts` — server endpoints with a temporary
  database, temporary profile-preferences path, and a mocked
  `DiscoveryCoordinator`. Never opens or copies the production
  database.
- `tests/onboarding-flow.test.tsx` — client flow using the existing
  component contract and a controlled harness for the API client.
  Existing onboarding suites remain green.

### Server coverage

- missing progress creates only the legitimate fresh state;
- valid progress resumes exactly;
- malformed / unsupported-version / storage-failure stay blocked;
- default recovery clears progress but preserves historical completion;
  `resetCompletion: true` is required to erase the completion marker;
- strict request validation rejects invalid bodies;
- safe client errors without diagnostic leakage;
- progress save/load round-trip;
- completion preserves unrelated profile fields and stores exactly
  `plan.appliedQueries` in `sourceQueryRoles`;
- omitted titles remain non-executable;
- source query cascade happens only after confirmation;
- no discovery when persistence fails;
- discovery called once after successful confirmation;
- distinct attempt IDs cannot complete the same profile concurrently;
- a completed profile requires an explicit edit session before a new
  completion attempt can run;
- completion attempt IDs are bounded and edit-start validation returns
  safe, endpoint-specific JSON;
- saved-but-discovery-failed result supports search-only retry;
- completion marker distinguishes completed from missing progress.

### Client coverage

- route loads without forced redirect;
- fresh voluntary start;
- existing-user manual start without forced redirect;
- question navigation (Continue, Back);
- validation errors focus first invalid control;
- back navigation preserves draft and review edits;
- review state round-trip;
- progress restoration at the exact stored question;
- Save and leave; completed-user edit resume;
- discard current edit while preserving historical completion;
- distinct malformed / unsupported-version / storage-failure
  screens;
- blocked-progress recovery without erasing historical completion;
- plan refresh before confirmation (via `POST /api/onboarding/preview`);
- applied and omitted query display (verified by the existing
  MR1-05 component tests);
- saving/confirming disabled state;
- profile-save failure retention (the client keeps the draft and
  surfaces a safe retryable error);
- successful confirmation starts discovery once;
- discovery failure after successful save surfaces a search-only
  retry;
- navigation to Jobs and Sources works;
- no job/application status mutation (verified by the absence of
  any call to the jobs/applications endpoints from the page).

## Validation

Focused gates while developing:

- `npm run typecheck`
- `npx vitest run tests/onboarding-api.test.ts`
- `npx vitest run tests/onboarding-flow.test.tsx`
- combined onboarding suites:
  `npx vitest run tests/onboarding-contract.test.ts tests/onboarding-preferences.test.tsx tests/onboarding-review.test.tsx tests/onboarding-progress-storage.test.ts tests/onboarding-search-plan.test.tsx tests/onboarding-api.test.ts tests/onboarding-flow.test.tsx tests/onboarding-entry-points.test.tsx`
- `npx eslint` on the changed source and test files
- `npx prettier --check` on the changed source, tests, CSS, and docs

After source changes stabilize, run the full gates once:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run verify`
- `npm run privacy:check`
- `npm run nlp:security-audit`
- `git diff --check`

## Checks NOT performed in MR1-06

- Visual review of the integrated wizard at narrow window widths
  and 200% zoom — these remain explicit acceptance items for
  **MR1-07** and are not described as passed.
- Packaged or installed-app validation.
- Production database access.
- Live discovery execution (no real provider / browser launch).
- Push, version bump, installer rebuild, release claim.

## Scope boundaries

No route beyond the documented `/api/onboarding/*` paths is added.
No `App.tsx` integration beyond the `/onboarding` route. No
`SourceRepository` mutation beyond the existing `cascadeTargetRoles`
call. No discovery execution outside the single ordered call in
`/api/onboarding/complete`. No production database access. No
migration. No dependency. No scoring, eligibility, ranking,
filtering, NLP-authority, notification, version bump, installer
build, or release claim is included.
