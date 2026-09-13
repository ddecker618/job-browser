# Changelog

## [Unreleased] - 2026-09-12

### Job Intelligence — EXPLANATION defaults

- The `roleFamilySuggestion` and `searchProfileFeedback` capability flags now
  default on, completing the EXPLANATION (1) trust surface: every job's
  intelligence payload includes the reconciled role-family suggestion
  (`/api/jobs/:id/intelligence` → `roleFamily`) and the bounded search-profile
  projection (`GET /api/search-profile/intelligence`) is served without an
  explicit opt-in. Both are read-time-only, carry structured evidence, mark
  deterministic values authoritative on conflict, and never change score,
  eligibility, ranking, filtering, or lifecycle (`authority.gate: 'never'`,
  `productionEffect: 'none'`). The `searchTieBreak` capability stays off by
  default because it is enrichment-level — it alters search ordering and
  remains behind its production-vs-shadow diff gate.
- No schema or flag-version change: `DEFAULT_NLP_CAPABILITY_FLAGS` values
  changed only, and stored/parsed capability rows (explicit opt-outs) continue
  to override defaults at decision time.
- Added regression coverage: default-on role-family + search-profile
  projection assertions in `tests/job-nlp-connected-api.test.ts` and updated
  default-flag assertions in `tests/job-nlp-capability-flags.test.ts`.

### Source Health Audit (P34)

- Corrected the failed-run health taxonomy in `discoveryCoordinator.translateError`:
  an exceeded discovery engine deadline ("Discovery run exceeded the ... ms
  deadline ...") is now classified distinctly as "Discovery run timed out before
  collecting results" instead of being misreported as
  "Timeout: The server did not respond in time". Genuine server timeouts keep
  their original message. Browser login walls now classify as
  "Login required: Sign in on the provider site and retry" (a new
  `requiresUserAction` class), separate from verification walls
  ("Verification required: Complete the security check or log in"); boards that
  render no job listings classify as
  "Provider unavailable: The provider did not return any search results".
- Hardened the Dice browser provider (`src/providers/dice.provider.ts`):
  fixed the false-positive signed-in detection (any page with a nav/header/main
  was treated as logged in, so the manual-login wait was a no-op); the provider
  now navigates to the first query before deciding whether a login wall exists.
  Added a zero-card fast-fail that aborts a run with a categorized message after
  two consecutive queries render no job cards (instead of grinding for the full
  30-minute engine deadline), a 20-minute internal fetch budget, and fixed
  double-counting of raw results in query diagnostics. The Dice source remains
  enabled by policy (protected provider).
- Added a controlled-source-repair CLI `npm run sources:repair`
  (`src/discovery/cli/repair-sources.ts`) with the same verified-backup
  guarantee as `sources:remediate`. Live-verified repairs, proven against a
  disposable copy of the production database:
  - Intel (Workday): stale posting-site slug `Intel_External` corrected to
    `External` (CXS probe: `External` 200 / 592 jobs; `Intel_External` 404
    `S21`);
  - Etsy: BambooHR -> Workday migration repoint (`etsy` / `etsy_careers`, 46
    live jobs) and re-enabled;
  - Encyclis: re-enabled the reachable iCIMS hosted-v1 portal
    (careers-encyclis.icims.com reachable; earlier "unreachable or inactive"
    classification was a transient misclassification).
    Repairs record append-only `ats-changed` evidence in
    `career_site_verification_history`, update/retire the affected `career_sites`
    rows, and never delete records.
- Added regression coverage: `tests/repair-sources.test.ts` (plan/apply/
  idempotence/append-only evidence) and extended `tests/dice-completion.test.ts`
  (zero-card abort, partial recovery, raw-result accounting) and
  `tests/discovery-coordinator.test.ts` (deadline vs timeout vs login vs render
  taxonomy).

## [1.1.2] - 2026-09-11

### Desktop Startup

- Shipped the FTS provisioning startup fix: `JobSearchRepository` now
  short-circuits with a cheap `ftsSynchronized()` guard when the FTS5 index is
  already in sync, removing the full index reconcile that ran on every open of
  a large database. Measured on a disposable copy of the real database,
  `createApp` startup dropped from 43,863 ms to 45 ms. Stale-index repair and
  recovery behavior are unchanged.

### Job Intelligence

- Job Intelligence explanations now work at the documented EXPLANATION (1)
  trust level by default. The `jobIntelligenceExplanation` capability flag
  defaults on (all other NLP flags stay off); the read-only cached-analysis
  GET route (`GET /api/jobs/:id/intelligence`) serves current analysis on
  reopen; and the preview has coherent states — Analyze, analyzing, current +
  Re-analyze, actionable failure alert, and a genuinely-disabled notice with
  no actionable button. Deterministic scoring, eligibility, lifecycle rules,
  and ranking authority are unchanged; Job Intelligence remains display-only.
- Rebuilt and validated the versioned installer:
  `release\Job-Browser-Setup-1.1.2.exe`, 253,597,831 bytes, SHA-256
  `A77B1F745BB2474E61CED4148450BF2A7DC654A60853ED94CF265D155AFE28F2`.
  Packaged and installed `app.asar` match SHA-256
  `5BC4F99DF1AA000186E7D684B955B6B29DEE8F6701385E12B720FFEA862D2E8E`.
  Installed executable reports ProductVersion `1.1.2.0` and FileVersion
  `1.1.2`.
- Validated against the installed artifact: packaged smoke, installed smoke,
  and seeded packaged-upgrade smoke passed; installed Job Intelligence proved
  functional end-to-end (default-enabled analysis, cached GET on reopen,
  re-analyze, and explicit-disable gating); production data untouched and
  intact. Final gates at release state green: `npm run verify` 158 files /
  1460 tests, `npm run privacy:check` 11/11, `npm run nlp:security-audit`
  3/3.

## [1.1.1] - 2026-09-11

### Desktop Startup

- Deferred non-critical startup maintenance until after the local service is
  reachable, so the app can open before known-closure reconciliation, matched
  role-family refresh, stale intelligence reconciliation, discovery alert
  evaluation, scheduler startup, and the NLP background worker begin competing
  for the database.
- Added timed startup and maintenance log entries for database checking,
  migration/update work, local-service startup, and each deferred maintenance
  phase. Deterministic scoring, eligibility, lifecycle rules, NLP extraction
  output, and trust boundaries remain unchanged.
- Rebuilt and validated the versioned installer:
  `release\Job-Browser-Setup-1.1.1.exe`, 253,596,928 bytes, SHA-256
  `1101A3795CCB930C9966DC02198B60EFCF757221496B61728C2B9C9E8886C815`.
  Packaged and installed `app.asar` match SHA-256
  `CEE52B0E0F625F25B26970ECCFF8637C27CFA2E0C243484FF3E76930613BB35F`.
  Installed executable reports ProductVersion `1.1.1.0` and FileVersion
  `1.1.1`.

## Unreleased — NLP explanation and enrichment promotion (P8-P29)

- Added target-role selection, exact family membership, and supporting current NLP index evidence. Stale derived data falls back to title evidence.
- Preserved scores, eligibility, lifecycle, and primary sorting. Fixed undefined-role rendering in the unfinished P8 implementation.
- Added normalized skill matching, immutable-resume diagnostic coverage, reconciled role suggestions, exact-tie search explanations, profile vocabulary feedback, persisted deterministic-vs-NLP comparisons, and read-only Settings status.
- Added four independent local consumer flags, all off by default, plus visible deterministic fallback on disabled/failed processing. Production scores, eligibility, lifecycle, family membership, and primary sort remain unchanged.
- Expanded the labeled corpus to 66 cases and added negated-requirement tuning. P23 validated 500 real jobs in a disposable copy with zero failures and an identical jobs-table fingerprint.
- P24-P29 validation: verify 157/1,445; privacy 11/11; NLP security 3/3; direct, rebuilt unpacked-package, packaged, installed, packaged-upgrade, and real-copy desktop smoke passed.
- Rebuilt the approved 1.1.0 installer from current source. This was superseded by the P30 rebuilt installer listed below. Nothing pushed.

## Unreleased — NLP compensation extraction (P30)

- Added local deterministic compensation extraction to the NLP document pipeline. It captures USD pay ranges, hourly/annual/monthly/one-time cadence, compact thousands, and bonus/commission/equity/sign-on/OTE signals with exact evidence spans.
- Compensation facts are informational, shadow-only, and carry additive metadata. They do not affect scores, eligibility, filters, lifecycle, hard gates, or primary sorting.
- Focused validation passed: compensation, document, and evaluation NLP tests (3 files / 18 tests). The final installer was rebuilt and validated. Installer: `release\Job-Browser-Setup-1.1.0.exe`, 253,596,385 bytes, SHA-256 `7E57A444A100F34BF5D481846CAA6A7BEE7FB13A162099E81FB790F97C9CA251`. Packaged and installed app.asar match SHA-256 `04315DEB302F784D8EED0901D729F0B2564BB07D1925EB4E7A1A1913EBF09563`.

All notable changes to this project will be documented in this file.

## [Unreleased]

### Desktop Startup

- Moved desktop database shadow-copy integrity verification to a worker thread
  so large existing databases do not block the Electron main process during
  startup. Recovery, migration, and quarantine behavior remain unchanged.

### NLP Intelligence Shadow Program

- Added deterministic, versioned NLP extraction, reconciliation, additive
  persistence, reprocessing, evaluation, acceptance, performance, security,
  privacy, and regression validation through Stages 0-29.
- Added a drawer-local Job Intelligence preview that shows traceable job text
  and explicit `Unknown` resume coverage without changing production scoring or
  eligibility.
- Validated shadow mode with `npm run verify` (136 files / 1346 tests),
  `npm run privacy:check` (11 tests), and Windows packaged/installed/upgrade
  smoke. Production promotion remains not yet validated or authorized.
- Final evidence: `docs/NLP_FINAL_HANDOFF.md`.

## [1.1.0] - 2026-09-09

### External Beta Hardening

Browser-backed discovery reliability, UX, privacy, and release validation
landed in the beta sprint leading up to the 1.1.0 external beta.

- **Browser reliability (DEF-001).** Root-caused and fixed the Dice
  detail-page stall failure class: bounded `closeBrowserSession()` with a
  forced process kill as a last resort, plus a per-run deadline watchdog in
  `DiscoveryEngine` that force-closes the session on breach. Abort/stop now
  interrupts in-flight browser waits promptly (`interrupted`, not a failure).
  Provider verification/auth-wall failures classify to
  `credentials-required` with a `Verification required: Complete the security
check or log in` health message instead of a generic failure.
- **Discovery performance.** Replaced per-provider fixed sleeps with bounded
  content/card-count waits (`waitForContent`, `waitForCardCount`) for
  Dice/LinkedIn/USAJobs and the shared browser runner. Anti-bot pacing after
  detail pages deliberately kept. All `page.goto` sites audited: consistently
  `domcontentloaded` with 30–45s caps.
- **First-run UX.** Dashboard onboarding panel (zero jobs) that adapts to
  source count, first-source zero state on the Sources page, and 1-click
  quick-add chips for browser boards (Dice/LinkedIn/USAJobs/Handshake).
- **Log-in UX.** Running-status sign-in hint for credential-backed sources and
  an amber "complete sign-in in the browser window, then run again" callout
  when verification/authentication failures appear in run history.
- **Empty/error-state UX.** Per-provider "what to do next" guidance under
  failed source health messages (verification/auth/timeout/404/unavailable/
  no positions); the Jobs page differentiates "no jobs match these filters"
  (with a Show-all link) from "no jobs yet" (with guidance to add sources).
- **Privacy.** Documented offline-first, no-telemetry transmission policy
  (`docs/privacy.md`); added `npm run privacy:check` — distribution scans of
  tracked files, compiled `dist/`, and the packaged `app.asar` for personal
  data and personal file types, plus fresh-install isolation and
  existing-data preservation tests. Local-only adoption markers
  (`adoption.installedAt` / `adoption.firstSourceAt`) recorded in SQLite,
  exposed read-only on the Settings page; never transmitted.
- **Testing & release validation.** Browser regression suite (session cleanup
  guarantees, navigation retry); known-quirks index (`docs/KNOWN_QUIRKS.md`);
  beta plan (`docs/BETA_PLAN.md`). Full gate green at 108 files / 1101 tests
  and `privacy:check` 11/11. Packaged smoke, installed smoke, and
  upgrade-preservation smoke pass on the built 1.1.0 artifact. Installer:
  `release\Job-Browser-Setup-1.1.0.exe`, 253,533,832 B,
  SHA-256 `E68D623699A46DE8C3C8534DB38FF54CE4887428A865AC0838F8F8512D8FBAD9`.

## [1.0.28] - 2026-09-08

### Dependency Security Hardening

Applied after the 1.0.28 initial cut; the rebuilt installer below incorporates
these changes.

- **Runtime dependencies (ship inside the installer):**
  - `multer` 2.2.0 → 2.3.0 (four advisories, three high: arbitrary file write /
    DoS via crafted multipart uploads).
  - `qs` 6.15.3 → 6.16.0 (two moderate DoS advisories, via `express` /
    `body-parser`).
  - `@xmldom/xmldom` 0.8.13 → 0.8.15 (nine advisories across 0.7/0.8 lines;
    mammoth's docx parsing requires the 0.8 API, so the patched LTS release is
    used instead of the 0.9 major). Overridden for `mammoth` and `plist`.
- **Build/runtime shell:**
  - `electron` 42.0.0 → 42.11.3 (Chromium sandbox/url-handling fixes and the
    `extract-zip` advisory chain; `extract-zip` is no longer in the dependency
    tree).
- **Development toolchain:**
  - `sharp` 0.35.3 → 0.35.4 (icon build), `js-yaml` 4.3.0 → 4.3.2
    (electron-builder/eslint), `vitest` 4.1.10 → 4.1.11 + `@vitest/mocker`,
    `browserslist` → 4.28.9, `baseline-browser-mapping` → 2.11.21,
    `fast-uri` → 3.1.7, `postcss` → 8.5.28, `nanoid` → 3.3.18,
    `undici` → 7.29.1, and `brace-expansion` 2.x forced to 2.1.4 via override.
- **Known residual (dev-only, not in the GitHub advisory list).**
  `brace-expansion` 1.x (used only by `minimatch@3` inside `glob@7`/eslint
  tooling) has no patched 1.x release; leaving it untouched avoids breaking
  asar packing. No runtime or shipped code is affected.
- **Line-ending hygiene.** Added `.gitattributes` (`* text=auto eol=lf`) so
  checkouts on Windows no longer flip files to CRLF, which previously caused
  spurious prettier format failures.
- **Verification.** Full gate green: format, lint, strict typecheck, Vitest
  104 files / 1057 tests on the upgraded dependency set. Installer rebuilt and
  re-smoke-tested; distribution privacy scan re-run against the new `app.asar`.

## [1.0.28] - 2026-09-08

### Manifest and Packaging Hardening

Applied after the security-hardened rebuild; the installer below incorporates
these changes.

- **App identity.** `appId` moved to a neutral `com.jobbrowser.app` so the
  distributed application no longer embeds the publisher's personal identity
  string. Resolved from a different, unrelated desktop shortcut folder; the
  production data directory is unaffected.
- **Smaller packaged payload.** Compiled tests, ad-hoc packaging/development
  scripts, and `dist` sourcemaps are excluded from the installer. The packed
  `app.asar` dropped from ~77.2 MB to ~73.7 MB (tests/scripts absent, only
  third-party `node_modules` maps remain).
- **Test-port robustness.** The backend lifecycle test no longer hardcodes a
  conventional port; it claims an OS-assigned ephemeral port, so unrelated
  local processes (e.g., a leftover dev server) can no longer cause a spurious
  `EADDRINUSE` failure.
- **Verification.** Full gate green (104 files / 1057 tests); distribution
  privacy scan clean; packaged smokes pass for fresh and upgrade scenarios.

## [1.0.28] - 2026-09-08

### Clean-Install Privacy and Data-Preservation Guarantees

- **Developer path leak removed from shipped code.** The discovery
  remediation CLI (`src/discovery/cli/cleanup-remediation.ts`) hardcoded the
  development machine's absolute paths (the local user's per-user application
  data directory holding the database, and its backups directory). Because
  tests compile into `dist/` and ship inside every installer's `app.asar`, this
  personal path data was embedded in the packaged application. It now uses the
  platform default database path resolution and derives the backups directory
  from it, so no machine-specific paths exist in the codebase or the
  distribution.
- **Fresh installs contain zero developer personal data.** Verified by new
  regression tests (`tests/privacy-fresh-install-isolation.test.ts`) using
  isolated temporary user-data directories: a brand-new install starts with
  empty `jobs`, `applications`, `application_history`, `resumes`,
  `job_observations`, and `career_site_discovery_attempts` tables; seeded
  sources and the employer registry contain no demo records; employer
  discovery is disabled by default; the default candidate profile is a generic
  template; and no personal-data markers appear anywhere in the created
  user-data tree.
- **Existing-user data is preserved on upgrade and reinstall.** Verified by
  new regression tests (`tests/privacy-existing-data-preservation.test.ts`):
  the database is never replaced (integrity check then open), pending
  migrations run against the existing database, an optional pre-migration
  backup is written only when configured, and user files (candidate profile,
  resumes, database) survive an upgrade boot. A guard
  (`assertDatabaseOutsideInstallDirectory`) rejects database locations inside
  the installation directory.
- **Distribution privacy gate.** `tests/privacy-distribution.test.ts` scans
  tracked repository files, compiled output, and the packaged `app.asar` for
  personal-data markers (machine home directories, per-user application data
  folders, developer names, personal email domains) and forbidden personal file
  types, failing the build if any are found. Third-party dependency source
  files (`node_modules`) are excluded from the marker scan because they contain
  maintainer addresses, not user data.
- **Documentation and hygiene.** Session handoff notes are no longer tracked
  (`docs/SESSION_HANDOFF.md` removed from git; the file remains gitignored for
  local use). Developer-only working artifacts (temp migration scripts,
  employer candidate/seed lists, packaged download archives) are gitignored.
- **Breaking/should-be-none.** No changes to the database schema or migration
  head (`030`). Backward-compatible.
- **Verification.** Full gate green: format, lint, strict typecheck, Vitest
  (all suites). Six desktop smoke scenarios (dev/packaged/installed x
  fresh/upgrade) pass with isolated temporary user-data directories.

## [1.0.27] - 2026-08-26

### Employer Discovery Eligibility Cadence Fix

- **Cadence anchor bug fix.** The intelligence service used `lastSuccessAt`
  from source runs (job-fetching operations) as the cadence anchor for
  employer discovery eligibility. Since the source scheduler runs sources
  every ~30 seconds, this always pushed `cadenceEligibleAt` 24–72 hours into
  the future for ALL executable sites, making `eligibleSiteIds()` always
  return an empty array. Fixed by querying `career_site_discovery_attempts`
  for `MAX(attempted_at)` per site and using that as the cadence anchor.
  Source run data is still used for activity metrics and priority.
- **Regression tests.** Two new tests in
  `tests/employer-discovery-intelligence.test.ts`: one verifying cadence uses
  discovery attempt time (not source run time), one verifying recent source
  runs don't block employer discovery eligibility.
- **Verification.** Full gate green: format, lint, strict typecheck, Vitest
  101 files / 1046 tests.

## [1.0.26] - 2026-08-26

### Discovery Operational Audit and Runtime Fixes

- **Greenhouse large-board response-size fix.** Datadog's Greenhouse board
  (`datadog`, 5.66 MB content response) deterministically exceeded the shared
  HTTP client's `maxResponseBytes` default of 5 MB, causing every fetch to fail
  with "response exceeded size limit". `ProviderHttpClient` now accepts an
  optional per-request `maxResponseBytes` override, and `GreenhouseProvider`
  applies an 8 MB ceiling for full-board requests (`GREENHOUSE_MAX_RESPONSE_BYTES`).
  The global default remains 5 MB; all other providers are unaffected.
- **Discovery desktop log propagation.** Discovery runs now write structured
  log entries to the desktop log file (`%APPDATA%/Job Browser/logs/`) instead of
  only stdout, so operator-visible evidence survives application restart.
  `DiscoveryCoordinator` accepts an optional `writeLog` option; `backend.ts`
  passes the running `logger`; `DiscoveryEngine` falls back to `log` when no
  writer is provided.
- **Scheduler graceful shutdown.** `DiscoveryScheduler.stop()` now waits for
  any in-flight health-check evaluation to complete before resolving, preventing
  orphaned async work from continuing after application shutdown. Concurrent
  evaluation is guarded by a promise-tracking flag so only one evaluation runs
  at a time.
- **Regression tests.** `tests/provider-http-client.test.ts` covers per-request
  `maxResponseBytes` override; `tests/greenhouse-provider.test.ts` asserts the
  raised Greenhouse limit; `tests/discovery-scheduler.test.ts` proves stop waits
  for in-flight health checks.
- **Verification.** Full gate green: format, lint, strict typecheck, Vitest 101
  files / 1044 tests. Application build passed. Packaged and installed
  smoke tests passed. Installer: `release\Job-Browser-Setup-1.0.26.exe`,
  249,956,140 bytes, SHA-256
  `68C995A473191C7B662263D985DE54061A6C8EFE79A4A8EA7BF2C3AE21192298`.

## [1.0.25] - 2026-08-21

### Validated Employer Source Additions and Documentation Hardening

- **Three validated employer sources added to discovery.** Datadog (Greenhouse board `datadog`, 448 live postings confirmed via public API), MongoDB (Greenhouse board `mongodb`, 411 live postings), and Intel (Workday CXS `intel.wd1.myworkdayjobs.com/Intel_External`) were imported through the idempotent employer-seed-manifest pipeline (`data/employer-seeds/validated-sources-2026-08-21.json`, provenance `controlled-source-addition-2026-08-21`). Dry-run and live runs produced identical counts (employers reused 4, career sites created 4, sources created 3, invalid 0, ambiguous 0). Production totals: 37 sources, 31 enabled.
- **AMD stopped with a documented blocker.** Its careers portal is a custom-domain iCIMS instance (`careers.amd.com`; `/api/jobs` confirmed working manually), but URL fingerprinting only recognizes iCIMS on `*.icims.com` hosts, so the supported import architecture cannot derive a Source configuration. A career-site evidence row was recorded; adding AMD requires manual creation through the Sources UI or a future approved explicit-config manifest extension.
- **Legacy demo-source review retained all seven candidates.** The five lowercase SmartRecruiters entries target real company boards (SanDisk, Anexinet, Wix, Netcompany, Bosch Group) with nonzero recent yield, the "Recruitee" entry targets bunq's live Recruitee board, and `mux` is a real employer on Ashby — none are provably obsolete demo/duplicate/legacy rows, so none were disabled and no data was touched. A separately approved rename pass is recommended so placeholder display names stop reading as demo rows.
- **Safety process.** Changes were applied only after a verified SQLite backup (`pre-source-addition-2026-08-21T18-54-50-758Z.sqlite`, integrity ok); preserved counts were identical before/after (jobs 2597, applications 2, observations 14458, status history 2620); all seven protected browser-session sources remain enabled; nothing was pushed or published.
- **Documentation hardening.** SESSION_HANDOFF now records that profile-preferences UI stages beyond Stage 0B remain deferred pending approval, and that USAJOBS login.gov occasionally rejects known devices (site-side authentication behavior, not automatically a connector defect).
- Ships commits `986681c` (controlled source remediation) and `bfe22d0` (discovery source-health alert classification) alongside this release work.

## [Unreleased] - 2026-08-21 (Milestone: Source Health Reconciliation and Alert Classification)

- **Alert classification (`discovery-alert-rules-v2`).** Every discovery alert now carries a machine-readable `classification` in its evidence and ends with "Classification: … Action: …" text. Twelve classes distinguish unsupported platform, pending credentials, browser-session, anti-bot, transient network/DNS, invalid URL, chronic provider failure, legitimate zero openings, zero-yield regression, scheduler downtime, overdue runs, and genuinely broken. Browser-session (LinkedIn, Dice, Indeed, Wellfound, ZipRecruiter, Handshake, USAJOBS), pending-credential, anti-bot, and transient failures cap at WARNING and can never present as broken; unsupported-platform and invalid-url career sites downgrade from CRITICAL to WARNING with repair guidance.
- **Scheduler-downtime awareness.** When no run of any source occurred within three cadence windows, per-source overdue/stale alerts are suppressed in favor of a single aggregate INFO `scheduler-inactive` notice stating when the scheduler went inactive and how many scheduled sources are pending. Time while the desktop application is closed no longer implies provider failure. Genuine overdue/stale behavior while the application is active is unchanged.
- **Zero-yield hardening.** Zero-yield regression alerts now skip browser-session providers entirely (their zero yield usually reflects authentication-gated content), while retaining the existing requirements of at least three complete, non-truncated discovery cycles plus historical yield. Healthy sources with legitimate zero openings never alert.
- **Duplicate-recreation guard.** `atsTenantIdentity` now maps the registered `cisco` and `crowdstrike` convenience identifiers onto their fixed Workday tenants (`workday:cisco:Cisco_Careers`, `workday:crowdstrike:crowdstrikecareers`), so employer-seed manifest import and employer-discovery Source resolution treat them as the same ATS tenant as an equivalent Workday configuration and cannot recreate the duplicate Sources removed by the controlled remediation.
- **No migration.** Classification state lives in each alert's existing `evidence_json` under the bumped rule version; alert history, audit columns, APIs, and UI consumers are unchanged apart from richer message strings.
- **New coverage.** `tests/alert-classification.test.ts` (16 tests) covers every classification path including browser-session severity caps, USAJOBS never-broken semantics, anti-bot vs broken distinction, DNS-transient distinctness, healthy zero-opening silence, browser-session zero-yield skip, scheduler-downtime suppression with aggregate notice, genuine-overdue preservation, and career-site severity downgrades; `tests/url-identity.test.ts` asserts deterministic cisco/crowdstrike tenant mapping; `tests/discovery-alerts.test.ts` updated for classified message format.
- **Verification.** Full gate green: format, lint, strict typecheck, Vitest 101 files / 1041 tests; desktop smoke passed. Production-safe dry run against a SQLite-backup snapshot copy reduced 32 unresolved production alerts to 5 correctly classified entries (0 CRITICAL): one scheduler-inactive INFO replacing 28 stale/overdue warnings, GitHub/Datadog invalid-url, MongoDB unsupported-platform, Intel anti-bot. Bounded public probes confirmed supported configurations for Datadog (Greenhouse token `datadog`, 448 jobs), MongoDB (Greenhouse token `mongodb`, 411 jobs), Intel (Workday CXS `intel.wd1.myworkdayjobs.com/Intel_External`), and AMD (iCIMS `careers.amd.com/api/jobs`) as input to a separately approved live-action step; nothing was written to production.

## [Unreleased] - 2026-08-21

### Controlled Discovery Source Remediation (version remains 1.0.24; no migration)

- **Bounded remediation CLI.** New `src/discovery/cli/remediate-sources.ts` (npm script `sources:remediate`) plans and applies disable-only source cleanup from local evidence. Dry-run is the default; `--live` requires an explicit flag, creates an integrity-checked and count-verified SQLite backup first (`<data-root>/backups/pre-source-remediation-<timestamp>.sqlite`), then applies actions in one transaction. It never deletes records and never touches protected providers: Wellfound, ZipRecruiter, USAJOBS, LinkedIn, Dice, Indeed, and Handshake are hard-guarded in both planning and apply paths; applying against a protected source throws.
- **Rules.** `chronic-categorical-failure`: enabled failed source with at least three consecutive failed runs whose latest failure classifies the target as categorically "unreachable or inactive" (transient DNS failures deliberately do not match). `duplicate-ats-tenant`: among enabled workday-family and iCIMS sources sharing one ATS tenant identity (`atsTenantIdentity`, the hardcoded cisco/crowdstrike Workday tenants, or the normalized iCIMS portal URL), only the canonical source stays enabled — career-site-linked sources win, then most linked jobs, then lexicographic id. `retired-career-site`: enabled sources whose linked career site is retired are disabled.
- **User-mandated decisions recorded.** Wellfound and ZipRecruiter remain enabled because browser-session failures require manual login/intervention; USAJOBS remains enabled pending credential configuration — zero discovered jobs is not evidence of an unsupported source. None of the three can be auto-disabled by the CLI.
- **Live run 2026-08-21 (installed database).** Exactly six disables applied, zero deletions: encyclis `9eab76b2…` (legacy server-rendered iCIMS portal, 3 consecutive failures) and Etsy `b83378ba…` (bamboohr connector cannot reach `etsy.bamboohr.com`; Etsy's actual ATS is Clinch Talent, unsupported), duplicate cisco `8634ed3c…` (retained: `36ba46c2…` Cisco), duplicate crowdstrike `002178d1…` (retained: `78d039c1…` via the workday connector per the unified fingerprint boundary), duplicate icims `ea5eb992…` pointing at the same `careers.costco.com` portal as Costco (retained: `821fc5ff…`), and Hooli `576e2667…` (linked career site retired). Each row's reason was written to its `health_message`.
- **Preservation verified.** Before/after counts identical: jobs 2597 (1841 active / 756 inactive), applications 2, application_history 2, job_observations 14458, job_status_history 2620, career_sites 36. Only the six approved source rows changed. The inactive `applied` job retains its Application record and workflow status. Backups: `pre-source-remediation-2026-08-21T17-01-40-513Z.sqlite` (standalone, 209,866,752 bytes) and `pre-source-remediation-2026-08-21T17-01-55-782Z.sqlite` (CLI-created immediately before apply); both integrity-checked with matching table counts.
- **Alerts re-evaluated through `DiscoveryAlertService.evaluateRules()`.** Both `source-failure-streak` CRITICAL alerts (Etsy, encyclis) resolved. Remaining unresolved: GitHub/Datadog/MongoDB `career-site-broken` CRITICAL (no supported ATS configuration exists at those URLs), Intel HTTP 403 warning, plus time-based `discovery-stale`/`source-overdue` warnings caused solely by the application not running since 2026-08-18; these clear on the next discovery cycle.
- **Verification.** `npm run verify` green (format, lint, strict typecheck, Vitest 100 files / 1025 tests including 14 new remediation tests in `tests/remediate-sources.test.ts`); `npm run desktop:smoke` passed.
- **Documentation corrections.** README migration-head claim corrected from `026` to `030_employer_aliases.sql`; provider inventory now accounts for the registered Cisco and CrowdStrike convenience identifiers and their relationship to the Workday connector.

## [1.0.24] - 2026-08-17

### Discovery Error Remediation: Failure Categorization and Zero-Yield False Positive Fix

- **BambooHR failure categorization.** `BambooHrProvider.validateConfiguration` now returns a structured `failureCategory` on validation failure (`'unreachable'` for DNS, `'timeout'` for timeouts, `'blocked'` for HTTP 403). Previously all network failures fell through to the generic "BambooHR subdomain is unreachable or inactive" message with no diagnostic structure.
- **ProviderHttpClient preserves original error detail.** The generic catch in `ProviderHttpClient.request()` now appends the original error message (`"${provider} request failed: ${detail}"`), so downstream string matching in providers and `translateError()` can classify the root cause instead of losing it.
- **DNS resolution failure surfacing.** `translateError()` now has a dedicated branch for "could not be resolved" errors, producing `"Provider unavailable: DNS resolution failed for host"` instead of the generic catch-all. Combined with the BambooHR `failureCategory`, this surfaces the actual DNS failure reason for the Etsy source-failure-streak alert.
- **Zero-yield streak skips healthy sources.** `zero-yield-streak` now ignores sources with `health_status = 'healthy'`. A healthy source returning 0 new jobs means the job pool is exhausted (no new listings), not a malfunction. This eliminates false-positive alerts for LinkedIn, ZipRecruiter, and PaloAltoNetworks — all three are working correctly but have no new jobs to discover.
- Final verification: `npm run verify` passes completely clean (format, lint, strict typecheck, full test suite — 99 files / 1011 tests). Desktop smoke green. Installer: `release/Job-Browser-Setup-1.0.24.exe`.

## [1.0.23] - 2026-08-16

### Discovery Alert Rule Reconciliation and Imported Source Remediation

- **Zero-yield streak rule corrected.** `zero-yield-streak` no longer counts every `succeeded` run regardless of snapshot quality. It now requires completed, non-truncated runs (`complete_snapshot = 1 AND fetch_truncated = 0`), groups runs that start within 60 seconds into a single discovery cycle (multi-query sources produce one run per query per scheduled tick), and fires only after 3 distinct complete cycles all yield 0 jobs on a source with historical yield. On the production dataset this clears 15 of 17 active alerts; only PaloAltoNetworks and ZipRecruiter are genuinely zero-yield.
- **Career-site-broken rule narrowed.** `career-site-broken` no longer fires for informational warnings with no fetch failures (reachable-but-unsupported, redirects, ATS-identity changes). It fires CRITICAL only for `health_status = 'broken'` and WARNING only when `health_status = 'warning' AND health_failure_count > 0`. On the production dataset this clears 18 of 22 active alerts.
- **Discovery-stale career-site rule corrected.** Sites whose discovery ended in a terminal `unsupported` state can never be re-discovered through a Source and are no longer flagged stale. Career sites linked to a Source with a disabled or manual schedule have no automatic cadence to be late against and are no longer flagged stale. All 8 active discovery-stale alerts were false positives and clear.
- **DNS resolution failures are no longer classified as invalid URLs.** `boundedPublicFetch` now rethrows `Public host could not be resolved` when the URL policy reports the host could not be resolved, and `atsDetector` maps that message to the `unreachable` failure category (transient warning) instead of `invalid_url` (broken). Datadog and GitHub were previously misclassified as broken CRITICAL; they now surface as transient warnings and recover when DNS resolves.
- **CrowdStrike fingerprint boundary unified.** The CrowdStrike special-case in `atsFingerprint.ts` was removed so `.myworkdayjobs.com` hosts are uniformly fingerprinted as the `workday` provider with `{origin, tenant, site}` configuration, matching the ATS detector's behavior. `crowdstrike` remains a valid registered provider for manual/managed Sources.
- **Operations Console triage improvements.** The active alerts panel in `EmployersPage.tsx` now sorts CRITICAL before WARNING, groups alerts by rule with per-rule counts, and shows full local date-time strings for first/observed detection.
- New regression coverage: `tests/discovery-alerts.test.ts` (career-site-broken filtering, zero-yield completeness/cycle semantics, discovery-stale exclusions for unsupported and manual-schedule sites, and the enabled-schedule stale case), `tests/bounded-public-fetch.test.ts` (DNS resolution failure reported distinctly from validation failure), and `tests/ats-detector.test.ts` (DNS resolution failures classified as `unreachable`, SSRF/validation still `invalid_url`).
- **Never-fingerprinted career sites no longer masquerade as unsupported.** Career sites with no ATS fingerprint yet (`ats_support_state` NULL) are now reported as a distinct `never-detected` support state instead of `unsupported`. Previously the default employers view hid every freshly seeded site behind the candidate-backlog filter, which surfaced as an empty Employers page and a desktop smoke failure. New regression test in `tests/employer-repository.test.ts` covers the mapping.
- **Desktop smoke test passes again.** `npm run desktop:smoke` renders the seeded Employers page, including the `Check health` action on the first two career sites of each collapsed employer card, and completes all `asserting-*` stages.
- Final verification: `npm run verify` passes completely clean (format, lint, strict typecheck, full test suite — 99 files / 1004 tests).

## [1.0.22] - 2026-08-16

### Health Audit Remediation and Installer Build

- Resolved and cleared remaining ESLint warnings and code style formatting check issues, allowing `npm run verify` check to pass completely clean.
- Rebuilt installer at `release/Job-Browser-Setup-1.0.22.exe`.

## [1.0.21] - 2026-08-16

### Versioned Employer Seed Manifest Import

- New database migration `030_employer_aliases.sql` adds the `employer_aliases` table with a unique constraint on `(employer_id, normalized_alias)` and a global unique index on `normalized_alias`, so an alias never silently targets a second employer.
- New `src/domain/urlIdentity.ts` provides deterministic canonicalization: `normalizeUrlIdentity` (lowercased host, `www.` stripped only when a second-level label remains, fragments/default ports/known tracking params removed, remaining query params preserved and sorted, repeated slashes collapsed, trailing slash trimmed), `normalizeDomainIdentity`, `normalizeEmployerName`, `canonicalConfigJson` (recursive key-sorted for Source configuration equality), and `atsTenantIdentity` (Greenhouse boardToken, Lever site, Ashby boardName, Workday tenant[:site], SmartRecruiters companyIdentifier, BambooHR companyDomain, Recruitee/Teamtailor/Workday company, Workable subdomain, iCIMS company).
- New versioned manifest schema in `src/models/employer-manifest.ts` and `src/schemas/employer-manifest.ts`: JSON (`{version, imports[]}`) and CSV inputs (exact column set, quoted fields, `true/1/yes` and `false/0/no` enabled parsing, case-insensitive columns), validated with zod and row-level `superRefine` requiring at least one of `employerName`, `rootDomain`, or `careersUrl`. Malformed/version-mismatched inputs throw bounded errors; invalid rows are collected, not aborted.
- New `src/discovery/employerSeedImporter.ts` imports manifests idempotently without duplicate Employers, CareerSites, or Sources. Employer identity resolves by exact normalized domain, then alias, then normalized name (two distinct domains/names → `ambiguous`, no writes). CareerSite identity resolves by exact URL, URL identity, ATS family + tenant (re-fingerprinting stored URLs), health effective URL, then retained evidence; cross-employer claims are flagged ambiguous. Sources resolve by `career_sites.source_id`, providerId + URL identity, providerId + canonical configuration JSON, then providerId + ATS tenant; archived and disabled sources are reused as-is and never auto-re-enabled.
- Batched writes: rows are processed in transactions of at most 25 with SQLite savepoints; per-row soft failures do not abort, and any database error rolls the whole batch back (`rejected` rows explain that nothing was persisted) and rebuilds the importer indexes from the database.
- Imported career sites are URL-fingerprinted (no network), and importer evidence (`manifest-provenance`, `manifest-batch`, `manifest-notes`, `manifest-expected-ats`, `manifest-expected-tenant`, `manifest-submitted-url`) is added after verification so verification's evidence wipe cannot delete it. Retired sites are reused as-is and never given new evidence or Sources.
- Dry-run mode performs no writes: reads are hypothetical (`new:<key>` identities) while counters mirror a live import.
- New CLI `npm run employers:import -- <manifest.json|csv> [--dry-run]` (`src/discovery/cli/import-employers.ts`) runs migrations + curated registry seeding, parses the file by extension, and prints the full summary plus a `rowsByStatus` breakdown.
- New `POST /api/employer-discovery/import` accepts `{format: 'json'|'csv', contents, dryRun}` and reuses the existing Employer/Source repositories.
- Bugfixes surfaced by the new test suite: `normalizeUrlIdentity` dropped every query parameter (URLSearchParams is live-bound, so clearing `search` before re-reading values discarded them); CSV column matching was case-sensitive against a lowercased header so camelCase columns never matched; JSON manifests that were arrays were not rejected as non-objects.
- New deterministic coverage: `tests/url-identity.test.ts`, `tests/employer-manifest.test.ts` (JSON + CSV parsing), `tests/employer-seed-importer.test.ts` (14 integration tests including in-batch duplicates, domain/alias/ATS-tenant reuse, unsupported ATS, dry-run, idempotent re-import, disabled-source preservation, retired-site preservation, rollback via an injected SQLite trigger, and curated-starter stability), and `tests/employer-import-api.test.ts`; migration-list expectations updated for `030`.
- Final verification: lint (`npm run lint`), strict typecheck (`npm run typecheck`), build (`npm run build`), and the full test suite (99 files / 1005 tests) pass; the CLI was smoke-tested against an isolated database in both dry-run and live modes, including an idempotent second import.

## [1.0.20] - 2026-08-16

### Clarified Discovery operational states and alert timestamp normalizations

- Fixed operational state ambiguity by introducing explicit subsystem running states (`employerDiscoveryRunning`, `careerSiteHealthRunning`, and `alertEvaluationRunning`) to the `/api/sources/control-center` response and `SourceControlCenter` type definition.
- Exposed `isRunning()` on `EmployerDiscoveryService`, `CareerSiteHealthService`, and `DiscoveryAlertService` to return true during active background automation runs.
- Reconstructed the status pill in `EmployersPage.tsx` to dynamically query active running states, showing detailed statuses like "Employer discovery running", "Source discovery running", "CareerSite health check running", "Alert evaluation running", "Multiple operations running", or "Idle" instead of a vague aggregate "Running" label.
- Addressed timestamp timezone inconsistency by introducing `ensureIsoUtc(value)` in `timestamps.ts`, which parses database space-separated datetime strings consistently and outputs canonical ISO-8601 UTC strings ending with a `Z` suffix.
- Applied `ensureIsoUtc()` to `first_detected_at`, `last_detected_at`, `resolved_at`, and `acknowledged_at` in the alert row mapping boundary, resolving discrepancies between SQL datetime defaults and application-created timestamps.
- Removed system clock dependencies (`Date.now()` and `new Date()`) inside `DiscoveryAlertService.evaluateRules()`, replacing them with `this.now()` to ensure deterministic evaluations and robust time-travel mocking.
- Added comprehensive unit, integration, UI, and API regression coverage for timestamp normalizations, lifecycle transitions (stability of `firstDetectedAt`, updates of `lastDetectedAt`), and subsystem-specific running labels.
- Final verification: lint (`npm run lint`), strict typecheck (`npm run typecheck`), build (`npm run build`), and the full test suite (95 files / 961 tests) pass; packaged desktop smoke tests pass against isolated user-data.
- Installer: `release/Job-Browser-Setup-1.0.20.exe`, 249,911,168 bytes, SHA-256 `8A4196B0834A4233EE08D8190DCA8297C02006F65DB75B0C94C1A0FF2DCB7776`.

## [1.0.19] - 2026-08-15

### Advanced discovery analytics & alerting rules

- New database migration `029_discovery_alerts.sql` sets up the `discovery_alerts` table with constraints and indexes ensuring stable identity (only one active/acknowledged alert per rule and entity).
- New `src/discovery/discoveryAnalyticsService.ts` queries metrics and formats the global summary, windowed run stats, job yields (excluding user-removed jobs), source performance stats, and provider health rollups.
- New `src/discovery/discoveryAlertService.ts` evaluates alerting rules for 6 conditions: `source-failure-streak` (Warning at 2 consecutive failures, Critical at >= 3, suppressed if provider-level degradation is active), `source-overdue` (Warning if scheduled next run is overdue by >= 1 hour, suppressed if scheduler is globally disabled, or site is retired/backed off), `career-site-broken` (Warning/Critical depending on ATS check results, suppressed if site is retired), `zero-yield-streak` (Warning if >= 3 consecutive successful runs return 0 jobs on a source with historical yield), `discovery-stale` (Warning if time since last successful run/discovery exceeds 3x expected cadence), and `provider-degraded` (Warning if >= 3 enabled sources for a provider fail in the last 24h, and overall provider failure rate is >= 50%).
- Integrated alert evaluation hooks during backend startup reconciliation, immediately after completed coordinator discovery runs, and at the end of the scheduler loop.
- Registered API endpoints in `src/server/app.ts` for analytics query windows, provider/sources details, active/resolved alerts list, alert acknowledgement, and manual re-evaluation.
- Rewrote the top of `src/client/pages/EmployersPage.tsx` to render the Operations Console, displaying summary cards, active alerts (with Acknowledge/evaluate buttons), trend analytics, provider health rollups, and a sources performance table.
- Added a compact summary widget in `src/client/pages/DashboardPage.tsx` linking to the console.
- Comprehensive test coverage in `tests/discovery-alerts.test.ts` verifying rules, lifecycle state transitions, suppression, and analytics calculations.
- Final verification (2026-08-15): lint (`npm run lint`), strict typecheck (`npm run typecheck`), build (`npm run build`), and the full test suite (95 files / 956 tests) pass; packaged desktop smoke tests pass against isolated user-data.
- Installer: `release/Job-Browser-Setup-1.0.19.exe`, 249,909,327 bytes, SHA-256 `0FB31AFF80AF84EB80A1064D7239FDC023F489A4F10A0D2746AC5F604996BD22`.

## [1.0.18] - 2026-08-15

### Geographic eligibility: deterministic worksite distance and remote region restrictions

- New `src/intelligence/geographicEligibility.ts` replaces the commute gate's reliance on the small exact-city heuristic. Worksites are parsed from the structured `city`/`state` fields AND the free-text `location` field (multi-worksite splitting on `;`, `/`, and/or plus `City, ST` runs), so provider location-string-only postings can no longer bypass the commute gate.
- Location knowledge is classified deterministically with the existing local atlas (no network geocoder): `known_local` (exact distance within the radius), `known_distant` (exact distance beyond the radius), `known_state_eligible` (same-state, exact distance unavailable), `known_state_ineligible` (out-of-state, exact distance unavailable), and `unknown`. Uncertainty is never treated as positive evidence, and a distance is never fabricated.
- Hard gate: a non-remote role is hard-blocked (`location_outside_radius`) only when every known worksite is definitively outside the configured commute boundary (exact distance or out-of-state). Same-state, unknown, and mixed worksite sets are not hard-blocked.
- Remote roles skip the worksite distance gate, but explicit remote region restrictions ("Remote role is restricted to Maryland", "Candidates must reside in Texas", "MD, VA" lists) are detected deterministically; a restricted region that does not intersect the candidate's preferred states hard-blocks with the new `remote_region_ineligible` reason. Nationwide allowances ("anywhere in the US") are never treated as restrictions.
- Recommendation honesty: `Verified Match` is now capped at `Strong Match` whenever location eligibility could not be confirmed (same-state unknown distance, unknown location, unknown work arrangement). Remote roles and confirmed `known_local` roles keep full verification.
- Scoring semantics: location score is driven by actual commute eligibility (`known_local` 100, `known_state_eligible` 60, unknown 30, blocked 0) instead of exact-city guesswork; an unknown work arrangement scores 50 for remote preference rather than the near-perfect not-preferred value.
- `SCORING_RULES_VERSION` → `2026-08-15-geographic-eligibility-v1`, and `remoteRegion` is included in the score-input hash, so previously persisted geographic scores are invalidated and recomputed at startup.
- New regression coverage (`tests/geographic-eligibility.test.ts`, 50 tests): worksite parsing, location-knowledge classification, hard-gate matrix, recommendation caps, end-to-end scoring, remote region restrictions, persisted-score invalidation, and a current-ranking integration test asserting geographically impossible jobs stay out of the eligible Jobs ranking while unknown-location jobs never rank above viable ones.
- Final verification (2026-08-15): lint, strict typecheck, build, and the full test suite (94 files / 951 tests) pass; development, packaged, and installed smokes pass against isolated user-data, including the installed-app upgrade scenario proving a seeded geographically-invalid high score auto-corrects to `Hard No` / 0.
- Installer: `release/Job-Browser-Setup-1.0.18.exe`, 249,893,167 bytes, SHA-256 `BDD1F4932A1C9C7E4AA6616D922DC68F9981E178B648A1DA6EEB0CECAC1A059D`.

## [1.0.17] - 2026-08-14

### Stale role-details invalidation and automatic reconciliation

- `ROLE_DETAILS_VERSION` → `role-details-v2`. The extraction contract changed semantics: negated remote/telework denial handling, provider remote-type contradiction by an explicit denial, active-clearance classification, and general U.S. state normalization are now part of the persisted document's determinism contract, so prior `role-details-v1` documents are no longer comparable.
- `SCORING_RULES_VERSION` → `2026-08-14-role-details-v2-invalidation-v1`.
- Automatic bounded startup reconciliation (`IntelligenceEngine.reconcileStaleData`): each startup re-extracts role details for up to 200 active jobs carrying a missing or stale-version document, invalidates the persisted score/recommendation of every active job whose role details remain stale, then runs the existing stale-score pipeline to recompute scores from the corrected interpretation. Offline, idempotent, restart-safe, no manual CLI; expired and `user_removed` jobs are never re-interpreted or resurrected.
- Old persisted scores from the 1.0.15 interpretation (e.g. "remote / Verified Match" for a "Telework/Remote work not authorized" position) cannot survive: they are cleared and recomputed as `Hard No` / 0 for the default profile.
- New upgrade regression test (`tests/role-details-upgrade.test.ts`) covering stale detection, re-extraction to v2, arrangement correction, state normalization, active-clearance recognition, score invalidation and recomputation, current-v2 row skipping, `user_removed` preservation, idempotent reruns, bounded batching, and no network dependency.
- The installed upgrade smoke (`scripts/desktop-smoke.ts --installed --upgrade`) verifies on the actual installed binary that a seeded synthetic 1.0.15 stale-v1 job is auto-corrected at startup: re-extracted to v2, work arrangement onsite, `Annapolis Junction`/`MD` location normalization, active TS/SCI clearance classification, old score/recommendation invalidated, rescored to `Hard No` / 0, with the `user_removed` job untouched.
- Final verification (2026-08-14): lint, strict typecheck, build, and the full test suite (93 files / 901 tests) pass; development, packaged, and installed smokes pass against isolated user-data, including the installed-app stale-v1 upgrade scenario.
- Installer: `release/Job-Browser-Setup-1.0.17.exe`, 249,885,287 bytes, SHA-256 `96AB39C05EEC617596F5A407A032D99E81F101E6C040DBBCC0A00FC770128C75`.

## [1.0.15] - 2026-08-14

### Structured Role Details Extraction

- Deterministic regex and rule-based Role Details extraction (`role_details_json`, version `role-details-v1`) integrated into ingestion and scoring-time persistence.
- Extraction precedence: authoritative structured provider data > labeled description sections > deterministic regex/rules > unknown. No AI/LLM/NLP.
- Extracted dimensions: workplace arrangement, employment type (separated from work arrangement), primary/remote locations, clearance mode & level, education degree & substitutions, experience required/preferred years & substitutions, required/preferred skills and tech stack, certifications, travel percentage, work schedule flags, citizenship requirements, contingent conditions, and occupational series.
- Migration `028_role_details.sql` adds nullable `jobs.role_details_json` column. Bounded offline backfill (`npm run role-details:backfill` or CLI) with idempotency, version-skipping, user_removed exclusion, and identity preservation.
- Provider normalization audit and bugfixes across USAJOBS (retaining full requirements text), Greenhouse (removing fabricated full-time fallback), SmartRecruiters (`workplaceType` mapping), and Dice (`temporary`/`internship` mapping).
- Job Detail panel structured Role Details section displaying clean key-value rows with evidence affordance (omitting unknown/null fields).
- Complete test coverage (188 role-details extractor/integration tests, dashboard UI tests, provider tests, and full regression test suite).
- Final verification (2026-08-14): lint, strict typecheck, build, and the full test suite (92 files / 898 tests) pass; development smoke, packaged smoke, and installed smoke pass against isolated user-data.
- Installer: `release/Job-Browser-Setup-1.0.15.exe`, 249,874,434 bytes, SHA-256 `505C91D3B13D826B7A74015E881FACB7ECB6D85396DE274B93B022B371BC425F`.

### Regression hardening: remote/telework denial, clearance wording, state normalization (2026-08-14)

- Work-arrangement classification now recognizes clause-local denials of remote / telework / telecommute / work-from-home availability ("Telework/Remote work currently not authorized", "not eligible for remote work", "does not offer remote work", "unavailable"), so an inserted qualifier such as "currently" cannot defeat the rule and a denial in an unrelated clause cannot taint a positive remote statement. Positive telework / telecommute / remotely language classifies remote; hybrid phrasing stays hybrid.
- An explicit remote/telework denial in the posting text overrides a provider remote/hybrid claim (provider remote-type fields are frequently template defaults); non-denial prose such as "must report to the office" still does not override provider claims.
- Clearance classification now recognizes active-status qualifiers that follow the level or modify a polygraph ("TS/SCI with an active CI polygraph"), standalone-level requirements ("must hold TS/SCI"), "must maintain an active [level] clearance", "ability to obtain", and "eligible for [level] clearance" — without turning obtainable / eligible / preferred wording into an active hard block.
- General U.S. state normalization (full state names, postal abbreviations, state-only locations) shared by the extractor and location eligibility via `src/utilities/us-states.ts`.
- 28 new deterministic regression tests (synthetic paraphrases plus positive-language anti-overcorrection guards). No company/provider/job-specific exceptions; every fix is a general failure-class rule.

The following sections summarize the 9.6 lifecycle / discovery stabilization
work that is included in this 1.0.15 release.

### Job lifecycle / manual availability (2026-08-14)

- Manual Remove / Restore of current jobs via a durable `jobs.user_removed`
  marker (migration `027_manual_job_removal.sql`); `PATCH
/api/jobs/:id/availability` exposes `remove` / `restore` / `verify`. The Jobs
  list and Job detail panel label removed jobs ("Removed"), and the dashboard
  surfaces a separate "Removed" count.
- User removals survive rediscovery and canonical recomputation: a provider
  re-listing the same canonical posting cannot silently resurrect a
  user-removed job. Jobs are never physically deleted; historical and
  application views still reference them.
- Bounded manual `verify` distinguishes definitive (`alive`, `closed`) from
  low-confidence (`unreachable`) outcomes. Only definitive outcomes mutate
  lifecycle state; timeouts, network errors, auth/rate-limit, and bot-protection
  responses never auto-remove a job (availability safety policy).
- Discovery employer activity (active/new-job counts) excludes user-removed
  jobs so manual suppression never inflates metrics.

### Federal / clearance eligibility (2026-08-14)

- Deterministic `federalEligibility` classification: occupational-series
  extraction, 0854 / professional-engineering basic-qualification detection
  (ABET, calculus + engineering-science, PE/FE/EIT, IOR wording), and active /
  obtainable / eligible / public-trust / ambiguous / none clearance
  classification.
- Only a genuine active-clearance requirement or explicit professional-
  engineering basic qualification hard-rejects (`clearance_required`,
  `professional_engineering_required`). Obtainable / eligible / public-trust
  wording and generic engineering titles never hard-block.
- `SCORING_RULES_VERSION` → `2026-08-13-federal-and-clearance-v1`.

### Added

- Discovery Control Center `Check CareerSite Health` action: a bounded
  foreground bulk health run (limit 25, single-flight) wired to the existing
  `/api/career-site-health/run` endpoint. No new route or migration.
- Employer and CareerSite registry "Added" timestamps in the Employers page.
- "Show retired CareerSites" toggle so retired records no longer dominate
  operational views.
- Regression tests for effective database-path reporting and rejected-settings
  atomicity (`tests/backend-lifecycle.test.ts`).
- Real tracked-employer and skill-signal totals in `AnalyticsView`
  (`trackedEmployers`, `skillSignals`), independent of the top-10 chart series.

### Changed

- Renamed the "Employer health summary" section to "CareerSite Health" with a
  total and an explicit note that probe-based health is separate from Source run
  success. Discovery Intelligence run metrics are labeled "Successful/Failed
  runs, last 30 days" with the exact activity window; active CareerSites show
  employer, scheduling class, priority, health, reasons, 30-day activity, and
  next eligibility.
- `GET /api/settings` now reports the **effective** database path (the database
  the backend actually opened) instead of a possibly stale persisted value.
  Packaged installs no longer display (or round-trip on save) an unsafe default
  location computed from the install directory.
- `PUT /api/settings` runs the `onSettingsSaved` hook (which hosts the desktop
  install-directory guard) **before** persisting, so a rejected save writes
  nothing to `app_settings`.
- `BackendOptions.atsDetector` is threaded into `CareerSiteHealthService` so
  health checks honor the same detector override the detection endpoint uses,
  enabling deterministic offline tests.

### Fixed

- Settings saves could fail with a 500 when a packaged install had persisted a
  stale `databaseLocation` pointing inside the replaceable installation
  directory: the Settings UI displayed it and any save round-tripped it through
  the install-dir guard. Effective-path reporting and guard-before-persist
  ordering resolve this.
- Analytics "Tracked employers" and "Skill signals" KPIs under-reported beyond
  the top-10 chart series; they now use real totals.
- A failed `/api/analytics/application-outcomes` query now surfaces an error in
  the Analytics page instead of silently hiding the outcomes panel.
- `SearchProfilePage` swallows nothing: a rejected save now displays the server
  error message instead of silently reverting to the idle hint.
- `PUT /api/settings` no longer invokes the `onSettingsSaved` hook twice (the
  redundant post-persist call was removed); the guard runs exactly once, before
  persisting.
- Verification at the time (2026-08-13): typecheck, ESLint, and the full suite
  (89 files / 676 tests) passed; desktop build/smoke was the only outstanding
  completion gate at that checkpoint.

### Lifecycle (migration `026_explicit_job_lifecycle.sql`)

- Source memberships and immutable observations retain explicit normalized
  closure evidence; legacy unknowns remain unknown.
- Date-only deadlines expire after the complete UTC closing day; exact deadlines
  expire at their supplied instant; posting age alone never expires a Job.
  Rediscovery can extend/remove closing evidence and reactivate the same
  identity.
- Preserved two-complete-snapshot misses and cross-source canonical safety;
  added bounded offline reconciliation and current/history/all Jobs views.
- Verified expiry does not alter Applications, events, ResumeSnapshots, Company
  identity, observations, or provenance.

### Install-local database-path guard

- Packaged runtime databases inside the replaceable installation directory are
  rejected: unsafe stored overrides fall back to per-user data, Settings
  rejects new unsafe paths, and external custom locations remain valid.

### Stabilization sprint verification (2026-08-13, before the Role Details work)

- Full suite: 89 files / 676 tests passed (2026-08-13). ESLint and strict
  typecheck pass. The desktop smoke now asserts the Analytics and Search Profile
  pages in addition to Jobs, Applications, Sources, Discovery Engine, and
  Settings.
- Development smoke, unpacked build (`release/win-unpacked`), packaged smoke,
  NSIS package, and installed-app smoke all passed against isolated smoke
  user-data.
- Intermediate installer at that time: `release/Job-Browser-Setup-1.0.14.exe`,
  249,839,217 bytes, SHA-256
  `0B8823AB8ACC7254705E6C411AC3946C88F573D0D8359FAC5A77087C1C5B2AEA`.
  Superseded by the final 1.0.15 artifact listed above.

## [1.0.14] — 2026-08-12

Phase 8 Milestones 8.1–8.8 and Employer Discovery 9.1–9.5 complete.

### Added

- Employer Discovery 9.5 on-demand `employer-discovery-intelligence-v1` with
  adaptive 6/24/72-hour cadences, explicit priority components, hard safety
  overrides, deterministic ordering/explanations, provider success history, and
  30-day half-open UTC activity metrics. Bounded summary and per-site REST reads
  plus a compact Employers Discovery Intelligence panel.
- Employer Discovery 9.4 CareerSite health (migration
  `025_career_site_health.sql`): deterministic health state, append-only
  verification history, transient failure thresholds, redirect and ATS-change
  detection, conservative repair, retirement, and bounded scheduling.
- Milestone 8.8 offline integrated fixtures proving populated persistence-set
  backup and changed-root restore preserve ResumeSnapshot evidence, Company
  identity, outcome analytics, and the independent Employer registry.
- Milestone 8.7 `application-outcomes-v1` on-demand analytics
  (migration `023_outcome_analytics_indexes.sql`).
- Milestone 8.6 Company Identity Foundation (migration `021_company_identity.sql`).
- Employer Discovery 9.3 seed importer and six-hour automation slice
  (migration `022_employer_discovery_engine.sql`).
- Milestone 8.5 persistence-set backup/restore with manifest coverage of SQLite,
  Resume, ResumeSnapshot, and profile/scoring files (migration
  `019_persistence_set_backup.sql`, `src/db/persistenceSetCoordinator.ts`).
- Milestone 8.4 ResumeSnapshots (migration `018_resume_snapshots.sql`) with
  immutable capture-time interpretations, reuse identity, and transactional
  capture with Application events.
- Milestone 8.3 Application management workflow with six loopback REST
  endpoints, opaque cursor pagination, and correction-aware timelines
  (migration `017_application_management_indexes.sql`).
- Milestone 8.2 Application event foundation (migration
  `016_application_event_foundation.sql`): V2 projection, append-only
  `application_history` ledger, and `application_effective_events` projection.
- Milestone 8.1 durability and recovery: quarantine of corrupt database sets,
  WAL-recovery before pre-migration backup, shadow-copy integrity verification,
  and bounded desktop recovery actions.
- Employer Discovery 9.6 operationally grounded CareerSite health
  (see Unreleased).
- Migration `026_explicit_job_lifecycle.sql` explicit lifecycle reasons and
  closing-date precision (see Unreleased).

### Changed

- `/employers` workflow presented as the first-class Discovery Engine with
  scheduler/automation state and manual `Run Discovery Now` and
  `Run Enabled Sources` actions.
- Startup seed reconciliation idempotently imports 25 real bounded Employer
  CareerSites (`curated-starter-v1`); former fictional pairs are retired, never
  deleted.
- Desktop startup ignores database overrides inside the installation directory.

### Verification

- Final full suite: 87 files / 660 tests passed. ESLint, strict typecheck,
  production build, development smoke, unpacked build, packaged smoke, NSIS
  package, silent install, and installed smoke passed.
- Installer: `release/Job-Browser-Setup-1.0.14.exe`, 249,829,699 bytes, SHA-256
  `037201DDFBA09EDEF9A5AB5EFD0BC1290A9D199513157AC0FEAC96930AC15785`.
- Rebuilt (9.5): 249,823,741 bytes, SHA-256
  `CE31661F2AA72F831FDE6C9524B1CE68AA870B76AB1227B53E1E14DC416C39CD`.

## [1.0.13] — 2026-08-02

### Fixed

- Removed generated JavaScript from Electron desktop smoke-test navigation;
  smoke routes are restricted to an explicit allowlist on the current loopback
  origin, eliminating the remaining code-construction injection finding.
- Added independent per-minute request limits for API and client file delivery
  (HTTP 429 with `Retry-After`).

### Verification

- 63 files / 420 tests, strict typecheck green, ESLint clean, zero `npm audit`
  vulnerabilities, desktop smoke passed, CodeQL clean.

## [1.0.12] — 2026-08-02

### Added

- Handshake browser provider with dedicated persistent profile, multi-query
  search, filters, pagination, and a disabled starter source. Credentials are
  never collected; only the locally stored browser session is reused.

### Fixed

- USAJOBS login acknowledgement URL substring check replaced with exact HTTPS
  hostname validation.
- LinkedIn diagnostic HTML regex script filtering replaced with `parse5`
  document parsing.
- Resume reads/deletions confined to the configured resume directory with
  traversal and prefix-collision blocking.

### Verification

- 62 files / 416 tests, strict typecheck green, ESLint clean, desktop smoke
  passed, CodeQL four alerts fixed.

## [1.0.11] — 2026-08-01

### Fixed

- Startup hang while migration `015_interrupted_run_status.sql` applied to large
  databases (full-table rescan on `job_observations`); temporary indexes cut the
  migration from ~18s to ~1.4s.

### Verification

- 58 files / 398 tests, strict typecheck green, ESLint clean. Verified against a
  copy of the real database (709 runs, 9,780 observations preserved, zero FK
  violations).

## [1.0.10] — 2026-08-01

### Fixed

- Zero-result discovery runs no longer reported as failed ("No open positions
  found" / "No jobs matched current filters" are successful runs that do not
  inflate `failure_count` or flip health). Filter-mismatch runs do not complete
  a snapshot; genuinely empty boards still reconcile.
- "Discovery was interrupted when Job Browser stopped" is now a distinct
  `interrupted` non-failure run state (migration `015_interrupted_run_status.sql`),
  preserving run data and references.

### Changed

- Run history renders `interrupted` runs with a neutral amber badge.

### Verification

- 58 files / 398 tests, strict typecheck green, ESLint clean.

## [1.0.9] — 2026-08-01

### Changed

- Upgraded dependencies to clear GitHub Dependabot advisories (22 → 0):
  `react-router@8.3.0` replaces `react-router-dom@7` (fixes RSC CSRF bypass);
  removed unused `@modelcontextprotocol/sdk`; bumped `electron-builder`,
  `vitest`, `tsx`, and `sharp`; `brace-expansion` pinned via overrides.
- Migrated client imports to `react-router`.

### Fixed

- Cleared 133 pre-existing ESLint errors across scoring, provider, and test
  files. No runtime behavior changes.

### Verification

- 58 files / 393 tests, strict typecheck green, ESLint clean, 0 `npm audit`
  vulnerabilities.

## [1.0.8] — 2026-07-31

### Fixed

- USAJOBS returned zero jobs because the hidden `#no-search-results` element
  aborted card collection; `noResults` now derives from the actual card count,
  and the new "Open MM/DD/YYYY to MM/DD/YYYY" date format is supported.
- Add Source form now explains the "Public careers URL" field and surfaces
  actionable validation messages for required configuration values.

### Added

- Regression tests for the USAJOBS extractor covering the hidden element and
  new date format.

### Verification

- 58 files / 393 tests, strict typecheck green.

## [1.0.7] — 2026-07-31

### Added

- SmartRecruiters hardening: accepts `jobs.` and `careers.` URLs, page-isolated
  pagination, validation reports with preview samples, and a dedicated 10-test
  suite.
- Legacy compatibility migration `014_legacy_remote_ok_sources.sql` disabling
  previous Remote OK sources while preserving jobs and run history.

### Changed

- Remote OK provider removed entirely (`remoteOk.provider.ts`, fixture, tests,
  `ensureRemoteOkSource`, discovery/intelligence CLIs, smoke references, and the
  Sources editor fallback is now SmartRecruiters). Discovery engine/coordinator
  suites now use Ashby fixtures.

### Removed

- Remote OK no longer listed as supported, no longer seeded, existing sources
  disabled by migration 014.

### Verification

- 57 files / 389 tests, strict typecheck green, ESLint at baseline.

## [1.0.6] — 2026-07-28

### Fixed

- Classify explicit onsite/hybrid postings ahead of generic technical remote
  terminology.
- Reject onsite/hybrid jobs outside the configured commute radius before
  scoring.
- Reprocess stale persisted scores when scoring rules or candidate settings
  change.
- Exclude ineligible/stale scores from default job search results.
- Invalidate frontend score caches when ranking inputs change.

### Verification

- 50 files / 334 tests.

## [1.0.0] — 2026-07-25

Initial release.

### Added

- 18 provider integrations: Ashby, BambooHR, Built In, Dice, Greenhouse, iCIMS,
  Lever, LinkedIn Jobs, Recruitee, Remote OK, SmartRecruiters, Structured Data,
  Teamtailor, USAJOBS, Wellfound, Workable, Workday, ZipRecruiter.
- LinkedIn and Dice headed-Chromium job search with persistent profiles.
- Source management (CRUD, per-source configuration, schedules, health).
- Dashboard and analytics, unified job normalization, WebSocket log streaming,
  SQLite storage with a migration system.

### Fixed

- Packaged build provider loading (`asarUnpack` removal for
  `ERR_MODULE_NOT_FOUND`).
- LinkedIn browser process leak, silent `page.goto` failures, login timeout,
  and profile isolation.
- BambooHR schema bug (`isRemote` nullable boolean).

### Removed

- Remote OK default source auto-creation on startup (provider code kept for test
  compatibility).

## How to Tag

```bash
git tag -a v1.0.0 -m "v1.0.0 — Initial release"
git push origin v1.0.0
```

## Release Process

1. Bump version in `package.json`
2. Update `CHANGELOG.md` with changes
3. Run `npm run desktop:package` for full NSIS installer
4. Test the installer build
5. Commit, tag, push
