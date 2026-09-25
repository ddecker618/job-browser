# MR1-06 — Connect the onboarding wizard to saved preferences and real discovery

**Current status/owner:** See [`docs/JOB_BROWSER_DELIVERY_BOARD.md`](../../JOB_BROWSER_DELIVERY_BOARD.md).
**Dependencies:** MR0-01, MR1-01, MR1-02, MR1-03, MR1-04, MR1-05
**Implementation owner:** OpenCode
**Reviewer:** Codex
**Expected size:** one focused session (this task)

## Status

- **Implementation complete** — claimed by OpenCode 2026-09-24
  (after Codex accepted MR1-05).
- **Correction pass complete** on 2026-09-24 — OpenCode applied the
  Codex review findings before re-review.
- **In Review** awaiting Codex re-acceptance; **not** self-approved
  as Done.
- Validated: typecheck clean; `tests/onboarding-api.test.ts` 20/20
  PASS; `tests/onboarding-flow.test.tsx` 13/13 PASS; combined
  onboarding focused suite **197/197 PASS** across 7 files (was 164
  before MR1-06; **+33** new tests); `npm run verify`
  **1802/1802 PASS** across 179 files (was 1769/1769 across 177
  before MR1-06; **+33** tests, same file count); `npm run
privacy:check` 11/11 PASS; `npm run nlp:security-audit` 3/3 PASS;
  `git diff --check` clean; `npm run format:check` clean;
  `npm run lint` clean.

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
  resumeKind?: 'stored' | 'fresh';
  snapshot?: OnboardingProgressSnapshot;
  plan?: OnboardingSearchPlan;
  blockKind?: 'malformed' | 'unsupported-version' | 'storage-failure';
  blockMessage?: string;
  completion: { completed: boolean; completedAt: string | null };
}
```

The plan is always rebuilt from current authoritative sources and
provider descriptors so the client cannot authorize against a stale
preview.

### `POST /api/onboarding/save`

Strictly validates the body against
`onboardingProgressSnapshotSchema` and writes through the existing
profile-scoped `OnboardingProgressStore`. A failed save leaves the
previous stored snapshot intact and returns a safe 409.

### `POST /api/onboarding/reset`

Explicit reset only. Clears the progress key and the completion
marker. Does not alter the candidate profile, sources, jobs,
applications, scoring, or NLP data.

### `POST /api/onboarding/complete`

Body:

```ts
{
  preferences: OnboardingValidatedPreferences;
  reviewItems: readonly OnboardingReviewItem[];
}
```

Strict request validation through `onboardingValidatedPreferencesSchema`
and `onboardingReviewItemSchema`.

Confirmation ordering (see `src/server/onboardingRoutes.ts`):

1. Rebuild the plan from current authoritative inputs.
2. Persist the candidate profile through
   `saveUnifiedProfilePreferences`, merging validated preferences and
   applying confirmed review items.
3. Set `sourceQueryRoles` to exactly `plan.appliedQueries` and call
   `sourceRepository.cascadeTargetRoles`.
4. Write the profile-scoped completion marker in `app_settings`.
5. Clear the stored progress key.
6. Invoke `coordinator.runAll()` exactly once.

Failure handling:

- Profile persistence failure → 500, no completion marker, no
  progress cleared, no discovery, draft preserved on the client.
- Cascade failure → completion marker is written and progress is
  cleared, but the response reports the cascade failure so the
  client can keep the user on the wizard and offer a retry path.
  Discovery is not invoked.
- Discovery failure → completion marker and progress clearing
  succeed; the response reports a translated, bounded
  `discoveryError` and `discoveryStarted: false`. The client offers
  a search-only retry through `POST /api/onboarding/discovery/retry`.

### `POST /api/onboarding/discovery/retry`

Idempotent search-only retry used by the client when discovery
failed after a successful completion. Does not touch progress, does
not rewrite preferences, does not clear the completion marker.

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
- `Not now` / `Cancel and leave` saves valid progress when possible
  and returns to the application without marking onboarding
  complete.
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

Each blocked screen offers an explicit Reset action and a link to the
Sources workspace. No blocked state may appear as an empty first-run
wizard.

## Completion marker behavior

A completion marker (`app_settings.onboardingCompletion:<profileId>`)
is written only when persistence succeeds. The marker distinguishes
"completed" from "missing progress". A successful completion always
clears the stored progress key. A failed persistence never writes the
marker.

## Confirmation and discovery ordering

The `/api/onboarding/complete` endpoint is the single ordered
authority:

1. Revalidate and rebuild the plan (server-side, authoritative).
2. Save confirmed profile preferences and executable query scope.
3. Mark onboarding complete.
4. Clear stored progress.
5. Invoke the existing `DiscoveryCoordinator.runAll` exactly once.

## Retry / cancel semantics

- Save failure (during navigation or confirm) → the client keeps the
  user's draft and review state and surfaces a safe retryable error.
  Discovery is never invoked.
- Discovery failure after a successful completion → completion and
  progress clearing stand; the client surfaces the translated
  discovery error and exposes a search-only `Retry search` button
  that calls `/api/onboarding/discovery/retry`.
- `Cancel and leave` → saves valid progress when possible and clears
  the completion marker so the user is not marked complete.
- Reset → explicit user action; clears progress and completion marker;
  does not alter other data.

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
- explicit reset clears the progress key and completion marker;
- strict request validation rejects invalid bodies;
- safe client errors without diagnostic leakage;
- progress save/load round-trip;
- completion preserves unrelated profile fields and stores exactly
  `plan.appliedQueries` in `sourceQueryRoles`;
- omitted titles remain non-executable;
- source query cascade happens only after confirmation;
- no discovery when persistence fails;
- discovery called once after successful confirmation;
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
- cancel/leave and resume;
- distinct malformed / unsupported-version / storage-failure
  screens;
- explicit reset;
- plan refresh before confirmation (the plan returned by the status
  endpoint is used for the preview);
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
  `npx vitest run tests/onboarding-contract.test.ts tests/onboarding-preferences.test.tsx tests/onboarding-review.test.tsx tests/onboarding-progress-storage.test.ts tests/onboarding-search-plan.test.tsx tests/onboarding-api.test.ts tests/onboarding-flow.test.tsx`
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
