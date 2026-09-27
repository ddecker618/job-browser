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
  fresh-install preference initialization when the unified document is absent,
  invalid-progress precedence during a resumable edit, Save and leave, discard,
  bounded errors, and search-only retry.
- `npm run desktop:lifecycle-harness` passes with no live discovery.
- `electron-builder.yml` still includes `LICENSE.txt`, `EULA.txt`, and
  `THIRD_PARTY_NOTICES.md`; NSIS remains assisted (`oneClick: false`) and sets
  `license: EULA.txt`. The Finish page must not auto-launch Job Browser;
  `runAfterFinish` is disabled for the isolated acceptance/install workflow.
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
  user data. Interactive Finish must leave app startup to the explicit
  disposable-environment launch, never start the app itself.
- Confirm installed ProductVersion `1.1.6.0`, FileVersion `1.1.6`, and exact
  byte/hash equality between packaged and installed `app.asar`.
- Add/run a packaged onboarding integration smoke with synthetic local data
  that verifies first-run entry, persisted navigation, close/reopen resume,
  Save and leave, a synthetic coordinator invocation exactly once, refusal of a
  second completion without explicit edit, authorized edit/discard preserving
  prior completion, safe discovery failure + search-only retry, and distinct
  malformed/unsupported handling. The injected-store onboarding API tests must
  verify storage-failure remains distinct and non-destructive. Assert no paths,
  credentials, secrets, secret-bearing URLs, or raw diagnostics appear in
  rendered/API text.
- After all desktop checks, confirm no Job Browser, Electron, Playwright,
  installer, or helper process remains; port 6783 is free; the test paths all
  resolve inside the disposable root; and no production database path was
  configured or accessed.

## Retired 1.1.6 candidate checkpoint — manual acceptance failed

Prepared on the committed source checkpoint `f13b44a` (target package 1.1.6):

- Current-source NSIS installer:
  `release\Job-Browser-Setup-1.1.6.exe`, 253,700,613 bytes,
  SHA-256 `D83E8C6BB798D6A23DAB27F697B2FBA5528B89EFE05D9354CCA9A0FA1065863C`.
- Packaged `app.asar`: 74,757,242 bytes, SHA-256
  `EA539574B0E67E4C1936E58D4F2119835DE790849C20907F46BEF4C7A0D816A5`.
- Silent upgrade from installed 1.1.5 to 1.1.6 completed with exit code 0;
  installed ProductVersion `1.1.6.0`, FileVersion `1.1.6`.
- Installed `app.asar` matches the packaged copy byte-for-byte:
  74,757,242 bytes, SHA-256
  `EA539574B0E67E4C1936E58D4F2119835DE790849C20907F46BEF4C7A0D816A5`.
- Asar inspection confirmed `LICENSE.txt`, `EULA.txt`,
  `THIRD_PARTY_NOTICES.md`, package author/version/`UNLICENSED`, MR1-06 and
  `df829b9` completion-guard code, notification-denial code, and required P36/P37
  markers.
- `npm run verify`: **1828/1828 tests** across 180 files; focused onboarding
  suites: **222/222** across 8 files; privacy **12/12**; NLP security **3/3**;
  `npm run legal:notices` generated notices for 168 production packages;
  legal notices current; format, lint, and typecheck passed.
- Packaged smoke, packaged seeded-upgrade, packaged onboarding save/reopen
  smoke, installed smoke, installed seeded-upgrade, and installed onboarding
  save/reopen smoke all passed. Lifecycle harness: **11/11 passed** on the final
  run. No Job Browser/Electron/Playwright/installer process remained and port
  6783 was free after validation.
- Assisted-installer EULA presentation/required acceptance: **PASS** for this
  candidate. All other manual acceptance remains pending, and this candidate is
  **FAILED** because the initial onboarding status screen showed an unavailable
  error even though a later `GET /api/onboarding/status` returned the valid
  stored v2 snapshot at Preferences > Location; Retry recovered immediately.
- The same run violated isolation: the acceptance log records a real Built In
  run with `fixtureOnly: false`, 50 jobs found, and 22 inserted into the
  disposable DB. The run has been stopped. This build is retired for acceptance;
  do not call it isolated, accepted, ready, released, or push it.
- The earlier default-data app launch was observed with Electron child
  `--user-data-dir` under the normal `%APPDATA%\Job Browser` root, but no
  contemporaneous database path/hash was recorded. The repository's historical
  2026-09-14 production DB hash (`2E4BC539…E197B07`, 493,121,536 bytes) is not a
  trustworthy baseline for 2026-09-27. No production DB read/hash was performed
  after the report, in keeping with the no-access boundary. Production
  non-modification cannot be proven without a contemporaneous pre-run baseline.

## Corrected source checkpoints — `20e3e35`, `9a9ff8b`, `1ba2b3e`

- Manual acceptance now fails closed unless the real user-data root is under
  the OS temporary directory and the database is under that root, including
  canonical-path/symlink checks. Startup refuses the mode without the explicit
  synthetic coordinator.
- Manual mode does not construct the real `DiscoveryCoordinator`, hard-disables
  scheduler construction, routes completion/retry/general discovery actions
  through a synthetic coordinator, and exposes a manual-mode status assertion.
  Provider HTTP and Playwright launch entry points independently block any
  external access and count blocked attempts.
- The clean-root unpackaged smoke injects a cancellation of the initial local
  onboarding-status request. Bounded client retry recovers the saved point; a
  structured, path-free diagnostic is captured in the desktop log. A separate
  API regression covers one safe `onboarding_status_not_ready` 503. Malformed,
  unsupported-version, and storage-failure blocked-state behavior remains
  distinct and non-destructive.
- `npm run verify` passes **1837/1837** across 181 files; focused onboarding
  suites **224/224** across 8 files; privacy **12/12**; NLP security **3/3**;
  format/lint/typecheck/legal gates pass. The lifecycle harness passes **11/11**
  on the corrected source. Focused path/network/status tests pass.
- The complete unpackaged two-process onboarding smoke injects exactly one
  canceled first status request, verifies the bounded retry and safe diagnostic,
  and completes with zero external provider attempts. `runAfterFinish: false`
  prevents installer Finish from launching the app.
- `9a9ff8b` records bounded, privacy-safe initial-status diagnostics in the
  desktop log; the clean-root smoke verifies the transient failure/recovery
  record contains only the safe event, kind, status, code, and attempt count.
- The corrected source is packaged below as a new candidate. The prior `f13b44a`
  artifact remains retired; only the current candidate's evidence below is
  relevant to renewed manual acceptance.

## Corrected installed candidate checkpoint — superseded artifact

Built from current commit `bfea12e` after the corrected source and documentation
checkpoint:

- Installer `release\Job-Browser-Setup-1.1.6.exe`: **253,702,793 bytes**,
  SHA-256 `103F66681E0C637EE5DE405A420535E062408E3EDDFAD7CA1AFAD7766C7F1D32`.
- Packaged and installed `app.asar`: **74,771,085 bytes** each, SHA-256
  `3AD8EA6FF88AF9845073A28C4343B9EEF0A9554E2D653220E9C922ABBF7301F9`;
  hashes match exactly.
- Silent installation exit code **0**; installed ProductVersion `1.1.6.0`,
  FileVersion `1.1.6`. Installer configuration is assisted NSIS with the EULA
  page, `license: EULA.txt`, and `runAfterFinish: false`.
- Current asar inspection confirms the legal files and metadata; MR1-06/profile
  completion guard; manual-mode synthetic coordinator, disabled scheduler,
  disposable-path guard, provider HTTP/Playwright network interlocks, bounded
  status diagnostic; and required P36/P37 markers.
- Corrected-candidate packaged, installed, seeded-upgrade, and two-process
  onboarding smokes pass. The onboarding smoke confirms synthetic coordination,
  zero provider network attempts, and recovery after one canceled status request.
- This candidate is installed but has **not** received new human acceptance.
  Recheck the EULA on this build; then complete the manual checklist below.
  Release remains **Not shipped**, no push has occurred, and production DB
  non-modification cannot be claimed without a trustworthy pre-run baseline.

## Manually accepted candidate — final test-only rebuild pending

Rebuilt on 2026-09-27 after adding a manual-mode startup preflight that keeps
the window hidden until disposable-path and synthetic-mode checks succeed.
This artifact contains source now committed as `ec822e5`; the lifecycle mailbox
and timing-only test fixes (`fa35d17`, `c0bb7aa`) followed the manual review and
do not change normal-mode desktop or renderer behavior.

- Installer `release\Job-Browser-Setup-1.1.6.exe`: **253,702,892 bytes**,
  SHA-256 `22EFC10C2A6F962467255E2D369FCD9325C607EE1C2B0E022FEA01757B033AC0`.
- Packaged and installed `app.asar`: **74,771,503 bytes** each, SHA-256
  `6C29FC78A1E8CA88C8D510F93723903DDF3684B935509434FCCC58F619BFADFF`;
  hashes match exactly. Installed ProductVersion `1.1.6.0`, FileVersion
  `1.1.6`; silent installation exit code **0**.
- `app.asar` inspection confirms `LICENSE.txt`, `EULA.txt`,
  `THIRD_PARTY_NOTICES.md`, version `1.1.6`, package author metadata, license
  `UNLICENSED`, hidden-window/preflight/manual-mode code, notification policy,
  and P36/P37 markers. NSIS remains assisted with `license: EULA.txt` and
  `runAfterFinish: false`.
- `npm run verify`: **1837/1837** across 181 files; privacy **12/12**; NLP
  security **3/3**; lifecycle **11/11**; packaged/installed normal and seeded
  upgrade smokes pass; packaged/installed two-process onboarding save/resume
  smokes pass; legal notices current.
- After the manual review, final lifecycle reruns exposed a race in the
  test-only file mailbox (commands appended during read/truncate could be
  dropped). `src/desktop/lifecycleHarness.ts` and
  `scripts/lifecycle-harness.ts` now publish/consume one atomically renamed
  command file per request; the lifecycle harness passes **11/11** after the
  fix, committed as `fa35d17`; `npm run verify` remains **1837/1837**. No
  renderer or normal-mode desktop behavior changed after the recorded manual
  review.
- A separate full-suite run exposed a tight wait in
  `onboarding-preferences.test.tsx`: the simulated one-second save delay equaled
  Testing Library's default wait timeout. The assertion now allows a bounded
  additional second across all save-completion/failure assertions, committed as
  `c0bb7aa` and `9ebcbfb`; the focused test and full `npm run verify` pass
  **1837/1837**.
- Fresh interactive installer EULA appeared and required acceptance: **PASS**.
  `runAfterFinish: false` correctly left app startup to a direct installed-app
  launch. The first post-installer launcher did not start the app; it was then
  launched directly with acceptance mode enabled and both user-data/database
  paths rooted under `%TEMP%\job-browser-mr1-07-manual-acceptance-1.1.6`.
- Fresh human checks on this candidate, reported 2026-09-27: initial onboarding
  and status **PASS** without the unavailable-status error; normal layout,
  narrow-window layout, and Windows 200% scaling **PASS**; keyboard navigation
  and visible focus **PASS**; readable/unclipped status and error text **PASS**;
  tray icon/menu/focus **PASS**; close/reopen/resume **PASS**; Save and leave
  **PASS**; edit and discard **PASS**; no unexpected notification or sound
  **PASS**. The user's results are the source of this manual evidence; they are
  not inferred from automated tests.
- The acceptance log records `coordinator: "synthetic"`,
  `realCoordinatorConstructed: false`, and `schedulerEnabled: false`. Startup
  used the disposable OS-temp root. The user reports completion in this
  acceptance session; the separate earlier Built In run remains the documented
  isolation failure and production-baseline limitation.
- Manual checks apply to the **253,702,892-byte** candidate above. A final
  committed-tree rebuild after the lifecycle-harness and test-wait fixes remains
  necessary. MR1-07 remains **In progress**; 1.1.6 remains **Not
  shipped** and has not been pushed. The earlier default-data launch still has
  no trustworthy contemporaneous baseline, so production non-modification
  cannot be proven.

## Committed-source release artifact before final test correction — superseded

Built from committed source/documentation checkpoint `9261b4e` on 2026-09-27,
after the lifecycle-mailbox and test-wait fixes:

- Installer `release\Job-Browser-Setup-1.1.6.exe`: **253,702,963 bytes**,
  SHA-256 `9BAB688FB372081C62F7AAB1CFE639BC5973746F0A3FEA4B518EBEEA72A96BCF`.
- Packaged and installed `app.asar`: **74,771,969 bytes** each, SHA-256
  `6221093D23CD98EB645BA616BF09E38B1C0D5F8755AC9C2BE45D42385F9981A2`;
  hashes match. Installed ProductVersion `1.1.6.0`, FileVersion `1.1.6`;
  silent installation exit **0**.
- Asar inspection confirms all three legal files; version `1.1.6`, package
  author metadata, and `UNLICENSED`; manual-mode preflight and deferred-window
  safeguards; notification policy; and P36/P37 markers. `electron-builder.yml`
  remains assisted (`oneClick: false`), sets `license: EULA.txt`, and keeps
  `runAfterFinish: false`.
- Notice generation wrote notices for **168 production packages**;
  `npm run legal:check` passes. Final `npm run verify` passes **1837/1837**;
  privacy **12/12**; NLP security **3/3**; lifecycle harness **11/11**.
  Packaged and installed regular, seeded-upgrade, and onboarding save/resume
  smokes all pass.
- The user's fresh EULA acceptance and complete manual PASS set are recorded
  above against the deferred-window candidate (installer SHA-256
  `22EFC10C2A6F962467255E2D369FCD9325C607EE1C2B0E022FEA01757B033AC0`). The
  final rebuild adds only lifecycle-test transport and bounded test-wait
  corrections; normal renderer/desktop UI code and NSIS EULA configuration did
  not change afterward.
- Post-validation check: no Job Browser, Electron, installer, or Playwright
  process remained; port 6783 was free. The disposable manual-acceptance root
  under `%TEMP%` was removed. No production database was read or hashed during
  final cleanup; the earlier default-data launch still has no trustworthy
  baseline, so production non-modification cannot be proven.
- The bounded-wait-only test correction `9ebcbfb` was committed after this
  artifact. The final source and documentation checkpoints are being rebuilt
  now; this artifact is superseded for the current release gate.

## Manual acceptance — direct-observation record

The user directly exercised the manually accepted candidate and reported the
PASS results above. This checklist defines the observed scope; it is not a set
of inferred results:

1. Assisted installer displays the Job Browser EULA and requires acceptance.
2. Normal desktop layout is usable; narrow-window layout has no inaccessible
   controls; Windows 200% scaling remains usable.
3. Keyboard navigation and visible focus work throughout onboarding.
4. Error/status text is readable and not clipped.
5. Tray icon, menu, and focus behavior remain correct.
6. Close/reopen, Save and leave, resume, edit, and discard behave as expected.
7. No unexpected notification sound or OS notification occurs.

Run the installed app with `JOB_BROWSER_ONBOARDING_ACCEPTANCE_MODE=1`,
`JOB_BROWSER_SMOKE_USER_DATA=<temporary-root>`, and
`JOB_BROWSER_DB_PATH=<temporary-root>\data\jobs.sqlite`. The packaged app
fails closed unless both paths are under the operating-system temporary
directory, supplies a synthetic local coordinator, and disables its scheduler
in this mode. Do not open production data during manual review. Record each
result as observed, failed, or not performed. Do not infer a manual pass from
automated tests.

## Rollback and failure handling

- **Smoke correction note (2026-09-26):** An initial unpackaged onboarding
  smoke exposed a missing pass-through for its onboarding synthetic coordinator
  and made one Built In `/jobs` HTTP read before failing its assertion. It used
  only the disposable smoke user-data/database root. The follow-up
  `--onboarding` smoke used a synthetic adapter and passed, but it did not prove
  that manual mode could not use the general application coordinator; the later
  manual run exposed that gap. The incident and corrective actions must remain
  disclosed in release evidence.
- **Manual acceptance failure (2026-09-27):** The follow-on candidate showed
  “Onboarding is unavailable — Onboarding progress could not be loaded”; the
  user's Retry succeeded and restored the valid saved v2 snapshot, indicating
  a transient initial status/readiness failure rather than corrupt progress.
  The supplied acceptance log records backend startup at `03:11:27.218Z` and a
  real Built In discovery run beginning `03:13:30.944Z` (run
  `7f0ad386-5853-4761-92cc-720f76a9af35`, `fixtureOnly: false`), ending
  `03:13:42.677Z`: 50 jobs found, 22 inserted, 0 updated, 28 rejected. Query
  strings are intentionally omitted from distributed documentation. Acceptance
  was stopped. Fix both paths, rebuild, and repeat every artifact-dependent
  check and fresh human acceptance; the EULA PASS applies only to the retired
  candidate and must be rechecked.
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
