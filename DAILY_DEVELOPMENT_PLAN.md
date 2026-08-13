# Daily Development Plan

## Current Work

Phase 7 provider expansion and release closure are complete. Milestone 8.1
(Durability and Recovery Foundation), Milestone 8.2 (Application Event
Foundation), and Milestone 8.3 (Application Management Workflow) are complete
and Architect-approved. Milestone 8.4 (ResumeSnapshots) implementation and its
completion gate are complete in the current worktree as of 2026-08-10; final
Architect acceptance is being requested. Phase 8 is not complete.

## Milestone 8.4 Completion Status

- Complete: unreleased migration `018_resume_snapshots.sql` adds
  `resume_snapshots`, the versioned capture-time
  `resume_snapshot_interpretations`, interpretation-scoped Skill/Certification
  relationships, a unique reuse identity, optional
  `submitted_resume_snapshot_id` on `applications` and `application_history`,
  and SQLite immutability plus resume-associated-Applied triggers. No historical
  Application or event is backfilled.
- Complete: `ResumeSnapshotRepository` persistence and `findReusable()` reuse
  lookup in `src/repositories/resume-snapshot-repository.ts`.
- Complete: capture orchestration (`src/resumes/resumeSnapshotCapture.ts`) with
  staged exact bytes, content hashing/sizing, opaque snapshot storage keys,
  capture-time interpretation construction, catalog qualification resolution,
  and identical-capture deduplication; synchronous snapshot storage
  (`src/resumes/snapshotStorage.ts`) confined to the snapshot root.
- Complete: reconciliation (`src/resumes/reconcileSnapshots.ts`) reporting
  artifact health, missing/corrupt detection, orphaned-artifact quarantine, and
  preservation of corrupt-but-referenced snapshots.
- Complete: `resumeId` (`.nullish()`) accepted by `POST /api/applications` and
  replacement events, snapshot inserted in the same transaction as the event and
  Application projection, `submitted_resume_snapshot_id` projected through
  `ApplicationService`/`ApplicationRepository`, and `GET /api/resume-snapshots`
  plus `GET /api/resume-snapshots/:snapshotId` endpoints.
- Complete: desktop `snapshotDirectory` wiring and a smoke
  `asserting-resume-snapshots` stage requiring healthy reconciliation and exactly
  one persisted storage key.
- Complete: migration, repository, capture, storage, reconciliation, and
  Application-snapshot integration tests pass in the final full suite: 74 files
  and 541 tests.
- Verification: `npm run lint`, `npm run typecheck`, `npm test` (74 files, 541
  tests), `npm run build`, and `npm run desktop:smoke` (twice, idempotent)
  all passed.
- Not rerun in this milestone: unpacked build, packaged smoke, installer build,
  silent install, and installed smoke; the Milestone 8.3 installer
  `release/Job-Browser-Setup-1.0.13.exe` remains the current release artifact.
- Deferred: coordinated backup/restore over the full persistence set, Company
  Identity, outcome analytics, integrated Phase 8 release certification,
  reapplications, reminders/followups, archive/delete/purge, sync, users, and
  predictions. Milestones 8.5 and later have not started and require explicit
  approval and a separate task.

## Milestone 8.3 Status

- Complete: binding Stage 0 decisions and the validated Application service,
  repository, schemas/models, REST boundary, and UI workflow.
- Complete: migration `016_application_event_foundation.sql` remains untouched.
  New migration `017_application_management_indexes.sql` replaces the exact
  list, status, Company, and timeline query indexes and adds copied-context/
  identity immutability plus user-event metadata-definition triggers. No
  parallel aggregate, ledger, or projection was introduced.
- Complete: exactly six REST endpoints provide list, detail, timeline,
  Applied-only creation, one lifecycle/Note/replace/Void event union, and summary
  notes with stable bounded `400`, `404`, and `409` errors. No IPC was added.
- Complete: retry-safe opaque Event ID/canonical-payload handling, Applied-only
  creation, and append plus canonical reproject plus post-fold Job compatibility
  run in one transaction. Summary notes do not synchronize Jobs; a Legacy State
  Imported winner does not auto-map.
- Complete: `/applications` status/Company filtering and opaque pagination,
  `/applications/:applicationId` copied context, notes, and complete
  correction-aware timeline, Applied confirmation, accessible dialogs, exact/
  date-only occurrence entry, and existing external-link/dashboard/Job
  compatibility boundaries.
- Complete: repository, migration, service, API, Job compatibility,
  UI/accessibility, dashboard, and smoke coverage pass in the final full suite:
  69 files and 500 tests. Independent backend and frontend audits both reported
  `No actionable findings.`
- Verification: touched source/test formatting and `git diff --check` passed
  with existing line-ending warnings only. `npm run verify` was executed but
  stopped at `format:check` because 69 pre-existing unrelated files are not
  Prettier-clean; the wrapper did not pass. Separate full lint, typecheck, test,
  build, development smoke (including isolated real Application POST/list/
  detail), unpacked build, packaged smoke, package, silent install (exit code 0),
  shortcut checks, and installed smoke all passed.
- Installer: `release/Job-Browser-Setup-1.0.13.exe`, 249,701,832 bytes, SHA-256
  `7285184A5A510F80F25501B58FEB465298C5108B09D9E58D76A904CBDADC011B`.
  Unpacked executable: `release/win-unpacked/Job Browser.exe`.
- Deferred: coordinated backup/restore over the full persistence set, Company
  Identity, outcome analytics, integrated Phase 8 release certification,
  reapplications, reminders/followups, archive/delete/purge, sync, users, and
  predictions. Milestones 8.5 and later have not started and require explicit
  approval and a separate task.

## Milestone 8.2 Status

- Complete: unreleased migration `016_application_event_foundation.sql`
  reconciles aggregate-only, history-only, divergent, imprecise-date, generic
  Interview, note-only, and source-less legacy records without replacing the
  existing Application aggregate or event ledger.
- Complete: migration and repository rebuilds share the
  `application_effective_events` view. Superseded ancestors and terminal voids
  are excluded, terminal replacements remain effective, and recorded activity
  still includes the complete audit ledger.
- Complete: SQLite enforces event append-only behavior, same-Application prior
  targets, no self-reference, linear direct supersession, normalized
  recorded-time order when supportable, and retention of at least one effective
  status-bearing event.
- Complete: dedicated Application repository and populated-upgrade tests cover
  projection equivalence, every approved legacy class, correction chains,
  immutable events, and unchanged `jobs.status` compatibility.
- Complete: strict typecheck, ESLint, 66 test files and 439 tests, production
  build, development smoke, unpacked build, packaged smoke, NSIS installer,
  silent install, shortcut verification, and installed-app smoke all pass.
- Delivered by Milestone 8.3 on 2026-08-09: validated lifecycle/correction
  commands, API/UI behavior, and retry idempotency.
  ResumeSnapshot capture/evidence folds were delivered by Milestone 8.4 on
  2026-08-10.

## Milestone 8.1 Status

- Complete: SQLite no longer deletes WAL/SHM sidecars as startup cleanup; a
  coherent set is recovered normally by SQLite.
- Complete: Integrity checks run against a shadow copy before pre-migration
  backup or migration, so SQLite-sidecar rebuilds cannot corrupt live evidence.
- Complete: Pre-migration SQLite backup preserved (until Milestone 8.5 replaces
  it with the expanded persistence-set workflow).
- Complete: Incoherent/corrupt database sets are quarantined into a timestamped
  incident directory with metadata; originals are never deleted or replaced;
  the desktop surfaces bounded recovery actions.
- Complete: 64 test files and 428 tests pass, including abnormal-shutdown WAL
  recovery, corrupt-set quarantine, orphaned-sidecar quarantine, backend
  lifecycle, and desktop startup tests.
- Complete: strict typecheck, ESLint, production build, development smoke,
  unpacked build, packaged smoke, NSIS installer, silent install, shortcut
  verification, and installed-app smoke all pass.

## iCIMS & Diagnostics Status

- Complete: Fixed Jibe/iCIMS vanity domain detection by increasing `detectAts` maxBytes size limit to 2MB.
- Complete: Added robust Jibe/iCIMS detection signals: `set-cookie` header `jasession` check and `jibe` HTML body text check.
- Complete: Implemented legacy iCIMS portal classification (failureCategory: `legacy_portal`, supportState: `detected-but-unsupported`) by executing a lightweight `/api/jobs?limit=1` probe check (mocked/bypassed in test environment).
- Complete: Added structured diagnostic fields to backend `detectAts` and UI (`requestedUrl`, `normalizedUrl`, `finalUrl`, `httpStatus`, `providersChecked`, `positiveSignals`, `negativeProbes`, `failureCategory`).
- Complete: Updated `SourceEditor.tsx` UI to dynamically display state-specific status headers and error text based on `failureCategory`.
- Complete: Removed all user-facing and runtime references to the old seeded default hospital example from seeded sources, placeholders, and test cases, replacing them with neutral placeholders.
- Complete: Format, lint, strict TypeScript, and full verification test suite passing after synchronizing the Remote OK fixture with its existing expectations.
- Complete: Production build and Electron desktop smoke tests verified successfully.
- Complete: Added Built In, Wellfound, and ZipRecruiter with fixture coverage and packaged provider-load checks.
- No provider, browser-automation, or other Phase 8 milestone expansion was
  started as part of Milestone 8.2.
- Blocked: legacy iCIMS portals without `/api/jobs`; supporting them would require brittle HTML/internal-interface parsing outside the approved connector.

## Implementation

- Provider ID/type: `icims` / `ats`.
- Configuration: required HTTPS `portalUrl`, optional `company`.
- Endpoint: `GET {portalOrigin}/api/jobs?limit=50&page=N`.
- Bounds: 10 pages, 50 records per page, 500 records maximum.
- Validation: rejects malformed/HTTP/userinfo URLs, incompatible JSON feeds, unavailable endpoints, and rate limiting; accepts valid empty `jobs` arrays.
- Schema support: wrapped `data` records, string/numeric IDs, string/object categories, nested/direct canonical URLs, partial optional fields.
- Deduplication: requisition ID, slug, canonical URL, then apply URL within a fetch; repository handles persisted source/cross-source identity.
- Normalization: title, employer fallback, department, location, workplace type, employment type, posted date, canonical URL, application URL, description, and qualifications.
- Salary: null because the verified public feeds provide no structured salary fields.
- Details: no detail request is needed; verified listing records include description and links.
- Rate limiting: shared HTTP client retries 429/502/503/504 at most twice and caps `Retry-After` at five seconds.

## Historical iCIMS Verification

- Focused: 4 files, 27 tests passed.
- Full: 48 files, 311 tests passed.
- Live Costco: valid, 2 requested records, 0 rejected.
- Live PepsiCo: valid, 2 requested records, 0 rejected.
- Production build: passed.
- Development and packaged Electron smoke: passed.
- Installer: generated and silently installed.
- Installed executable smoke: passed.
- Installer size: 125,733,944 bytes.
- Installer SHA-256: `E5484F4C4591440ECA58B508000CDAB9FECD06152EE7D32D0B26304FD4764022`.

## Known Limitations

- The connector supports modern `/api/jobs` portals, not every historical iCIMS deployment.
- A detected hosted iCIMS URL can still fail source validation if that tenant lacks `/api/jobs`.
- Vanity domains require confirmation of the portal origin.
- Remote/hybrid classification is best-effort from explicit fields and public labels.
- No structured salary is available from the verified public endpoint.

## Next Task

Request final Architect acceptance for the completed Milestone 8.4 gate. Do not
begin Milestone 8.5 or later Phase 8 work, another provider, browser automation,
authenticated APIs, CAPTCHA handling, or anti-bot workarounds without a separate
explicit approval and task.
