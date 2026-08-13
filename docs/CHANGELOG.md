# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

Milestone 8.8 and Employer Discovery 9.5 are Architect-approved. Phase 8 and the
Employer Discovery 9.1 through 9.5 workstream are complete as of 2026-08-12.

### Current worktree

- Added non-destructive expired/closed Job lifecycle with migration
  `026_explicit_job_lifecycle.sql`. Source memberships and immutable observations
  retain explicit normalized closure evidence; legacy unknowns remain unknown.
- Date-only deadlines expire after the complete UTC closing day, exact deadlines
  expire at their supplied instant, and posting age alone never expires a Job.
  Rediscovery can extend/remove closing evidence and reactivate the same identity.
- Preserved two-complete-snapshot misses and cross-source canonical safety. Added
  bounded offline reconciliation, current/history/all Jobs views, retained
  historical detail, and current-opportunity search/scoring/market metrics.
- Verified expiry does not alter Applications, events, ResumeSnapshots, Company
  identity, observations, or provenance. Focused lifecycle tests passed 10 files
  / 77 tests; the database-path guard passed 3 files / 13 tests; the final full
  suite passed 87 files / 660 tests.
- Prevented packaged runtime databases inside the replaceable installation
  directory. Unsafe stored overrides fall back to per-user data, Settings rejects
  new unsafe paths, and external custom locations remain valid.
- Final ESLint, strict typecheck, production build, development smoke, unpacked
  build, packaged smoke, NSIS package, silent install, and installed smoke passed.
  Installer: `release/Job-Browser-Setup-1.0.14.exe`, 249,829,699 bytes, SHA-256
  `037201DDFBA09EDEF9A5AB5EFD0BC1290A9D199513157AC0FEAC96930AC15785`.

- Employer Discovery 9.5 adds the on-demand
  `employer-discovery-intelligence-v1` policy with adaptive 6/24/72-hour
  cadences, explicit priority components, hard safety overrides, deterministic
  ordering and explanations, provider success history, and 30-day half-open UTC
  Employer/CareerSite activity metrics. Successful zero-result runs remain
  successes and unknown activity remains explicit. Existing scheduler ownership,
  default-off operation, no-startup-catch-up, single-flight execution, and
  25-site bounds remain intact.
- Added bounded summary and per-site REST reads plus a compact Employers
  Discovery Intelligence panel showing due/eligible counts, scheduling class,
  priority, health, reasons, next eligibility, and provider reliability. No
  migration, cache, AI/LLM call, external analytics, or provider-contract change
  was required.
- 9.5 completion verification passed at 11 focused files / 103 tests and 87 full
  files / 654 tests, plus ESLint, strict typecheck, production build, development
  smoke, NSIS packaging, packaged smoke, silent install, and installed smoke.
  Rebuilt installer: `release/Job-Browser-Setup-1.0.14.exe`, 249,823,741 bytes,
  SHA-256
  `CE31661F2AA72F831FDE6C9524B1CE68AA870B76AB1227B53E1E14DC416C39CD`.

- Milestone 8.8 adds offline integrated fixtures proving populated
  persistence-set backup and changed-root restore preserve exact ResumeSnapshot
  evidence, Company identity, Application outcome analytics, and the independent
  Employer registry. A deferred-boundary audit confirms future entities remain
  absent from migrations, APIs, and UI.
- Employer Discovery 9.4 adds migration `025_career_site_health.sql`,
  deterministic current health and append-only verification history, transient
  failure thresholds, redirect and ATS-change detection, conservative repair,
  retirement, bounded scheduling, API operations, and an Employers health
  summary/history UI. ATS changes preserve linked historical Sources.
- Final release verification passed: 85 test files / 635 tests, ESLint, strict
  typecheck, production build, development desktop smoke, NSIS packaging,
  packaged smoke, silent current-user install, shortcut verification, and
  installed smoke. Installer: `release/Job-Browser-Setup-1.0.14.exe`,
  249,807,277 bytes, SHA-256
  `86F47A33AF342508152618EA1069F30FC264342626A7553A8309E41F44AD68AC`.
- Milestone 8.7 and Employer Discovery 9.3 are Architect-approved. Milestone 9.5
  has not started.

- Milestone 8.7 Local Outcome Analytics is completion-gate complete pending
  Architect acceptance. `application-outcomes-v1` is calculated on demand from
  effective Application events, exact Company projections, and immutable
  capture-time Skill/Certification evidence. Results expose current versus ever
  outcomes, half-open cohort windows, auditable numerators/denominators/sample
  sizes, unknown buckets, small-sample disclosure, timing, and source watermark.
  Migration `023_outcome_analytics_indexes.sql` contains only a query-plan-driven
  event index; no AnalyticsCache or prediction persistence was added.
- Employer Discovery 9.3 is completion-gate complete. The bounded seed importer
  preserves explicit provenance, rejects malformed records, caps each import at
  25 Employers and five CareerSites per Employer, and is idempotent without
  fuzzy merges. Default-off six-hour automation is owned by the existing
  desktop scheduler, runs at most 25 eligible sites, performs no startup
  catch-up, respects backoff/retired state, prevents overlap, reuses Sources,
  and leaves unknown or credential-required targets non-executable.
- Final verification passed at 82 test files / 621 tests plus typecheck, ESLint,
  production build, development desktop smoke, unpacked packaging, and packaged
  desktop smoke.

- Milestone 8.6 Company Identity Foundation adds migration
  `021_company_identity.sql`, versioned `company-exact-v1` resolution,
  deterministic canonical names, generic-key exclusion, Job/Application
  projections, auditable assignment provenance, and an explicit unlinked
  Application bucket while preserving all source and copied Company text.
- Employer Discovery 9.3 gains its first automated slice through migration
  `022_employer_discovery_engine.sql`: eligible CareerSites are
  verified/fingerprinted, mapped to existing providers, linked to idempotently
  created/reused Sources, recorded with result/backoff provenance, and executed
  through the existing DiscoveryCoordinator. The Employers page exposes bounded
  runs and per-site state. Seed importing and automatic scheduling remain.
- Verification for these parallel slices passed at 80 test files / 608 tests,
  plus typecheck, ESLint, production build, development desktop smoke, packaged
  desktop smoke, and a rebuilt version 1.0.14 installer.

- Milestone 8.5 (Persistence-Set Backup and Restore) implementation and its
  completion gate finished on 2026-08-12; final Architect acceptance is being
  requested. It provides manifest-based backup of
  SQLite, Resume, ResumeSnapshot, and CandidateProfile/scoring preference files
  (`src/db/persistenceSetBackup.ts`, migration `019_persistence_set_backup.sql`)
  with verified offline restore, dry-run reporting, and round-trip tests across
  empty, populated, failed-parse, missing-file, interrupted,
  concurrent-preference-write, and changed-root scenarios.
- Persistence-set serialization boundary: a single in-process read/write
  coordinator (`src/db/persistenceSetCoordinator.ts`) holds shared/read
  coordination across `createPersistenceSetBackup` and exclusive/write
  coordination across the authoritative manifest-covered writers in
  `src/server/app.ts` (`PUT /api/profile`, `PUT /api/scoring`, approved Resume
  proposals, and `DELETE /api/resumes/:id`), so a backup cannot capture a mixed
  source-data boundary. ResumeSnapshot and upload writers require no additional
  coordination because published snapshot files are immutable once referenced
  and upload files precede their SQLite rows with no interleave.
- The final completion-gate audit made referenced Resume/Snapshot absence,
  malformed Snapshot storage keys, and Snapshot hash/size corruption fail the
  backup; verifies copied-artifact hashes, every manifest role and owner,
  interrupted-operation cleanup/retry, and missing/corrupt detection; and proves
  orphaned, temporary, and quarantined files remain excluded. The focused suite
  passes 22 tests, the full suite passes 78 files / 600 tests, and development,
  packaged, and installed desktop smoke pass against rebuilt version 1.0.14.
- Employer Discovery parallel workstream: Employer Registry / CareerSite /
  deterministic ATS-fingerprint vertical slice (migration
  `020_employer_discovery.sql`, `src/domain/atsFingerprint.ts`,
  `src/repositories/employerRepository.ts`, `src/server/app.ts`, the Employers
  page, and `POST /api/career-sites/:id/source` mapping a verified CareerSite to
  an existing provider Source).

### Added

- Added migration `018_resume_snapshots.sql`, which adds the immutable
  `resume_snapshots` artifact table, the versioned capture-time
  `resume_snapshot_interpretations` payload, interpretation-scoped Skill and
  Certification relationships, and optional `submitted_resume_snapshot_id`
  columns on `applications` and `application_history`. Reuse identity is unique,
  snapshots/interpretations/relationships are immutable, only the resume-bearing
  Applied event may carry an association, and no historical Application or event
  is backfilled.
- Added `ResumeSnapshotRepository` persistence (`src/repositories/
resume-snapshot-repository.ts`) with deterministic reads, storage-key listing,
  and `findReusable()` reuse lookup.
- Added the capture orchestration (`src/resumes/resumeSnapshotCapture.ts`)
  that verifies the selected Resume file inside managed storage, hashes and
  sizes it, copies exact bytes to an opaque snapshot storage key, builds the
  capture-time interpretation, resolves Skill/Certification catalog IDs, and
  deduplicates identical captures through a unique reuse identity.
- Added snapshot storage helpers (`src/resumes/snapshotStorage.ts`, now
  synchronous) that confine artifact paths to the configured snapshot root,
  stage artifacts, and quarantine or remove unreferenced files.
- Added the reconciliation pipeline (`src/resumes/reconcileSnapshots.ts`) that
  reports artifact health, flags missing/corrupt files, quarantines orphaned
  artifacts, and preserves corrupt-but-referenced snapshots.
- Wired `resumeId` through `POST /api/applications` and replacement events to
  capture a snapshot before the Application transaction commits, exposed
  `GET /api/resume-snapshots` health/storage-key reporting and
  `GET /api/resume-snapshots/:snapshotId`, and integrated the snapshot into the
  desktop smoke fixture.
- Added `src/schemas/application.ts` `resumeId` validation via
  `.nullish()`, making resume selection optional while preserving strict
  validation of supplied values.

### Changed

- `ApplicationService.createApplication()` and `appendEvent()` now accept a
  prepared snapshot; the snapshot row is inserted in the same SQLite transaction
  as the Application projection, so an event is never recorded without its
  captured evidence.
- `ApplicationService` and `ApplicationRepository` map
  `submittedResumeSnapshotId` (null for legacy Applications and events).
- Resume service (`src/resumes/resumeService.ts`) shares the absolute
  resume-directory confinement rule used by snapshot storage.
- Existing `applications`, `application_history`, and
  `application_effective_events` remain canonical. Coordinated backup/restore
  over the full persistence set, Company Identity, outcome analytics, and
  integrated Phase 8 certification remain later milestones.

### Verification

- Full `npm run lint`, `npm run typecheck`, `npm test` (74 files, 541 tests),
  and `npm run build` passed.
- `npm run desktop:smoke` passed twice with idempotent fixture seeding
  (per-run Job/Event IDs, fixed Resume so snapshot reuse keeps exactly one
  storage key) and an `asserting-resume-snapshots` stage that requires healthy
  reconciliation and exactly one persisted artifact.
- The existing Milestone 8.3 release artifacts
  (`release/Job-Browser-Setup-1.0.13.exe`, `release/win-unpacked/Job Browser.exe`)
  were not rebuilt in this milestone.

## [1.0.13] — 2026-08-02

### Fixed

- Removed generated JavaScript from the Electron desktop smoke-test navigation. Smoke routes are now restricted to an explicit allowlist and loaded directly on the current loopback origin, eliminating the remaining code-construction injection finding.
- Added independent per-minute request limits for API traffic and client file delivery. Excess requests receive HTTP 429 responses with `Retry-After`, bounding database and filesystem work while leaving generous capacity for normal desktop use.

### Verification

- Full suite passes: 63 test files and 420 tests, strict typecheck green, ESLint clean, touched-file formatting clean, `npm audit` reports zero vulnerabilities, and the Electron desktop smoke test passed. CodeQL confirms all seven originally reported alerts are fixed and no alerts remain open.

## [1.0.12] — 2026-08-02

### Added

- Added a Handshake browser provider with a dedicated persistent profile, first-run school/SSO/MFA login, multi-query job search, remote/hybrid/on-site filters, explicit pagination, GraphQL response parsing, salary and closing-date normalization, and a disabled starter source. The application never collects Handshake credentials and reuses only the locally stored browser session.

### Fixed

- Replaced the USAJOBS login acknowledgement URL substring check with exact HTTPS hostname validation, preventing attacker-controlled lookalike hosts from being trusted.
- Replaced LinkedIn diagnostic HTML's regular-expression script filtering with `parse5` document parsing so malformed or whitespace-variant script tags are removed safely.
- Confined resume reads and deletions to the configured resume directory, consolidated parsing into one validated file read, and blocked traversal and directory-prefix collision paths.

### Verification

- Full suite passes: 62 test files and 416 tests, strict typecheck green, ESLint clean, touched-file formatting clean, and Electron desktop smoke test passed. CodeQL confirms four security alerts fixed.

## [1.0.11] — 2026-08-01

### Fixed

- Startup no longer hangs for several seconds while migration `015_interrupted_run_status.sql` applies to a large database. The migration's deferred foreign-key cleanup rescanned the full `job_observations` table for every deleted run (~18s on a database with ~10k observations), freezing the app long enough for Windows to flag it as unresponsive and close it before the migration could commit. Temporary indexes on the referencing columns keep those lookups index-driven, cutting the migration to ~1.4s. The app now starts and completes the upgrade normally.

### Verification

- Full suite passes: 58 test files and 398 tests, strict typecheck green, ESLint clean (0 errors). Verified against a copy of the real database: 709 runs, 9,780 observations, 969 source references, and 21 diagnostics all preserved with zero foreign-key violations; the migration applies in ~1.4s.

## [1.0.10] — 2026-08-01

### Fixed

- Sources that find zero jobs are no longer reported as failed. A discovery run with no open positions (or where every position was filtered out) now completes as a successful run with a notice such as "No open positions found" or "No jobs matched current filters", instead of throwing and being recorded as a failure. Empty runs no longer inflate `failure_count`, set `last_failure`, or flip source health to failed. A filter-mismatch run does not complete a snapshot (existing jobs stay active), while a genuinely empty board still completes its snapshot so removed jobs deactivate as expected.
- "Discovery was interrupted when Job Browser stopped" is now a distinct non-failure run state. Interrupted runs (the app shut down mid-discovery) are recorded with the new `interrupted` status instead of `failed`, no longer increment failure counts, and no longer mark the source as failed. Migration `015_interrupted_run_status.sql` rebuilds the `runs` table to allow the new status (preserving run data and run references from `job_sources`, `job_observations`, and `identity_conflict_diagnostics`) and reclassifies existing runs that were marked failed only for this reason.

### Changed

- Discovery run history now renders `interrupted` runs with a neutral amber badge instead of a red failure badge.

### Verification

- Full suite passes: 58 test files and 398 tests, strict typecheck green, ESLint clean (0 errors).

## [1.0.9] — 2026-08-01

### Changed

- Upgraded dependencies to clear GitHub Dependabot advisories (22 alerts down to 0): `react-router-dom@7` replaced with `react-router@8.3.0` (fixes the React Server Components CSRF bypass advisory); removed the unused `@modelcontextprotocol/sdk` (drops the vulnerable `@hono/node-server` and its Windows serve-static path traversal); bumped `electron-builder` to 26.15.3, `vitest` to 4.1.10, `tsx` to 4.23.1, and `sharp` to 0.35.3. Added npm `overrides` pinning `brace-expansion` to patched releases (1.1.17 / 2.1.3) so transitive tooling deps no longer resolve vulnerable versions.
- Migrated the client's React Router imports from `react-router-dom` to `react-router` (v8 packages everything under the main entry).

### Fixed

- Cleared the 133 pre-existing ESLint errors across `src/intelligence/scoringEngine.ts`, `src/providers/cisco.provider.ts`, `src/providers/crowdstrike.provider.ts`, `src/providers/smartRecruiters.provider.ts`, and the dice-completion, query-budget, usajobs-provider, and discovery-coordinator test suites: removed needless `async`/`any`, replaced `filter()[0]` with `find()`, wrapped numeric template interpolations, and dropped unused variables. No runtime behavior changes.

### Verification

- ESLint clean (0 errors), strict typecheck green, full suite passes: 58 test files and 393 tests, `npm audit` reports 0 vulnerabilities.

## [1.0.8] — 2026-07-31

### Fixed

- USAJOBS discovery returned zero jobs ("No open positions found") even when the public search page showed results. The search results extractor treated the always-present, hidden `#no-search-results` element as "no results", so card collection aborted on the first page. `noResults` is now derived from the actual extracted card count, and the card date parsing supports the new "Open MM/DD/YYYY to MM/DD/YYYY" format (falling back to the legacy "Posted … · Apply by …" format).
- The Add Source form now explains what the "Public careers URL" field is for and shows an actionable validation message when a required configuration value (such as the iCIMS portal URL or SmartRecruiters company identifier) is missing, instead of an opaque ATS detection error.

### Added

- Regression tests for the USAJOBS search results extractor (jsdom) covering the hidden no-results element and the new date format.

### Verification

- Full suite passes: 58 test files and 393 tests, strict typecheck green.

## [1.0.7] — 2026-07-31

### Added

- SmartRecruiters provider production hardening: config schema accepts both `https://jobs.smartrecruiters.com/<slug>` and `https://careers.smartrecruiters.com/<slug>` URLs (HTTPS-only; bare hosts rejected), later search pages failing no longer discard earlier pages (`tryPage` isolation), and configuration validation reports job counts with preview samples, empty boards, and 404s.
- Legacy compatibility migration `014_legacy_remote_ok_sources.sql` that disables any previously created Remote OK sources while preserving their jobs and run history.
- Dedicated SmartRecruiters provider test suite (10 tests) covering URL normalization, validation, pagination isolation, and details enrichment.

### Changed

- Removed the Remote OK provider entirely: `src/providers/remoteOk.provider.ts`, its fixture, and its tests are deleted. `ensureRemoteOkSource` is gone, the discovery/intelligence CLIs and desktop smoke test no longer reference Remote OK, and the Sources editor provider fallback is now SmartRecruiters.
- The discovery engine and coordinator test suites now use the Ashby provider fixtures; the built-in provider drives the discovery engine tests.

### Removed

- Remote OK is no longer listed as a supported provider, is not seeded as a starter source, and existing Remote OK sources are disabled by migration 014.

### Verification

- Full suite passes: 57 test files and 389 tests, strict typecheck green, ESLint back to the pre-existing baseline error count.

## [Unreleased] — 2026-07-25

### Added

- Built In public HTML/search-card and JSON-LD detail-page provider.
- Wellfound and ZipRecruiter visible-browser providers with fixture-safe fetch paths and local persistent profiles.
- Shared browser job-board extraction, security-check waiting, JSON-LD parsing, salary/date/workplace inference, and bounded detail enrichment.
- Packaged provider-load assertions and persistent profile directories for the new browser connectors.

### Verification

- Production build, strict typecheck, ESLint, provider fixtures, provider registration, unpacked Electron packaging, and packaged Electron smoke pass.
- Full suite passes: 48 test files and 311 tests.

### Documentation (2026-08-07)

- Reorganized the product, implementation roadmap, Database V2, application,
  resume, intelligence, and architecture documentation around explicit
  single-document responsibilities. Added complete section scaffolding,
  relocated the technical backlog from the architecture into the roadmap, and
  repurposed the former chatbot-oriented AI Assistant specification as the
  future intelligence-engine specification. No runtime behavior, tests,
  providers, or migrations changed.

## [1.0.6] — 2026-07-28

### Fixed

- Classify explicit onsite and hybrid postings ahead of generic technical remote terminology.
- Reject onsite and hybrid jobs outside the configured commute radius before scoring.
- Reprocess stale persisted scores when scoring rules or candidate settings change.
- Exclude ineligible or stale scores from default job search results.
- Invalidate frontend score caches when ranking inputs change.

### Verification

- Full verification passes: 50 test files and 334 tests.

## [1.0.0] — 2026-07-25

Initial release.

### Added

- **18 provider integrations**: Ashby, BambooHR, Built In, Dice, Greenhouse, iCIMS, Lever, LinkedIn Jobs, Recruitee, Remote OK, SmartRecruiters, Structured Data, Teamtailor, USAJOBS, Wellfound, Workable, Workday, ZipRecruiter
- **LinkedIn job search**: Headed Chromium browser for one-time login, persistent profile, multi-query support
- **Dice.com job search**: Same browser-based approach as LinkedIn
- **Source management**: CRUD for job sources with per-source configuration, schedules, and health monitoring
- **Dashboard & analytics**: Job discovery history, source health, import counts
- **Job normalization**: Unified schema across all providers — title, company, location, salary, remote type, employment type, description, requirements
- **Desktop notifications**: WebSocket-based live log streaming
- **SQLite storage**: Persistent local database with migration system

### Fixed

- **Packaged build provider loading**: Removed `asarUnpack` for providers to fix `ERR_MODULE_NOT_FOUND` on relative imports
- **LinkedIn browser process leak**: Added `underlyingBrowser.close()` to fully kill Chromium between sessions
- **LinkedIn page.goto silent failures**: Removed `.catch(() => {})` that masked navigation errors
- **LinkedIn login timeout**: Increased navigation timeout to 45s, added `--no-proxy-server` launch arg
- **LinkedIn profile isolation**: Prevented session cross-contamination between providers
- **BambooHR schema bug**: Fixed `isRemote: z.boolean().optional()` → `z.boolean().nullable().optional()` — API sends `null`

### Removed

- **Remote OK default source**: No longer auto-created on startup. Provider code kept for test compatibility.

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
