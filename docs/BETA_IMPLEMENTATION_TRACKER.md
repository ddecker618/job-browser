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

| Phase | Scope (per plan)                                                                                                     | Status | Notes                                                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | Audit docs, verify baseline, record outstanding work                                                                 | [x]    | Audit done; outstanding installed-reinstall tail recorded in Known Remaining Work                                                                                  |
| 1     | Browser-backed discovery reliability inventory + fix failure class                                                   | [~]    | 1A inventory done; DEF-001 root-cause fixed (units A+C + abort-interrupt); provider error classification → health LANDED                                           |
| 2     | Performance (browser cycles: wall-clock, dom-idle/greedy loads, parallelization)                                     | [~]    | Fixed-sleep → bounded content/card-count waits landed for dice/linkedin/usajobs/shared runner; goto/load audit clean; parallelization deferred to phase 15 (D-008) |
| 3     | First-run UX (branding, zero-state, 1-click add employer)                                                            | [~]    | First-run onboarding panel on dashboard (zero jobs) + quick-add chips for browser boards (dice/linkedin/usajobs/handshake) LANDED                                  |
| 4     | Log-in UX (status of login progress, verification)                                                                   | [~]    | Running-status sign-in hint (browser providers) + run-history verification callout LANDED                                                                          |
| 5     | Empty-state/error-state UX (per-provider errors, no jobs found, health)                                              | [~]    | Sources error guidance (verification/auth/timeout/404/unavailable/no-positions) + contextual jobs empty states LANDED                                              |
| 6     | Privacy (already largely covered): do-not-collect claims, distribution privacy test, personal-data exclusions re-run | [~]    | Existing work `3/3` green at `8998fde`; `privacy:check` script added; no-telemetry transmission policy documented LANDED (re-run at release)                       |
| 7     | Clean install / upgrade safety (incl. the reinstall tail)                                                            | [ ]    | Installed copy is still previous build — see Blockers                                                                                                              |
| 8     | Packaging identity / hardening (already largely done): neutral appId, payload exclusions, installer                  | [~]    | DONE at `8998fde`; re-verify per release (phase 10)                                                                                                                |
| 9     | Automated browser regression tests                                                                                   | [~]    | Cleanup-guarantee suite (`tests/browser-regression.test.ts`) + provider self-close-on-error assertion LANDED                                                       |
| 10    | Release validation incl. packaged smoke tests                                                                        | [ ]    | Smoke runner exists; re-run at release                                                                                                                             |
| 11    | Regression tests for discovery reliability (resource release/timeouts)                                               | [>]    | `browser-session-close` + engine deadline tests added this checkpoint                                                                                              |
| 12    | Docs: index page with**every** known quirk (incl. Dice hang)                                                         | [ ]    |                                                                                                                                                                    |
| 13    | Privacy audit final pass                                                                                             | [ ]    |                                                                                                                                                                    |
| 14    | Beta plan                                                                                                            | [ ]    |                                                                                                                                                                    |
| 15    | Beta config + release                                                                                                | [ ]    |                                                                                                                                                                    |
| 16    | Adoption/flags telemetry                                                                                             | [ ]    | Keep minimal; no personal data                                                                                                                                     |
| 17    | Version bump (ONLY here) + version-checks + CSP + final gates                                                        | [ ]    | 1.0.28 → 1.1.0 target                                                                                                                                              |
| 18    | Final report + READY/NOT READY FOR EXTERNAL BETA                                                                     | [ ]    |                                                                                                                                                                    |

## Current Working State

Phase 0 audit complete:

- Worktree clean at `8998fde`, v1.0.28, branch `main`. Baseline `npm run verify` green (104 files / 1057 tests) as of `8998fde` (no source changes since).
- Current installer: `release\Job-Browser-Setup-1.0.28.exe`, 253,530,460 B, SHA-256
  `12F9AAFE20AFA615D45363DB37EB512D61EDEE68544F40E44D990C0FD1C5007A`
  (supersedes `7BF04A32…` → `D67AEBED…`). Packaged `app.asar` = 73,658,296 B (SHA `8F951906AA56FA091E80FB06D3E5AF34B0EADB086E855C78996B793DE8B3B365`).
- Installed app is still the PREVIOUS hardened build; reinstall waited on the app being closed (see Blockers).
- Production DB: fine. One historical migration checksum diverged (`030_employer_aliases.sql`); USER-APPROVED one-row reconcile on `2026-09-09T00:35Z`; backup taken first (scratch temp dir, file `jobs.sqlite.pre-030-reconcile-2026-09-09T00-35-56-114Z.sqlite`); drift scan = NO DRIFT.

Phase 1 (browser reliability) WORKING STATE:

- Full inventory of browser-backed paths completed (wellfound, ziprecruiter, indeed → shared `runBrowserSearch` via `browserJobBoard.ts`; dice, linkedin, usajobs, handshake → direct `launchBrowserSession` from `linkedIn/browserSession.ts`).
- Root cause of the Dice detail-page stall identified and reproduced as a failure CLASS: unbounded `closeBrowserSession()` + per-run deadline absent in `DiscoveryEngine`.
- Unit A (bounded session close) and Unit C (run deadline watchdog) implemented this checkpoint. Unit B (launch-timeout) intentionally NOT changed: `chromium.launchPersistentContext` has its own internal launch bound (~30s) and a wrapper risks leaking an orphan process on our own timeout — record decision D-002.
- Next small unit (phase 1 bake-in): interruptible cancellation semantics + coach software checks after provider logic; then phase 2 performance.

Phase 1 CLOSED (all units landed, verify green):

- Bounded session close (Unit A), per-run deadline (Unit C), abort-interruptive teardown: all landed.
- Provider error classification → health LANDED (`68abd20`): browser verification/auth-wall failures (`login timed out`, `please log in manually`, `authwall`, `security challenge`, `complete verification`, `verification required`, `checkpoint`, `captcha`) classify to `Verification required: Complete the security check or log in` and mark the source `credentials-required` (reuses existing health status per D-006) instead of `failed`; helper `requiresUserAction()` drives `lastError`. Plain authentication stays `Authentication required`.

Phase 2 (performance) WORKING STATE:

- Added `waitForContent` (selector presence poll) + `waitForCardCount` (DOM-count poll) to `linkedIn/browserSession.ts`; both bounded, poll at 250ms/200ms.
- Replaced per-provider FIXED sleeps with content-driven waits (worst case == previous budget, best case much faster):
  - Dice: post-nav 3000 → wait for `[data-testid="job-card"]`; pre-extract 2000 → wait for structured-data/header card; scroll-loop 2000 → wait for card-count growth.
  - LinkedIn: post-nav 3000 + pre-collect 2000 → wait for `.job-card-container`/`.jobs-search-results__list-item`; pre-extract 1500 → wait for `.jobs-description__content`/`.show-more-less-html__markup`; scroll-loop 2000 → card-count growth.
  - USAJobs: post-nav 5000 → wait for `#search-results .page-section`; pre-extract 2500 → wait for `main`; scroll (page-based) unchanged.
  - Shared `browserJobBoard.ts` (wellfound/indeed/ziprecruiter): post-results 2000 → wait for first cards (extractCards>0); scroll-loop 1500 → card-count growth.
- INTENTIONALLY KEPT (anti-bot pacing, per sprint rule): post-goBack `waitForTimeout(1500)` + randomized 1000–2000ms (Dice/LinkedIn) and 500–1500ms (USAJobs) pacing sleeps after returning from detail pages; also LinkedIn `clickJobCard` 1500 settle and browserJobBoard `goBack` settle 1000/1500. These are deliberate rate-limit/CAPTCHA pacing, not waste.
- Next perf item: `page.goto`/`domcontentloaded` audit (all providers already use `domcontentloaded`, 30–45s timeouts), then parallelization eval (likely deferred to phase 15 with explicit concurrency caps).

## Decisions Made

- D-001 (2026-09-09): Production DB `030_employer_aliases.sql` checksum diverged from the shipped file because the file was re-landed by commit `d43f361`. USER AUTHORIZED a one-row `UPDATE schema_migrations` to the current file checksum (`a7ed42…` → `1e10dbc4…`). No app data touched. Backup taken first.
- D-002 (2026-09-09): No explicit launch timeout wrapper on `launchPersistentContext`; Playwright already bounds launch internally, and our own wrapper could orphan a half-launched process. Bounded close + run deadline cover the stall class.
- D-003 (2026-09-09): Deadline teardown force-closes the module-level browser session even if sharing with another flow (login wait). Discovery runs are serialized, so at most one run is active; a session the user is separately driving (dev `keepBrowserOpen`) may be closed by a timeout — acceptable; logged.
- D-004 (2026-09-09): No changes to site terms/robots/CAPTCHA paths — login waits, security-challenge waits, and bounded retries remain as designed.
- D-005 (2026-09-09): Phase 11 regression tests for this failure class are unit-level (mock/fake sessions); no live-browser dependence in CI.
- D-006 (2026-09-09): Verification/auth-wall failures reuse the existing `credentials-required` source status rather than adding a new `needs-verification` status — the latter requires a table-rebuild migration because `sources.health_status` has CHECK constraints in `006_multi_source_discovery.sql`. The distinct health_message (`Verification required: Complete the security check or log in`) preserves the semantic difference without schema churn.
- D-007 (2026-09-09): Per-job anti-bot pacing sleeps after returning from detail pages (Dice/LinkedIn 1500 + randomized 1000–2000ms; USAJobs 500–1500ms) are KEPT, not converted to content-waits — bandwidth/CPU are not the constraint there; pacing is deliberate rate-limit/CAPTCHA mitigation. Scroll/pager content-load waits ARE converted (the DOM renders lazily, so polling measures real load and strictly reduces wall-clock).
- D-008 (2026-09-09): Cross-source discovery parallelization is DEFFERED to phase 15, gated on an explicit concurrency cap (target ≤2) + coordinator sequencing/stop-semantics review. Phase 2 ships the wait optimizations only; parallelizing now would entangle browser-reliability fixes (DEF-001) with a scheduling change and raise rate-limit/CAPTCHA exposure across sources.
- D-009 (2026-09-09): User-facing "sign-in required" hint uses a client-side heuristic (active provider requires `requiresCredentials` && not `credentialStatus.configured`) rather than a backend run-phase state. The running-status hint text is provider-branded and degrades to the generic provider-name fallback; verification/auth failures surface through existing health/run records (D-006/D-DEF messages). Backend per-phase login state is out of scope for the UX sprint.

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
| 2026-09-09           | `npm run verify` full AFTER abort-interrupt unit (signal-aware run deadline)                                     | 105 files / 1065 tests, green                                              |
| 2026-09-09           | `npm run verify` full AFTER provider error classification unit (`68abd20`)                                       | 105 files / 1068 tests, green                                              |
| 2026-09-09           | `npm run verify` full AFTER perf unit 1: `waitForContent` + Dice fixed-sleep→content-wait (`481bd38`)            | 106 files / 1073 tests, green                                              |
| 2026-09-09           | `npm run verify` full AFTER perf unit 2: LinkedIn + USAJobs content-waits (`53624a5`)                            | 106 files / 1073 tests, green                                              |
| 2026-09-09           | `npm run verify` full AFTER perf unit 3: scroll-loop card-count waits incl. shared runner (`ab025cd`)            | 106 files / 1077 tests, green                                              |
| 2026-09-09           | `npm run verify` full AFTER first-run onboarding panel + dashboard/sources zero-state (`f09acdf`)                | 106 files / 1079 tests, green                                              |
| 2026-09-09           | `npm run verify` full AFTER 1-click quick-add chips (`1afc84b`)                                                  | 106 files / 1080 tests, green                                              |
| 2026-09-09           | `npm run verify` full AFTER sign-in/verification UX unit (`2d717df`)                                             | 106 files / 1082 tests, green                                              |
| 2026-09-09           | `npm run verify` full AFTER empty-state/error-guidance unit (`3d90e98`)                                          | 106 files / 1085 tests, green                                              |
| 2026-09-09           | `npm run privacy:check` AFTER transmission policy + script unit (`c47d64c`)                                      | 3 files / 11 tests, green                                                  |
| 2026-09-09           | `npm run verify` full AFTER browser regression suite (`5f2c3fc`)                                                 | 107 files / 1093 tests, green                                              |
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
- `src/discovery/discoveryCoordinator.ts` — `translateError` verification bucket (pre-auth) + `requiresUserAction()` used in healthCheck + run-error catch; reuses `credentials-required`
- `tests/discovery-coordinator.test.ts` — verification-wall integration + translateError classification tests
- `src/providers/linkedIn/browserSession.ts` — new `waitForContent` + `waitForCardCount` bounded helpers
- `tests/browser-content-wait.test.ts` (new) — content-wait + card-count-wait helper tests
- `src/providers/dice.provider.ts`, `src/providers/linkedIn.provider.ts`, `src/providers/usajobs.provider.ts`, `src/providers/browserJobBoard.ts` — fixed sleeps → content/card-count waits
- `tests/dice-completion.test.ts`, `tests/usajobs-provider.test.ts`, `tests/query-budget.test.ts` — added `waitForContent`/`waitForCardCount` to browserSession mocks

## Commits Created (sprint, local only — NONE pushed)

- `811a26b` — fix: bound browser session close and discovery run deadline (Units A+C, phase-11 tests, tracker). Verify green 105/1064. 2026-09-09.
- `d28e4fe` — docs: tracker checkpoint after `811a26b`.
- (this update) — docs: tracker close-out of installed reinstall tail (silent install + asar match + installed smoke). NOT pushed.
- `bad8614` — fix: abort interruptive browser teardown (signal-aware run deadline resolves `interrupted` promptly even when provider ignores the signal) + scrub personal path from tracker. Verify green 105/1065. NOT pushed.
- `68abd20` — fix: classify browser verification walls as credentials-required (translateError verification bucket + integration/unit tests). Verify green 105/1068. NOT pushed.
- `481bd38` — perf: `waitForContent` helper + convert Dice fixed sleeps (post-nav, pre-extract) to bounded content waits. Verify green 106/1073. NOT pushed.
- `53624a5` — perf: LinkedIn + USAJobs fixed sleeps → bounded content waits. Verify green 106/1073. NOT pushed.
- `ab025cd` — perf: scroll-loop fixed sleeps → `waitForCardCount` lazy-load waits (dice/linkedin/shared runner). Verify green 106/1077. NOT pushed.
- `f09acdf` — feat: first-run onboarding panel (dashboard when zero jobs, adapts to source count) + first-source zero-state on Sources page. Verify green 106/1079. NOT pushed.
- `1afc84b` — feat: 1-click quick-add chips for browser boards (dice/linkedin/usajobs/handshake) prefilling the source editor. Verify green 106/1080. NOT pushed.
- `2d717df` — feat: surface sign-in/verification progress — running-status hint for credential-backed sources + amber callout with "complete sign-in then run again" on verification/auth errors in run history. Verify green 106/1082. NOT pushed.
- `3d90e98` — feat: contextual empty states + per-provider error guidance — SourcesPage shows a "what to do next" hint under failed health messages (verification/auth/timeout/404/unavailable/no-positions); JobsPage empty state differentiates "no jobs match these filters" (with Show-all link) from "no jobs yet" (with Sources guidance). Verify green 106/1085. NOT pushed.
- `c47d64c` — docs(feat): no-telemetry transmission policy in privacy.md + `npm run privacy:check` script (dist/tracked/asar personal-data scans + fresh-install isolation + existing-data preservation). privacy:check green 11/11. NOT pushed.
- `5f2c3fc` — test: browser cleanup guarantee + navigation retry regression suite. Engine never leaks a session (success→0 closes; deadline/abort→exactly 1; non-browser provider error→cleanup owner is the provider), provider self-close-on-error asserted for Handshake, navigateWithRetry retry/exhaustion. Verify green 107/1093. NOT pushed.

## Phase 1 bake-in status

- Interruptive cancellation: LANDED (`bad8614`). A stop/abort now force-tears-down the owned browser at the engine boundary, so a provider wedged in a browser wait that ignores the signal is interrupted promptly (recorded as `interrupted`, not failure), no longer waiting out default timeouts or the 30-min deadline.
- Provider error classification → health: LANDED (`68abd20`). Verification/auth-wall failures classify to `Verification required: Complete the security check or log in` and mark the source `credentials-required` (see D-006); timeout vs exhausted distinction already present (`Timeout: The server did not respond in time` vs `No open positions found`). Phase 1 is CLOSED.

## Phase 2 bake-in status

- Fixed-sleep replacement: LANDED for dice/linkedin/usajobs/shared runner (`481bd38`, `53624a5`, `ab025cd`) — post-nav and pre-extract waits are now content-driven (selector presence) and scroll loops are card-count-driven, both bounded at the previous sleep budget. Anti-bot pacing after detail pages deliberately kept (D-007).
- goTo/load-event audit: CLEAN (2026-09-09) — all `page.goto` sites use `waitUntil: 'domcontentloaded'` with 30–45s caps (dice login/detail, linkedin login/detail, usajobs detail, plus `navigateWithRetry` in browserSession); zero `load`/`networkidle` uses anywhere (memory-saver). No code change needed.
- Parallelization: DEFFERED to phase 15 by decision D-008 — cross-source parallel discovery is gated on the concurrency-cap design + coordinator sequencing review, and is intentionally NOT in phase 2 to avoid conflating browser-reliability fixes with a scheduling change.

## Known Remaining Work

- [x] Reinstall current installer (`12F9AAFE…`): silent install exit 0; installed asar == packaged asar (`8F951906…`); `desktop:smoke:installed` passed. App was confirmed closed (no Job Browser/electron process, no 6783 listener) before install. CLOSED 2026-09-09.
- [x] Phase 1 bake-in: interruptible-cancellation semantics + provider-side error classification → health status. CLOSED 2026-09-09 (D-006; verify 105/1068 at `68abd20`).
- [~] Phase 2 perf: fixed-sleep → content/card-count waits + goto/load audit LANDED; parallelization deferred to phase 15 (D-008).
- [~] Phase 3 first-run UX: onboarding panel + first-source zero state + 1-click quick-add chips LANDED (`f09acdf`, `1afc84b`); branding polish re-check at release.
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
