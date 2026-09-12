# Beta Testing Guide

This page tells external beta users how to install Job Browser 1.1.1, run the
key scenarios, and report findings. It pairs with `docs/BETA_PLAN.md` (goals,
scope, and exit criteria) and `docs/KNOWN_QUIRKS.md` (known behaviors).

## Install

1. Copy the beta installer `Job-Browser-Setup-1.1.1.exe` to the test machine.
2. Install over an existing Job Browser 1.0.x copy, or run it on a clean
   machine.
3. Launch Job Browser, complete onboarding, add at least two sources (one
   browser source, one HTTP source), and let discovery run once manually.

The installer, packaged contents, and the installed copy are verified identical
(SHA-256 match) in the release validation; an upgrade install preserves the
existing database, resumes, profile, and backups. All data stays on the
machine: Job Browser collects and transmits no telemetry (`docs/privacy.md`).

## Key scenarios to test

### 1. Browser sources and login

- Add a Dice source and run discovery. Job cards should load without the
  detail-page stall from earlier 1.0.x builds.
- For LinkedIn/USAJobs/Handshake, exercise the interactive login flow. While a
  credential-backed source runs, Sources shows a "sign-in running" hint; if the
  provider reports a verification/security wall, the run history shows an amber
  callout telling you to complete sign-in in the browser window and run again.

### 2. Scheduled discovery

- Enable a source schedule ("Allow enabled source schedules while Job Browser
  is open"). Runs happen only while the app is open. Confirm run history and
  health messages update after a scheduled run.

### 3. Empty and error states

- Apply a filter combination that matches no jobs: Jobs should say "No jobs
  match these filters" with a Show-all link.
- With no sources and no jobs: Jobs should guide you toward adding sources.
- Cause or observe a provider timeout: the Sources page shows a "what to do
  next" hint under that source.

### 4. Upgrade safety

- Install 1.1.0 over your existing 1.0.x data. Confirm all jobs,
  applications, resumes, profile settings, and backups are still present and
  the dashboard loads normally. Nothing is wiped on uninstall/upgrade.

### 5. Long-session health

- Leave Job Browser open for an extended session with scheduled discovery.
  Confirm no browser window is left behind, no discovery run hangs, and Source
  health matches actual behavior.

## What to report

Prefer direct reports to the maintainer (issue/thread) with the run history
and the health message text from the Sources page. Include:

- Source type and provider.
- Health message text (exact wording).
- Whether the run was manual or scheduled.
- Browser board / employer if relevant.

Privacy: do **not** share the database file, diagnostics HTML, or profile data.
Raw screenshots are discouraged; describe the screen instead.

## Known quirks to be aware of

See `docs/KNOWN_QUIRKS.md` for the full index. Highlights: browser providers
are interactive (a credential-backed source may need a manual sign-in);
anti-bot pacing means discovery is intentionally not maximally fast; a run that
is stopped is recorded as `interrupted`; `No open positions found` is a healthy
empty result, not an error.
