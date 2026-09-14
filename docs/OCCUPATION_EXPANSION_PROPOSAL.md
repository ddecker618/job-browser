# Job Browser — Occupation Expansion: "My matches / All jobs" implementation specification

## Current status — Package C repair (2026-09-13)

The Package C implementation delivered under the previous continuation
contained eight concrete defects that were repaired in this
continuation. Source-level evidence and the fixes shipped today:

1. **`window-all-closed` did not exit when close-to-tray was off.**
   The handler only called `app.quit()` when `quitRequested` was
   already true; an ordinary close with `closeToTray=false` left
   the backend alive. Fixed: the handler now also exits when
   close-to-tray is off (or when the tray is unavailable), routed
   through `LifecycleController.requestQuit()`.
2. **No-tray fallback could hide the only window.** `closeAction()`
   only checked `closeToTray` and `quitRequested`. Fixed: it now
   also checks `trayAvailable`. When the tray was never created
   (e.g. startup failure left the desktop running with no Exit
   path), the window must actually close so the user is not trapped
   behind a hidden window.
3. **Initial tray menu was not installed.** `TrayManager.create()`
   called `refreshMenu()` before assigning `this.tray`, and a
   `Menu.buildFromTemplate()` throw left the underlying `Tray`
   leaked. Fixed: assign `this.tray = tray` before `refreshMenu()`,
   wrap the menu build in try/catch and `destroy()` on throw.
4. **Quit paths were inconsistent.** `BackendManager.stop()`
   cleared its handle before awaiting shutdown, so a second quit
   call would see `handle === null` and skip the cleanup. Fixed:
   added `currentShutdown` (shared in-flight promise); a second
   `stop()` now awaits the same shutdown. Also: `desktop:safe-exit`
   and `app.quit()` paths route through `lifecycle.requestQuit()`.
5. **Pause/resume changed a separate preference.** The tray's
   `toggleSchedulerFromBackend()` PUT to `/api/discovery/settings`
   with both `schedulerEnabled` and `employerDiscoveryEnabled`
   flipped together, silently overwriting the user's opt-out.
   Fixed: new `PUT /api/scheduler-control` route that only flips
   `schedulerEnabled`; the tray now uses that route.
6. **Settings rollback and unavailable backend.**
   `desktop:set-close-to-tray` reverted to `!value` (a flipped
   boolean) instead of the actual previous state, and claimed
   success even when the backend was down. Fixed:
   `LifecycleController.persistCloseToTray()` restores the
   previously-stored value on any failure and returns
   `persisted: false` so the UI can surface an error.
7. **Tray state could become stale.** `TrayManager.refresh()`
   was unguarded: an in-flight `getSummary()` could resolve after
   `destroy()`, calling into a destroyed tray. Fixed: refresh now
   short-circuits if `destroying` is true, and the tray's
   `isCreated` getter returns false once `destroy()` is in
   progress.
8. **Windows shutdown documentation and handling were wrong.**
   The previous handoff claimed `before-quit` covered Windows
   shutdown/logoff. Electron's documentation explicitly states
   `before-quit` is **not** emitted on Windows shutdown/restart or
   user logout. Fixed: `WindowManager.create()` now accepts
   optional `querySessionEnd` and `sessionEnd` handlers; the main
   process wires both on the main BrowserWindow.
   `query-session-end` `preventDefault()`s so bounded cleanup has
   a chance to flush; `session-end` is a last-chance
   no-op-preventable hook. The controller's `onWindowsSessionEnd()`
   runs bounded best-effort cleanup with a configurable timeout
   (default 5 s) and never claims the cleanup is guaranteed to
   complete before Windows terminates the process.

Architecture:

- New `src/desktop/lifecycleController.ts` — `LifecycleController`
  owns the quit flag, the close-to-tray setting, repeated-exit
  coordination, and the persisted/in-memory state machine for
  `closeToTray`. All Electron-touching code (tray, window,
  `app.quit`) is reached through injected dependencies so the
  coordination itself is exercised in a Node test environment
  without spinning up Electron.
- New `PUT /api/scheduler-control` in `src/server/app.ts` —
  toggles `schedulerEnabled` only; preserves the
  `employerDiscoveryEnabled` opt-out.
- `src/desktop/backendManager.ts` — added `currentShutdown` getter
  and a shared-promise slot so repeated `stop()` calls await the
  same shutdown instead of skipping cleanup.
- `src/desktop/windowManager.ts` — accepts optional
  `querySessionEnd` / `sessionEnd` handlers and registers them on
  the main BrowserWindow.
- `src/desktop/main.ts` — wires `LifecycleController` into every
  IPC handler and lifecycle hook; uses the controller for
  `closeAction`, `setCloseToTray` PUT, `requestQuit`, and Windows
  session-end cleanup.
- `src/desktop/trayManager.ts` — assigns the Electron `Tray` before
  installing the menu, cleans up partially-created state on menu
  construction failure, and guards `refresh()` against resolving
  after `destroy()`.

Verification (recorded by this continuation):

- `npm run verify` — green: 168 test files / 1,547 tests.
  Baseline before this continuation was 164 / 1,521. New files: 4
  test files + 1 lifecycle controller. New tests: 26.
- New integration tests:
  - `tests/desktop-lifecycle-controller.test.ts` (17 tests) —
    closeAction matrix, requestQuit idempotency, shutdown
    serialization and bounded timeout, persistCloseToTray
    round-trip / rejection rollback / backend-unavailable
    restoration, loadCloseToTrayFromBackend success and
    network-blip fallback, onWindowsSessionEnd bounded cleanup.
  - `tests/desktop-tray-manager.test.ts` (2 tests) —
    refresh-after-destroy is a no-op; partial-create failure
    during menu construction triggers `destroy()`.
  - `tests/desktop-backend-manager-shutdown.test.ts` (4 tests) —
    currentShutdown non-null only during in-flight shutdown,
    second stop() awaits the same promise, handle is cleared
    before awaiting, in-flight slot is cleared on a failed first
    attempt.
  - `tests/desktop-scheduler-control-api.test.ts` (3 tests) —
    PUT flips schedulerEnabled without touching
    employerDiscoveryEnabled, rejects missing schedulerEnabled with
    400, rejects extra fields with 400 (strict body).

What still requires native Windows verification:

These cannot be exercised from the local Windows shell by a code
change; they require a packaged or installed build and a real
session: tray icon presence and tooltip; right-click menu contents;
Pause/Resume Discovery round-trip through the tray; Open Job
Browser from the tray; Exit Job Browser from the tray (clean
shutdown); close with close-to-tray on (window hides, tray remains);
close with close-to-tray off (graceful exit); Windows shutdown/logoff
handling; startup failure (tray still available for Exit). The
implementation does not claim the OS-level cleanup completes before
Windows terminates the process.

Why the desktop smoke harness does not prove tray behavior:

`scripts/desktop-smoke.ts` renders the seeded Employers page and
asserts text; it does not assert tray icon presence, menu contents,
pause/resume round-trips, or Exit Job Browser. A generic packaged
smoke pass (`npm run desktop:smoke:packaged` or
`npm run desktop:smoke:installed`) exercises backend, routes, and
shutdown but does not establish any of the tray / close-to-tray /
Windows-shutdown guarantees from §10.6.

Recommended next task:

Write a focused, **fixture-based** desktop lifecycle harness that
boots an isolated Electron app against a temporary user data
directory and asserts, in this order:

1. Tray icon is present after `window-created`.
2. Tray right-click menu contains `Open Job Browser`,
   `Pause Discovery` (or `Resume Discovery`), and
   `Exit Job Browser`.
3. Toggling Pause/Resume flips the global scheduler
   (`schedulerEnabled` in `/api/tray-summary`).
4. Close with close-to-tray on hides the window
   (`BrowserWindow.isVisible()` false) and the tray remains.
5. Close with close-to-tray off quits the app cleanly (no leftover
   processes).
6. Startup failure (forced by an invalid DB path) leaves a tray
   Exit path available.

Do not require live discovery. Do not run from a packaged build
until steps 1–6 pass on `electron .` against the temp user data
directory.

Stop before packaging or implementing additional features.

---

## Historical — Continuation checkpoint Package B + Package C (2026-09-13)

Packages B (consistent preference resolution, §1) and C (background
discovery and tray controls, §10) are implemented and verified locally.
Source remains uncommitted. See `SESSION_HANDOFF.md` for the full
continuation checkpoint, the file list, and the OS-level guarantees
§10.6 still requires native Windows verification for.

- Package B fix is narrowly scoped to the `analyze` and
  `reconcile-stale-intelligence` closures in `src/server/backend.ts`
  and a new `src/preferences/cliProfilePreferences.ts` helper that the
  three auxiliary CLIs opt into via `--profile-preferences=<path>` or
  `PROFILE_PREFERENCES_PATH`. The CLIs do not blindly receive a
  desktop path; without the flag/env they fall back to legacy
  `config/candidate-profile.json` and `config/scoring-config.json`.
  Regression tests with deliberately divergent unified and legacy
  profiles confirm the stored `score_version` matches the unified
  `createScoreVersion` when a path is provided, and the legacy
  version when it is not.
- Package C implements close-to-tray (default on), a system-tray
  icon with Open Job Browser, Pause/Resume Discovery, and Exit Job
  Browser, and a clean exit path. No scheduler, coordinator,
  provider, or discovery code was changed. The `session-end` event
  from §10.4.2 is not registered (Electron does not expose it);
  Windows shutdown already triggers `before-quit`, which stops the
  backend. The tray is created unconditionally after the window so
  a startup failure still has an Exit path. The
  `setCloseToTray` IPC reverts its in-memory copy when the backend
  rejects the PUT, so the UI never claims a setting the backend did
  not persist.
- Verification: `npm run verify` passed, 164 files / 1,520 tests
  (baseline before this continuation: 160 / 1,491). No live
  discovery, production database edits, application build, installer,
  installation, commit, or push.

The remainder of this document is the original specification. Do not
restart Packages A, B, or C from these older prompts.

## Recovery checkpoint — Package A (2026-09-13)

This section supersedes older next-task wording below. OpenCode was interrupted
while updating documentation after implementing My matches / All jobs. Recovery
inspected its local saved session and the actual worktree at HEAD fd63a2a.

- Package A implementation is present, uncommitted, and at a source checkpoint;
  do not restart it or automatically start Packages B/C.
- Source includes the scope query, remembered-view endpoints, scoped saved
  filters, All jobs toggle, personal-score freshness badges and UI/API/repository
  tests. Explicit matches/all URLs are supported; old filtered URLs and old saved
  filters retain My matches. Bare navigation may restore the remembered view.
- Recovery fixed the interaction between asynchronously loaded remembered scope
  and locally saved filters, serialized scope preference writes, refreshed the
  scope cache after saving, and made each search capture its score version once.
  Regression tests cover delayed settings, restored filters, back/forward and
  single-version reads. No scoring rules or source behavior were changed.
- Initial typecheck and 4 focused files / 54 tests passed. After recovery edits,
  typecheck and 2 files / 22 tests passed. Final verification is recorded below.
- No live discovery, production database edits, application build, installer,
  installation, commit or push. Installed-app behavior is not verified.
- Existing unrelated documentation changes and scripts/\_\_flags-check.ts remain
  intact. A pre-recovery copy of all modified/untracked files and tracked diff
  was saved outside the repository in the Codex task workspace.

Remaining scope: review Package A's source checkpoint before release. Package B
(unified preferences) remains a separate release prerequisite; Package C (tray
and background discovery) is not implemented. Its proposal's shutdown guarantees
still require runtime/API verification rather than assuming desktop-only edits
prove them. Do not execute the old Package A prompt as a new task.

Recovery-modified files: src/client/pages/JobsPage.tsx,
src/repositories/job-search-repository.ts, tests/jobs-page-ui.test.tsx,
tests/job-search-repository.test.ts, this handoff and
docs/OCCUPATION_EXPANSION_PROPOSAL.md. All other Package A edits were recovered
from OpenCode. Architecture decision: HIGH confidence, preserve the existing
services and resolve consistency within the approved Package A behavior.

Historical proposal follows; its instructions are superseded by the implemented
behavior above and the user-approved Package A prompt. In particular, score-version
absence means freshness unknown when evaluation evidence exists, and legacy saved
filters restore matches. The source checkpoint adds response metadata intentionally.

Status: Ready for review. Prepared from the job-browser occupation-expansion audit
(reconciled against the second repository review in
`~/Downloads/job-browser-jobhire-review.md`).

Update 2026-09-13: §9 adds the consolidated three-package delivery plan (My matches /
All jobs → unified-preference fix → background discovery + tray controls) and §10 adds
the background-discovery/tray work package requested in `SESSION_HANDOFF.md`
("Requested follow-up: background discovery and tray controls (2026-09-13)"). Desktop
lifecycle and scheduler code was inspected before writing §10. Everything remains
read-only planning; no repository files outside this document have been changed.

### Final recovery verification

npm run verify passed on 2026-09-13: formatting, ESLint, TypeScript, and
160 test files / 1,491 tests. git diff --check passed. This is an uncommitted
source checkpoint, not an installed release. Review Package A before Package B.
Recovery also corrected test-only lint errors in tests/job-search-api.test.ts.

## 0. Source of authority and reconciliation scope

This specification reconciles only the findings in the second review
(`job-browser-jobhire-review.md`) that affect the proposed "My matches / All jobs"
browsing feature. Feature-affecting findings, decision, and disposition:

| Review finding                                                                                                                                                                                                | Feature relevance                                                                                                                                                                                                                                                              | Disposition in this scope                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.** Profile authority not consistently passed to automatic analysis (`backend.ts:274-278` post-discovery analysis; `backend.ts:465-494` startup stale-score reconcile; both omit `profilePreferencesPath`) | Directly affects the "label personal scores accurately (current / stale / unscored)" requirement, because a divergent profile can make the stored `score_version` disagree with the request-time version, and the startup path can even re-score rows with a different version | **Verified; does not block this feature. See §1.** The feature computes labels against the request-time `currentScoreVersion` (already resolved through the unified resolver at `app.ts:153-156`) and never relies on the startup path's version. The resolver fix is tracked as a separate Priority-0 work package (§5, "Out of scope"). |
| **B.** Coverage attached to already-recorded applications                                                                                                                                                     | None (this feature makes no application/coverage changes)                                                                                                                                                                                                                      | Ignored for this scope; preserved as separate future work.                                                                                                                                                                                                                                                                                |
| **C.** Tech-focused matching constraints (search-profile default families; `scoringEngine.ts` seniority penalties, exec/director hiding, Illinois exclusion; clearance eligible-vs-holds)                     | These are _My matches_ semantics and are intentionally preserved untouched. They do not leak into All jobs because All jobs removes the eligibility gate and score-version pin; it never applies personal scoring to filter results                                            | Retained exactly as-shipped for the default scope. No scoring/profile edits in this scope.                                                                                                                                                                                                                                                |
| **D.** Documentation mixes historical/current state; ARCHITECTURE.md:226-231 warning about missing unified-preference resolution is accurate                                                                  | Relevant to accuracy of the score-labeling claim                                                                                                                                                                                                                               | Confirmed accurate by code read (see §1). This spec adds only this proposal document and, separately, flagged optional doc notes (§7).                                                                                                                                                                                                    |

## 1. Unified-preference resolution issue — verification and blocking status

**Verified, in code.** `loadCandidateProfile(profilePath, profilePreferencesPath?)`
(`src/config/candidate-profile.ts:10-27`) prefers the unified document when
`profilePreferencesPath` is defined and loadable, otherwise reads the legacy
`config/candidate-profile.json`. `loadUnifiedProfilePreferences(undefined)` returns
`null` (`src/preferences/profilePreferencesRuntime.ts:9-18`), so an omitted path
silently means _legacy-only_. `loadScoringConfig` has the identical contract
(`src/config/scoring-config.ts:10-16`).

- Interactive/request-time paths pass `profilePreferencesPath` → unified resolution:
  `src/server/app.ts:153-157` (`createScoreVersion` for the search repository),
  `app.ts:560-561`, `app.ts:984-998`, `app.ts:1108-1110`, and the settings/search-profile
  routes `app.ts:1056-1057,1088-1090,1105`.
- Automatic entry points omit it → legacy-only:
  - `src/server/backend.ts:274-278` — post-discovery coordinator analysis.
  - `src/server/backend.ts:465-494` — startup `reconcile-stale-intelligence`.
  - `src/intelligence/verifiedMatches.ts:16-17`, `src/intelligence/cli.ts:26-27`,
    `src/db/cli/backfill-role-details.ts:10` — auxiliary entry points.
- Note that the coordinator constructor _does_ receive `profilePreferencesPath`
  (`backend.ts:271-273`) for source-query cascading, so discovery queries resolve
  unified prefs while the analysis that runs inside the same object does not.

Consequence: when `settings/profile-preferences.json` exists and differs from the
legacy files, `SCORING_RULES_VERSION` is computed from a unified document at request
time but from legacy files during startup reconcile. The stored `score_version` on
rows can therefore disagree with the request-time version, and the startup step can
reprocess/invalidate scores using different inputs.

**Blocking status: does NOT block this feature or its implementation.** Rationale:

1. The All-jobs score labels are computed against `currentScoreVersion` resolved at
   request time (`app.ts:153-156`, already unified-correct). The feature adds no new
   path that reads profile/scoring at startup.
2. The My-matches default scope is byte-for-byte today's behavior, so it is unaffected.
3. The fix is small, local, and orthogonal (pass `profilePreferencesPath` through the
   four automatic entry points above). It can land as an independent commit in the
   same release with no interaction with the scope toggle.

**Action:** implement this scope without touching the resolver. Track the resolver fix
as a release prerequisite for the _staleness labeling claim_: without it, on a
divergent-prefs install the startup path may rewrite `score_version`, which can make
rows appear stale even though the user has not changed anything. The labeling logic in
§4.3 handles whatever `score_version` exists at read time, so it is correct either way;
the requirement is that the two background entry points agree with the interactive
version, which is the Priority-0 fix. Do **not** mark `ARCHITECTURE.md:226-231`
resolved as part of this work.

## 2. Scope of this work

### In scope

- Preserve **My matches** as the default scope, with unchanged results and behavior
  (identical WHERE, sorting default, URLs, facets, counts).
- Add **All jobs** — browse all current collected listings with **no implicit
  personal-match restrictions**, but with the user's explicit filters preserved.
- Accurate labeling of existing personal scores: **current / stale / unscored**.
- Consistent scope behavior for URLs, saved filters, remembered settings, sorting,
  pagination, counts, and facets.
- A truthful "All jobs means collected listings, not the entire job market" note.
- Current/history separation preserved in both scopes (existing `active` control).

### Out of scope (separate tasks; do NOT implement here)

- Junk-posting suppression (the ~3.7% of titles like `Additional Verification
Required` / `Welcome to …` / `We can't find this page` observed in the production
  database). Referenced in §3 but explicitly separate.
- Collection/profile decoupling (removing the personal query cascade from source
  configuration, `source-repository.ts:104-111`, `app.ts:1067,1106`).
- Any discovery, source-query, scoring-rule, profile, application, or production-data
  change. No schema migration, no seed changes, no installer work.
- The unified-preference resolver fix (§1), the prospective resume-coverage work
  (review Priority 1), and all later review priorities.

## 3. Product behavior

### 3.1 My matches (default, unchanged — invariant)

- Identical results to today: `JobSearchRepository.filters()` behavior is untouched
  for the default scope, including the eligibility gate
  (`COALESCE(eligibility_passed,1)=1`, `job-search-repository.ts:255-256`), the
  score-version pin (`:247-253`), the `status != 'ignored'` clause (`:305-309`), and
  the current-history separation (`:370-374`).
- Default sort stays `score` desc; default landing is the role-centered view
  (pairing with the existing `target-role-note`, `JobsPage.tsx:475-484`).
- Existing URLs, saved filters, filter persistence key
  (`job-browser-filters:${SCORING_RULES_VERSION}`, `JobsPage.tsx:67`), page/sort
  params, and empty-state copy are unchanged. The scope param is **omitted** from the
  URL in matches, so old bookmarks remain byte-for-byte valid.

### 3.2 All jobs

- Adds a `scope=all` URL parameter on `/api/jobs/search`.
- Shows every currently collected listing without implicit personal restrictions:
  - **no** `COALESCE(eligibility_passed,1)=1` gate (ineligible rows appear),
  - **no** `jobs.score_version = ?` pin (rows scored under any version appear),
  - still **excludes** `status = 'ignored'` and, by default, non-current rows
    (`active = 1 AND status <> 'expired'`), exactly as the current history
    separation prescribes, with the same `active` filter control to reach
    `removed`/history. This is the same explicit `includeIneligible` + `active`
    machinery that already exists; All jobs just turns them on as scope defaults.
- All existing filter controls continue to work as explicit filters (search, company,
  location, remote type, provider, source, min/max score, min salary, recommendation,
  status, role family, matched families, verification status, date ranges,
  new/updated/closing-soon, multiple-source). None of these are seeded by the profile;
  in All jobs there are no implicit criteria at all.
- Default sort becomes `firstSeenAt` desc (newest first); the user can reselect any
  existing sort. Score column still works (null scores sort last, as today,
  `job-search-repository.ts:134-136`).

### 3.3 Score labeling (current / stale / unscored)

- Response per item already includes `scoreVersion` (`models/job-search.ts:87`,
  `job-search-repository.ts:715`). Add `currentScoreVersion` to the search response
  meta (request-time, unified-correct).
- Rules (applied identically in the jobs table and the job detail drawer):
  - `scoreVersion === null` → **Unscored** (no personal evaluation exists).
  - `scoreVersion !== null && scoreVersion !== currentScoreVersion` → **Stale**;
    the stored score/recommendation is still shown but visibly labeled stale under
    the new rules.
  - `scoreVersion === currentScoreVersion` → **current**; rendered exactly as today.
- In the default matches scope, stale never appears (the version pin excludes it), so
  this labeling is new only in All jobs.

### 3.4 URL, remembered settings, and saved filters — consistent scope semantics

- **URLs:** `?scope=all` is the explicit, shareable, restorable form. `scope` is
  orthogonal to the 22-key filter bag (`JobsPage.tsx:14-38`); it is never written into
  the `job-browser-filters` LS key.
- **Remembered settings:** the persisted choice is stored in `app_settings` under the
  key `jobViewScope` (dedicated `GET/PUT /api/view-scope`, mirroring the existing
  `searchProfile` pattern at `app.ts:1087-1106`). On app start / JobsPage mount:
  URL `scope` wins if present, otherwise the persisted value is applied. Toggling
  writes both the URL param and the persisted value.
- **Saved filters:** when saving a filter, the current `scope` is stored inside the
  filter blob (`POST /api/saved-filters` already accepts arbitrary `string|number|
boolean` values via `z.record`, `app.ts:1117-1127`). Restoring a saved filter also
  restores its scope and sets the URL. Filters saved under the old shape (no scope)
  restore with no scope change (stay on current scope).
- **Sorting / pagination / counts / facets:** all derived from the same filtered
  CTE (`JobSearchRepository.search()` → `with filtered_jobs`, `facets()` against the
  same `filterSql`, `job-search-repository.ts:108-117,440-491`), so `total`, `pages`,
  `page`/`pageSize`, and every facet automatically reflect the active scope. No new
  endpoints or duplicative queries.

### 3.5 "All jobs means collected listings" note

- When `scope=all`, render a visible note (no toast/clutter): All jobs shows every
  listing currently collected from your sources. Employer career sites return all of
  their live postings; targeted sources (Indeed, ZipRecruiter, USAJOBS, …) return only
  the occupations they are queried for. This is your local collection, not the entire
  job market.
- This one sentence satisfies the transparency requirement and makes the narrowed
  collection (tech-targeted job-board queries, junk postings deferred to the separate
  task) honest.

### 3.6 History/current separation in both scopes

- The existing `active` control (`Filters.active`, `JobsPage.tsx:443-447`) is unchanged
  and available in both scopes: default current (`active = 1 AND status <> 'expired'`),
  `removed` history (`Inactive / expired history`). In All jobs, history also drops the
  eligibility gate (ineligible historical rows are visible), which is the consistent
  reading of "no implicit restrictions". Expired/removed rows stay out of both default
  views.

## 4. Technical design (exact)

### 4.1 Server — query schema

`src/schemas/job-search.ts:37-92` adds one field:

```ts
scope: z.enum(['matches', 'all']).default('matches'),
```

`src/models/job-search.ts`:

- `JobSearchQuery` (`:16-46`): add `scope: 'matches' | 'all'` (optional; default
  `'matches'` at the schema layer). Add after `includeIneligible`.
- `JobSearchResponse` (`:144-153`): add `currentScoreVersion: string | null`.

### 4.2 Server — filters

`src/repositories/job-search-repository.ts:filters()` (`:240`). Modify the two blocks:

- `:247-254` (score-version pin): guard with `query.scope !== 'all'`.
- `:255-256` (eligibility gate): guard with `query.scope !== 'all' && query.includeIneligible !== true`.

Everything else (`status != 'ignored'`, `active`, explicit filters, `matchedFamilies`,
`targetRole`, dates, provider/source memberships) is untouched.

`search()` (`:108-181`): in the returned object, add
`currentScoreVersion: this.getScoreVersion?.() ?? null` (the constructor already holds
`getScoreVersion`, `:104`). No other change; `total`, `pages`, and `facets` flow from
the same filtered set.

### 4.3 Server — persisted scope routes

`src/server/app.ts`, after the existing `/api/search-profile` block (`:1087-1113`),
mirroring its repository.getSetting/`saveSetting` pattern with strict validation:

```ts
app.get('/api/view-scope', (_request, response) => {
  const raw = repository.getSetting('jobViewScope');
  let value: unknown = null;
  try {
    if (raw !== null) value = JSON.parse(raw);
  } catch {
    value = null;
  }
  response.json({ scope: value === 'all' ? 'all' : 'matches' });
});
app.put('/api/view-scope', (request, response) => {
  const body = z
    .strictObject({ scope: z.enum(['matches', 'all']) })
    .parse(request.body);
  repository.saveSetting('jobViewScope', JSON.stringify(body.scope));
  response.json({ scope: body.scope });
});
```

`src/database/dashboardRepository.ts:687-705` already provides
`getSetting`/`saveSetting`; no change there. `AppSettings` (`models/dashboard.ts:158-167`)
is not touched (scope is not part of the settings form object).

### 4.4 Client — API

`src/client/api.ts` (helpers `request`/`json` already exist, `:143-174`):

```ts
viewScope: () =>
  request<{ scope: 'matches' | 'all' }>('/api/view-scope'),
saveViewScope: (scope: 'matches' | 'all') =>
  request<{ scope: 'matches' | 'all' }>(
    '/api/view-scope',
    json('PUT', { scope }),
  ),
```

`searchParameters` (`:118-132`) already serializes any `Partial<JobSearchQuery>`
including the new `scope` field; no change needed there.

### 4.5 Client — JobsPage

`src/client/pages/JobsPage.tsx`:

- Scope state: read URL `scope` via a `readScope(searchParams.get('scope'))` helper
  (modeled on `readSort`, `:904-914`). On mount, if no URL scope and no
  `?scope/` param, fetch `api.viewScope()` (React Query `useQuery(['view-scope'])`) and
  apply the persisted value. URL always wins.
- Search query construction (`:103-145`): add
  `...(scope === 'all' ? { scope: 'all' } : {})`. Omit in matches so responses are
  identical to today.
- Toggle: a two-option segmented control in the `PageHeader` actions area
  (`:227-256`): **My matches** / **All jobs**. Toggling sets the URL param
  (`setSearchParams`), deletes `page`, and calls `api.saveViewScope(scope)`.
- Default sort (`readSort`): when the URL has no `sort`, return `'firstSeenAt'` for
  `scope === 'all'` and `'score'` otherwise.
- Score label helper (shared with JobDetailPanel):
  `export function personalScoreLabel(scoreVersion: string | null, current: string | null): 'current' | 'stale' | 'unscored'`.
- Recommendation cell (`:596-615`): render the existing value; when
  `scoreVersion === null` show **Unscored** (today's fallback); when stale add a
  `stale` badge/word while keeping the stored value visible.
- All-jobs note (§3.5) rendered below the PageHeader when `scope === 'all'`.
- Saved filters: on save (`:164-169`) pass `{ ...filters, scope }`; on restore
  (`:269-285`) read `scope` from `filter.filters` and set the URL param when present.
- Do NOT touch: `initialFilters`/`filterKeys`, `FILTER_STORAGE_KEY`, `loadFilters`,
  `writeFilters`, the `active` select, `page`/`pageSize` handling, or the family/role
  filter wiring.

### 4.6 Client — Job detail

`src/client/components/JobDetailPanel.tsx:185-209`: add the same stale/unscored label
to the recommendation badge (`:189-191`). Reuse `personalScoreLabel` with
`currentScoreVersion` supplied from the JobsPage search response (pass via prop or
the same `useQuery`).

## 5. Files to change (complete list)

| File                                        | Change                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/schemas/job-search.ts`                 | add `scope` enum (default `'matches'`)                                            |
| `src/models/job-search.ts`                  | add `scope` to `JobSearchQuery`; add `currentScoreVersion` to `JobSearchResponse` |
| `src/repositories/job-search-repository.ts` | scope guards in `filters()`; `currentScoreVersion` in `search()`                  |
| `src/server/app.ts`                         | `GET`/`PUT /api/view-scope` routes                                                |
| `src/client/api.ts`                         | `viewScope` / `saveViewScope`                                                     |
| `src/client/pages/JobsPage.tsx`             | scope state + toggle + default sort + label + note + saved-filter scope           |
| `src/client/components/JobDetailPanel.tsx`  | stale/unscored label in detail drawer                                             |
| `tests/job-search-repository.test.ts`       | scope + currentScoreVersion cases (§6)                                            |
| `tests/job-search-api.test.ts`              | scope + view-scope HTTP cases (§6)                                                |
| `docs/OCCUPATION_EXPANSION_PROPOSAL.md`     | this file                                                                         |

No migrations, no provider/discovery/profile/scoring/application changes, no
installer work. Optional, _separately reviewed_ doc notes (not part of this scope):
`docs/ARCHITECTURE.md:226-231` append "tracked as Priority-0; not resolved", and
`docs/PROJECT_MEMORY.md` one-line "All-jobs scope shipping note".

## 6. Acceptance tests

Regression — My matches unchanged:

1. `/api/jobs/search` (no scope) response is identical in shape and `total`/`facets`
   to the pre-change response for a fixed seeded database; `items[].scoreVersion`
   present; `currentScoreVersion` present and equals the request-time version from
   `createScoreVersion`.
2. `filters()` with `scope='matches'` produces the exact same SQL clauses as today
   (eligibility gate present, score-version pin present).
3. Existing job-search tests (repository, API, target-role, performance) pass
   unmodified — these assert current behavior and must not need edits for
   scope=matches.

All jobs behavior: 4. `filters()` with `scope='all'` omits the eligibility gate and the score-version
pin, and retains `status != 'ignored'` and the `active` current-history clause. 5. HTTP: `?scope=all` returns rows with `eligibilityPassed: false`, includes
`scoreVersion` differing from `currentScoreVersion`, and `total` > the matches
total for the same seeded data. `facets.recommendations` counts include values that
appear only among ineligible rows (e.g. hidden "Hard No"), so facets reflect the
scope. 6. HTTP: `?scope=all&active=removed` returns historical ineligible rows (history is
ungated in All jobs); `?scope=matches&active=removed` keeps the eligibility gate
(invariant preserved). 7. When no `getScoreVersion` is supplied to `JobSearchRepository`, responses carry
`currentScoreVersion: null` and item labeling falls back to Unscored/stale by null
comparison (unit level).

Scope persistence and client contract: 8. `GET /api/view-scope` returns `{ scope: 'matches' }` when unset; after
`PUT /api/view-scope { scope: 'all' }` it returns `{ scope: 'all' }`; invalid body
returns 400 (strict parse). 9. Saving a filter with `scope: 'all'` round-trips through `POST /api/saved-filters`
and restores `scope=all`; a legacy-shaped filter (no scope) restores with the
current scope unchanged. 10. URL round-trip: `?scope=all&sort=firstSeenAt&page=2` renders All jobs sorted by
newest on page 2; toggling to matches resets page to 1 and omits `scope` from the
URL.

Labeling acceptance (integration fixtures): 11. Rows with `score_version = null` → "Unscored"; rows with `score_version <> current`
→ "Stale" badge with the stored score still shown; rows equal → unchanged.

Performance: 12. Search-performance tests remain green (scope adds no new query path; `total`/facets
reuse the same CTE).

Verify commands (final, unmodified project gates):

```
npm run verify
npm run nlp:security-audit   # unchanged scope; runs clean as regression
```

## 7. Ready-to-run implementation prompt

Copy-paste block for the implementing agent. It references this document; no other
context recovery is required.

```
Implement the "My matches / All jobs" feature exactly as specified in
docs/OCCUPATION_EXPANSION_PROPOSAL.md (changes §4, files §5, acceptance §6).

Scope guardrails (do not violate):
- My matches (default, scope omitted from URL) must be byte-for-byte today's
  behavior: identical /api/jobs/search WHERE for the default scope, identical
  defaults (sort=score, eligibility gate, score-version pin).
- NO changes to discovery, source queries, scoring rules, search profile, candidate
  profile, applications, job lifecycle, or production data. NO schema migration.
- Junk-posting suppression and collection/profile decoupling are SEPARATE tasks —
  do not start them.
- Do not modify the unified-preference resolver; do not claim ARCHITECTURE.md
  :226-231 is resolved. Labels must be computed against the request-time
  currentScoreVersion only.
- Follow repo conventions: no comments added unless required; run prettier.

Server:
1. src/schemas/job-search.ts — add scope: z.enum(['matches','all']).default('matches')
   to jobSearchQuerySchema.
2. src/models/job-search.ts — JobSearchQuery.scope?: 'matches'|'all';
   JobSearchResponse.currentScoreVersion: string | null.
3. src/repositories/job-search-repository.ts:
   - filters(): scope 'all' skips the score-version pin and the eligibility gate
     (guard both existing clauses); keep status != 'ignored' and the active/current
     and history clauses exactly as-is.
   - search(): return currentScoreVersion: this.getScoreVersion?.() ?? null.
4. src/server/app.ts — add GET /api/view-scope and PUT /api/view-scope using
   repository.getSetting('jobViewScope')/saveSetting, strict zod body
   ({scope: enum}), JSON-encoded storage, invalid body => 400. Place after the
   /api/search-profile block (app.ts:1087-1113). Do not modify settingsSchema.

Client:
5. src/client/api.ts — add viewScope() (GET) and saveViewScope(scope) (PUT via json()).
6. src/client/pages/JobsPage.tsx:
   - scope read from URL param ('all'|else 'matches'); on mount apply persisted
     value from api.viewScope when URL has no scope.
   - pass scope into the search query ({ scope: 'all' } only when all; omit in
     matches).
   - add My matches / All jobs toggle in the PageHeader actions; toggling updates the
     URL (deletes page) and calls api.saveViewScope.
   - default sort via readSort: no URL sort => firstSeenAt when scope=all, else score.
   - add personalScoreLabel(scoreVersion, current) helper (current|stale|unscored);
     render stale badge + Unscored fallback in the recommendation cell; keep stored
     value visible when stale.
   - All jobs renders the collection-limitations note (see spec §3.5).
   - saved filters carry scope: include scope in saved filter blobs and restore it.
7. src/client/components/JobDetailPanel.tsx — same stale/unscored label on the
   recommendation badge (:189-191) using personalScoreLabel.

Tests (add, do not weaken existing):
8. tests/job-search-repository.test.ts — matches default unchanged; all omits gate +
   pin; currentScoreVersion present/null per getScoreVersion; scope default in schema.
9. tests/job-search-api.test.ts — scope=all exposes eligibility_passed=false rows and
   total/facets reflect scope; matches identical total; active=removed ungated under
   all, gated under matches; view-scope GET default matches, PUT round-trip, 400 on
   bad body; saved-filter scope round-trip and legacy restore.

Run npm run verify and confirm the full gate is green. Do not commit or push.
Package version and installer are untouched. Report the diff scope and the exact
verify output.
```

## 8. Notes for the reviewer

- The staging evidence (production database read-only counts) that informed §3.2/§3.5:
  3,910 total rows; 2,382 current; 1,181 current rows fail the eligibility gate;
  1,489 current rows have `matched_families = NULL`; ~89 rows (~3.7%) are
  verification-walls/error titles (deferred to the junk-suppression task).
- All-jobs requires no widening of discovery or source queries today; it only makes the
  existing collected inventory browsable. Growing non-tech supply is the separate
  collection work.
- The second review's recommended next task (unified-preference fix, then prospective
  resume coverage) remains valid independently; this feature does not reorder it.

## 9. Consolidated delivery plan — three bounded work packages

The requested browsing feature (§2–§8) is coordinated with two other bounded packages.
All three are independent, reviewable commits with disjoint file ownership (Package A
and Package C both touch `src/server/app.ts` but in disjoint route blocks).

| #     | Package                                            | Primary files                                                                                                                                                                                                             | Depends on                   |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **A** | My matches / All jobs (this document §2–§8)        | `src/schemas/job-search.ts`, `src/models/job-search.ts`, `job-search-repository.ts`, `app.ts` (view-scope routes), `api.ts`, `JobsPage.tsx`, `JobDetailPanel.tsx`, 2 test files                                           | None                         |
| **B** | Unified-preference resolution fix (Priority-0, §1) | `backend.ts` (two call sites), `verifiedMatches.ts:16`, `intelligence/cli.ts:26`, `db/cli/backfill-role-details.ts:10`                                                                                                    | None                         |
| **C** | Background discovery and tray controls (§10)       | `desktop/lifecycle.ts`, `desktop/main.ts`, `desktop/windowManager.ts`, `desktop/trayManager.ts`, `preload.cts`, `client/desktop.ts`, `DesktopSettings.tsx`, `app.ts` (desktop-settings/tray-summary routes), 2 test files | None (reuses existing infra) |

**Recommended implementation order: A → B → C.**

- **A first.** It is self-contained (schemas → repository → routes → client), has the
  narrowest blast radius, and delivers the requested browsing change on its own. Its
  ready-to-run prompt is §7.
- **B second.** Small, orthogonal backend fix. It is required for the _staleness
  labeling claim_ in §1 to be correct on installs whose unified profile differs from
  the legacy files, so it should ride along in the same release immediately after A.
  It does not block A's implementation.
- **C last.** Desktop-lifecycle work (window close, tray, session-end). It deliberately
  reuses the existing backend, scheduler, coordinator, single-instance lock, and
  clean-shutdown paths **without modifying any of them** (§10.4), so it does not depend
  on A or B. Browsing and preference behavior are committed and verified before any
  lifecycle change. It also matches the user's requested ordering
  (browsing → preference consistency → background operation).

Coordination rules: preserve unrelated uncommitted changes; do not commit or push
without explicit authorization; each package is its own commit; no broad audit, no
live discovery, no production-data changes, no rebuild/install in any package.

## 10. Background discovery and tray controls (separate work package)

Requested in `SESSION_HANDOFF.md` "Requested follow-up: background discovery and tray
controls (2026-09-13)". This is a recording of requested future behavior and a bounded
design, not an implemented feature.

### 10.1 Current evidence (inspected read-only 2026-09-13)

- `src/desktop/main.ts:54-55` — single-instance lock; `app.on('second-instance',
() => windows.focus())` (`:66`); `app.on('window-all-closed', () => app.quit())`
  (`:67`); `before-quit` prevents default, awaits `backend.stop()`, then re-quits
  (`:68-76`). Closing the window today therefore **quits** the app.
- `src/desktop/windowManager.ts` — no tray lifecycle; the window `close` handler only
  saves bounds (`:53`). `focus()` already restores + shows a hidden/minimized window
  (`:82-87`), so reopen-after-hide is nearly free.
- `src/desktop/backendManager.ts` — single `BackendHandle`; `start()` is idempotent
  (`:26`); `stop()` nulls the handle then awaits `handle.stop()` (`:80-84`).
- `src/server/backend.ts:542-565` — `handle.stop()` clears the startup-maintenance
  timer, awaits startup maintenance, `scheduler.stop()` (else `coordinator.stop()`),
  `nlpBackgroundWorker.stop()`, `server.close()`, `wal_checkpoint(TRUNCATE)`, then
  closes SQLite. Clean, bounded shutdown already exists.
- `src/discovery/discoveryScheduler.ts` — 30 s `unref()` interval (`:102-109`);
  `start()` advances missed schedules and employer-discovery eligibility without
  catch-up execution (`:28-39`); `evaluate()` is single-flight/non-overlapping
  (`:52-62`); `stop()` clears the timer, stops the coordinator, and awaits the
  in-flight evaluation (`:41-50`).
- `src/discovery/discoveryCoordinator.ts:126-130` — `stop()` aborts the active source
  run and awaits the queue tail; `enqueue()` rejects once stopped (`:137-138`).
- Tests already prove the hard guarantees: `tests/discovery-scheduler.test.ts`
  (no overlap `:65-92`, no catch-up at startup `:94-118`, bounded employer/health
  batches, waits for in-flight work before stopping `:167-196`, global-disable no-op
  `:29-37`); `tests/backend-lifecycle.test.ts` (clean stop closes the DB `:40-49`).
- No `Tray`, `setLoginItemSettings`, or launch-at-login code exists anywhere in `src`
  (grep returned nothing). The global **scheduled-discovery toggle already exists**:
  `GET/PUT /api/scheduler-control` surfaces `schedulerEnabled`
  (`src/server/app.ts:686,814` via `sourceRepository.setSchedulerEnabled`), shown on
  the Discovery Control page.
- Settings persistence: `settingsSchema` is strict (`app.ts:1458-1475`) and
  `AppSettings` (`models/dashboard.ts:158-167`) are not to be touched; arbitrary
  keys persist via `dashboardRepository.getSetting/saveSetting`
  (`dashboardRepository.ts:687-705`), the same pattern §4.3 uses for `jobViewScope`.

**Scoping conclusion:** the existing scheduler, coordinator, and backend already
satisfy most of the requested guarantees (no duplicate scheduling, no catch-up storms,
bounded runs, safe SQLite close, no orphaned processes on Exit). Package C is therefore
a **desktop-lifecycle and tray package** — window-close semantics, tray UI, one
persisted setting, a pause shortcut that reuses the existing global toggle, and
Windows session-end handling. **No changes to `DiscoveryScheduler`,
`DiscoveryCoordinator`, providers, discovery logic, migrations, or the installer.**

### 10.2 Scope

**In scope:**

- Close-to-tray: closing the main window leaves Job Browser running with a visible
  system-tray icon and a clear indication that scheduled discovery continues.
- Tray menu: **Open Job Browser**, **Pause/Resume Discovery**, **Exit Job Browser**.
  Exit means a complete, graceful shutdown (the existing `before-quit` path).
- A persisted, user-visible **close-to-tray** setting (default **on** for the desktop
  app; see §10.3). Web mode is unchanged and shows no desktop controls.
- Attention-required surfacing without repeated popups: a single tray line
  ("Discovery: N sources need attention") refreshed when the menu opens; no dialogs.
- Windows session-end (logoff/shutdown) → same graceful stop as Exit.
- Reopen/second-launch restores the existing instance (already works via the existing
  single-instance lock + `focus()`).

**Out of scope (explicit separate follow-ups):**

- Startup with Windows. Separate opt-in decision, **not** implied by background mode.
  Documented hook only: `app.setLoginItemSettings({ openAtLogin })` plus a separately
  stored setting key; do not implement here.
- Discovery during sleep, or any scheduling semantics change (interval, batches,
  catch-up policy). Pause/resume intentionally reuses the existing persisted global
  toggle so there is exactly one source of truth.
- Provider interaction changes (login/CAPTCHA boundaries are untouched; background
  mode must not hide them), popup/notification-center work, installer work, schema
  changes.

### 10.3 Product behavior and default decisions

- **Close-to-tray default: ON (recommended).** The entire point of this package is
  that closing the window keeps discovery running; defaulting off would ship a
  background mode nobody gets unless they discover a setting. The toggle restores the
  legacy "close quits" behavior. Flag the default as a confirmed product decision in
  review; flipping it is a one-constant change.
- Closing the window (close-to-tray on) hides the window; the backend, scheduler, and
  database owner continue undisturbed.
- Tray tooltip states background mode and discovery state, e.g. "Job Browser —
  Discovery active in background" / "Discovery paused" / "Startup incomplete".
- **Pause/Resume Discovery** calls the existing `setSchedulerEnabled(false|true)`
  endpoint. It is persisted and identical to the Discovery Control page toggle; while
  paused, scheduled source/employer/health runs stop but alert rules and closure
  reconciliation still run (existing tested behavior of `evaluateInternal`).
- Reopening (tray Open, or a second launch) shows and focuses the existing window; it
  never creates a second backend, scheduler, database connection owner, or discovery
  run.
- Exit and Windows shutdown stop scheduling, await anything in flight with bounded
  cleanup, close provider/browser resources and SQLite safely (`handle.stop()`), and
  leave no orphaned Job Browser processes. Recovery behavior is preserved.
- Background means recurring **bounded scheduled runs while the PC is awake and the
  app is running**; no discovery after explicit Exit or during sleep. Schedule
  opt-outs and source enablement are preserved unchanged.
- Attention-required (login/verification) is surfaced as a silent tray indicator —
  one line, updated on menu open — and the existing source-health records/routes
  remain authoritative. No popups, no repeated dialogs, nothing that hides an auth
  flow when the user does open the window.

### 10.4 Technical design (exact)

#### 10.4.1 New pure lifecycle module — `src/desktop/desktopLifecycle.ts` (unit-testable)

```ts
export type CloseAction = 'close' | 'hide';
export function closeAction(
  closeToTray: boolean,
  quitRequested: boolean,
): CloseAction {
  if (quitRequested) return 'close';
  return closeToTray ? 'hide' : 'close';
}
export interface TrayLabelState {
  backendRunning: boolean;
  paused: boolean;
  attentionSources: number;
  startupComplete: boolean;
}
export function trayLabel(state: TrayLabelState): string;
export function pauseMenuItemLabel(paused: boolean): string; // 'Pause Discovery' | 'Resume Discovery'
```

No Electron imports — keeps these decisions unit-testable in the Node vitest
environment (the existing `tests/desktop-*.test.ts` pattern).

#### 10.4.2 Main process — `src/desktop/main.ts`

- Add `let quitRequested = false;` Set it in `requestQuit()` (tray Exit; `app.on(
'session-end', requestQuit)` for Windows logoff/shutdown), then call `app.quit()`.
  The existing `before-quit` handler (`:68-76`) already does the bounded stop.
- Keep `window-all-closed → app.quit()` (`:67`) unchanged: with close-to-tray on the
  window never actually closes, so no quit happens; with it off the behavior is
  byte-for-byte today's.
- After `windows.create(...)`, create a `TrayManager` (icon path already resolved).
  Create it unconditionally so a **startup failure** still leaves an Exit path
  available; label state then shows "Startup incomplete" (`backend.current === null`).
- After backend start (`runStartup`), fetch the persisted close-to-tray value once
  (proxy `GET /api/desktop-settings`) and hold it in memory; pass
  `() => closeAction(closeToTray, quitRequested)` to `WindowManager.create` so window
  close behaves correctly immediately, before any user interaction.
- IPC proxied to the backend HTTP routes (same pattern as the existing fetch-based
  smoke assertions, `main.ts:328`):
  - `desktop:get-close-to-tray` → `GET /api/desktop-settings` → `{ closeToTray }`.
  - `desktop:set-close-to-tray(boolean)` → update the in-memory value, `PUT
/api/desktop-settings`, return the round-tripped value.
  - `desktop:tray-summary` → `GET /api/tray-summary` (used to refresh the tray menu).
- `desktop:tray-pause-toggle` → `PUT /api/scheduler-control { schedulerEnabled }`
  (reads current `schedulerEnabled` first via the existing GET at `app.ts:686`).

#### 10.4.3 WindowManager — `src/desktop/windowManager.ts`

- `create()` gains a `closeDecision: () => CloseAction` option.
- In the existing `window.on('close', ...)` handler (`:53`): always save bounds; then
  if `closeDecision() === 'hide'`, `event.preventDefault()` and `window.hide()`.
- `focus()` (`:82-87`) is unchanged and already un-hides.

#### 10.4.4 New tray module — `src/desktop/trayManager.ts`

- `class TrayManager` wrapping Electron `Tray`:
  - Tooltip from `trayLabel` (§10.4.1); static state refreshed after pause toggles and
    window show/hide; attention count refreshed on menu open via `desktop:tray-summary`.
  - Context menu (rebuilt on open, using `Menu`):
    - **Open Job Browser** → `windows.focus()`.
    - **Pause/Resume Discovery** → calls the pause-toggle IPC; label from
      `pauseMenuItemLabel`.
    - An attention/status line (disabled item) shown only when relevant.
    - separator; **Exit Job Browser** → `requestQuit()`.
  - `tray.on('click', () => windows.focus())`.

#### 10.4.5 Setting — do NOT touch `settingsSchema`/`AppSettings`

- `src/server/app.ts` (disjoint block after the §4.3 view-scope routes):
  ```ts
  app.get('/api/desktop-settings', (_request, response) => {
    const raw = repository.getSetting('closeToTray');
    let value: unknown = null;
    try {
      if (raw !== null) value = JSON.parse(raw);
    } catch {
      value = null;
    }
    response.json({ closeToTray: value === false ? false : true });
  });
  app.put('/api/desktop-settings', (request, response) => {
    const body = z
      .strictObject({ closeToTray: z.boolean() })
      .parse(request.body);
    repository.saveSetting('closeToTray', JSON.stringify(body.closeToTray));
    response.json({ closeToTray: body.closeToTray });
  });
  app.get('/api/tray-summary', (_request, response) => {
    // schedulerEnabled from sourceRepository.getSchedulerEnabled(),
    // running from coordinator.status().running,
    // attentionSources = count of enabled sources whose health is
    //   'credentials-required' | 'failed' for enabled providers only.
    response.json({
      schedulerEnabled,
      running,
      attentionSources,
      startupComplete,
    });
  });
  ```
  Default when unset = `true` (documented decision, §10.3). File-disjoint from the
  view-scope block; both follow the existing `getSetting`/`saveSetting` pattern.

#### 10.4.6 Client surface

- `src/desktop/preload.cts`: expose `getCloseToTray()`, `setCloseToTray(value)`,
  `togglePauseDiscovery()` via `ipcRenderer.invoke`.
- `src/client/desktop.ts` `DesktopBridge`: add the three methods.
- `src/client/components/DesktopSettings.tsx`: add a **"Continue running in the
  background when the window is closed"** checkbox under the Desktop application panel,
  driven by `bridge.getCloseToTray()`/`setCloseToTray()`. Web mode (bridge null)
  continues to show the existing "Run Electron…" message.

#### 10.4.7 No scheduler/coordinator changes

Pause/resume, no-overlap, bounded batches, wake/sleep safety, and clean-stop behavior
are all already implemented and tested (§10.1). Package C adds no code to
`DiscoveryScheduler.ts`, `discoveryCoordinator.ts`, providers, or discovery logic.

### 10.5 Files to change (complete list)

| File                                        | Change                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/desktop/desktopLifecycle.ts` (new)     | pure `closeAction`, `trayLabel`, `pauseMenuItemLabel`                                                                                    |
| `src/desktop/main.ts`                       | `quitRequested`, `session-end`, `TrayManager`, close-decision wiring, close-to-tray/tray-summary/pause IPC, startup fetch of closeToTray |
| `src/desktop/windowManager.ts`              | `closeDecision` option; hide instead of close                                                                                            |
| `src/desktop/trayManager.ts` (new)          | Tray, tooltip, context menu, attention line                                                                                              |
| `src/desktop/preload.cts`                   | expose `getCloseToTray`, `setCloseToTray`, `togglePauseDiscovery`                                                                        |
| `src/client/desktop.ts`                     | `DesktopBridge` additions                                                                                                                |
| `src/client/components/DesktopSettings.tsx` | close-to-tray toggle                                                                                                                     |
| `src/server/app.ts`                         | `GET/PUT /api/desktop-settings`, `GET /api/tray-summary`                                                                                 |
| `tests/desktop-lifecycle.test.ts` (new)     | `closeAction`, label/pause-label helpers                                                                                                 |
| `tests/desktop-settings-api.test.ts` (new)  | desktop-settings round-trip + 400, tray-summary fields                                                                                   |
| `docs/OCCUPATION_EXPANSION_PROPOSAL.md`     | this file                                                                                                                                |

No scheduler/coordinator/provider/discovery/migration/installer changes. Optional
separate follow-up (documented only): startup-with-Windows opt-in via
`app.setLoginItemSettings`.

### 10.6 Acceptance tests

1. Close with close-to-tray on: window hides (`window.isVisible()` false), backend
   `/api/health` stays OK, scheduler keeps running due sources after the 30 s tick.
2. Close with close-to-tray off: unchanged behavior — window closes, app quits via
   `window-all-closed`.
3. Tray icon present with a tooltip indicating background discovery active/paused.
4. Tray Open: hidden or minimized window is shown and focused; no second backend,
   scheduler, or DB owner (single handle invariant, `backendManager.ts:26`).
5. Tray Exit during an in-flight scheduled run: `before-quit` awaits
   `scheduler.stop()` → `coordinator.stop()` aborts the active source and awaits the
   queue; database is closed (`backend-lifecycle` clean-stop pattern); no orphaned
   Job Browser process.
6. Second launch while running: existing single-instance behavior; the running window
   is focused (`second-instance` → `focus()`, un-hides).
7. Pause/Resume from tray round-trips through `PUT /api/scheduler-control`; while
   paused, `evaluate()` runs alerts/closure reconciliation but no source/employer/
   health runs (existing global-disable tests remain the assertion for this);
   Discovery Control page shows the same state; persists across restart.
8. `GET/PUT /api/desktop-settings`: default `{ closeToTray: true }` when unset;
   round-trip; invalid body → 400 (strict parse); toggle persists and main re-reads it
   at startup.
9. Windows `session-end` → `requestQuit()` → the same clean stop path as Exit; nothing
   runs after quit.
10. Sleep/resume: simulate a time jump (`now` advances) — existing tests already
    assert no catch-up storms (`discovery-scheduler.test.ts:139-165`), no overlap
    (`:65-92`), bounded employer/health batches; add an explicit long-gap
    `evaluate()` case for sources if one is missing.
11. Attention surfacing: with an enabled source in `credentials-required`/`failed`
    health, the tray menu shows a single attention line refreshed on menu open; no
    popups or repeated dialogs.
12. Startup failure: the failure window is unaffected and the tray is still present
    with an Exit path (`BackendManager.current === null`; `stop()` is a no-op-safe
    null handle).

Verify: `npm run verify` green. No live discovery, no rebuild/install, no commit or
push during implementation; report the diff scope and exact verify output.

### 10.7 Ready-to-run prompt — Package C

```
Implement the "Background discovery and tray controls" work package exactly as
specified in docs/OCCUPATION_EXPANSION_PROPOSAL.md §10.

Guardrails (do not violate):
- Preserve the existing close behavior when the setting is off, and the exact
  existing single-instance, before-quit, and window-all-closed behavior.
- DO NOT modify src/discovery/discoveryScheduler.ts, discoveryCoordinator.ts, any
  provider, discovery logic, migrations, or the installer. Pause/resume reuses the
  existing global scheduler toggle (PUT /api/scheduler-control).
- Do not touch settingsSchema (app.ts:1458-1475) or AppSettings
  (models/dashboard.ts:158-167). Persist closeToTray via repository.getSetting/
  saveSetting('closeToTray') through the new routes only.
- Do not implement startup-with-Windows (separate opt-in follow-up; document hook
  only). No commit/push/rebuild; preserve unrelated uncommitted changes.

Work items:
1. NEW src/desktop/desktopLifecycle.ts — pure closeAction(closeToTray, quitRequested)
   ('close'|'hide'), trayLabel(state), pauseMenuItemLabel(paused). No electron import.
2. src/desktop/windowManager.ts — create() takes closeDecision(): CloseAction;
   in the close handler, after saveBounds, if 'hide' preventDefault + hide().
3. src/desktop/main.ts — quitRequested flag + requestQuit(); app.on('session-end',
   requestQuit); create TrayManager after windows.create (always, so startup failure
   still has an Exit path); fetch closeToTray from GET /api/desktop-settings after
   backstart and pass closeDecision to WindowManager.create; IPC desktop:get-close-to-
   tray, desktop:set-close-to-tray, desktop:tray-summary, desktop:tray-pause-toggle
   (proxy to the HTTP routes via backend.current.url; mimic the existing fetch usage).
4. NEW src/desktop/trayManager.ts — Tray + tooltip (trayLabel) + context menu:
   Open Job Browser (windows.focus), Pause/Resume Discovery (toggle via IPC), status/
   attention line (refreshed on menu open from desktop:tray-summary), Exit Job
   Browser (requestQuit); tray click -> focus.
5. src/desktop/preload.cts + src/client/desktop.ts — expose getCloseToTray,
   setCloseToTray, togglePauseDiscovery on the bridge.
6. src/client/components/DesktopSettings.tsx — "Continue running in the background
   when the window is closed" checkbox wired to the bridge; web mode unchanged.
7. src/server/app.ts — add GET/PUT /api/desktop-settings (strict zod body,
   default closeToTray: true when unset) and GET /api/tray-summary
   ({schedulerEnabled, running, attentionSources, startupComplete}) in a disjoint
   block after the view-scope routes.
8. NEW tests/desktop-lifecycle.test.ts — closeAction matrix, trayLabel /
   pauseMenuItemLabel outputs.
9. NEW tests/desktop-settings-api.test.ts — desktop-settings default + round-trip +
   400 on invalid body; tray-summary fields present and correctly computed
   (schedulerEnabled false -> paused content; an enabled source with
   credentials-required health increments attentionSources).

Acceptance criteria in §10.6 (all 12). Run npm run verify and confirm the full gate
is green. Report the diff scope, the close-to-tray default decision you applied, and
the exact verify output. Do not commit or push.
```

### 10.8 Sequencing note

Package A (§7 prompt) is the first bounded implementation task and can start
immediately; Package B is next (small backend fix); Package C follows. Packages are
independent, but this order keeps browsing and preference behavior committed and
verified before lifecycle changes and matches the requested
browsing → preferences → background order.
