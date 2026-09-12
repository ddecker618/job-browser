# Beta Plan

Targets the external beta of Job Browser 1.1.1.

## Goal

Validate the browser-discovery experience and the upgrade path with a small
group of real users before wider release. Success = beta users configure their
own sources, run discovery on a normal schedule, and report no data-loss or
browser-reliability regressions; the privacy guarantees hold.

## Scope

- Windows x64 desktop installer (NSIS).
- Browser sources: Dice, LinkedIn, USAJobs, Handshake (interactive login).
- HTTP/SQL sources: all structured-data providers shipped in 1.0.x.
- Upgrade from existing 1.0.x install and clean installation.

## Beta-config vs production

- Keep the packaged app **entirely local**. No telemetry is collected or
  transmitted (see `KNOWN_QUIRKS.md` #17 and `docs/privacy.md`).
- Local-only adoption markers may be recorded (see phase 16, tracker) to help
  the maintainer observe whether beta installs are actually used; these never
  leave the machine.

## Installation

1. Copy the beta installer (`dist/` artifact from phase 10/15) to the test
   machine.
2. Install over the existing 1.0.x build, or run on a clean machine.
3. Run Job Browser, complete onboarding, add at least two sources (one browser
   source, one HTTP source), and let discovery run once manually.

## Feedback collection

- Direct reports to the maintainer (issues/thread) with the run history and
  health message from the Sources page.
- Include: source type, provider, health message text, and whether the run was
  manual or scheduled. Raw screenshots are discouraged for privacy.
- Do **not** share the database file, diagnostics HTML, or profiles.

## Findings to watch

- Dice hang or browser-process leak after long sessions (DEF-001 guarantee).
- Login/verification walls misclassified as ordinary failures.
- Upgrade path: existing database, resumes, profile, backups survive.
- Zero-result or partial snapshots (should not damage health or history).

## Exit criteria

1. Full gate green (`npm run verify`) plus `npm run privacy:check`.
2. Packaged smoke + installed smoke pass on a fresh and an upgraded machine.
3. No unresolved data-integrity or privacy defects from beta findings.
4. Beta findings triaged; release blockers fixed or waived with reason.

## Milestones

- Phase 10: packaged smoke tests re-run at release.
- Phase 13: privacy audit final pass.
- Phase 17: version bump to 1.1.0, CSP, version checks, final gates.
- Phase 18: final report + READY / NOT READY FOR EXTERNAL BETA.

## Status

All milestones reached (2026-09-09). Exit criteria:

1. Full gate green (`npm run verify`, 108 files / 1101 tests) + `npm run
privacy:check` (11/11). ✅
2. Packaged smoke + installed smoke pass on the 1.1.1 artifact; upgrade
   preservation verified with a seeded synthetic database. ✅
3. No unresolved data-integrity or privacy defects from beta findings
   (no external findings yet; pre-release audit clean). ✅
4. Beta findings triaged; release blockers fixed. Cross-source
   parallelization waived for the beta line with reason (tracker decision D-010). ✅

Beta artifact: `release\Job-Browser-Setup-1.1.1.exe`
(253,596,928 B, SHA-256
`1101A3795CCB930C9966DC02198B60EFCF757221496B61728C2B9C9E8886C815`).

Verdict: **READY FOR EXTERNAL BETA**.
