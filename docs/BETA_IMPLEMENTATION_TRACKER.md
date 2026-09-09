# BETA IMPLEMENTATION TRACKER — Job Browser

> Persistent, authoritative record of the external-beta productization sprint.
> Resume sessions from THIS file, not from chat. Repository evidence wins over any stale claim in this file.

## Sprint Metadata

| Field                      | Value                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Sprint                     | `beta-productization` ("JOB BROWSER - FULL BETA PRODUCTIZATION")                                                                     |
| Started                    | 2026-09-08 (local)                                                                                                                   |
| Repo                       | `ddecker618/job-browser`, branch `main`                                                                                              |
| Baseline commit            | `8998fde` (clean worktree at start)                                                                                                  |
| Version during development | `1.0.28` (bump ONLY once, at phase 17)                                                                                               |
| PUSH RULE                  | **NO PUSH during this sprint.** Local checkpoint commits only. Same for empty commits.                                               |
| Acceptance                 | Final report states **READY FOR EXTERNAL BETA** or **NOT READY FOR EXTERNAL BETA** + reason. Version bump only after all gates pass. |

### Global guardrails (never violate)

- Create/update this tracker BEFORE substantial code changes; update at every checkpoint: phase change, decision, defect, test run, commit.
- Do not push. Checkpoint commits are allowed and encouraged (small recoverable units).
- Do not bypass CAPTCHA/auth/robots/rate limits. Do not debug production site internals strictly to defeat anti-bot measures.
- Do not do destructive operations on production data; back up before anything affects it. (Existing DB = `%APPDATA%\Job Browser\data\jobs.sqlite`.)
- Do not delete or destroy user data during any clean install / reinstall / upgrade path. Do not package personal or developer data (re-run privacy scans).
- Migration files already applied must never be edited or renumbered (1.0.28 validates checksums).
- Do not kill a browser process the user is actively driving (only Playwright-owned sessions may be force-terminated).
- Work back-to-back with `npm run verify` (104 files / 1057 tests baseline, green at `8998fde`).

## Status Legend

- `[x]` complete · `[>]` in progress · `[ ]` not started · `[~]` deferred/blocked · `[!]` blocked on user

## Phase Progress

| Phase | Scope (per plan)                                                                                                     | Status | Notes                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| 0     | Audit docs, verify baseline, record outstanding work                                                                 | [x]    | Audit done; outstanding installed-reinstall tail recorded in Known Remaining Work        |
| 1     | Browser-backed discovery reliability inventory + fix failure class                                                   | [>]    | 1A inventory done; 1C Dice root cause = DEF-001; fix landed in units A+C this checkpoint |
| 2     | Performance (browser cycles: wall-clock, dom-idle/greedy loads, parallelization)                                     | [ ]    | Blocked until phase 1 bake-in                                                            |
| 3     | First-run UX (branding, zero-state, 1-click add employer)                                                            | [ ]    |                                                                                          |
| 4     | Log-in UX (status of login progress, verification)                                                                   | [ ]    |                                                                                          |
| 5     | Empty-state/error-state UX (per-provider errors, no jobs found, health)                                              | [ ]    |                                                                                          |
| 6     | Privacy (already largely covered): do-not-collect claims, distribution privacy test, personal-data exclusions re-run | [ ]    | Existing work `3/3` green at `8998fde`; re-run at release                                |
| 7     | Clean install / upgrade safety (incl. the reinstall tail)                                                            | [ ]    | Installed copy is still previous build — see Blockers                                    |
| 8     | Packaging identity / hardening (already largely done): neutral appId, payload exclusions, installer                  | [~]    | DONE at `8998fde`; re-verify per release (phase 10)                                      |
| 9     | Automated browser regression tests                                                                                   | [ ]    | Phase 11 tests below are phase-1 companions; fuller suite here                           |
| 10    | Release validation incl. packaged smoke tests                                                                        | [ ]    | Smoke runner exists; re-run at release                                                   |
| 11    | Regression tests for discovery reliability (resource release/timeouts)                                               | [>]    | `browser-session-close` + engine deadline tests added this checkpoint                    |
| 12    | Docs: index page with**every** known quirk (incl. Dice hang)                                                         | [ ]    |                                                                                          |
| 13    | Privacy audit final pass                                                                                             | [ ]    |                                                                                          |
| 14    | Beta plan                                                                                                            | [ ]    |                                                                                          |
| 15    | Beta config + release                                                                                                | [ ]    |                                                                                          |
| 16    | Adoption/flags telemetry                                                                                             | [ ]    | Keep minimal; no personal data                                                           |
| 17    | Version bump (ONLY here) + version-checks + CSP + final gates                                                        | [ ]    | 1.0.28 → 1.1.0 target                                                                    |
| 18    | Final report + READY/NOT READY FOR EXTERNAL BETA                                                                     | [ ]    |                                                                                          |

## Current Working State

Phase 0 audit complete:

- Worktree clean at `8998fde`, v1.0.28, branch `main`. Baseline `npm run verify` green (104 files / 1057 tests) as of `8998fde` (no source changes since).
- Current installer: `release\Job-Browser-Setup-1.0.28.exe`, 253,530,460 B, SHA-256
  `12F9AAFE20AFA615D45363DB37EB512D61EDEE68544F40E44D990C0FD1C5007A`
  (supersedes `7BF04A32…` → `D67AEBED…`). Packaged `app.asar` = 73,658,296 B (SHA `8F951906AA56FA091E80FB06D3E5AF34B0EADB086E855C78996B793DE8B3B365`).
- Installed app is still the PREVIOUS hardened build; reinstall waited on the app being closed (see Blockers).
- Production DB: fine. One historical migration checksum diverged (`030_employer_aliases.sql`); USER-APPROVED one-row reconcile on `2026-09-09T00:35Z`; backup `C:\Users\dusti\AppData\Local\Temp\opencode\jobs.sqlite.pre-030-reconcile-2026-09-09T00-35-56-114Z.sqlite`; drift scan = NO DRIFT.

Phase 1 (browser reliability) WORKING STATE:

- Full inventory of browser-backed paths completed (wellfound, ziprecruiter, indeed → shared `runBrowserSearch` via `browserJobBoard.ts`; dice, linkedin, usajobs, handshake → direct `launchBrowserSession` from `linkedIn/browserSession.ts`).
- Root cause of the Dice detail-page stall identified and reproduced as a failure CLASS: unbounded `closeBrowserSession()` + per-run deadline absent in `DiscoveryEngine`.
- Unit A (bounded session close) and Unit C (run deadline watchdog) implemented this checkpoint. Unit B (launch-timeout) intentionally NOT changed: `chromium.launchPersistentContext` has its own internal launch bound (~30s) and a wrapper risks leaking an orphan process on our own timeout — record decision D-002.
- Next small unit (phase 1 bake-in): interruptible cancellation semantics + coach software checks after provider logic; then phase 2 performance.

## Decisions Made

- D-001 (2026-09-09): Production DB `030_employer_aliases.sql` checksum diverged from the shipped file because the file was re-landed by commit `d43f361`. USER AUTHORIZED a one-row `UPDATE schema_migrations` to the current file checksum (`a7ed42…` → `1e10dbc4…`). No app data touched. Backup taken first.
- D-002 (2026-09-09): No explicit launch timeout wrapper on `launchPersistentContext`; Playwright already bounds launch internally, and our own wrapper could orphan a half-launched process. Bounded close + run deadline cover the stall class.
- D-003 (2026-09-09): Deadline teardown force-closes the module-level browser session even if sharing with another flow (login wait). Discovery runs are serialized, so at most one run is active; a session the user is separately driving (dev `keepBrowserOpen`) may be closed by a timeout — acceptable; logged.
- D-004 (2026-09-09): No changes to site terms/robots/CAPTCHA paths — login waits, security-challenge waits, and bounded retries remain as designed.
- D-005 (2026-09-09): Phase 11 regression tests for this failure class are unit-level (mock/fake sessions); no live-browser dependence in CI.

## Defects Discovered

- DEF-001 — Browser detail-page stall (Dice; symmetric candidate across all browser providers). Symptom from field: Dice navigated into a job page and stayed there indefinitely; Chrome stayed open; discovery stalled until the user manually closed the browser. Analysis (evidence from code, 2026-09-09):
  1. Every Dice wait is individually bounded (goto 30s, `domcontentloaded` 45s×3; selector 15s; waits; loops). The detail extractor is bounded too.
  2. `closeBrowserSession()` (`src/providers/linkedIn/browserSession.ts`) awaits `persistentContext.close()` and `underlyingBrowser.close()` with NO timeout; a wedged Chromium keeps the window open and the awaited close hangs. Closing the window manually lets the browser exit → close resolves → discovery resumes. **Matches the reported symptom exactly.**
  3. `DiscoveryEngine.run` has no per-run deadline, so a chain of bounded steps (or one stuck close) can stall a run arbitrarily long, and `options.signal.abort()` is only honored at coarse provider checkpoints — it cannot interrupt an in-flight browser wait.
     Classification: failure class = unbounded browser lifecycle/close + no run-level watchdog. NOT a Dice-only special case.
     Fix (this checkpoint): bounded close with forced kill of the Playwright-owned process as last resort (Unit A); per-run deadline in `DiscoveryEngine` that force-closes the browser on breach so in-flight awaits reject and the run is failed with a timeout error (Unit C).
- DEF-002 (from 2026-08-16 era, revalidated): production `030` migration checksum drift — see D-001. Closed.

## Verification Ledger

| When                 | What                                                                                                             | Result                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Baseline (`8998fde`) | `npm run verify`                                                                                                 | 104 files / 1057 tests, green                                              |
| 2026-09-09           | `tests/browser-session-close.test.ts` + engine-deadline test                                                     | focused run green                                                          |
| 2026-09-09           | `npm run verify` full AFTER phase-1 units A+C + tests (format+lint+typecheck+test)                               | 105 files / 1064 tests, green                                              |
| 2026-09-09           | Installed reinstall tail: silent install `12F9AAFE…`, installed asar == packaged asar, `desktop:smoke:installed` | all green (exit 0, asar `8F951906…` match at installed path, smoke passed) |
| Release (phase 10)   | packaged smoke + distribution privacy scan + installer asar hash (re-run at boundary)                            | pending                                                                    |
| Outage post-incident | drift scan + app start (`Backend started` 2026-09-09T00:37:02Z, `pendingMigrations:[]`)                          | clean                                                                      |

## Files Changed (this sprint, so far)

- `docs/BETA_IMPLEMENTATION_TRACKER.md` (this file — must exist before substantial code; created 2026-09-09)
- `src/providers/linkedIn/browserSession.ts` — bounded session close + forced process kill fallback (Unit A)
- `src/discovery/discoveryEngine.ts` — per-run deadline watchdog (Unit C)
- `src/models/discovery.ts` — `DiscoveryOptions.runTimeoutMs`
- `tests/browser-session-close.test.ts` (new) — bounded-close/fake-session tests (phase 11)
- `tests/discovery-engine.test.ts` — provider-deadline test (phase 11)

## Commits Created (sprint, local only — NONE pushed)

- `811a26b` — fix: bound browser session close and discovery run deadline (Units A+C, phase-11 tests, tracker). Verify green 105/1064. 2026-09-09.
- `d28e4fe` — docs: tracker checkpoint after `811a26b`.
- (this update) — docs: tracker close-out of installed reinstall tail (silent install + asar match + installed smoke). NOT pushed.

## Known Remaining Work

- [x] Reinstall current installer (`12F9AAFE…`): silent install exit 0; installed asar == packaged asar (`8F951906…`); `desktop:smoke:installed` passed. App was confirmed closed (no Job Browser/electron process, no 6783 listener) before install. CLOSED 2026-09-09.
- [ ] Phase 1 bake-in: interruptible-cancellation semantics review + provider-side classify errors as `needs-verification` / shape of health status; then Phase 2 perf.
- [ ] Full phase list 2–9, 12–18 per Phase Progress.
- [ ] Final privacy scan + distribution scan at release boundary.
- [ ] Final report + version bump (phase 17) + READY/NOT READY verdict.

## Blockers

- [ ] No push until sprint end (user rule — actively enforced, not a bug).

## Resume Instructions

1. Re-read THIS file first. Update `Current Working State` to match reality before any new work.
2. Queue = bundled in Phase Progress + Known Remaining Work; start at the first `[>]`/`[ ]` item.
3. Run `npm run verify` before any source change if the code changed since last LEDGER row after a `git status` check.
4. Keep units small; checkpoint-commit after each unit once verify is green. NEVER push.
5. If prod DB is ever touched: confirm user consent, back up first (see D-001 pattern), log commands.
