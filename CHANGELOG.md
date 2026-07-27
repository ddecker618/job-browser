# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — 2026-07-25

### Added

- Built In public HTML/search-card and JSON-LD detail-page provider.
- Wellfound and ZipRecruiter visible-browser providers with fixture-safe fetch paths and local persistent profiles.
- Shared browser job-board extraction, security-check waiting, JSON-LD parsing, salary/date/workplace inference, and bounded detail enrichment.
- Packaged provider-load assertions and persistent profile directories for the new browser connectors.

### Verification

- Production build, strict typecheck, ESLint, provider fixtures, provider registration, unpacked Electron packaging, and packaged Electron smoke pass.
- Full suite passes: 48 test files and 311 tests.

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
