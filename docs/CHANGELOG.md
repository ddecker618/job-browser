# Changelog

All notable changes to this project will be documented in this file.

## [1.0.17] - 2026-08-14

### Stale role-details invalidation and automatic reconciliation

- `ROLE_DETAILS_VERSION` → `role-details-v2`. The extraction contract changed semantics: negated remote/telework denial handling, provider remote-type contradiction by an explicit denial, active-clearance classification, and general U.S. state normalization are now part of the persisted document's determinism contract, so prior `role-details-v1` documents are no longer comparable.
- `SCORING_RULES_VERSION` → `2026-08-14-role-details-v2-invalidation-v1`.
- Automatic bounded startup reconciliation (`IntelligenceEngine.reconcileStaleData`): each startup re-extracts role details for up to 200 active jobs carrying a missing or stale-version document, invalidates the persisted score/recommendation of every active job whose role details remain stale, then runs the existing stale-score pipeline to recompute scores from the corrected interpretation. Offline, idempotent, restart-safe, no manual CLI; expired and `user_removed` jobs are never re-interpreted or resurrected.
- Old persisted scores from the 1.0.15 interpretation (e.g. "remote / Verified Match" for a "Telework/Remote work not authorized" position) cannot survive: they are cleared and recomputed as `Hard No` / 0 for the default profile.
- New upgrade regression test (`tests/role-details-upgrade.test.ts`) covering stale detection, re-extraction to v2, arrangement correction, state normalization, active-clearance recognition, score invalidation and recomputation, current-v2 row skipping, `user_removed` preservation, idempotent reruns, bounded batching, and no network dependency.
- Final verification (2026-08-14): lint, strict typecheck, build, and the full test suite (93 files / 901 tests) pass; development, packaged, and installed smokes pass against isolated user-data, including the installed-app stale-v1 upgrade scenario (the installed 1.0.17 binary auto-corrects a seeded synthetic 1.0.15 database at startup).
- Installer: `release/Job-Browser-Setup-1.0.17.exe`, 249,884,580 bytes, SHA-256 `8E3E578826B48993730614B9F9E06119C1EF59B2325E7A6D8B2405831E2F924C`.

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