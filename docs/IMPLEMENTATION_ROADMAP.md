# Job Browser Implementation Roadmap

> **Document responsibility:** Record implementation sequencing, phase scope,
> dependencies, completion gates, and testing expectations. Product intent,
> architecture decisions, persistence schemas, and detailed feature behavior
> belong in their respective specifications.

## Current Phase

> **Section purpose:** State the active delivery phase and any gate that must be
> cleared before the next phase begins.

Phase 7 discovery and source-management work is complete. Phase 8 Milestones
8.1 through 8.8 are complete and Architect-approved; Phase 8 is complete as of
2026-08-12. Approved bounded provider validation may continue
independently; browser-backed providers remain opt-in and subject to site terms,
robots policies, login controls, and security checks.

Employer Discovery is an approved parallel workstream, not a later phase. It
became authorized to begin after final Architect approval of Milestone 8.3, and
its design and implementation may proceed alongside Milestones 8.4 through 8.8.
It does not block Phase 8, and Phase 8 does not depend on it; the workstream
boundaries remain independent. Employer Discovery 9.1 through 9.5 is complete
and Architect-approved as of 2026-08-12.

## Completed Phases

> **Section purpose:** Summarize verified completed phases without reproducing
> release history from the changelog. Phases 1 through 6 should be added in a
> later pass only after their scope can be reconstructed from authoritative
> project records.

### Phase 7: Completed Discovery System

> **Phase summary:** Preserve the completed discovery and provider-expansion
> scope that established the current product foundation.

#### Objective

> **Field purpose:** State the outcome this phase was intended to achieve.

Complete the discovery and source-management system before beginning
application, resume, company, or intelligence work.

#### Scope

> **Field purpose:** Define the work included in the phase at planning level.

Provider integrations, source management, bounded discovery, job
normalization, lifecycle handling, search, operational health, and desktop
release verification were included.

#### Dependencies

> **Field purpose:** Identify completed foundations or external approvals the
> phase relied on.

The phase depended on the existing Electron desktop foundation, local
persistence, provider contracts, fixture-based tests, and authorized access to
supported public or user-visible sources.

#### Required Work

> **Field purpose:** Summarize the work required to satisfy phase scope without
> duplicating detailed architecture or feature specifications.

- Complete the approved provider expansion through modern iCIMS/Jibe and the
  subsequently approved marketplace connectors.
- Route manual and scheduled discovery through the coordinated source workflow.
- Preserve source provenance, posting lifecycle, diagnostics, and normalized
  search behavior.
- Verify development, packaged, and installed desktop operation.

#### Completion Criteria

> **Field purpose:** State the evidence required before the phase can be marked
> complete.

The supported providers register and pass deterministic coverage, discovery
and source-management workflows are operational, and the release verification
record is captured in `CHANGELOG.md` and `SESSION_HANDOFF.md`.

#### Testing

> **Field purpose:** Identify the testing categories required for the phase.

Provider fixtures, discovery and repository regressions, migrations, API and UI
coverage, strict type checking, linting, production builds, and desktop smoke
tests were required. Exact historical results remain in the changelog and
session handoff.

#### Future Expansion

> **Field purpose:** Identify follow-up work without reopening completed scope.

Legacy follow-up ideas from this phase are retained under Future Phases for
triage. They are not part of the completed Phase 7 acceptance boundary.

## Upcoming Phases

> **Section purpose:** Describe approved or proposed next phases at a planning
> level. A listed phase is not implemented until its completion criteria are
> met.

### Phase 8: Application Intelligence

> **Phase summary:** Extend the existing application compatibility persistence
> into immutable event-derived tracking, preserve exact submitted Resumes, add
> conservative Company identity, and calculate local outcome evidence without
> speculative prediction or cache infrastructure.

#### Objective

> **Field purpose:** State the outcome this phase is expected to achieve.

Deliver reliable local application history and the evidence foundations needed
for transparent future guidance without overstating current or derived data.

#### Scope

> **Field purpose:** Define the planning areas included in the phase.

The approved first release includes:

- One event-derived Application per Job with a dedicated list, detail, timeline,
  corrections, copied context, and richer outcomes.
- Hybrid immutable ResumeSnapshots with capture-time qualifications.
- Coordinated backup and restore for SQLite and application-managed career-data
  files.
- Exact-normalized Company identity and auditable assignments.
- Installation-local, on-demand application outcome analytics.
- Preservation of current CandidateProfile authority, deterministic
  recommendations, `score_history`, and existing analytics semantics.

The first release explicitly excludes User/owner entities, authentication,
reapplications, FollowUps, Reminders, additional application materials, Company
alias or merge workflows, AnalyticsCache, snapshot reprocessing, generalized
recommendation history, predictions, purge behavior, sync, and cross-install
analytics.

#### Dependencies

> **Field purpose:** Identify prerequisites that must be resolved before work
> begins.

Phase 7 must remain stable in real use. `DATABASE_V2.md`,
`FEATURE_SPEC_APPLICATIONS.md`, and `FEATURE_SPEC_RESUMES.md` are the approved
architecture and behavior inputs. Each milestone must preserve the migration
head and pass its completion gate before work advances to a dependent milestone.

#### Milestone 8.1: Durability and Recovery Foundation

**Objective:** Establish a safe SQLite startup and migration boundary before new
historical facts are introduced.

**Required work:**

- Stop deleting WAL and shared-memory sidecars as startup cleanup.
- Let SQLite recover the coherent database set normally, then run integrity
  checks before pre-migration backup or migration.
- Preserve the current SQLite pre-migration backup until Milestone 8.5 replaces
  it with the expanded persistence-set workflow.
- Quarantine an incoherent set and surface bounded recovery actions instead of
  silently discarding recoverable state.

**Completion gate:** Abnormal-shutdown fixtures prove committed WAL data
survives startup; corrupt or incoherent sets are quarantined with visible
recovery actions; empty and populated migration-head databases still start and
back up correctly.

> **Status: COMPLETE; ARCHITECT APPROVED** — Verified 2026-08-08. Corrupt and
> incoherent sets are
> quarantined with preserved originals and bounded recovery actions through
> `src/db/database-recovery.ts`; integrity verification runs against a shadow
> copy so SQLite's WAL-index rebuild cannot mutate the live set; WAL-recovery
> tests, backend lifecycle tests, full Vitest suite (428 tests), strict
> typecheck, ESLint, production build, development and packaged Electron smoke
> tests, NSIS installer build, silent install, shortcut verification, and
> installed-app smoke all passed.

#### Milestone 8.2: Application Event Foundation

**Objective:** Migrate current application aggregates and Job-linked history into
the approved event-derived compatibility model without losing IDs or facts.

**Required work:**

- Extend `applications` and `application_history`; do not create competing
  aggregate or event tables.
- Reconcile aggregate-only, history-only, divergent, imprecise-date, generic
  Interview, note-only, and source-less records according to Database V2.
- Preserve one Application per Job and keep `jobs.status` as a coarse
  compatibility workflow.
- Replace accidental Job cascade behavior and enforce ordinary append-only event
  writes at repository and SQLite boundaries.
- Add only query-driven application and event indexes.

**Completion gate:** Populated-upgrade tests preserve every relevant legacy ID
and row, projection rebuild equals persisted state, direct event mutation fails,
and all current Job-status regressions pass.

> **Status: COMPLETE; ARCHITECT APPROVED** — Verified 2026-08-08. Unreleased
> migration `016_application_event_foundation.sql`
> reconciles every approved legacy class and defines one canonical
> effective-event view for migration and repository projection rebuilds.
> Correction chains are insert-only, same-Application, prior-target, linear, and
> protected against loss of the final effective status. Legacy Job-status writes
> append their compatibility event and run the same canonical projection fold
> before committing. Dedicated repository and populated-upgrade tests pass with
> the full suite (66 files, 439 tests), strict typecheck, ESLint, production
> build, development and packaged Electron smoke, NSIS installer build, silent
> install, shortcut verification, and installed-app smoke. This verification
> predates the Milestone 8.3 Stage 0 decision gate.

#### Milestone 8.3: Application Management Workflow

**Objective:** Deliver the approved list, detail, timeline, lifecycle, and
correction behavior over Milestone 8.2 persistence.

**Required work:**

- Add validated Application service and API operations with retry-safe creation.
- Implement Applied, recruiter-contact, interview-stage, offer, accepted,
  rejected, ghosted, withdrawn, Note, replacement, and void behavior.
- Capture minimal application-time Job, Company, location, URL, and source
  context.
- Add paginated list, current-state filters, detail, timeline, copied context,
  mutable summary notes, and visible correction state.
- Preserve the exact compatibility mapping between rich Application events and
  coarse Job status.

**Completion gate:** Feature-spec acceptance coverage passes for creation,
idempotency, permissive lifecycle events, backdated/date-only entry, corrections,
offline use, context preservation, and Job workflow compatibility.

> **Status: COMPLETE; ARCHITECT APPROVED** — Accepted 2026-08-10. The
> Applied-only retry-safe service, six REST endpoints, indexed list/detail/
> timeline reads, copied-context and correction-aware UI, canonical projection
> transaction, and Job compatibility behavior are implemented. Repository,
> migration, service, API, Job compatibility, UI/accessibility, dashboard, and
> smoke coverage pass in the final full suite (69 files, 500 tests). Independent
> backend and frontend audits both reported `No actionable findings.` Full lint,
> typecheck, build, and desktop verification passed; `npm run verify` itself
> stopped at `format:check` because 69 pre-existing unrelated files are not
> Prettier-clean.

> **Later milestone status:** Milestones 8.4 through 8.8 are complete and
> Architect-approved; Phase 8 is complete.

#### Milestone 8.4: ResumeSnapshot Capture

**Objective:** Preserve the exact Resume artifact and capture-time interpretation
associated with an Application.

**Required work:**

- Add hybrid ResumeSnapshot metadata, one capture-time interpretation, and
  queryable Skill and Certification relationships.
- Implement confined temporary-file, hash, atomic-rename, SQLite commit, and
  orphan-reconciliation behavior.
- Integrate optional snapshot selection with Applied and complete replacement
  events without consulting the default Resume.
- Preserve current Resume library, proposal, profile-preference, and re-score
  behavior.

**Completion gate:** Exact-byte, parser-failure, no-Resume, selected-file failure,
source Resume deletion, path-confinement, orphan, and migration-no-backfill tests
pass. Snapshot behavior remains unreleased until Milestone 8.5 completes.

**Status (2026-08-10):** Implemented and completion-gate verified. Migration
`018_resume_snapshots.sql`, `ResumeSnapshotRepository`,
`resumeSnapshotCapture`, synchronous snapshot storage, reconciliation, optional
`resumeId` on Applied/replacement commands, and `GET /api/resume-snapshots`
endpoints exist. Final suite: 74 files, 541 tests; lint, typecheck, build, and
`desktop:smoke` pass. Snapshot release remains blocked on Milestone 8.5
persistence-set backup/restore.

#### Milestone 8.5: Persistence-Set Backup and Restore

**Objective:** Make the external career-document boundary recoverable before
ResumeSnapshots can ship.

**Status:** Implementation and completion gate finished in the current worktree
on 2026-08-12. Final Architect acceptance is being requested. Phase 8 remains
incomplete.

**Required work:**

- Replace SQLite-only application backup with a verified manifest covering
  SQLite, current Resume files, ResumeSnapshot files, and authoritative
  CandidateProfile/scoring preference files.
- Serialize SQLite and every writer for manifest-covered Resume, snapshot, and
  preference files while establishing the backup boundary.
- Implement an explicit verified offline restore into current managed roots.
- Map current absolute Resume paths to portable manifest keys and rewrite them by
  Resume ID when restore targets a different managed root.
- Detect missing, corrupt, orphaned, temporary, and quarantined files without
  substituting mutable content.

**Completion gate:** Backup and restore round trips verify every manifest hash,
role, and owner across empty, populated, failed-parse, missing-file, interrupted,
concurrent-preference-write, and changed-root operations. Snapshot release is
blocked on this gate.

#### Milestone 8.6: Company Identity Foundation

**Objective:** Add safe local Company grouping for Application display and
analytics without corrupting source identity.

**Status: COMPLETE; ARCHITECT APPROVED** — Implemented and accepted on
2026-08-12 with migration `021_company_identity.sql`. Phase 8 remains
incomplete.

**Required work:**

- Add stable Company identity and auditable Job/Application assignments.
- Implement the versioned `company-exact-v1` normalization, generic-key
  exclusion, canonical-name selection, and conflict behavior.
- Preserve current Job Company text and copied Application-time Company text.
- Leave ambiguous records unlinked and provide no fuzzy matching, alias manager,
  or merge workflow.

**Completion gate:** Migration and ingestion fixtures prove deterministic exact
assignment, generic-key exclusion, canonical display selection, conflict
handling, no fuzzy merge, retained source text, assignment provenance, and an
explicit unknown Company bucket.

#### Milestone 8.7: Local Outcome Analytics

**Objective:** Calculate transparent local application evidence from retained
facts without new cache or prediction entities.

**Status: COMPLETE; ARCHITECT APPROVED** — Accepted 2026-08-12. Phase 8 remains
incomplete pending Milestone 8.8 acceptance.

**Required work:**

- Implement on-demand Application, Company, Skill, and Certification statistics
  with explicit scope, period, event definitions, numerator, denominator, sample
  size, unknown buckets, and definition version.
- Distinguish current outcome from ever reaching an outcome and exclude
  superseded or void events from effective calculations.
- Preserve existing `analytics`, `recommendations`, `score_history`, Job score
  projections, and CandidateProfile authority unchanged.
- Route every analysis entry point through the shared file-preference resolver
  so background and API calculations use the same current inputs.
- Add indexes only when representative query plans show they are needed; do not
  add AnalyticsCache, generalized recommendation history, or predictions.

**Completion gate:** Deterministic fixtures verify metric definitions,
corrections, time windows, unknown dimensions, small-sample disclosure, existing
intelligence regressions, and acceptable representative local query plans.

#### Milestone 8.8: Integrated Release Verification

**Objective:** Prove that Phase 8 is safe as one desktop release and close its
documentation and operational boundaries.

**Required work:**

- Run the full migration, repository, service, API, renderer, security,
  performance, backup/restore, and desktop regression suites.
- Verify first run, populated upgrade, abnormal shutdown, packaged application,
  installed application, offline workflows, and application-managed file
  locations.
- Confirm every deferred and future item remains absent from migrations, APIs,
  and UI.
- Update architecture, handoff, changelog, and user-facing documentation to
  implemented behavior and verification evidence.

**Completion gate:** All required checks pass, no migration or persistence-set
integrity issue remains, packaged and installed smoke tests succeed, and release
evidence is recorded in the changelog and session handoff.

**Status: COMPLETE; ARCHITECT APPROVED** — Accepted 2026-08-12. Integrated fixtures
prove offline populated backup/restore across changed managed roots while
preserving Company identity, Employer separation, ResumeSnapshot evidence, and
outcome analytics. Deferred schema/API/UI boundaries remain absent. The final
suite passed 85 files / 635 tests; lint, strict typecheck, production build,
development smoke, NSIS packaging, packaged smoke, silent install, shortcut
verification, and installed smoke passed for version 1.0.14.

#### Completion Criteria

> **Field purpose:** Define the evidence needed to declare the phase complete.

Phase 8 is complete only when Milestones 8.1 through 8.8 pass in order. A schema,
placeholder UI, or partially completed snapshot flow is not completion evidence.
No snapshot release may precede coordinated backup and restore, and no analytics
release may relabel calculated metrics as predictions.

#### Testing

> **Field purpose:** Identify required verification categories before delivery.

Each milestone defines its minimum gate. Across the phase, verification must
cover migration preservation, repository and service transactions, API
validation, user workflows, filesystem failure recovery, privacy boundaries,
query plans, full regressions, production build, and desktop smoke tests.

#### Future Expansion

> **Field purpose:** Note logical extensions that are explicitly outside this
> phase's first approved scope.

Reapplications, reminders, additional materials, Company alias/merge workflows,
snapshot reprocessing, purge, User ownership, synchronization, cross-install
analytics, outcome-based recommendations, confidence scores, and predictions
remain future work until separately approved.

### Parallel Workstream: Employer Discovery Platform

> **Workstream status:** Approved as an independent parallel workstream. Design
> and implementation became authorized after final Milestone 8.3 Architect
> approval and may proceed alongside Milestones 8.4 through 8.8. It must not
> block Phase 8, Phase 8 must not depend on it, and the workstream boundaries
> remain independent. A real Employer Registry / CareerSite / ATS-fingerprint
> vertical slice is implemented in the current worktree. Milestone 9.3 is
> Architect-approved; Milestone 9.4 is the accepted implementation baseline.
> Milestone 9.5 is completion-gate complete pending final acceptance.

Objective

Build a continuously maintained Employer Discovery Platform that discovers, verifies, fingerprints, monitors, and schedules employer career sites independently of provider implementations while preserving source provenance, deterministic behavior, and local-first operation.

Scope

The first release includes:

A persistent Employer Registry independent of individual job postings.
Discovery from approved seed sources and existing provider observations.
Automatic ATS fingerprinting with confidence and evidence.
Verified CareerSite records linked to Employers.
Discovery evidence, verification history, and health monitoring.
Intelligent scan scheduling based on confidence and historical success.
Automatic detection of ATS and career-site changes.
Provider-independent employer targeting for discovery workflows.

The first release explicitly excludes AI hiring predictions, employer ranking, fuzzy company matching, automatic company merges, crowd-sourced verification, cloud synchronization, distributed crawling, generalized web crawling, and speculative employer inference.

Dependencies

Final Milestone 8.3 Architect approval authorized this parallel workstream.

The workstream may proceed in parallel with Milestones 8.4 through 8.8.

The workstream does not block Phase 8, and Phase 8 does not depend on it.

Milestones 8.4 through 8.8 keep their existing numbering and dependencies.

Provider interfaces remain stable.

Discovery consumes providers but does not own provider implementations.

Employer identity remains independent of Company identity introduced in Phase 8.

Milestone 9.1 Employer Registry
Objective

Introduce a persistent Employer Registry representing organizations independently of discovered Jobs.

Required Work
Employer entity
CareerSite entity
Employer aliases
Employer metadata
Verification history
Health status
Discovery provenance
Registry APIs
Registry UI
Completion Gate

Employers remain stable across multiple discovery runs, duplicate employer creation is prevented, provenance is preserved, and registry operations pass deterministic repository and migration tests.

Milestone 9.2 ATS Fingerprinting
Objective

Automatically identify the applicant tracking system powering each CareerSite.

Required Work
Fingerprint framework
Detection rules
Evidence storage
Confidence model
Failure handling
Version tracking
Fingerprint regression tests
Completion Gate

Known ATS providers are identified with deterministic evidence and confidence while unknown sites remain explicitly unclassified.

Milestone 9.3 Discovery Engine
Objective

Continuously discover new employers and career sites without manual maintenance.

Status

**Status: COMPLETE; ARCHITECT APPROVED** — Accepted 2026-08-12. Eligible
CareerSites are fingerprinted,
mapped to existing providers, linked to idempotently created/reused Sources,
persisted with attempt/result/backoff state, and executed through the existing
DiscoveryCoordinator. The bounded provenance-bearing seed importer and
default-off lifecycle-owned six-hour scheduler complete the approved 9.3 scope.
Milestone 9.5 is complete and Architect-approved.

Required Work
Seed importer
Discovery scheduler
Discovery pipeline
Candidate validation
Duplicate detection
Retry handling
Failure backoff
Provenance preservation
Completion Gate

Discovery repeatedly identifies new employers without introducing duplicate registry records or invalid career sites.

Milestone 9.4 Employer Health
Objective

Maintain the operational health of every Employer and CareerSite.

Status

**Status: COMPLETE; ARCHITECT APPROVED** — Accepted 2026-08-12. Migration
`025_career_site_health.sql` adds
current health state and append-only verification history. Deterministic bounded
checks handle healthy, transient, broken, unsupported, redirect, ATS-change,
repair, retirement, scheduling, and overlap transitions. Existing Sources are
never deleted or destructively replaced. API, compact Employers health summary,
retained-history controls, focused regressions, and development, packaged, and
installed desktop smoke passed. Milestone 9.5 is complete and
Architect-approved.

Required Work
Health scoring
Verification history
ATS change detection
Redirect handling
Broken-link detection
Automatic repair workflow
Health dashboard
Completion Gate

Health transitions are deterministic and supported by retained evidence while preserving historical verification records.

Milestone 9.5 Discovery Intelligence
Objective

Use accumulated discovery evidence to improve scheduling, prioritization, and provider selection.

Status

**Status: COMPLETE; ARCHITECT APPROVED** — Accepted 2026-08-12. The versioned
`employer-discovery-intelligence-v1` on-demand read model derives deterministic
scheduling decisions, provider reliability, and Employer/CareerSite activity
from retained local CareerSite, verification, attempt, Source, run, and JobSource
evidence. It adds no migration or analytics cache. Safety gates for retirement,
broken health, backoff, unsupported paths, invalid/credential-required/disabled
Sources, and failed Source health override priority. Existing scheduler
ownership, default-off automation, no-startup-catch-up, single-flight execution,
and 25-site batches remain unchanged.

The policy uses explicit 6-hour high-priority, 24-hour normal/degraded, and
72-hour stable cadences. Priority is the bounded sum of inspectable activity,
ATS-confidence, provider-reliability, staleness, and health/failure components;
ordering uses eligibility, priority, next-eligible time, Employer name, and
CareerSite ID. Activity and provider metrics use a 30-day half-open UTC window.
Successful zero-result runs remain successes, interrupted runs are neutral, and
activity is unknown until a linked Source has succeeded.

Focused 9.5 and Employer/provider regressions passed at 11 files / 103 tests.
The full suite passed 87 files / 654 tests; strict typecheck, ESLint, production
build, development smoke, NSIS packaging, packaged smoke, silent install, and
installed smoke passed for version 1.0.14.

Required Work
Adaptive scheduling
Confidence-weighted scans
Discovery metrics
Provider success history
Employer activity metrics
Discovery dashboards
Completion Gate

Scheduling decisions become evidence-driven while remaining deterministic, explainable, and reproducible.

Completion Criteria

The Employer Discovery workstream is complete only when employer discovery, fingerprinting, registry management, health monitoring, and scheduling operate deterministically, preserve evidence and provenance, and require no manual intervention for supported discovery workflows.

Testing

Verification must cover:

Registry migrations
Duplicate detection
ATS fingerprint accuracy
Evidence preservation
Health transitions
Discovery scheduling
Retry behavior
Regression fixtures
Provider compatibility
Production build
Desktop smoke tests
Future Expansion

Future work may include:

AI-assisted employer prioritization
Hiring trend analysis
Employer relationship graphs
Distributed discovery
Collaborative verification
Cloud synchronization
External registry import/export
Automated employer categorization

## Future Phases

### Completed Reliability Work: Explicit Job Availability Lifecycle

**Boundary:** Extend the existing source-snapshot lifecycle and current-job
reads; do not delete Jobs, alter Application lifecycle, infer expiry from posting
age, or introduce another scheduler owner.

**Status: COMPLETE** — Migration `026_explicit_job_lifecycle.sql`, trusted
closing-date evidence, cross-source canonical reconciliation, bounded local
expiry checks, current/history Jobs UX, current-market query scoping, retained
historical detail, and deterministic lifecycle regressions are implemented. The
follow-on install-local database-path guard is also complete.

> **Section purpose:** Retain existing unscheduled engineering ideas without
> assigning release commitments or presenting them as approved features.

### Future Phase: Unscheduled Discovery and Platform Improvements

> **Phase summary:** Hold the prior short-, medium-, and long-term technical
> roadmap until each item is revalidated and assigned to an approved phase.

#### Objective

> **Field purpose:** Explain why this future workstream exists.

Continue improving discovery reliability, provider operability, and deployment
options after current product priorities justify the work.

#### Scope

> **Field purpose:** Bound the categories represented by the retained backlog.

The historical backlog covers provider validation, coordinator resilience,
source transparency, posting lifecycle, diagnostics, browser-profile options,
supported integration models, and possible deployment or notification modes.

#### Dependencies

> **Field purpose:** Record prerequisites for considering these items.

Every item requires current-behavior verification, product prioritization,
security and policy review, and an approved implementation phase.

#### Required Work

> **Field purpose:** Preserve the existing backlog for triage; these entries are
> not commitments and may already be resolved.

- Revalidate the historical Workable nullable-field issue, Dice login flow,
  Structured Data source, USAJOBS credentials UI, and packaged provider-load
  automation items.
- Reassess coordinator-level retry handling, source-contribution visibility,
  job expiry, source health presentation, and actionable provider errors.
- Evaluate multiple browser profiles, corporate proxy support, supported OAuth
  integrations, and a provider plug-in model.
- Reconsider separate web-server operation and email notifications only as
  independently approved product work.
- Revalidate the historical proposal for LLM-scored resume matching against the
  approved intelligence philosophy before treating it as an implementation
  requirement.

#### Completion Criteria

> **Field purpose:** Define how a future phase would be closed.

No completion criteria are assigned. A future planning pass must first remove
resolved items and convert approved work into a bounded phase.

#### Testing

> **Field purpose:** Reserve the verification expectations for approved future
> work.

Testing requirements must be defined per selected item and must retain the
project's deterministic, bounded, no-unapproved-live-request test boundary.

#### Future Expansion

> **Field purpose:** Prevent an unscheduled backlog from expanding implicitly.

Additional ideas should not be added here until they are supported by an
existing technical decision or explicit product approval.

## Planning Principles

> **Section purpose:** Preserve the existing delivery rules applied to every
> implementation phase.

1. Finish one feature completely.
2. Verify it with tests.
3. Update its documentation.
4. Do not begin the next feature until the current feature is production-ready.
