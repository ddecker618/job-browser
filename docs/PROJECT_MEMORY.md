# Job Browser Project Memory

## Purpose

This file is the primary entry point for AI assistants working on Job Browser.

Before proposing architectural changes, implementation plans, database changes, or new features, read this file and the authoritative documents referenced below.

## Authoritative Documents

Read in this order:

1. `SESSION_HANDOFF.md`
   - Recent implementation context and historical investigations
   - Volatile provider counts, migration head, and verification results must be
     checked against the repository and changelog
   - Phase planning in the handoff does not override the maintained roadmap,
     database decisions, or feature specifications

2. `JOB_BROWSER_PRD.md`
   - Product goals
   - Product behavior
   - Long-term vision

3. `IMPLEMENTATION_ROADMAP.md`
   - Development phases
   - Current and future work

4. `ARCHITECTURE.md`
   - System architecture
   - Component responsibilities
   - Runtime design

5. `DATABASE_V2.md`
   - Approved Phase 8 persistence architecture
   - Compatibility and migration rules
   - Deferred and future architecture decisions

6. `FEATURE_SPEC_APPLICATIONS.md`
   - Application tracking behavior

7. `FEATURE_SPEC_RESUMES.md`
   - Current Resume behavior and approved snapshot behavior

8. `FEATURE_SPEC_AI_ASSISTANT.md`
   - Intelligence and recommendation behavior

9. `CHANGELOG.md`
   - Historical implementation changes

## Current Development State

Phase 7 discovery and source-management work is complete.

Phase 8 Milestones 8.1 through 8.8 are complete and Architect-approved. Phase 8
is complete as of 2026-08-12. The independent Employer Discovery 9.1 through
9.5 workstream is also complete and Architect-approved. Migration head is
`026_explicit_job_lifecycle.sql`; version remains 1.0.14.

The current implementation additionally provides explicit non-destructive Job
availability lifecycle. Two complete source-snapshot misses remain required for
snapshot removal. Trusted date-only deadlines expire after the complete UTC
closing day; trusted exact deadlines expire at their supplied instant.
Canonical availability remains active while any source membership is active.
Current opportunity reads exclude inactive Jobs, while explicit history and Job
detail preserve Applications, events, ResumeSnapshots, Company identity,
observations, and provenance.

Current implementation already includes:

- Immutable ResumeSnapshots captured when an Applied event records a selected
  Resume: `resume_snapshots`, versioned capture-time
  `resume_snapshot_interpretations`, and interpretation-scoped Skill and
  Certification relationships from migration `018_resume_snapshots.sql`, with
  unique reuse identity and SQLite immutability triggers. Existing Applications
  and events remain NULL with no default/latest/current Resume inference.
- Capture orchestration (`src/resumes/resumeSnapshotCapture.ts`,
  `src/resumes/snapshotStorage.ts`) that verifies the selected Resume file,
  stages and hashes exact bytes, publishes to an opaque snapshot storage key,
  builds the capture-time interpretation, and deduplicates identical captures.
- Reconciliation (`src/resumes/reconcileSnapshots.ts`) that reports artifact
  health, flags missing/corrupt files, quarantines unreferenced artifacts, and
  preserves corrupt-but-referenced snapshots.
- `POST /api/applications` and replacement events accept optional `resumeId`
  (`.nullish()` in `src/schemas/application.ts`); the snapshot row is inserted
  in the same transaction as the event and Application projection, so an event
  is never recorded without its captured evidence. `GET /api/resume-snapshots`
  exposes health plus storage keys.
- The desktop wires `snapshotDirectory` and the desktop smoke validates a real
  Application creation with a captured snapshot, healthy reconciliation, and
  exactly one persisted storage key.
- Dedicated `/applications` and `/applications/:applicationId` workflows with
  status/Company filters, opaque cursor pagination, copied context, mutable
  summary notes, and a complete correction-aware timeline.
- Applied confirmation from the Jobs workflow and Job detail panel plus
  accessible lifecycle, Note, replacement, and Void workflows with exact or
  date-only occurrence entry.
- One validated `ApplicationService` and exactly six loopback REST endpoints for
  list, detail, timeline, Applied creation, a discriminated event union, and
  summary notes. Errors are stable bounded `400`, `404`, and `409`; no IPC was
  added.
- Retry-safe opaque Event IDs and canonical payloads, Applied-only creation, and
  one transaction for append, `ApplicationRepository.reproject()`, and post-fold
  Job compatibility. Notes do not synchronize Job state, and a Legacy State
  Imported winner does not auto-map.
- Untouched migration `016_application_event_foundation.sql` plus migration
  `017_application_management_indexes.sql`, which replaces the exact list,
  status, Company, and timeline query indexes and adds immutable copied-context/
  identity and user-event metadata-definition triggers. Existing
  `applications`, `application_history`, and `application_effective_events`
  remain canonical.
- Core Milestone 8.3 boundaries are `src/applications/applicationService.ts`,
  `src/repositories/application-repository.ts`,
  `src/repositories/job-repository.ts`, `src/server/app.ts`,
  `src/schemas/application.ts`, `src/models/application-management.ts`,
  `src/domain/application-history.ts`, `src/domain/application-status.ts`, and
  `src/utilities/timestamps.ts`.
- Final repository, migration, service, API, Job compatibility,
  UI/accessibility, dashboard, Application-snapshot, capture, storage,
  reconciliation, and smoke coverage passes at 74 files and 541 tests.
  Independent backend and frontend audits in the Milestone 8.3 gate both
  reported `No actionable findings.`
- A local Resume library with upload, parsing, rename, default, delete, re-score,
  and profile-proposal review. ResumeSnapshots now capture immutable
  application-time evidence from that library.
- Deterministic Job/CandidateProfile scoring, current `recommendations`, retained
  changed-score `score_history`, run-scoped analytics, and live dashboard
  queries. These are calculations, not outcome predictions.
- SQLite-only application-managed backup. Current Resume and preference files
  are not included in a coordinated backup or restore workflow.
- Normal SQLite WAL recovery, shadow-copy integrity verification, and preserved
  quarantine evidence from completed Milestone 8.1.

Approved first-release Phase 8 scope is:

- Event-derived, append-only Application history while preserving one
  Application per Job and coarse Job-status compatibility.
- Minimal copied application-time context and richer local outcomes.
- Hybrid immutable ResumeSnapshots and capture-time qualification
  interpretations.
- Coordinated manifest-based backup and restore for SQLite and authoritative
  application-managed career-data files.
- Exact-normalized Company identity with no fuzzy matching.
- Installation-local, on-demand outcome analytics with no AnalyticsCache.
- Continued file authority for editable CandidateProfile/scoring preferences and
  alignment of all analysis entry points to the shared resolver, while preserving
  current recommendation-history semantics.

Deferred or future architecture includes reapplications, FollowUps, Reminders,
additional materials, snapshot reprocessing, Company alias/merge workflows,
purge, physical User ownership, synchronization, cross-install analytics,
generalized recommendation history, confidence scores, and predictions.

Do not assume a Phase 8 feature is implemented merely because it is documented.

## Development Principles

- Preserve working functionality.
- Prefer extension over unnecessary rewrites.
- Do not remove existing providers without explicit approval.
- Maintain backward compatibility where practical.
- Keep user data local-first unless cloud functionality is explicitly approved.
- Treat existing migrations as immutable unless specifically directed otherwise.
- Do not bypass CAPTCHAs, login controls, anti-bot mechanisms, or site policies.
- Do not make major architectural changes merely because another design appears
  cleaner.
- Tests must pass before work is considered complete.
- Documentation should be updated when architecture or behavior materially
  changes.

## Important Distinction

Job Browser already records basic Application aggregate and history rows when a
user moves a Job into an application-related status. Phase 8 extends that
compatibility foundation; it does not introduce application persistence from
scratch.

Milestone 8.3 now delivers richer immutable event-derived tracking, copied
application-time context, dedicated Application workflows, and reliable local
outcome capture. Milestone 8.4 delivers immutable ResumeSnapshot evidence
captured when an Applied event records a selected Resume. Exact
ResumeSnapshots are now implemented; coordinated persistence-set recovery,
Company identity, and local evidence calculations remain later Phase 8 work. Do
not propose replacing the existing Applied path or tables unless an inspected
compatibility requirement makes extension unsafe.

## AI Working Rule

When information in memory conflicts with the current repository, the current
repository wins.

When documentation conflicts with implemented code, report the discrepancy
instead of silently choosing one.

When the requested task would contradict an explicit architectural decision,
stop and explain the conflict before changing it.

## Employer Discovery Platform

A dedicated Employer Discovery Platform will be developed as an approved
parallel workstream after Milestone 8.3.

The platform is intentionally separate from provider implementations.

Providers are responsible for retrieving Jobs.

The Employer Discovery Platform is responsible for determining which employers
should be discovered, verified, fingerprinted, monitored, scheduled, and
rescanned.

The subsystem preserves evidence, provenance, verification history, employer
health, ATS identification, and discovery confidence.

Implementation is governed by the authoritative design contained in
Discovery_Enigine_PROD.md. (An earlier draft referenced a nonexistent
EMPLOYER_DISCOVERY_PLATFORM.md; the actual repository spec is
Discovery_Enigine_PROD.md.)
