# MR1-07 — Validate installed onboarding and first-user experience

**Status:** In progress — authorized 2026-09-26; target release 1.1.6

**Owner:** OpenCode

**Reviewer:** Codex; installed visual checks require direct user observation

**Dependencies:** MR1-06 accepted and Done (`df829b9`)

**Release state:** Not shipped until all automated and manual gates pass

## Isolation rules

- Use only disposable user-data roots and synthetic databases/fixtures.
- Desktop smoke commands must use their generated temporary
  `JOB_BROWSER_SMOKE_USER_DATA` and `JOB_BROWSER_DB_PATH` values. Any
  additional installed-app launch must explicitly set both paths to an
  isolated temporary root before the executable starts.
- Never open, hash, copy, migrate, or modify
  `%APPDATA%\Job Browser\data\jobs.sqlite` or other user databases.
- Never run external-provider discovery. Onboarding completion automation
  must use a local synthetic fixture/coordinator and prove its invocation
  count without network access.
- Do not attempt authentication, CAPTCHA, rate-limit, or other security-control
  bypass. No notification may be enabled or emitted.
- Remove disposable data after validation; record its root and cleanup result
  without recording personal file contents.

## Automated acceptance

### Source and release gates

- `npm run legal:notices`, then `npm run legal:check`.
- Confirm application-owned version fields are `1.1.6`; preserve the approved
  `package.json#author` and `UNLICENSED` license; do not change transitive
  dependency versions.
- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run verify`,
  `npm run privacy:check`, and `npm run nlp:security-audit`.
- Focused onboarding tests cover status boundaries, profile-scoped completion
  serialization, explicit edit authorization, navigation persistence/resume,
  Save and leave, discard, bounded errors, and search-only retry.
- `npm run desktop:lifecycle-harness` passes with no live discovery.
- `electron-builder.yml` still includes `LICENSE.txt`, `EULA.txt`, and
  `THIRD_PARTY_NOTICES.md`; NSIS remains assisted (`oneClick: false`) and sets
  `license: EULA.txt`.
- Notification silence remains proven by `NotificationManager.tsx` and the
  desktop main-process permission handlers.

### Current-source installer and isolated app checks

- Build a new NSIS installer from the release commit with
  `npm run desktop:package`; record installer path, byte size, SHA-256, and
  packaged `app.asar` size/SHA-256.
- Inspect `app.asar` for the three legal files, `package.json` author and
  `UNLICENSED` metadata, MR1-06 onboarding source, `df829b9` profile-scoped
  completion guard, notification policy, and retained P36/P37 markers.
- Run `npm run desktop:smoke:packaged` and
  `npm run desktop:smoke:packaged -- --upgrade`.
- Install the candidate silently into the test installation and require exit
  code 0. Run `npm run desktop:smoke:installed` and
  `npm run desktop:smoke:installed -- --upgrade` against isolated temporary
  user data.
- Confirm installed ProductVersion `1.1.6.0`, FileVersion `1.1.6`, and exact
  byte/hash equality between packaged and installed `app.asar`.
- Add/run a packaged onboarding integration smoke with synthetic local data
  that verifies first-run entry, persisted navigation, close/reopen resume,
  Save and leave, synthetic completion exactly once, refusal of a second
  completion without explicit edit, authorized edit/discard preserving prior
  completion, safe discovery failure + search-only retry, and distinct
  malformed/unsupported/storage-failure handling. Assert no paths, credentials,
  secrets, secret-bearing URLs, or raw diagnostics appear in rendered/API text.
- After all desktop checks, confirm no Job Browser, Electron, Playwright,
  installer, or helper process remains; port 6783 is free; the test paths all
  resolve inside the disposable root; and no production database path was
  configured or accessed.

## Manual acceptance — must be directly observed

Pause only after the final 1.1.6 installer is built, installed, and all
automated checks pass. With the candidate ready, request observations for:

1. Assisted installer displays the Job Browser EULA and requires acceptance.
2. Normal desktop layout is usable; narrow-window layout has no inaccessible
   controls; Windows 200% scaling remains usable.
3. Keyboard navigation and visible focus work throughout onboarding.
4. Error/status text is readable and not clipped.
5. Tray icon, menu, and focus behavior remain correct.
6. Close/reopen, Save and leave, resume, edit, and discard behave as expected.
7. No unexpected notification sound or OS notification occurs.

Run the installed app with the disposable user-data/database environment; do not
open production data during manual review. Record each result as observed,
failed, or not performed. Do not infer a manual pass from automated tests.

## Rollback and failure handling

- Preserve the current 1.1.5 installer and source history; never overwrite it
  with an artifact described as 1.1.6.
- If any source or manual check fails, keep the candidate unpublished, fix only
  the demonstrated defect, add regression coverage, rebuild the installer, and
  rerun every artifact-dependent check plus any failed manual observation.
- Retain disposable test roots until smoke diagnostics are captured, then remove
  them. If an installed candidate must be removed, preserve application data;
  no validation step may delete user data.
- Do not push or mark MR1-07 Done until every automated and manual acceptance
  item is resolved.

## Owned files

- `docs/delivery/tasks/MR1-07-installed-onboarding-validation.md`
- `docs/JOB_BROWSER_DELIVERY_BOARD.md`, `SESSION_HANDOFF.md`,
  `docs/PROJECT_MEMORY.md`, `docs/CHANGELOG.md`, and applicable release tracker.
- `package.json` and root application version entries in `package-lock.json`.
- Only if acceptance uncovers a defect: the relevant onboarding source/tests,
  desktop smoke/lifecycle/package scripts, or installer configuration.
- The mandatory legal files and EULA packaging configuration are verified;
  do not rewrite them without a discovered defect and explicit scope need.

## Evidence required for Done

- Final commit IDs and proof local `main` equals pushed `origin/main`.
- Version and full `npm run verify`, privacy, NLP security, legal, focused
  onboarding, lifecycle, packaged/installed/seeded-upgrade smoke results.
- Installer and packaged/installed `app.asar` byte sizes and SHA-256 hashes;
  executable ProductVersion/FileVersion; legal-file/package metadata and P36/P37
  marker inspection; installed/package `app.asar` equality.
- EULA acceptance observation, each visual/accessibility/interaction result,
  notification check, no-orphan/port result, disposable-data cleanup, and
  production-data isolation evidence.
- Release documentation identifies 1.1.6 as shipped only after the push and
  post-push checks pass. MR3-01 remains the next user-prioritized future task.
