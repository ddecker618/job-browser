# Session Handoff

## Current status — 1.1.4 release-boundary closeout (2026-09-14)

The 1.1.4 release boundary is **complete**. This is the active checkpoint.
Older sections below are historical context; do not start additional work
from them.

### Release boundary state

- **Version:** `1.1.4` in `package.json` and `package-lock.json`.
- **Installer rebuilt and validated:**
  `release\Job-Browser-Setup-1.1.4.exe` (253,613,965 bytes, SHA-256
  `C61A58FDEDFFE253E7E59B9BE28A88E4ACC03F58AD9687DF0BDBC639DF6DADF1`).
  Packaged and installed `app.asar` are identical (74,133,415 bytes,
  SHA-256 `0504650BBE543BD3D4A50B6E987F5246475F1C096ADCDEC3DE83A5D766E4B2CE`).
  Installed executable reports ProductVersion `1.1.4.0` / FileVersion
  `1.1.4` (silent upgrade from the 1.1.3 install, exit 0).
- **Smokes passed:** packaged smoke, packaged seeded-upgrade smoke,
  installed smoke, and installed seeded-upgrade smoke — all PASS.
- **Full verification:** `npm run verify` — 169 files / 1,573 tests, all
  pass.
- **Privacy/security gates:** `npm run privacy:check` 11/11 and
  `npm run nlp:security-audit` 3/3 pass.
- **P36 confirmed in the packaged asar:** `resume-snapshot-evidence-v2`,
  `coverageContext`, `captureState`, `parsingError`, and the
  `job-intelligence-abstention-note` client marker are all present in the
  packaged app.asar.
- **Notifications remain disabled:** `NotificationManager.tsx` returns
  `null`; `main.ts` denies `notifications` permission checks/requests
  before the BrowserWindow is created (verified inside the packaged asar:
  `installSilentNotificationPolicy`, `setPermissionRequestHandler`, and
  `setPermissionCheckHandler` are present).
- **Production DB untouched** (prod DB SHA-256 and size unchanged across
  the release).
- **No orphan processes:** no Job Browser/Electron processes and port 6783
  is free after validation.

### What shipped at this boundary (P36, local commits `dbd0fdb` + `b4e6256` + 1.1.4 release commit)

P36 coverage abstention hygiene on top of the 1.1.3 baseline:
`snapshotEvidence.ts` emits consistent UNKNOWN coverage for all five
evidence kinds when a resume snapshot failed to parse (never `MISSING`,
adapter bumped to `resume-snapshot-evidence-v2`); `/api/jobs/:id/intelligence`
returns a read-only `coverageContext` (`captureState`:
`no_application` | `no_snapshot` | `parsed` | `failed`, plus
`parsingError`); and the Job Intelligence preview renders capture-state
absence notes and a failed-parse abstention note. P36 stays EXPLANATION/
shadow-only — no scoring, eligibility, ranking, filtering, lifecycle,
status, archive, removal, or hard-gate changes; no job-type expansion;
no new NLP modules; no schema migration. See `docs/CHANGELOG.md` (1.1.4)
for details.

### Remaining manual Windows acceptance items

- Real Windows shutdown / logoff / restart must deliver
  `query-session-end` on the main BrowserWindow; the controller's
  bounded `onWindowsSessionEnd()` cleanup runs, then `app.exit()` is
  issued. This is a Windows-behaviour verification that cannot be
  reproduced from a normal shell.
- Actual `Tray` icon visibility, right-click menu rendering, and
  focus behaviour require a desktop session and cannot be asserted
  programmatically. The harness verifies the in-band IPC and backend
  coordination that drive those OS-level behaviours.
- Whether the brief `shutdown` timeout (default 5 s) is acceptable
  for real Windows shutdown latency requires a real logoff timing on
  a packaged build.
- `src/client/components/NotificationManager.tsx` must remain **silent**
  (no browser/Windows notification sounds or OS notifications). Do not
  re-enable notifications during any future work.

### Recommended next task

No pending source or packaging work remains. The 1.1.4 release commit is
local and **ready to push** pending user approval. On a future source
change, rerun `npm run verify`, `npm run desktop:lifecycle-harness`, and
the packaged/installed smokes before any new release boundary. Manual
packaged Windows acceptance items above are the only outstanding
verification.

---

## Historical — Lifecycle-continuation checkpoint (2026-09-14, pre-release)

This section is **historical**. It records the fixtures-and-shutdown-race
continuation that produced commit `a7c4356` before the 1.1.3 boundary; the
release itself is recorded in the current status above. Do not treat the
"next tasks" here as the current queue.

### What this checkpoint actually fixes

Eight concrete defects were identified in the Package C implementation
delivered under the previous continuation. Source-level evidence and the
fixes shipped today:

1. **Close-to-tray disabled did not exit.** `src/desktop/main.ts` only
   called `app.quit()` from `window-all-closed` when `quitRequested`
   was already true, so an ordinary close with `closeToTray=false`
   left the backend alive. Fixed: the `window-all-closed` handler now
   also exits when close-to-tray is off (or when the tray is not
   available), routed through `lifecycle.requestQuit()`.
2. **No-tray fallback could hide the only window.** `closeAction()`
   only checked `closeToTray` and `quitRequested`. Fixed: it now
   also checks `trayAvailable`. When the tray was never created
   (e.g. a startup failure left the desktop running with no Exit
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
   and `app.quit()` paths route through `lifecycle.requestQuit()`,
   so any quit path sets the quit flag and destroys the tray.
5. **Pause/resume changed a separate preference.**
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
   short-circuits if `destroying` is true, and the tray's `isCreated`
   getter returns false once `destroy()` is in progress.
8. **Windows shutdown documentation and handling were wrong.**
   The previous handoff claimed `before-quit` covered Windows
   shutdown/logoff. Electron's documentation explicitly states
   `before-quit` is **not** emitted on Windows shutdown/restart or
   user logout. Fixed: `WindowManager.create()` now accepts
   optional `querySessionEnd` and `sessionEnd` handlers; the main
   process wires both on the main BrowserWindow. `querySession-end`
   `preventDefault()`s so bounded cleanup has a chance to flush;
   `session-end` is a last-chance no-op-preventable hook. The
   controller's `onWindowsSessionEnd()` runs bounded best-effort
   cleanup with a configurable timeout (default 5 s) and never
   claims the cleanup is guaranteed to complete before Windows
   terminates the process.

### Architecture

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
  `closeAction`, `setCloseToTray` PUT, `requestQuit`, and
  Windows session-end cleanup. The
  `set-close-to-tray` IPC now throws when persistence fails (the
  UI is expected to surface the error).
- `src/desktop/trayManager.ts` — assigns the Electron `Tray`
  before installing the menu, cleans up partially-created state
  on menu construction failure, and guards `refresh()` against
  resolving after `destroy()`.

### Verification (recorded by this continuation)

- `npx vitest run tests/desktop-lifecycle-controller.test.ts` —
  17 tests pass: closeAction matrix (quit wins, hide only when
  tray is available, close fallback when not, close when
  close-to-tray is off), `requestQuit` idempotency,
  `shutdown` serialization and bounded timeout, `persistCloseToTray`
  round-trip / rejection rollback / backend-unavailable
  restoration, `loadCloseToTrayFromBackend` success and
  network-blip fallback, `onWindowsSessionEnd` bounded cleanup.
- `npx vitest run tests/desktop-tray-manager.test.ts` — 2
  tests pass: refresh-after-destroy is a no-op; partial-create
  failure during menu construction triggers `destroy()`.
- `npx vitest run tests/desktop-backend-manager-shutdown.test.ts`
  — 4 tests pass: `currentShutdown` is non-null only during an
  in-flight shutdown, a second `stop()` awaits the same promise,
  the handle is cleared before awaiting so other code sees "no
  backend" during cleanup, and the in-flight slot is cleared on
  a failed first attempt.
- `npx vitest run tests/desktop-scheduler-control-api.test.ts`
  — 3 tests pass: PUT flips `schedulerEnabled` without touching
  `employerDiscoveryEnabled`, rejects missing `schedulerEnabled`
  with 400, rejects extra fields with 400 (strict body).
- `npm run typecheck` — green.
- `npm run lint` — green.
- `npm run format:check` — green.
- `npm run verify` — green: 168 test files / 1,547 tests.
  Baseline before this continuation was 164 / 1,521. New
  files: 4 test files + 1 lifecycle controller. New tests: 26.

### Files changed by this continuation

- `src/desktop/backendManager.ts` — shared shutdown promise,
  `currentShutdown` getter.
- `src/desktop/desktopLifecycle.ts` — `closeAction` accepts
  `trayAvailable`.
- `src/desktop/lifecycleController.ts` (new) — controller with
  injected dependencies.
- `src/desktop/main.ts` — wired through the controller;
  `set-close-to-tray` PUT rollback; tray pause via
  `/api/scheduler-control`; `window-all-closed` exits on
  close-to-tray off; Windows session-end handlers.
- `src/desktop/trayManager.ts` — install menu after assignment;
  guard refresh-after-destroy; cleanup on partial-create
  failure.
- `src/desktop/windowManager.ts` — optional
  `querySessionEnd` / `sessionEnd` handlers.
- `src/server/app.ts` — `PUT /api/scheduler-control`.
- `tests/desktop-backend-manager-shutdown.test.ts` (new).
- `tests/desktop-lifecycle-controller.test.ts` (new).
- `tests/desktop-scheduler-control-api.test.ts` (new).
- `tests/desktop-tray-manager.test.ts` (new).
- `tests/desktop-lifecycle.test.ts` — updated `closeAction`
  tests for the new `trayAvailable` parameter.
- `docs/OCCUPATION_EXPANSION_PROPOSAL.md` — Package C status
  notes, native acceptance checklist updated.
- `SESSION_HANDOFF.md` — this rewrite.

### What still requires native Windows verification

These cannot be exercised from the local Windows shell by a code
change; they require a packaged or installed build and a real
session:

- **Tray icon presence and tooltip text.** The construction is
  unit-tested with `vi.doMock('electron')`; the OS-level icon and
  tooltip must be confirmed on a packaged build.
- **Right-click menu contents.** The menu items and labels are
  unit-tested; their rendering on Windows requires a packaged
  build.
- **Pause/Resume Discovery round-trip through the tray.** The
  PUT and label flip are unit-tested; the click → IPC → PUT →
  label refresh sequence must be confirmed on a packaged build.
- **Open Job Browser from the tray.** The IPC and window focus
  are unit-tested; OS focus behavior must be confirmed.
- **Exit Job Browser from the tray (clean shutdown).** The
  `requestQuit` flow is unit-tested; the actual
  `app.quit() → before-quit → backend.stop → DB close` sequence
  must be observed on a packaged build.
- **Close with close-to-tray on (window hides, tray remains).**
  Unit-tested; OS-level behavior must be observed.
- **Close with close-to-tray off (graceful exit).** Unit-tested;
  OS-level behavior must be observed.
- **Second launch while running (single-instance, focus).**
  Existing `app.requestSingleInstanceLock()` + `second-instance`
  handler; not changed by this continuation.
- **Windows shutdown/logoff handling.** `query-session-end`
  registration is in place with bounded best-effort cleanup
  (5 s timeout). Whether Windows actually delivers
  `query-session-end` before terminating is a Windows behavior
  that must be confirmed on a packaged build. The implementation
  does **not** claim the cleanup completes before Windows
  terminates the process.
- **Startup failure (tray still available for Exit).** Unit-tested
  via the closeAction tray-availability fallback. The actual
  rendered failure page must be observed on a packaged build.

### Why the desktop smoke harness does not prove tray behavior

`scripts/desktop-smoke.ts` renders the seeded Employers page and
asserts text; it does **not** assert tray icon presence, menu
contents, pause/resume round-trips, or Exit Job Browser. A
generic packaged smoke pass (`npm run desktop:smoke:packaged` or
`npm run desktop:smoke:installed`) exercises backend, routes, and
shutdown but does not establish any of the tray / close-to-tray /
Windows-shutdown guarantees from §10.6. Any recommendation of those
scripts as evidence for Package C completion is invalid.

### Recommended next task

Write a focused, **fixture-based** desktop lifecycle harness that
boots an isolated Electron app against a temporary user data
directory and asserts, in this order:

1. Tray icon is present after `window-created`.
2. Tray right-click menu contains `Open Job Browser`,
   `Pause Discovery` (or `Resume Discovery`), and
   `Exit Job Browser`.
3. Toggling Pause/Resume flips the global scheduler
   (`schedulerEnabled` in `/api/tray-summary`).
4. Close with close-to-tray on hides the window (Electron
   `BrowserWindow.isVisible()` false) and the tray remains.
5. Close with close-to-tray off quits the app cleanly (no
   leftover processes).
6. Startup failure (forced by an invalid DB path) leaves a
   tray Exit path available.

Do not require live discovery. Do not run from a packaged build
until steps 1–6 pass on `electron .` against the temp user data
directory.

Stop before packaging or implementing additional features.

---

## Historical — Recovery checkpoint Package A (2026-09-13)

This section is **historical**. Package A implementation was recovered
from an interrupted OpenCode session. The work is present,
uncommitted, and at a source checkpoint. Do not restart Package A.
The verification numbers recorded here (160 / 1,491) are the
baseline before the Package B+C continuation below.

- Package A implementation is present, uncommitted, and at a
  source checkpoint; do not restart it.
- Source includes the scope query, remembered-view endpoints,
  scoped saved filters, All jobs toggle, personal-score freshness
  badges and UI/API/repository tests.
- Recovery fixed the interaction between asynchronously loaded
  remembered scope and locally saved filters, serialized scope
  preference writes, refreshed the scope cache after saving, and
  made each search capture its score version once.
- 160 test files / 1,491 tests passed at recovery.

## Historical — Continuation checkpoint Package B + Package C (2026-09-13)

This section is **historical and partially incorrect**. The recorded
"Package C" claims in this section were not actually established by
the source; this continuation is the first checkpoint that exercises
the lifecycle in a Node test environment. In particular:

- The claim that Windows shutdown is handled by `before-quit` is
  **false** per Electron's documented behavior. See the
  `query-session-end` / `session-end` registration in the current
  status above.
- The claim that the desktop lifecycle is "fully verified" is
  **false**. Pure helper tests are insufficient to prove
  coordination; see the new integration tests added in this
  continuation.
- The claim that `npm run desktop:smoke` proves tray behavior is
  **false** — the harness does not assert tray or close-to-tray
  behavior.

Package B (consistent preference resolution) remains in place from
the earlier continuation:

- `src/server/backend.ts` — the post-discovery `analyze` callback
  and the startup `reconcile-stale-intelligence` step now pass
  `options.profilePreferencesPath` to `loadCandidateProfile` and
  `loadScoringConfig`.
- `src/preferences/cliProfilePreferences.ts` — new helper that
  resolves `--profile-preferences=<path>` or
  `PROFILE_PREFERENCES_PATH`. The three auxiliary CLIs
  (`analyze`, `verified-matches`, `role-details:backfill`) call
  it; without the flag/env they fall back to legacy
  `config/candidate-profile.json` and `config/scoring-config.json`.
- `tests/cli-profile-preferences.test.ts` (7 tests) and
  `tests/backend-preference-resolution.test.ts` (3 tests) prove
  the resolution and the integration.

---

## Current project status (historical, pre-Package-B/C)

Reconciled against source checkpoint `fd63a2a` (P35) and the P33
release record. Git/source evidence takes precedence over historical
completion records.

- Phase 7 and Phase 8 (8.1–8.8) are complete; Phase 8 was
  Architect-approved on 2026-08-12. Employer Discovery 9.1–9.5 is
  complete and approved; 9.6 seed manifest import is complete.
- The 18-phase beta-readiness sprint is complete: READY FOR
  EXTERNAL BETA. Original product phases, beta phases, NLP Stages
  0–29, and P0–P35 checkpoints are separate numbering sequences.
- NLP Stages 0–29 and P0–P35 are complete. P35 is committed as
  `fd63a2a`. Latest recorded full source verification: 159
  files / 1,472 tests.
- Current package version and latest validated installer:
  **1.1.2**, released at P33 (`c83949b`). P34 source-health code
  and P35 defaults are later source changes and are not included
  in that recorded installer.
- Current source defaults: `jobIntelligenceExplanation`,
  `roleFamilySuggestion`, and `searchProfileFeedback` are on;
  `searchTieBreak` is off. Stored opt-outs remain authoritative.

## Release evidence (historical)

- Installer: `release/Job-Browser-Setup-1.1.2.exe`, 253,597,831 bytes.
- Installer SHA-256: `A77B1F745BB2474E61CED4148450BF2A7DC654A60853ED94CF265D155AFE28F2`.
- P33 recorded packaged, installed, and seeded-upgrade smoke
  passes, installed Job Intelligence validation, 158 files /
  1,460 tests, privacy 11/11, security 3/3.

## Resume and maintenance

Read `docs/PROJECT_MEMORY.md`, `docs/BETA_IMPLEMENTATION_TRACKER.md`,
and `docs/Intelligence_Roadmap.md` alongside current Git status.
Use `docs/IMPLEMENTATION_ROADMAP.md` for completed product scope and
dependencies. Historical evidence remains in Git history, the
changelog, and tracker ledgers; old next-step instructions are not
the current queue.

Do not push without user authorization. Do not rebuild/install or
rerun live sources as part of documentation cleanup. Preserve
production data; use verified backups for any separately authorized
live data changes.

## Requested follow-up: background discovery and tray controls (historical)

The original user requirement recorded here asked for close-to-tray
behavior, tray controls, pause/resume, and exit coordination. The
implementation and verification now live in the current status
above; this section is preserved for traceability only.
