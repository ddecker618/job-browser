# Changelog

All notable changes to this project will be documented in this file.

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
