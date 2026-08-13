# Job Browser Database V2 Architecture Specification

## Current Migration Addendum: Explicit Job Availability

Migration `026_explicit_job_lifecycle.sql` adds lifecycle reasons to `jobs` and
`job_sources`, normalized current closing evidence to `job_sources`, and the same
evidence to immutable `job_observations`. Existing active rows are truthfully
active. Existing inactive causes and historical date authority remain unknown;
migration does not infer expiration from age or legacy canonical dates.

Availability remains independent of `jobs.status` Application compatibility and
the Application event projection. Applications, events, ResumeSnapshots,
Company assignments, observations, runs, and Employer Registry data remain
retained.

> **Authority:** This document is the authoritative persistence architecture for
> Phase 8 and later application-intelligence work. It defines conceptual
> entities, ownership, historical guarantees, compatibility boundaries, query
> expectations, and migration policy. It does not implement SQL or authorize a
> migration by itself.

> **Current-schema source of truth:** Checked-in migrations and current
> repository behavior remain authoritative for the implemented schema. This
> document is authoritative for how future persistence must extend that schema.
> Where an implementation differs from this future design, the discrepancy must
> be handled by an explicit migration and compatibility plan, not by silently
> reinterpreting existing data.

> **Implemented migration head (2026-08-12):**
> `026_explicit_job_lifecycle.sql`. Phase 8 Milestones 8.1 through 8.8 and
> Employer Discovery 9.1 through 9.5 are complete and Architect-approved.

Product behavior is owned by `JOB_BROWSER_PRD.md` and the feature
specifications. Delivery order is owned by `IMPLEMENTATION_ROADMAP.md`. Runtime
and component boundaries are owned by `ARCHITECTURE.md`. This specification
references those documents instead of duplicating their requirements.

Normative terms use the following meanings:

- **Must** indicates a required persistence invariant.
- **Should** indicates the default design unless measured evidence justifies an
  exception.
- **May** identifies a compatible extension, not an implementation commitment.

## Compatibility Baseline

Database V2 extends the migration-head schema; it does not replace it. The
following current entities constrain the design:

| Concept             | Current persistence                                                     | Database V2 treatment                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Jobs                | `jobs`, `job_sources`, `job_observations`, and related discovery tables | Preserve IDs, normalized listing data, provenance, lifecycle data, and existing search behavior.                                                       |
| Job workflow        | `jobs.status` and `job_status_history`                                  | Preserve as the current job-browsing workflow and compatibility projection. Do not merge it with application events.                                   |
| Applications        | `applications`, at most one row per Job                                 | Extend the existing aggregate. Preserve every existing application ID and job relationship.                                                            |
| Application history | `application_history`, linked to a job                                  | Evolve this table into the physical store for conceptual ApplicationEvents. Do not create a competing history without an approved reason.              |
| Resumes             | `resumes` plus files in the local resume directory                      | Extend existing metadata and file identities. Add snapshots separately; do not replace uploaded resume rows.                                           |
| Candidate profiles  | `candidate_profiles` plus local profile-preference files                | Preserve existing profile IDs and references. Treat profiles as installation-local analysis configurations, not as Users or resume snapshots.          |
| Companies           | Required company text and normalized company text on `jobs`             | Add a first-class Company identity while retaining the existing text fields for compatibility and historical display.                                  |
| Recommendations     | `recommendations` and `score_history`                                   | Preserve current deterministic scoring data. Future recommendation caching must extend or coexist without relabeling calculated scores as predictions. |
| Analytics           | `analytics` plus live dashboard queries                                 | Preserve current profile/run-scoped metrics. Application-outcome analytics is a separate derived domain.                                               |
| Search cache        | Optional runtime-managed FTS5 objects                                   | Continue treating FTS as disposable and rebuildable, never authoritative.                                                                              |

Existing migrations are immutable. In particular, future work must account for
legacy application IDs that may equal job IDs, application rows with null or
approximate applied dates, divergent `jobs.status` and `applications.status`,
history linked directly to jobs, resumes with no version lineage, and jobs that
may no longer have source associations.

At the Phase 8 baseline, ordinary SQL could update or delete
`application_history`, Job deletion cascaded to it, the application-managed
backup contained SQLite only with no coordinated restore for external files, and
database startup removed WAL/SHM sidecars before opening SQLite. Milestone 8.1
now preserves coherent sidecars and establishes the crash-recovery boundary;
Milestone 8.2 now enforces append-only ApplicationEvents and restrictive history
retention. Milestone 8.3 now provides the validated Application command boundary
and indexed list/detail/timeline reads without replacing `applications`,
`application_history`, or `application_effective_events`. Coordinated
persistence-set backup and restore remains Milestone 8.5 work.

## 1. Current Database Philosophy

### 1.1 Local-First Design

SQLite remains the authoritative store for structured Job Browser data except
for the existing editable CandidateProfile and scoring preference files retained
as an explicit compatibility boundary. Resume and future snapshot files remain
within application-managed local directories, with metadata and integrity
information in SQLite. No cloud account, remote database, or external analytics
service is required to use application history, resume history,
recommendations, or local analytics.

The local-first boundary means:

- A user must be able to read and update existing application history while
  offline.
- Previously discovered jobs and locally stored career documents must remain
  available when providers are unavailable.
- Network-derived data must retain provenance so it is distinguishable from
  user-entered facts.
- Future synchronization, if separately approved, must consume local records;
  it must not make a remote service the hidden source of truth.

### 1.2 Offline Operation

All authoritative Phase 8 writes must complete against local persistence. An
application event, resume snapshot, company association, or user note must not
depend on a provider request. Analytics derived from local facts should also be
available offline. Recommendations that require an unapproved external service
are outside the current persistence contract.

### 1.3 Extension Over Replacement

Future migrations must extend existing entities whenever their identity and
semantics remain useful:

- `jobs` remains the canonical discovered-job entity.
- `applications` remains the current application aggregate.
- `application_history` becomes the ApplicationEvent store through additive
  linkage and event vocabulary changes.
- `resumes` remains the uploaded-resume library.
- `candidate_profiles`, `recommendations`, `score_history`, and `analytics`
  retain their existing meanings.

Parallel replacement tables are prohibited unless an approved migration plan
shows that the existing entity cannot safely represent the required semantics.
Renaming for conceptual clarity is not, by itself, sufficient reason to replace
data.

### 1.4 Backward Compatibility

Backward compatibility applies to installed data, stable identities, and
current behavior:

- Existing IDs must be preserved exactly; code must not assume every text ID is
  a UUID.
- Existing application and status histories must survive unchanged.
- Existing application rows must remain associated with their current jobs.
- Existing resumes and storage paths must remain valid.
- Existing company strings on jobs must remain readable even after Company IDs
  are introduced.
- Existing discovery provenance must not be rewritten as part of Phase 8.
- Current job-status operations must continue working while richer application
  APIs are introduced.

Nullable transitional relationships are acceptable for legacy data when a
truthful value cannot be reconstructed. A migration must never manufacture a
resume snapshot, exact application URL, source, or event timestamp from current
state and present it as an observed historical fact.

### 1.5 Data Preservation

Database V2 distinguishes four persistence classes:

| Class                              | Examples                                                                                       | Rule                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Observed or user-recorded facts    | ApplicationEvents, immutable snapshot files and hashes, copied application-time source context | Preserve as history. Correct by adding explicit information, not by overwriting the original fact.                                               |
| Current projections                | Applications, Jobs, current Recommendations, current Company associations                      | May change transactionally, but must be reproducible from or traceable to authoritative inputs where specified.                                  |
| Retained derived history           | Snapshot interpretations, Company assignments, score history                                   | Preserve with input provenance and definition version even when current mutable inputs prevent exact reconstruction. It is not an observed fact. |
| Rebuildable derived or cached data | Statistics, analytics caches, current recommendation caches, FTS                               | May be invalidated and rebuilt. It must never be the only copy of an observed fact.                                                              |

Privacy deletion is distinct from routine mutation. Immutability means a retained
historical record is not silently edited. A coordinated Application or
installation-data purge requires a separately approved workflow and is not part
of the first Phase 8 release.

### 1.6 Immutable Historical Records

ApplicationEvents and ResumeSnapshots are immutable after successful creation.
The following rules apply:

- Corrections are represented by a complete replacement or Void event with
  explicit provenance; a Resume association is never edited in place.
- Derived projections may be recalculated without changing the underlying
  event or snapshot.
- Parser, normalizer, and metric versions must be recorded when their output is
  persisted.
- Historical records may not be updated merely because the current Job, Resume,
  Company, profile, or recommendation changes.
- Cascading deletion must not erase retained application history as an
  accidental side effect of deleting a provider source or mutable library item.

### 1.7 Privacy-First Storage

Resume content, profile data, application outcomes, notes, and event metadata
are sensitive user data. They remain local unless a separate privacy and product
decision explicitly authorizes transfer.

- Provider credentials remain outside SQLite under the existing encrypted
  credential boundary described in `ARCHITECTURE.md`.
- Resume snapshot files must remain in an application-managed local directory
  and must use the same path-confinement rules as current resumes.
- Anonymous analytics is not implied by creating local statistics entities.
- Cross-install or cohort analytics must not be stored, exported, or uploaded
  without an approved consent, anonymization, retention, and deletion design.
- Derived outputs containing resume or application data inherit the sensitivity
  of their inputs and must be covered by any future coordinated purge operation.

### 1.8 Migration Philosophy

Schema evolution remains forward-only and migration-based. Applied migration
files are immutable and checksum-protected. Each future migration must preserve
a database that contains any valid combination of legacy rows, including
partial histories and null values created by earlier releases.

Detailed versioning, ordering, rollback, and validation requirements appear in
Section 9.

### 1.9 Future Scalability

Future scalability means preserving clean identity and query boundaries, not
optimizing for an unapproved cloud service:

- Phase 8 remains explicitly single-install and single-user. Ownership is
  implicit at the installation boundary; no physical User entity or owner
  foreign keys are introduced.
- Jobs and Companies remain installation-level reference data. Existing
  user-specific fields on Jobs remain installation-global compatibility state.
- Event and snapshot identities are stable and portable.
- Versioned structured payloads allow parsers and metric definitions to evolve.
- Query-driven indexes support normal local use; caches are introduced only
  after measurement.
- No design assumes cross-user analytics, remote synchronization, or unlimited
  data volume.

### 1.10 Data Conventions

Future entities must follow current conventions unless a migration explicitly
documents an exception:

- Identifiers are opaque stable text values. UUIDs may be generated for new
  rows, but readers must not require UUID syntax.
- New V2 timestamps use UTC ISO-8601 text. Legacy timestamp text remains
  unchanged and receives a separate normalized sort value where conversion is
  unambiguous. Event occurrence time and record creation time are separate
  values.
- A date-only event uses a normalized UTC sort timestamp plus the canonical
  stored precision value `date`. In product wording, `date` means date-only
  precision. Approximate or unknown precision is retained explicitly; the
  normalized timestamp is never displayed as a more precise observation.
- Boolean values follow the existing checked integer convention.
- Enumerations must be constrained at the persistence boundary when doing so
  will not prevent forward-compatible event metadata.
- JSON payloads must identify their schema or definition version and must be
  validated before persistence.
- Frequently joined, filtered, grouped, or integrity-bearing values must be
  normalized into fields or relationships rather than hidden only in JSON.
- Human-readable source text and immutable snapshot values are retained when a
  normalized identity can change.

## 2. Entity Relationship Overview

### 2.1 Conceptual Entity Inventory

| Entity                       | Status                                      | Persistence responsibility                                                                                                           |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| User                         | Future architecture                         | No physical Phase 8 entity. A future multi-user or synchronization architecture must address all installation-global state together. |
| CandidateProfile             | Existing                                    | Mutable installation-local analysis configuration. Existing IDs and foreign-key references remain valid.                             |
| Resume                       | Existing                                    | Mutable library metadata for a locally stored uploaded file. It is a source from which snapshots may be created.                     |
| ResumeSnapshot               | Planned                                     | Immutable capture of the exact resume artifact and capture metadata used for one or more applications.                               |
| ResumeSnapshotInterpretation | Planned capture-time model                  | One immutable, versioned parser/normalizer output for the captured artifact. Additional post-capture interpretations are deferred.   |
| Skill                        | Existing                                    | Canonical skill identity. Existing job-skill relationships remain unchanged; snapshot-skill relationships are separate.              |
| Certification                | Existing                                    | Canonical certification identity. Existing job-certification relationships remain unchanged.                                         |
| Job                          | Existing                                    | Canonical discovered opportunity with source provenance and mutable current listing data.                                            |
| Company                      | Planned                                     | Stable canonical employer identity layered over existing job company strings.                                                        |
| CompanyAlias                 | Deferred                                    | Reviewed aliases and alias-management behavior are outside the first Phase 8 release.                                                |
| JobCompanyAssignment         | Planned with Company                        | Versioned or auditable resolution of a Job to a Company, including method and provenance.                                            |
| ApplicationCompanyAssignment | Planned with Company                        | Auditable exact resolution of an Application's canonical Company without changing company text captured at application time.         |
| Application                  | Existing, extended                          | Installation-local current projection for one application to a Job.                                                                  |
| ApplicationEvent             | Existing as `application_history`, extended | Immutable event stream that records application facts and derives lifecycle state.                                                   |
| JobStatusHistory             | Existing                                    | Audit of the broader job-browsing workflow. It remains separate from ApplicationEvents.                                              |
| FollowUp                     | Deferred                                    | Potential application-owned action record. It is outside the first Phase 8 release.                                                  |
| Reminder                     | Deferred                                    | Potential schedule/reminder record associated with a FollowUp or Application. It is outside the first Phase 8 release.               |
| ApplicationStatistics        | Phase 8 on-demand read model                | Counts, rates, and timing metrics computed from applications and events for a defined scope and period; no table is added.           |
| CompanyStatistics            | Phase 8 on-demand read model                | Company-dimension application metrics derived from Company, Application, and ApplicationEvent data; no table is added.               |
| SkillStatistics              | Phase 8 on-demand read model                | Outcome correlations using immutable ResumeSnapshot skill associations; no table is added.                                           |
| CertificationStatistics      | Phase 8 on-demand read model                | Outcome correlations using immutable ResumeSnapshot certification associations; no table is added.                                   |
| AnalyticsCache               | Deferred                                    | No Phase 8 table. Outcome analytics are calculated on demand until measured evidence justifies a cache.                              |
| RecommendationCache          | Existing compatibility concept              | Existing `recommendations` remains current calculated state; `score_history` remains retained calculated history.                    |

### 2.2 Relationship Diagram

```text
[Resume]          1 ---- produces ------- * [ResumeSnapshot]
[ResumeSnapshot]  1 ---- used by -------- * [Application]
[ResumeSnapshot]  1 ---- referenced by -- * [ApplicationEvent]
[ResumeSnapshot]  1 ---- captured as ---- 1 [ResumeSnapshotInterpretation]

[Job]             1 ---- referenced by -- * [Application]
[Company]         1 ---- associated with  * [Application]
[Application]     1 ---- records -------- * [ApplicationEvent]

[Company]         1 ---- may later have - * [CompanyAlias: deferred]
[Company]         1 ---- resolved by ---- * [JobCompanyAssignment]
[Job]             1 ---- resolved by ---- * [JobCompanyAssignment]
[Company]         1 ---- resolved by ---- * [ApplicationCompanyAssignment]
[Application]     1 ---- resolved by ---- * [ApplicationCompanyAssignment]

[Source]          1 ---- owns ----------- * [JobSource]
[Job]             1 ---- has ------------ * [JobSource]
[Job]             1 ---- has ------------ * [JobObservation]

[ResumeSnapshotInterpretation] * ---- extracts ---- * [Skill]
[ResumeSnapshotInterpretation] * ---- extracts ---- * [Certification]

[CandidateProfile] 1 --- produces ------- * [RecommendationCache]
[Job]              1 --- evaluated by --- * [RecommendationCache]

[Application] + [ApplicationEvent] + [Company] + [ResumeSnapshot]
                         |
                         | derive
                         v
[ApplicationStatistics / CompanyStatistics / SkillStatistics /
                   CertificationStatistics]
                         |
                         | future materialization only
                         v
                  [AnalyticsCache: deferred]
```

An Application uses zero or one ResumeSnapshot in the initial model despite the
diagram's aggregate one-to-many direction. The initial Phase 8 constraint allows
at most one Application for each Job. Company and source relationships may be
missing on legacy data where identity cannot be established truthfully. A future
physical User relationship requires a holistic multi-user architecture and is
not part of this diagram.

### 2.3 Relationship Rules

**Installation ownership:** Applications, Resumes, ResumeSnapshots,
CandidateProfiles, and local derived outputs belong implicitly to the current
installation. Jobs, source provenance, canonical Skills, Certifications, and
Companies are also installation-level data. Phase 8 makes no multi-user
isolation claim.

**Application and Job:** Database V2 permits at most one Application for a given
Job. This preserves the current one-application-per-job model while leaving
Application IDs independent so repeated attempts can be designed later without
rewriting legacy IDs.

The existing physical uniqueness of `applications.job_id` remains in Phase 8. A
later approved multi-user or repeated-attempt design must explicitly migrate it.

**Resume and ResumeSnapshot:** A Resume may produce many immutable snapshots.
A snapshot retains its source Resume identity when known but must remain usable
if the mutable Resume is renamed, archived, replaced, or deleted according to
an approved retention workflow.

**ResumeSnapshot and Application:** An Application references zero or one
submitted ResumeSnapshot in the initial Phase 8 model. A snapshot may be reused
by multiple Applications only when the complete capture identity in Section 5.3
is identical, including installation, source Resume, filename, media metadata,
bytes, payload, and interpretation versions.

**Job and Application:** Every Application references one durable Job. The
existing restrictive relationship remains important because a provider or
source deletion must not remove a Job required by application history.

**Company and Job:** A Company may group many Jobs. Existing company text stays
on each Job; a new Company relationship is additive and may be null for
ambiguous legacy data.

**Company and Application:** An Application may reference the canonical Company
resolved at creation. It also retains the company name observed at application
time so future Company corrections or merges cannot rewrite historical display.
ApplicationCompanyAssignment records the Phase 8 exact resolution provenance;
assignment correction is deferred.

**Application and ApplicationEvent:** An Application has one or more events once
it exists. New status-bearing Applications must have an event; migration-created
legacy projections may use an explicitly marked legacy import event.

**JobStatusHistory and ApplicationEvent:** These histories overlap only for
compatibility transitions. JobStatusHistory audits broad job organization;
ApplicationEvent records the application lifecycle. Neither replaces the other.

**Snapshots and qualifications:** ResumeSnapshotInterpretation-to-Skill and
ResumeSnapshotInterpretation-to-Certification relationships are separate from
current Job-to-Skill and Job-to-Certification relationships. They may reuse the
existing canonical catalogs but not the existing job junctions. Every Snapshot
has a capture-time interpretation identity even when parsing failed.

**Statistics and caches:** Statistics derive from retained facts. A future cache
may reference Companies, Jobs, ResumeSnapshots, or definition versions, but
deleting a cache must never delete a referenced fact.

### 2.4 Installation Ownership Boundary

Phase 8 adds no `users` table, User ID, owner column, authentication identity, or
multi-user behavior. Applications, Resumes, snapshots, CandidateProfiles,
settings, saved filters, profile-preference files, and user-specific Job fields
are all implicitly owned by the current installation.

This is a deliberate compatibility decision, not an assumption that ownership
has been solved for multiple people. A future User entity must be introduced
together with UserJobState, per-user Resume defaults, settings, saved filters,
recommendation projections, external preference-file ownership, deletion, and
synchronization. Partial owner foreign keys are prohibited because they would
create a false isolation boundary.

### 2.5 Existing Resume Integration

The existing Resume identity and fields remain valid, including display name,
original filename, storage path, MIME type, size, default selection, parsing
status, extraction arrays, parsing error, and timestamps.

Current Resume rows store an absolute `storage_path`. Phase 8 backup manifests
therefore identify each Resume file by Resume ID and a portable path relative to
the managed Resume root while retaining the installed path for compatibility.
Restore to a different managed root must rewrite each restored compatibility
path to the verified current-root location before the restored database becomes
active; it must not leave a path pointing at the original installation.

Database V2 adds only the relationships and integrity metadata required for
future history:

- A content hash should be recorded when the file is successfully verified, but
  a missing legacy file must not make migration fail.
- Existing extraction arrays remain mutable current parse results.
- Resume files are not overwritten to create a new version. A new upload remains
  a new Resume, and historical application use is represented by ResumeSnapshot.
- Existing proposals retain their current relationship and behavior.

Database V2 does not introduce a logical resume-family or parent-version entity
until resume versioning behavior is approved beyond snapshot requirements.

### 2.6 Existing Job Integration

Job remains the canonical discovery entity with its existing source,
observation, search, score, and workflow relationships. Database V2 adds at most
an optional canonical Company relationship. It does not move source provenance,
application history, or resume data into Job.

Current Job title, company, location, URL, and description remain mutable
listing fields. Application-time context is copied to Application because Job
is not an immutable historical snapshot.

### 2.7 CandidateProfile, Skill, and Certification Integration

CandidateProfile remains a mutable installation-local scoring configuration.
Existing analysis runs, recommendations, score history, and analytics continue
referencing the same profile IDs. CandidateProfile must not be used as an
immutable record of qualifications at application time.

During Database V2, editable CandidateProfile and scoring state remains
file-authoritative. The versioned unified preference file is authoritative when
present; existing candidate/scoring files remain its compatibility fallback.
`candidate_profiles.configuration_json` remains the last configuration persisted
for an analysis identity and the foreign-key anchor for existing analysis
history; it is not silently promoted to the editable source of truth.

Current resolution is not uniform: validated API paths use the shared preference
resolver, while startup stale-score and post-discovery analysis currently omit
the unified preference path and can load legacy files. Phase 8 must align every
analysis entry point to the shared file resolver before claiming one current
input. Existing SQLite rows remain attached to their historical outputs. Full
SQLite authority consolidation is future architecture under Section 10.21.

Backup inventory must include application-managed profile and scoring preference
files as well as SQLite-owned CandidateProfile rows. This does not make external
files part of a SQLite transaction; it makes their authority and lifecycle
explicit.

The existing Skill and Certification catalogs may provide canonical identities
for ResumeSnapshotInterpretation relationships. Existing Job junctions retain
their current meaning and are not repurposed. Interpretation relationships must
preserve extraction provenance and the raw observed label even when they link to
a canonical catalog entry.

### 2.8 Relationship Integrity and Deletion Matrix

Copied historical identifiers and live relationships are distinct. A copied
identifier is immutable text retained for provenance; a live relationship is a
foreign-key-style association used to navigate current entities.

| Relationship                                        | Ordinary delete/merge rule                                                                                    | Historical rule                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Job to Application                                  | Restrict Job deletion while an Application exists.                                                            | Source removal or job expiry cannot cascade into Application history.                                                           |
| Application to ApplicationEvent                     | Restrict ordinary Application deletion. No routine hard-delete path is included in the first Phase 8 release. | Events never disappear through Job, Source, Company, Resume, or cache operations.                                               |
| Resume to ResumeSnapshot                            | Clear the optional live Resume relationship or restrict according to the approved Resume delete workflow.     | Preserve copied Source Resume ID at capture and the snapshot artifact.                                                          |
| ResumeSnapshot to Application/ApplicationEvent      | Restrict snapshot deletion while either relationship exists.                                                  | Remove a snapshot only when no retained fact references it and an explicit cleanup or purge authorizes removal.                 |
| Company to Job/Application                          | Restrict ordinary deletion. Company merge behavior is deferred.                                               | Preserve Job company text, Application company-at-time text, JobCompanyAssignment, and ApplicationCompanyAssignment provenance. |
| Source to Application context                       | Current Source deletion may clear the optional live relationship.                                             | Preserve copied Source ID, provider ID, and source label on Application.                                                        |
| CandidateProfile to recommendation/analysis history | Preserve existing restrictive behavior.                                                                       | Existing profile IDs remain valid historical references.                                                                        |
| Facts to statistics or derived outputs              | Deleting or invalidating a derived output never deletes a fact.                                               | Any future approved purge must also remove or invalidate derived outputs that contain the purged fact.                          |

Every Phase 8 relationship remains inside one installation. No import or future
sync process may attach an Application to a ResumeSnapshot from another
installation without a separately approved identity and transfer design.

## 3. Application Model

### 3.1 Purpose

Application is the durable, installation-local aggregate for a job application. It
provides efficient current-state queries while ApplicationEvents retain the
historical record from which lifecycle state is derived.

The existing `applications` table is the compatibility foundation. Database V2
extends it; it does not create a second aggregate with the same responsibility.

### 3.2 Ownership

Every new or migrated Application is local to the current installation. Phase 8
does not add authentication, email, cloud identity, owner IDs, or multi-user
runtime requirements. Jobs and Applications share the same implicit
installation ownership boundary.

### 3.3 Creation and Lifecycle

Normal command creation begins only with Applied. Migration may create an
Application from reconciled legacy application evidence without fabricating an
Applied observation. Note, lifecycle, replacement, and Void commands require an
existing Application. Pre-application behavior remains owned by the job workflow
and `FEATURE_SPEC_APPLICATIONS.md`; Database V2 does not redefine when Saved,
Interested, or Resume Ready become user-visible states.

Application lifecycle status is derived from the latest effective
status-bearing ApplicationEvent. The Application stores a current-status
projection for list and filter queries, but that field is not an independent
historical fact.

The canonical persistence status vocabulary is:

- Applied
- Recruiter Contact
- Phone Screen
- Technical Interview
- Manager Interview
- Final Interview
- Offer
- Accepted
- Rejected
- Ghosted
- Withdrawn
- Interview (stage unknown; also retains legacy generic state)
- Unknown Legacy State (migration-only)

Interview remains user-selectable as an explicit stage-unknown fallback and
valid for migrated records whose interview stage is unknown. Dedicated UI
actions present the specific interview stages first.

Unknown Legacy State is never user-selectable; it preserves history-only or
note-only legacy evidence without fabricating an application outcome. This is
the approved persistence vocabulary. User-facing creation and transition rules
are defined by `FEATURE_SPEC_APPLICATIONS.md`; persistence retains every valid
event, including a later event after an outcome.

### 3.4 Conceptual Fields

| Field                         | Requirement                                               | Persistence rule                                                                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application ID                | Required                                                  | Stable and immutable. Preserve existing IDs, including legacy IDs equal to Job IDs.                                                                                                                                                                      |
| Job ID                        | Required                                                  | Immutable relationship to the canonical Job. Existing restrictive deletion behavior must be preserved.                                                                                                                                                   |
| Company ID                    | Optional for legacy; expected when exactly resolved       | Projection from the Phase 8 ApplicationCompanyAssignment. Never infer through fuzzy matching. Any later approved correction or merge may redirect the projection without rewriting captured context.                                                     |
| Current status                | Required                                                  | Transactionally maintained projection derived from effective status-bearing events.                                                                                                                                                                      |
| Applied at                    | Conditionally required                                    | Earliest effective Applied event time when known. Legacy null or approximate values remain explicitly legacy.                                                                                                                                            |
| Applied-at precision          | Required when Applied at is present                       | Exact, date-only, approximate, or unknown, derived from the supporting event.                                                                                                                                                                            |
| Last event at                 | Required for new V2; nullable for all-unknown legacy time | Maximum effective event occurrence time. Recomputed when backdated or corrective events are appended. A legacy aggregate with no supportable occurrence time remains null.                                                                               |
| Last recorded at              | Required for V2                                           | Most recent event write time, used to distinguish late data entry from event occurrence.                                                                                                                                                                 |
| Submitted ResumeSnapshot ID   | Optional                                                  | References the immutable submitted resume when known. Must never default to the current or default Resume after the fact.                                                                                                                                |
| Job title at application      | Required for new V2 Applications                          | Immutable copied display value for historical accuracy. Legacy rows may be unknown until explicitly confirmed.                                                                                                                                           |
| Company name at application   | Required for new V2 Applications                          | Immutable copied display value independent of later Company normalization.                                                                                                                                                                               |
| Location at application       | Optional                                                  | Immutable copied value when available.                                                                                                                                                                                                                   |
| Application URL used          | Optional                                                  | Exact URL selected or recorded by the user. It must not track later changes to Job URLs.                                                                                                                                                                 |
| Source context at application | Optional                                                  | Copied Source ID, provider ID, and human-readable source label used for the application when known. A live relationship may be nullable, but source deletion must not erase copied context.                                                              |
| Notes                         | Optional                                                  | Mutable current summary after V2 adoption. Existing values are preserved with legacy provenance because current rows may contain automated status-change reasons rather than user notes. Historical notes that matter to a timeline are separate events. |
| Created at                    | Required                                                  | Original aggregate creation or migration-import time.                                                                                                                                                                                                    |
| Updated at                    | Required                                                  | Last projection or mutable-summary write time. It is not an event occurrence time.                                                                                                                                                                       |
| Legacy provenance             | Conditional                                               | Marks values imported or inferred from pre-V2 aggregates so they are not misrepresented as exact observations.                                                                                                                                           |

No new V2 field may be populated from current Job or Resume state during
migration unless the historical value is known. Unknown is more accurate than a
plausible but fabricated value.

### 3.5 Relationships

- Application references one Job.
- Application may reference one canonical Company.
- Application may reference one submitted ResumeSnapshot.
- Application owns many ApplicationEvents.
- Application may own FollowUps, Reminders, or additional materials only after
  those feature contracts are approved.

### 3.6 Immutability and Projection Rules

Application is a mutable projection, not an immutable row. Only the following
categories may change directly:

- Current status, applied time, last-event times, and submitted snapshot
  projection when recomputed from events.
- Mutable user summary notes.
- Canonical Company association set by the approved exact resolver for new and
  migrated Applications. Phase 8 exposes no direct reassignment operation.
- Bookkeeping timestamps and version markers.

Application ID, Job identity, and copied application-time context must not be
silently changed. Direct Job reassignment is prohibited after any event exists
because it would reinterpret the event history. A replacement-Application
correction workflow is deferred.

### 3.7 Historical Preservation

- Discovery refresh must not overwrite Application fields or events.
- Source deletion must preserve the Job and all copied application-time context.
- Resume rename, default changes, reparse, or deletion must not alter a linked
  ResumeSnapshot.
- Company normalization or merging must not alter company text captured at
  application time.
- Recalculated status or analytics must never delete prior events.
- Application deletion is not a routine Phase 8 operation. Any later approved
  purge must be explicit rather than a cascade from Job, Source, Resume,
  Company, or derived-output deletion.

### 3.8 Compatibility With Current Job Status

`jobs.status` remains the current broad UI workflow during Phase 8 adoption.
Database V2 must not assume it equals the Application projection because the two
already diverge in valid installed databases.

During the Phase 8 compatibility period, status-bearing event writes reproject
the Application and derive a coarse mapped `jobs.status` from the post-fold
current Application status in the same transaction so existing screens continue
to work. Job status and history change only when that coarse value differs. The
approved mapping is defined below and in the application feature specification.
It is a compatibility projection only:

| Application state                               | Compatible Job status |
| ----------------------------------------------- | --------------------- |
| Applied or Recruiter Contact                    | `applied`             |
| Phone Screen                                    | `interview`           |
| Technical, Manager, Final, or generic Interview | `interview`           |
| Offer or Accepted                               | `offer`               |
| Rejected or Ghosted                             | `rejected`            |
| Withdrawn                                       | `ignored`             |

Persistence must preserve the richer event even when the compatibility Job
status is coarse. Direct non-application Job workflow changes do not rewrite or
delete an existing Application or its events.

## 4. Application Events

### 4.1 Purpose and Physical Compatibility

ApplicationEvent is the immutable record of something that happened to an
Application. The existing `application_history` table is the physical
compatibility foundation. Unreleased migration `016_application_event_foundation.sql`
adds Application linkage and the broader event vocabulary to that table rather
than creating a parallel event history. Milestone 8.3 left migration `016`
untouched and added forward migration `017_application_management_indexes.sql`;
the aggregate, ledger, and effective-event view remain canonical.

Existing `job_status_history` remains a separate job-workflow audit. Existing
`application_history.job_id` remains available for compatibility and integrity
checks even after Application ID is added.

### 4.2 Event Types

Status-bearing event types are:

- Applied
- Recruiter Contact
- Phone Screen
- Technical Interview
- Manager Interview
- Final Interview
- Interview (stage unknown or retained legacy generic)
- Offer
- Accepted
- Rejected
- Ghosted
- Withdrawn
- Legacy State Imported

The required Phase 8 administrative and non-status event types are:

- Note.
- Void.
- Legacy Applied Date Imported, for applicable migration records only.

A replacement is not a separate semantic event type. It uses the complete
canonical type and values that should remain effective, such as Applied when
correcting an Applied date or Resume association. Void is used only when removing
the target from effective folds. A snapshot selected during normal creation is
associated by Applied; there is no standalone Resume Submitted event in the
first release. Follow-up and reminder events are not added. Legacy Applied Date
Imported contributes only to the applied-date fold; it never carries a Resulting
status or changes current status.

The same event type may occur more than once. Interview stages, recruiter
contacts, rejections followed by renewed contact, and corrected historical data
must not be forced into a single row per type.

### 4.3 Conceptual Fields

| Field                     | Requirement                                                               | Persistence rule                                                                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event ID                  | Required                                                                  | Stable and immutable; preserve all existing history IDs. New commands allocate the ID before their first write and reuse it on retry. Only the same ID plus complete canonical command payload and, for creation, copied Application context is idempotent; conflicting reuse is rejected.              |
| Application ID            | Required for V2 events                                                    | Parent Application. Existing rows are backfilled only where the Job-to-Application relationship is unambiguous.                                                                                                                                                                                         |
| Job ID                    | Required for compatibility                                                | Must identify the same Job as the parent Application. Preserves current query and migration behavior.                                                                                                                                                                                                   |
| Event type                | Required                                                                  | Constrained canonical vocabulary plus explicitly versioned future extensions.                                                                                                                                                                                                                           |
| Resulting status          | Required for status-bearing events                                        | First-class constrained value used by the status fold. Lifecycle event types, including replacements, map to their matching status. Legacy State Imported may carry another allowed imported status with explicit provenance.                                                                           |
| Occurred-at source value  | Required for normal events; nullable only for migration-only unknown time | Original occurrence value. New exact events use canonical UTC ISO-8601 date-times; date-only events retain `YYYY-MM-DD` while using a separate midnight-UTC sort value. Legacy text is preserved byte-for-byte when not parseable or normalized. A Legacy State Imported event does not invent a value. |
| Occurred-at sort value    | Required for new V2 events; optional for unparseable legacy data          | Normalized UTC value used for ordering and indexes. It never replaces the source value.                                                                                                                                                                                                                 |
| Occurrence precision      | Required for V2                                                           | Exact, date-only, approximate, or unknown. Migrated timestamps are never presented as exact unless existing event evidence supports that precision.                                                                                                                                                     |
| Recorded-at source value  | Required                                                                  | Original write-time value. Existing `created_at` supplies this role and remains unchanged.                                                                                                                                                                                                              |
| Recorded-at sort value    | Required for V2; nullable only for unparseable legacy data                | Normalized UTC write time used for deterministic fallback ordering.                                                                                                                                                                                                                                     |
| Actor or source           | Required                                                                  | User, dashboard, migration, import, or another approved provenance value. It is not the job provider source.                                                                                                                                                                                            |
| Notes                     | Optional                                                                  | Context specific to this event. It is immutable with the event.                                                                                                                                                                                                                                         |
| Metadata                  | Optional                                                                  | Versioned structured details such as interview format or imported legacy status. It must not hide core query fields.                                                                                                                                                                                    |
| ResumeSnapshot ID         | Optional                                                                  | Exact submitted resume associated with Applied or a complete replacement of a Resume-bearing event when known.                                                                                                                                                                                          |
| Supersedes event ID       | Optional                                                                  | Identifies an earlier event corrected by this event without editing the original.                                                                                                                                                                                                                       |
| Supersession action       | Required when superseding                                                 | Replace or void. Replace uses the canonical semantic Event type and supplies every replacement value; void uses Event type Void and removes the target from effective folds without deleting it.                                                                                                        |
| Resume association action | Required for material-bearing events                                      | Unchanged, set, or clear. Set requires a ResumeSnapshot ID; clear explicitly records that no snapshot should remain in the projection.                                                                                                                                                                  |
| Definition version        | Required for new event families                                           | Identifies the event interpretation rules used when persisted.                                                                                                                                                                                                                                          |

### 4.4 Append-Only Rule

ApplicationEvents are append-only while their parent Application is retained.
Ordinary product operations must not update or delete an event after commit.
Phase 8 enforces this through repository/service APIs and SQLite protection
against ordinary `UPDATE` and `DELETE` statements. Controlled migrations may
replace that protection while rebuilding the table. No product purge bypass is
introduced until a coordinated purge workflow is separately approved.

Milestone 8.2 implements the SQLite append-only boundary, structurally linear
correction chains, and repository projection rebuilds. Milestone 8.3 now
implements validated lifecycle, Note, replacement, and Void commands through the
atomic event-append, canonical reproject, and Job-compatibility service boundary.

Append-only history is required because:

- Outcome analytics depends on the original sequence and timing of events.
- Users must be able to understand why a current status or metric exists.
- Backdated entry and correction must remain distinguishable from silent edits.
- Resume, Company, and recommendation changes must not rewrite prior outcomes.
- Future analytical definitions may need facts that an earlier projection did
  not use.

A correction appends a replacement or Void event that references the superseded
event. Both remain available for audit. The following integrity rules apply:

- A superseding event and its target must belong to the same Application.
- An event cannot supersede itself or an event recorded after it.
- Supersession chains must be acyclic.
- An effective event may have at most one effective direct superseder.
- Correcting a prior correction appends a new event that supersedes the current
  terminal replacement, producing one linear effective chain.
- A replacement event uses the canonical semantic type that the effective ledger
  should retain and carries every status or material value needed to replace the
  target; omitted core values are not inherited implicitly.
- A void that would leave the Application without any effective status-bearing
  event is rejected unless the whole Application is being purged.
- An event may reference only a ResumeSnapshot in the same installation.

### 4.5 Status Derivation

Application projections distinguish the complete audit ledger from its
effective fact set. The complete ledger contains every original, replacement,
superseded, and void event. The effective set is used for current status,
applied-date, material, and occurrence projections.

1. Resolve each linear supersession chain. Exclude superseded ancestors. Include
   the terminal replacement, or include nothing when the terminal action is
   void.
2. Order effective events by occurred-at sort value, then recorded-at sort
   value, then stable Event ID. If a legacy occurrence cannot be normalized, use
   its recorded-at sort value and Event ID without changing the original text.
   Occurrence precision is retained for display and analysis and never invents
   finer ordering.
3. Status fold: use the latest effective event with a Resulting status.
4. Applied-date fold: use the earliest effective Applied or Legacy Applied Date
   Imported event, retaining its occurrence precision.
5. Material fold: process Resume association actions in event order. Set selects
   the referenced snapshot, clear selects none, and unchanged preserves the
   prior result.
6. Activity fold: derive `last_event_at` from the maximum effective occurrence
   sort value and leave it null only when no legacy occurrence can be normalized.
   Derive `last_recorded_at` from the maximum recorded-at sort value across the
   complete audit ledger, including superseding and void events.

Every retained Application must have at least one effective event with a
Resulting status. Non-status events never satisfy this invariant.

Persisting the projection is allowed and expected for efficient list queries,
but every projection update must be transactional with the event append. A
rebuild operation must be able to reproduce the same result from events.

### 4.6 Legacy History

Migration must preserve every existing application-history row and event time.
Legacy event names map without loss to their closest canonical type and receive
the matching Resulting status. Generic `interview` remains generic; it must not
be guessed as a particular interview stage.

When an existing Application has no usable history, migration may append one
Legacy State Imported event containing the previous aggregate status and a
clear migration provenance marker. It must not fabricate an Applied event or
exact applied time. A legacy `applied_at` without a matching factual Applied
event is represented by Legacy Applied Date Imported and conservatively marked
as approximate or unknown precision. An existing event with the same applied
time may establish stronger precision. No pre-V2 applied date is assumed exact
solely because the aggregate contains a timestamp.

Legacy timestamps that are date-only, non-UTC, or unparseable retain their
original text. Migration adds normalized sort values only when conversion is
unambiguous and otherwise records unknown or approximate precision. No
migration rewrites the original event time merely to satisfy the V2 timestamp
format.

### 4.7 Milestone 8.3 Command Boundary

Implemented and completion-gate verified on 2026-08-09, Milestone 8.3 normal
writes use one validated Application service and the
Milestone 8.2 projection rebuild. They do not introduce a parallel event ledger,
projection algorithm, command bus, ResumeSnapshot workflow, or Company identity
boundary.

Normal creation begins only with Applied. The client allocates the Event ID and
the server allocates the Application ID. If the Event ID already exists, the
service compares the complete canonical command payload to the retained event
and, for creation, the immutable copied Application context. Identical payloads
are idempotent replays with no new write; any differing command field is a
conflict. Server-generated recorded time, Application ID, and bookkeeping fields
are not client payload fields. A different Event ID for a Job that already owns
an Application is a conflicting second attempt, not a retry.

The dedicated Application service does not expose a later Applied lifecycle
command. A factual correction to Applied uses replacement. Repeated coarse
Applied events already produced by the Job-status compatibility path remain
valid retained history and continue to fold normally.

Every new event command completes in one short SQLite transaction:

1. Resolve Event-ID replay or conflict.
2. Validate Job, Application, and correction target where applicable.
3. Create the parent Application only for first Applied.
4. Append the immutable event.
5. Rebuild the Application with the canonical effective-event fold.
6. Derive coarse Job compatibility from the post-fold current status.
7. Update Job status and Job status history only when the coarse status changed.

Failure at any step rolls back the entire command. Note events and mutable
summary-note writes do not resynchronize Job status. A Legacy State Imported
winner, including Unknown Legacy State, has no automatic Job compatibility
mapping.

New exact occurrence values arrive as ISO-8601 date-times with `Z` or an explicit
offset and normalize to UTC. New date-only source values use `YYYY-MM-DD`, stored
precision `date`, and a midnight UTC sort value that is never displayed as an
observed time. Recorded time is generated by the service in UTC. Future exact
instants and future local calendar dates are rejected.

New explicit Application events use actor `user` and definition version
`application-event-v1`. The client does not supply resulting status, recorded
time, normalized sort values, actor, or copied provider/source labels. Structured
metadata uses a versioned object; equality compares canonical structured values,
not raw JSON key order.

Milestone 8.3 corrections target only the current terminal event in one linear
chain. Eligible targets are status-bearing or Note events with normalized
recorded time. Void, Legacy State Imported, Legacy Applied Date Imported,
superseded ancestors, and ambiguous-record-time events are not normal correction
targets. A status replacement supplies a complete user-selectable status event;
a Note replacement remains a Note. A Void reuses the target occurrence source,
sort value, and precision for audit ordering, records the correction time
separately, and cannot be superseded through the Milestone 8.3 service. The
existing final-effective-status protection remains mandatory.

Application summary notes remain mutable aggregate state, use local
last-write-wins semantics, and do not append events. Timeline Note records remain
immutable ApplicationEvents. Copied title, Company text, location, URL, and
source context are confirmed at Applied creation and have no direct edit
operation in Milestone 8.3.

The list cursor uses the conceptual Section 8.3 tuple: last recorded time
descending and Application ID ascending. Its public representation is an opaque,
base64url-encoded, versioned payload. Null activity sorts last. Timeline reads
return the complete ledger for one naturally bounded Application in occurrence,
recorded, and Event-ID order. Outcome aggregations and current-versus-ever list
queries remain outside Milestone 8.3.

## 5. Resume Snapshots

### 5.1 Resume and Snapshot Responsibilities

Resume and ResumeSnapshot are deliberately different entities:

- Resume is a mutable library item representing an uploaded local document and
  its current parse result, display name, and default selection state.
- ResumeSnapshot is an immutable historical artifact representing exact content
  and interpretation used for an application.

The existing `resumes` table remains the Resume entity. Snapshot support is
additive.

### 5.2 Why Snapshots Exist

Resumes change independently of applications. A user can upload a revision,
rename a resume, choose a new default, approve extracted skills, reparse a file,
or delete a library item. None of those actions should change what was submitted
for an earlier application.

An Application must therefore never point directly to "the latest resume" or
resolve its historical resume through the current default. It references the
immutable ResumeSnapshot used at application time. Without that boundary,
resume-based outcome analysis would associate later qualifications with earlier
applications and produce historically false conclusions.

### 5.3 Snapshot Creation

A snapshot is created when all of the following are true:

- An application-specific action records that a known Resume was used.
- The exact local file is readable within the managed resume directory.
- Its content hash and metadata can be verified.
- The parser and normalization payload can be versioned.

Snapshot creation and the Applied event should behave as one logical operation.
Because SQLite and the filesystem cannot share one transaction, the persistence
protocol is:

1. Write the file to a temporary path inside the managed snapshot directory on
   the same filesystem as its final location.
2. Close the file, calculate and verify its hash and size, then atomically rename
   it to an opaque final storage key.
3. Commit Snapshot metadata, the ApplicationEvent, and the Application
   projection in one SQLite transaction referencing that final key.
4. If the database transaction fails, quarantine or remove the unreferenced
   final file.
5. At startup and before backup, reconcile database rows against files. An
   unreferenced file is an orphan eligible for quarantine; a row whose file is
   missing is an integrity error and must never fall back to the current Resume.

An existing immutable snapshot may be reused only when the installation, source
Resume identity, file bytes, original filename, MIME/extension metadata,
normalized payload, parser version, and normalization version are all
identical. Content hash alone is not sufficient because two capture contexts
can use the same bytes under different Resume identities or filenames. Reuse
supports the query "show applications created from Resume Snapshot X" without
conflating distinct captures.

A historical application entered after the fact may reference a snapshot only
if the user supplies or confirms the exact historical document. Database V2
must not snapshot the current Resume and imply that it was used previously.

### 5.4 Conceptual Fields

| Field                           | Requirement | Persistence rule                                                                                                                                                    |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot ID                     | Required    | Stable and immutable.                                                                                                                                               |
| Source Resume ID at capture     | Optional    | Immutable copied identifier of the library Resume when known. It remains as provenance if the live Resume is later removed.                                         |
| Live source Resume relationship | Optional    | Convenience relationship to the current Resume. Ordinary Resume deletion sets this relationship to unknown or is restricted without changing the copied identifier. |
| Content hash                    | Required    | Cryptographic identity of the immutable file bytes. Used for integrity and safe reuse, not as a public identifier.                                                  |
| Storage key                     | Required    | Opaque relative key for an immutable local snapshot copy. It is resolved under the managed snapshot directory and remains portable across restore locations.        |
| Original filename               | Required    | Historical user-facing filename at capture time.                                                                                                                    |
| MIME type and extension         | Required    | Captured input metadata; parser selection rules remain versioned.                                                                                                   |
| Size                            | Required    | Integrity and operational metadata.                                                                                                                                 |
| Normalized payload              | Required    | Versioned structured representation of parsed resume content. A failed parse stores a valid empty/error payload rather than omitting the contract.                  |
| Parser version                  | Required    | Identifies extraction behavior.                                                                                                                                     |
| Normalization version           | Required    | Identifies the normalized payload contract.                                                                                                                         |
| Parsing status and error        | Required    | Truthfully records success or failure at snapshot time. A failed parse may still preserve the exact submitted file.                                                 |
| Created at                      | Required    | Immutable snapshot creation time, not inferred application time.                                                                                                    |

### 5.5 Normalization and Queryable Qualifications

The default representation is hybrid:

- Preserve the exact immutable file outside SQLite in managed local storage.
- Store integrity metadata and a versioned normalized payload in SQLite.
- Give the capture-time payload a ResumeSnapshotInterpretation identity.
- Use explicit Interpretation-to-Skill and Interpretation-to-Certification
  relationships for qualifications used in filtering or analytics.
- Preserve raw normalized labels and extraction provenance so later catalog
  normalization does not erase what the parser observed.

The existing Resume extraction arrays remain valid for mutable library display.
They are not historical snapshot facts. Existing Job skill and certification
junctions must not be reused as resume relationships.

### 5.6 Relationship to Applications

An Application stores the submitted ResumeSnapshot ID projection when known.
The Applied event or a later complete replacement of the effective Resume-bearing
event preserves the historical association from which that projection is
derived. The snapshot does not point to a mutable current Application status and
does not change when the Application advances.

One immutable snapshot may support many Applications. One Application supports
zero or one submitted resume in the initial model. Additional submitted resume
versions or other materials require an approved ApplicationMaterial design.

### 5.7 Update Rules

Snapshot content, storage key identity, hashes, original normalized payload, and
capture-time parser versions are immutable. Post-capture reprocessing is
deferred. If it is later approved, it must append a versioned
ResumeSnapshotInterpretation rather than overwrite the snapshot or manufacture
a new application-time capture. Analytics must name the interpretation version
it uses.

A mistaken Application-to-Snapshot association is corrected by replacing the
effective Resume-bearing event with the same canonical semantic type and the
corrected association. The old snapshot remains retained if any historical event
still references it.

### 5.8 Retention and Deletion

- A snapshot referenced by a retained Application or event must not be deleted.
- Deleting or archiving the source Resume must not delete its snapshots.
- A snapshot with no references may be removed only by an approved explicit
  cleanup or user-data purge policy; no automatic retention period is assumed.
- Routine snapshot deletion and aggregate purge are deferred. A future approved
  purge may remove snapshots only after they become unreferenced.
- Backup and restore must treat SQLite, current Resume files, snapshot files, and
  authoritative application-managed preference files as one persistence set.
  The current SQLite-only backup is insufficient and must be replaced before
  snapshots are released.

Phase 8 backup and restore use one persistence-set manifest covering:

- The SQLite backup.
- Every current Resume library file referenced by SQLite.
- Every immutable ResumeSnapshot file referenced by SQLite.
- Application-managed CandidateProfile and scoring preference files that remain
  authoritative outside SQLite.

Credential storage, logs, diagnostics, temporary files, quarantined files, and
older backup sets remain outside this manifest. Backup sets are not copied into
new backup sets.

The coordinated protocol is:

- All SQLite writes and all writes to manifest-covered Resume, snapshot, and
  authoritative preference files are paused or serialized through one backup
  coordinator while the copies establish a source-data boundary.
- The manifest records the database backup identity plus every referenced file
  storage key, hash, size, persistence role, and owning Resume or Snapshot ID
  where applicable.
- Only files referenced by that manifest are copied; temporary, quarantined,
  orphaned, diagnostic, and log files are excluded.
- Backup succeeds only after copied files match the manifest.
- Restore places files under the current managed roots using relative storage
  keys, replaces SQLite through a verified offline restore operation, rewrites
  restored absolute Resume compatibility paths by Resume ID when the root
  differs, and verifies every hash before the restored set becomes active.
- A missing or corrupt snapshot makes the restored persistence set degraded and
  visible; restore must not substitute a mutable Resume file.

Snapshot copies are created only when the user records that a Resume was used
for an Application. The system does not duplicate every uploaded Resume in
advance. This limits sensitive-data duplication while satisfying historical
accuracy.

### 5.9 Future Compatibility

Stable hashes, installation ownership, definition versions, and explicit
qualification relationships allow future local analytics or approved
synchronization without changing historical content. Snapshot payloads must
remain readable across normalizer versions, and migration must never rewrite old
payloads solely to match a newer parser.

## 6. Company Model

### 6.1 Purpose

Company provides a stable identity for grouping Jobs and Application outcomes.
It resolves the current ambiguity of grouping only by mutable company text while
preserving all existing denormalized values.

Company is an employer identity. It is not a provider, source, ATS tenant, or
job-board account. `sources.employer`, `provider_metadata`, and Company must not
be treated as interchangeable.

### 6.2 Compatibility Design

Companies become first-class through an additive relationship:

- Existing `jobs.company` and `jobs.normalized_company` remain present and
  readable.
- Jobs receive an optional Company relationship after a future migration.
- Backfill uses the versioned exact resolver below only.
- Ineligible generic keys and integrity conflicts remain unlinked.
- No fuzzy or title-similarity merge runs during migration.
- Company resolution must not feed canonical names back into Job identity,
  fingerprints, source observations, or existing company text.

### 6.3 Exact Resolution Definition

Phase 8 uses resolver definition `company-exact-v1`:

1. Normalize Company text by trimming, lowercasing, and collapsing internal
   whitespace, matching the current `normalized_company` behavior.
2. Treat an empty key and the exact keys `unknown`, `unknown company`, `n/a`,
   `na`, `not specified`, `confidential`, `confidential company`,
   `company confidential`, `undisclosed`, `various`, and `multiple companies` as
   ineligible. The versioned set changes only through a later resolver version.
3. Create or reuse exactly one active Company for each eligible normalized key.
   Case and whitespace variants intentionally resolve together; no other
   similarity contributes.
4. When a migration or ingestion batch first introduces a key, choose the
   canonical display name from the trimmed Company text on the earliest retained
   Job by `created_at`, using Job ID as the stable tie-breaker. Later ingestion
   reuses that Company and does not silently rename it.
5. If one eligible key is already attached to more than one active Company,
   record an integrity conflict and leave affected new assignments unresolved.
   Never select one arbitrarily.

No user confirmation, alias, external-identifier, duplicate-review, merge, or
canonical-name management workflow is included in Phase 8.

### 6.4 Conceptual Fields

| Field                     | Requirement | Persistence rule                                                                                                                                                                       |
| ------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company ID                | Required    | Stable opaque identity. Any future approved merge design must redirect references without reusing an ID for an unrelated company.                                                      |
| Canonical name            | Required    | Current preferred display name. Changing it does not rewrite historical application text.                                                                                              |
| Normalized key            | Required    | Deterministic lookup key compatible with existing normalization. One active canonical Company owns a given approved key; conflicts remain unresolved rather than arbitrarily selected. |
| Created and updated times | Required    | Administrative identity timestamps, not job-observation times.                                                                                                                         |

Company aliases, duplicate-merge redirects, and their management workflows are
deferred. Phase 8 creates identity only through exact equality of the existing
normalized company value. It never fuzzy-matches or silently merges Companies.

### 6.5 Relationships to Jobs

A Company may have many Jobs. A Job may have zero or one canonical Company until
identity is confidently resolved. Job source provenance remains attached to the
Job and its source relationships; Company does not absorb it.

Provider updates may propose a Company association but must not automatically
merge two existing Companies based only on a similar name.

Every Job-to-Company assignment records its resolution provenance: original
company text, normalized key, resolver method, definition version, and assignment
time. Exact migration matching is a derived resolution, not an observed provider
fact. If later ingestion changes a Job's company text, append a new exact
assignment and update the Job projection transactionally while preserving the
prior assignment. Ineligible or conflicting new text clears the current
projection through an auditable assignment result rather than moving it
silently.

### 6.6 Relationships to Applications

An Application may reference the canonical Company associated with its Job at
creation. It also stores company name at application time. The canonical
relationship supports grouping; the copied name preserves historical display.

If Company merging is later approved, analytics may group the Application under
the merged canonical identity while explanations continue showing the name
recorded at application time.

For a new Application, exact resolution uses its copied company-at-application
text. ApplicationCompanyAssignment preserves that text, candidate Company ID,
resolver method, definition version, and assignment time. Later Job updates do
not change the Application assignment.

For a legacy Application with no copied company-at-application text, migration
may derive a grouping relationship from the Job's current eligible exact key only
when it labels the assignment `migration-current-job-context`; it leaves the
copied historical Company text unknown. Phase 8 provides no user correction or
reassignment workflow. A future approved correction or Company merge must
preserve the original assignment and must not insert a false application-time
observation.

### 6.7 Future Analytics

Company supports response, interview, offer, acceptance, rejection, ghosting,
and timing metrics derived from ApplicationEvents. Company itself stores no
rate, score, prediction, or recommendation as an observed field. Those values
belong to derived statistics or caches with sample size, period, scope, and
definition version.

## 7. Analytics

### 7.1 Evidence Classes

The intelligence specification in `FEATURE_SPEC_AI_ASSISTANT.md` owns the
meaning and presentation of intelligence outputs. Persistence enforces the
following separation:

| Evidence class                   | Meaning                                                                               | Persistence examples                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Observed data                    | Provider-supplied source value, immutable source artifact, or explicit user assertion | Job observations, resume snapshot file bytes and hash, user-recorded ApplicationEvents, company text observed on a Job                             |
| Versioned derived interpretation | Deterministic interpretation retained with its inputs and definition version          | Snapshot normalized payload, extracted snapshot Skills/Certifications, JobCompanyAssignment, current deterministic recommendation, `score_history` |
| Derived metric                   | Deterministic aggregate calculation from facts or versioned interpretations           | Response rates, interview counts, time-to-response, offer rates, skill correlations                                                                |
| Prediction                       | Estimate of an unknown future outcome                                                 | A future probability or forecast with target/model definition, evaluation metadata, and confidence                                                 |
| Rebuildable cache                | Disposable copy of a derived result whose authoritative inputs remain available       | AnalyticsCache, current RecommendationCache materialization, FTS                                                                                   |

A ResumeSnapshot contains both an observed artifact and a versioned derived
interpretation; each value retains its own provenance. A user-confirmed Company
assignment may include an observed user assertion, while an automatic exact-name
assignment remains derived.

Retained derived history such as `score_history` is not an observed fact and is
not automatically disposable merely because it was calculated; its original
mutable inputs may no longer be reconstructable. Derived metrics and predictions
must never be stored in an observed-data field. A prediction must not overwrite
a calculated recommendation, and neither may overwrite an Application outcome.

### 7.2 ApplicationStatistics

ApplicationStatistics is the conceptual read model for application counts,
funnel rates, and event timing. It is derived from Applications and effective
ApplicationEvents.

Every persisted or returned statistics result must identify:

- Installation-local scope.
- Time window and inclusion boundaries.
- Metric definition and version.
- Numerator, denominator, and sample size when a rate is shown.
- Included and excluded statuses or event types.
- Source-data watermark or input hash.
- Generation time.

ApplicationStatistics is not an event ledger. It may be recomputed or deleted
without affecting Applications.

The authoritative first-release cohort, event-set, denominator, correction,
timing, unknown-data, and result-metadata rules are definition
`application-outcomes-v1` in `FEATURE_SPEC_AI_ASSISTANT.md`.

### 7.3 CompanyStatistics

CompanyStatistics applies an explicit Company dimension to
ApplicationStatistics. It may include response count, interview count, offer
count, acceptance count, outcome rates, and timing distributions. Records with
unknown Company identity remain in an unknown bucket rather than being silently
discarded or guessed.

### 7.4 SkillStatistics and CertificationStatistics

SkillStatistics and CertificationStatistics relate immutable qualifications on
the selected ResumeSnapshotInterpretation to later application outcomes. They
must not use the user's latest Resume, current profile, or a newer interpretation
without naming that version as a substitute for application-time facts.

Correlation is a derived metric, not proof of causation. Persisted results must
retain sample size, metric definition, scope, and snapshot-normalization version.
Raw skill and certification labels remain traceable to the snapshot extraction
that produced them.

### 7.5 Existing Analytics Compatibility

The current `analytics` table remains profile- and analysis-run-scoped job-market
analytics. It is not repurposed as application-outcome history. Existing rows
and metric names remain valid.

Outcome analytics are calculated on demand in Phase 8. They do not add outcome
facts to the existing generic analytics rows. A persisted derived read model or
cache requires later measured evidence and separate approval.

### 7.6 AnalyticsCache

AnalyticsCache is deferred and no Phase 8 migration creates it. If measured
future queries justify a cache, it remains disposable and never authoritative.
A future cache entry must include:

- Stable cache key including installation scope.
- Query/metric definition name and version.
- Versioned parameters and dimension identifiers.
- Source-data watermark or deterministic input hash.
- Generated time and optional expiry time.
- Result payload schema version.
- Sample size and confidence metadata when relevant.

Invalidation is input-based, not time-to-live alone. Appending or correcting an
ApplicationEvent, changing an Application Company association, purging an
Application, merging Companies, or changing a metric definition invalidates
affected entries. Cache misses fall back to authoritative facts.

### 7.7 RecommendationCache

RecommendationCache is the conceptual current-output store for recommendations.
The existing `recommendations` table is the compatibility foundation, and
`score_history` remains historical calculated-score output.

Current recommendations continue to identify Job, CandidateProfile, score
version, and input hash through the existing schema. Existing `score_history`
rows are a compatibility exception: they may have a null score version and do
not contain an input hash or explanation. They are preserved without claiming
full reconstructability. A future generalized cache would identify all material
inputs:

- CandidateProfile.
- Job.
- Resume or ResumeSnapshot when used.
- Rule, algorithm, or model version.
- Deterministic input hash.
- Output kind: calculated recommendation or prediction.
- Score or result payload.
- Explainability payload.
- Confidence semantics when applicable.
- Generation and staleness times.

Phase 8 preserves current behavior: `recommendations` stores one current result
per Job and CandidateProfile, while `score_history` appends materially changed
calculated outputs. No generalized recommendation-history entity is added. A
recommendation must not be used as evidence that an application succeeded.

### 7.8 Future Predictions

No prediction persistence is authorized by Database V2. A future approved
prediction must be stored as a derived output with target definition, input
scope, version, evaluation metadata, confidence meaning, and generation time.
It must be distinguishable from both observed outcomes and deterministic match
scores in every query.

### 7.9 Anonymous Analytics Boundary

All statistics are local to the installation. Anonymous cross-install analytics
is future architecture, not Phase 8. Database V2 does not authorize collection,
export, upload, demographic inference, or retention of a cross-install dataset.

## 8. Query Patterns

### 8.1 Expected Queries

| Query                                                                | Expected usage                              | Authoritative inputs                                                                                     | Required access path                                                    |
| -------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Show all applications                                                | Frequent, paginated primary list            | Application projection, Job, optional Company                                                            | Last event/recorded time; optional current-status ordering              |
| Show applications by company                                         | Frequent filter and company detail          | Application, Company, copied historical company name                                                     | Company plus recent activity                                            |
| Show application detail                                              | Frequent single-record read                 | Application, Job, Company, ResumeSnapshot                                                                | Direct Application identity with bounded related lookups                |
| Show application timeline                                            | Frequent detail query                       | Complete ApplicationEvent audit ledger with effective/superseded/void markers                            | Application plus occurrence sort, recorded sort, and stable tie-breaker |
| Show interview history                                               | Frequent timeline subset                    | Phone Screen, Technical, Manager, Final, and Interview (stage unknown or retained legacy generic) events | Application plus event type and occurrence time                         |
| Show applications created from Resume Snapshot X                     | Occasional resume analysis                  | Application and ResumeSnapshot                                                                           | Snapshot identity                                                       |
| Show applications currently at Offer or another outcome              | Frequent current-state filter               | Application projection                                                                                   | Current status plus recent activity                                     |
| Show applications that ever became Offers or reached another outcome | Frequent history filter and analytics input | Effective status-bearing events                                                                          | Event type/resulting status plus occurrence period and Application      |
| Show company response rates                                          | Analytics, lower frequency                  | Company, Applications, response-bearing events                                                           | Company and time window over event facts; cache only if measured        |
| Show time from application to first response                         | Analytics, lower frequency                  | Earliest Applied and earliest qualifying response event                                                  | Per-Application ordered events                                          |
| Show outcomes by skill or certification                              | Analytics, lower frequency                  | Application, ResumeSnapshot qualification links, events                                                  | Snapshot qualification dimension joined to application outcomes         |
| Show due follow-ups or reminders                                     | Future frequent task query                  | Deferred FollowUp and Reminder entities                                                                  | Not approved until feature semantics exist                              |
| Rebuild an Application projection                                    | Recovery and migration                      | All effective events for one Application                                                                 | Complete ordered event stream by Application                            |
| Invalidate recommendation or analytics results                       | Write-adjacent maintenance                  | Input hashes, definition versions, event watermarks                                                      | Cache key and input identity                                            |

### 8.2 Query Semantics

- Application lists read the current projection; timelines read immutable
  events. A normal timeline may emphasize effective facts, but audit detail must
  retain superseded, replacement, and void events.
- Status filters use the Application projection but must be explainable through
  events.
- "Current outcome" queries use the projection. "Ever reached outcome" queries
  use effective events and may return an Application whose current status later
  changed.
- Historical display uses copied application-time context and ResumeSnapshot,
  not current Job or Resume values.
- Analytics queries define their denominator explicitly. Missing Company,
  snapshot, or event data remains visible as unknown rather than disappearing.
- Event order uses occurrence time, recorded time, and stable Event ID.
- All queries are installation-local in Phase 8.
- Large lists are paginated with stable ordering. Timeline queries are naturally
  bounded by one Application.

### 8.3 Index Strategy

Indexes are justified by the query patterns above, not by every possible field.
Migration `017_application_management_indexes.sql` replaces the earlier query
indexes with exactly the Milestone 8.3 access paths:

- Application list by `last_recorded_at DESC, id`.
- Current-status list by `status, last_recorded_at DESC, id`.
- Case-insensitive copied-Company list by
  `company_at_application COLLATE NOCASE, last_recorded_at DESC, id`.
- Complete timeline by `application_id`, effective occurrence fallback,
  `recorded_at_sort`, and stable Event ID.

The existing unique Application-by-Job lookup remains in place. Migration `017`
also adds one trigger that makes Application identity and copied context
immutable and one trigger that requires `application-event-v1` metadata on new
user events. It does not add later-milestone ResumeSnapshot, canonical Company,
outcome-history, or analytics indexes. Those access paths remain subject to
Milestones 8.4 through 8.7 and representative query-plan evidence.

Existing indexes remain unless a measured and tested migration proves them
redundant. Analytics-specific indexes should be added only after representative
local datasets demonstrate that event-based calculation is insufficient.

Stable application pagination uses the full cursor tuple for its selected sort,
including Application ID as the final tie-breaker. For the default activity
sort, the conceptual tuple is last recorded time descending and Application ID.
Status and Company filters retain the same activity-and-ID ordering within their
scoped access paths.

### 8.4 Performance Expectations

Phase 8 initially targets local desktop datasets, not warehouse-scale analytics.
Correctness and historical integrity take priority over precomputation.

- Primary application lists and detail timelines should use indexed reads and
  stable pagination.
- Projection updates and event appends should complete in one short transaction.
- Analytics may become asynchronous if measured work would block normal
  interaction. Cache design remains deferred.
- Existing optional FTS remains isolated from application history and can be
  rebuilt independently.

## 9. Migration Strategy

### 9.1 Versioning Philosophy

- Continue the existing zero-padded sequential migration naming convention.
- Use the next available version at implementation time; this document does not
  reserve a number.
- Never edit or reuse an applied migration filename.
- Preserve migration checksums and the current `schema_migrations` contract.
- Apply each migration in its own transaction through the existing runner.
- Version JSON payload definitions independently from migration versions.

### 9.2 Forward Compatibility

Future readers must tolerate:

- Legacy Applications without Company, ResumeSnapshot, exact URL, or copied
  context until migration backfill completes.
- Generic legacy Interview events.
- Unknown future event metadata fields within a versioned payload.
- Future Company alias and merge fields if those deferred extensions are later
  implemented.
- Snapshot payloads produced by older parser and normalization versions.
- Missing or stale derived caches.

New required relationships are introduced as nullable during compatibility
backfill unless a truthful deterministic value exists for every installed row.
They become required for new writes before legacy nulls are constrained.

### 9.3 Migration Ordering

The recommended logical order is:

1. Extend Applications and `application_history` with compatibility linkage,
   event projection metadata, legacy provenance, and required query paths.
2. Reconcile existing aggregate-only, history-only, divergent, and legacy-date
   records without forcing them to equal `jobs.status`.
3. Add ResumeSnapshots and capture-time qualification relationships without
   creating snapshots for existing Applications.
4. Add Companies and conservative exact-normalized-name associations while
   retaining all Job company text.
5. Add only the query-driven indexes required for approved Phase 8 reads.

No Phase 8 migration adds a physical User, FollowUp, Reminder, AnalyticsCache,
additional ApplicationMaterial, generalized recommendation history, or
additional snapshot-interpretation history.

These may be separate migrations to reduce rebuild risk and make preservation
tests precise. Migration SQL design remains a later implementation task.

### 9.4 Legacy Reconciliation Matrix

Migration must classify each legacy Job/Application/history combination before
building V2 projections:

| Legacy condition                                                             | Required treatment                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application aggregate plus consistent status-bearing history                 | Preserve all IDs and rows, link events to the Application, derive the V2 projection from events, and retain original aggregate values for verification.                                                                                                                 |
| Application aggregate with no history                                        | Preserve the aggregate, append Legacy State Imported with aggregate status and provenance, and import any unsupported applied date with conservative precision.                                                                                                         |
| Status-bearing application history with no Application aggregate             | Create one Application for the Job, preserve and link every event, and derive projection values from that history.                                                                                                                                                      |
| Note-only application history with no aggregate                              | Create one Application with Unknown Legacy State, append a Legacy State Imported event, and preserve/link the Note events. Do not infer Applied.                                                                                                                        |
| Aggregate status diverges from latest history                                | Preserve the aggregate's current compatibility state by appending Legacy State Imported with unknown occurrence time and migration record time after the linked legacy ledger. Retain the original aggregate timestamps only as provenance, not as proof of event time. |
| Aggregate applied date has a matching Applied history event                  | Derive from that event and use the event's supportable precision.                                                                                                                                                                                                       |
| Aggregate applied date has no matching Applied event                         | Append Legacy Applied Date Imported and mark precision approximate or unknown. Do not claim the timestamp was user-recorded.                                                                                                                                            |
| Application-related Job status with no aggregate or application history      | Preserve the Job workflow unchanged and report it as unreconciled; do not create application history from Job status alone.                                                                                                                                             |
| Job status moved out of an application state while aggregate/history remains | Preserve both. Application projection derives from ApplicationEvents; Job status remains the compatibility workflow value until an approved event changes it.                                                                                                           |
| History events share an occurrence time or were entered out of order         | Preserve original times and IDs. Use recorded time and stable ID as deterministic tie-breakers without changing occurrence values.                                                                                                                                      |
| Legacy occurrence or creation text is date-only, non-UTC, or unparseable     | Preserve the original text. Add a normalized sort value only when conversion is unambiguous; otherwise use recorded sort and stable ID with unknown or approximate precision.                                                                                           |
| Application-protected Job has no remaining source association                | Preserve the Job and Application. Leave unavailable source relationship null while retaining any copied source context.                                                                                                                                                 |
| Existing Application ID equals Job ID                                        | Preserve the ID exactly. Do not rewrite it to match the ID format used by new Applications.                                                                                                                                                                             |

Migration must reconcile history-only and aggregate-only records before adding
any final relationship constraint that would reject them. Reconciliation counts
and classifications must be available to migration verification so a populated
upgrade can prove that no legacy application evidence was dropped.

### 9.5 Data Preservation Rules

- Preserve every relevant Job, Application, application-history, and
  job-status-history ID and row present when the Phase 8 migration begins.
- Preserve existing Application status, applied date, last-event date, notes,
  and timestamps before deriving V2 projections.
- Do not infer a specific interview stage from generic Interview.
- Do not create ResumeSnapshots from current Resume state for historical
  Applications.
- Do not infer an application URL from the Job's current URL list.
- Do not infer a Company through fuzzy matching.
- Do not delete old recommendation, score-history, analytics, source,
  observation, or resume data as Phase 8 cleanup.
- Preserve jobs protected by existing application aggregates or history during
  source deletion.
- Treat FTS and future caches as rebuildable and outside preservation counts.

### 9.6 SQLite Table Rebuilds

Current status and event vocabularies are protected by SQLite checks. Expanding
them may require rebuilding affected tables. Any rebuild must:

- Copy all columns and rows, including values not used by the new feature.
- Preserve primary keys and foreign-key references.
- Recreate every existing index and constraint intentionally.
- Preserve the restrictive Job-to-`application_history` relationship established
  by Milestone 8.2.
- Preserve the ordinary ApplicationEvent update/delete rejection established by
  Milestone 8.2; migration rewrites must finish before those guards are recreated.
- Use temporary child-reference protection where required, following the proven
  migration pattern used for run-table reconstruction.
- Run foreign-key and integrity checks before commit or startup completion.
- Include a populated-upgrade test with legacy applications and histories.

### 9.7 Rollback Philosophy

Job Browser uses forward migrations, not down migrations.

- A failure inside an unapplied migration rolls back that migration transaction.
- A desktop upgrade must retain the existing SQLite pre-migration backup
  behavior until the expanded persistence-set backup supersedes it.
- The backup boundary begins only after normal SQLite crash recovery and
  integrity verification. The approved Section 10.20 boundary must be
  implemented before Phase 8 data is considered durable.
- If a released migration is semantically wrong, recovery uses a verified
  backup restore or a new forward corrective migration; the applied file is not
  edited.
- Destructive rollback that would discard new ApplicationEvents or snapshots is
  prohibited.
- Snapshot, Resume, and authoritative preference-file changes require the
  coordinated persistence-set manifest because a SQLite backup alone cannot
  restore external files.

### 9.8 Validation Before Release

A future implementation is not complete until it verifies:

- First-run creation from an empty database.
- Upgrade from a populated migration-head database.
- Legacy application IDs, null applied dates, status divergence, generic
  interview history, aggregate-only history, history-only records, note-only
  history, and source-less retained jobs.
- Preservation of all existing row counts and foreign-key references expected
  to survive.
- Event-to-projection rebuild equivalence.
- ResumeSnapshot file/hash/path integrity and failure recovery.
- Company backfill without fuzzy merges.
- On-demand analytics equivalence and preservation of existing derived outputs.
- SQLite integrity and foreign-key checks.
- Desktop pre-migration backup and restore behavior for the expanded persistence
  set.
- Abnormal-shutdown recovery with a non-empty WAL containing committed
  application data.

### 9.9 Future Schema Evolution

- New event types require a definition version and compatibility mapping.
- New snapshot parser outputs require a new payload version; old payloads remain
  readable.
- Company merges use stable identities and explicit redirects, not destructive
  ID reuse.
- Multiple application attempts require relaxing the current Job uniqueness only
  after product behavior is approved.
- Analytics definitions and prediction outputs carry independent versions and
  never rewrite observed data.
- Columns or tables retained for compatibility are removed only through a
  separately approved deprecation plan with at least one successful migration
  cycle.

## 10. Architecture Decision Register

Every question raised during the Database V2 review is resolved below. These
statuses approve architecture for later implementation; they do not claim that
the current schema or runtime already implements it.

- **APPROVED FOR PHASE 8:** Required in the first Phase 8 implementation unless
  a new architecture review changes the decision.
- **DEFERRED:** Explicitly excluded from the first Phase 8 implementation. No
  migration or partial behavior may be added implicitly.
- **FUTURE ARCHITECTURE:** Requires a broader product, privacy, or system design
  and must not shape Phase 8 schema as if that design already existed.

### 10.1 ResumeSnapshot Representation

**Status:** APPROVED FOR PHASE 8

**Decision:** Should snapshot content be fully normalized, stored only as JSON,
or use a hybrid representation?

**Possible approaches:** Fully normalized relational fields; one opaque JSON
document; immutable file plus versioned JSON and normalized relationships for
query-critical dimensions.

**Advantages:** Full normalization provides strong queries and constraints. JSON
evolves easily. The hybrid preserves exact content, supports schema evolution,
and keeps Skills and Certifications queryable.

**Disadvantages:** Full normalization creates a large schema before parsing
requirements stabilize. JSON-only storage weakens integrity and analytics.
Hybrid storage requires versioning and consistency rules across representations.

**Resolution:** Use the hybrid design in Section 5: immutable local file,
versioned normalized payload, and explicit Skill/Certification relationships.

**Confidence:** High. It preserves current file-based storage and avoids making
an unstable parser schema the only historical representation.

### 10.2 Snapshot Files, Backup, and Restore

**Status:** APPROVED FOR PHASE 8

**Decision:** Should snapshots copy file bytes, or retain only metadata and a
hash pointing to the mutable Resume file?

**Possible approaches:** Reference the original file; copy an immutable local
snapshot; store file bytes inside SQLite.

**Advantages:** Referencing avoids duplicate files. Copying preserves history
and fits current filesystem storage. SQLite blobs simplify single-file backup.

**Disadvantages:** References break when a Resume is deleted or replaced.
Copies require coordinated backup. Large blobs increase database size and
migration/backup cost.

**Resolution:** Copy immutable files into a managed snapshot directory. Release
snapshot support only with the coordinated persistence-set manifest in Section
5.8, covering SQLite, Resume files, snapshot files, and authoritative
application-managed profile/scoring preference files.

**Confidence:** High. Historical accuracy cannot depend on a mutable source
file, and the current architecture already stores resume files outside SQLite.

### 10.3 Multiple Applications to the Same Job

**Status:** APPROVED FOR PHASE 8

**Decision:** Must Phase 8 support repeated application attempts to the same
canonical Job?

**Possible approaches:** Preserve one Application per Job; allow many attempts
immediately; model one Application with attempt subrecords.

**Advantages:** One-per-job preserves current semantics and minimizes migration
risk. Multiple rows model reapplications accurately. Attempt subrecords retain
one aggregate but add another lifecycle layer.

**Disadvantages:** One-per-job cannot separate distinct attempts. Immediate
many-attempt support makes legacy event ownership and UI behavior ambiguous.
Attempt subrecords add unapproved complexity.

**Resolution:** Preserve the existing one-Application-per-Job uniqueness for the
first Phase 8 implementation. Keep independent Application IDs and event linkage
so the uniqueness rule can be relaxed through a later approved migration.

**Confidence:** Medium. Current behavior supports one application, while product
requirements do not yet define reapplication.

### 10.4 Lifecycle Transition Enforcement

**Status:** APPROVED FOR PHASE 8

**Decision:** Which status transitions are valid, and which outcomes may reopen?

**Possible approaches:** Enforce a strict state graph; permit any event and
derive the latest state; enforce common transitions while allowing explicit
administrative correction/import events.

**Advantages:** Strict transitions prevent mistakes. Permissive events preserve
real-world irregularity. A hybrid supports normal validation and historical
imports.

**Disadvantages:** Strict graphs can reject legitimate recruiter behavior.
Fully permissive writes can create confusing timelines. Hybrid rules require
the feature specification to define exceptions.

**Resolution:** Do not impose a strict state graph. Normal creation starts with
Applied; after creation, any approved selectable lifecycle event may follow any
other, including an event after an outcome. Imports and corrections use their
explicit provenance rules. `FEATURE_SPEC_APPLICATIONS.md` owns the user-facing
behavior.

**Confidence:** Medium-high. The permissive rule avoids false terminal locks
while the feature specification supplies explicit user-facing semantics.

### 10.5 Legacy Application State Reconciliation

**Status:** APPROVED FOR PHASE 8

**Decision:** How should an existing aggregate with no matching factual history
be made event-derived?

**Possible approaches:** Trust the aggregate without an event; synthesize a
normal lifecycle event; append an explicitly marked Legacy State Imported event.

**Advantages:** Trusting the aggregate avoids new history but breaks event
derivation. A normal event simplifies queries. A legacy import event preserves
the state while disclosing uncertainty.

**Disadvantages:** Aggregate-only status remains irreproducible. A normal event
fabricates observation precision. A legacy event requires projection support.

**Resolution:** Append Legacy State Imported with the original status and retain
aggregate timestamps as migration provenance only when no existing event can
support the aggregate. Its occurrence time remains unknown unless factual
history supports one.

**Confidence:** High. This is the only approach that preserves both state and
epistemic accuracy.

### 10.6 Company Alias and Merge Governance

**Status:** APPROVED FOR PHASE 8

**Decision:** How are aliases approved and duplicate Companies merged?

**Possible approaches:** Automatic fuzzy matching; exact normalized matching
only; exact backfill followed by explicit user/admin-reviewed aliases and merges.

**Advantages:** Fuzzy matching reduces manual work. Exact matching is safe.
Reviewed merges improve quality without silently combining employers.

**Disadvantages:** Fuzzy matching can corrupt all downstream analytics. Exact
matching leaves aliases separate. Reviewed merges require a future management
workflow.

**Resolution:** Use exact existing normalized-company equality for migration and
initial ingestion. Never fuzzy-merge automatically. Alias management, duplicate
review, and merge redirects are deferred.

**Confidence:** High. Existing discovery already avoids unsafe similarity
merges, and Company analytics amplifies identity errors.

### 10.7 User Entity and CandidateProfile Ownership

**Status:** FUTURE ARCHITECTURE

**Decision:** Should a physical local User be introduced now, and how should
existing CandidateProfiles relate to it?

**Possible approaches:** Keep ownership implicit; create one singleton User only
for new entities; create a singleton User and backfill all user-owned current
entities.

**Advantages:** Implicit ownership is minimal. New-only ownership reduces
touches. Full backfill gives consistent privacy, deletion, and future local-user
boundaries.

**Disadvantages:** Implicit ownership makes later sync or deletion ambiguous.
New-only ownership leaves split semantics. Full backfill touches several
existing tables and profile stores.

**Resolution:** Keep Phase 8 ownership implicit at the installation boundary. Do
not add a User table, owner columns, authentication identity, or partial owner
foreign keys. A future User architecture must address Job workflow state,
Applications, Resumes, CandidateProfiles, defaults, settings, saved filters,
preference files, derived outputs, deletion, and synchronization together.

**Confidence:** Medium-high. Explicit ownership is valuable, but profile data
also exists outside SQLite and requires coordinated design.

### 10.8 Application Context Snapshot Granularity

**Status:** APPROVED FOR PHASE 8

**Decision:** How much Job context should be copied into Application?

**Possible approaches:** Rely entirely on Job; copy minimal display/application
fields; create a complete immutable Job snapshot.

**Advantages:** Job-only storage is normalized. Minimal copying preserves the
historically important title, company, source, URL, and location. Full snapshots
preserve every listing detail.

**Disadvantages:** Job-only history changes over time. Minimal copies cannot
reconstruct the full posting. Full snapshots duplicate large descriptions and
provider data without an approved use case.

**Resolution:** Copy the minimal context defined in Section 3 and retain the
Job relationship. Do not add full Job snapshots until a feature requires them.

**Confidence:** High. It closes the known historical gap without redesigning
the discovery model.

### 10.9 Additional Application Materials

**Status:** DEFERRED

**Decision:** How should cover letters and multiple submitted documents be
retained?

**Possible approaches:** Add fields directly to Application; create a generic
immutable ApplicationMaterial entity; defer storage and retain only user notes.

**Advantages:** Direct fields are simple for one cover letter. A material entity
supports multiple files and versions. Deferral avoids inventing unapproved file
behavior.

**Disadvantages:** Direct fields do not scale and repeat snapshot concerns. A
material entity expands scope. Deferral leaves the existing feature requirement
incomplete.

**Resolution:** Add no cover-letter field or ApplicationMaterial persistence in
Phase 8. If later approved behavior requires submitted-file retention, prefer a
generic immutable ApplicationMaterial patterned after ResumeSnapshot rather than
one-off mutable paths.

**Confidence:** Medium. Historical materials are valuable, but only resume
snapshots currently have sufficient approved requirements.

### 10.10 FollowUps and Reminders

**Status:** DEFERRED

**Decision:** Should the existing planned `followups` and `reminders` backlog be
implemented with the first application migration?

**Possible approaches:** Add both immediately; model reminders as events; defer
until user behavior and scheduling semantics are specified.

**Advantages:** Immediate tables complete the old backlog. Events reduce entity
count. Deferral prevents persistence from defining UI and scheduling behavior.

**Disadvantages:** Immediate design risks unused fields and incorrect lifecycle
rules. Event-only reminders mix future intent with observed history. Deferral
postpones reminder support.

**Resolution:** Add neither entity nor reminder events in Phase 8. A later
feature revision must define ownership, recurrence, completion, dismissal, and
recovery before persistence is designed.

**Confidence:** High. The approved feature specification explicitly excludes
these workflows and does not define scheduling semantics.

### 10.11 Analytics Computation and Caching

**Status:** APPROVED FOR PHASE 8

**Decision:** Should application analytics be generated on demand or persisted
in caches from the first release?

**Possible approaches:** Always calculate from events; eagerly maintain
statistics tables; calculate on demand and add versioned cache entries only for
measured expensive queries.

**Advantages:** On-demand calculation is simple and always current. Eager
projections are fast. Conditional caching balances correctness and performance.

**Disadvantages:** On-demand queries may slow as history grows. Eager aggregates
create complex invalidation. Conditional caching requires measurement and cache
versioning.

**Resolution:** Calculate installation-local outcome analytics on demand. Do not
create AnalyticsCache in Phase 8. Any later cache proposal requires a new
evidence-backed decision.

**Confidence:** High. Local application volumes do not justify speculative
aggregate maintenance, and events remain the reliable source.

### 10.12 Event Immutability and Privacy Deletion

**Status:** APPROVED FOR PHASE 8

**Decision:** How should append-only events coexist with correction and a future
user deletion request?

**Possible approaches:** Permit event edits; append corrections but never
delete; append corrections during normal use and allow explicit aggregate/user
purge.

**Advantages:** Edits are simple but destroy auditability. Never deleting
maximizes history. Explicit purge preserves normal immutability while supporting
user control.

**Disadvantages:** Edits corrupt derived history. Never deleting may conflict
with privacy expectations. Purge requires coordinated cache, snapshot-file, and
foreign-key cleanup.

**Resolution:** Use append-only events with explicit replacement or void events
for normal correction. Phase 8 provides no routine hard-delete or purge path. A
future coordinated purge must separately define dependent derived-output,
snapshot-file, active-data, and backup behavior.

**Confidence:** High. This preserves analytical integrity without claiming that
immutability overrides user privacy.

### 10.13 Anonymous Cross-Installation Analytics

**Status:** FUTURE ARCHITECTURE

**Decision:** Will local outcome records ever contribute to anonymous cohort
statistics?

**Possible approaches:** Never share; export only user-initiated reports; add an
opt-in anonymized contribution pipeline in a later phase.

**Advantages:** Local-only storage has the strongest privacy boundary. Manual
export gives user control. Opt-in cohorts could support the product's long-term
evidence vision.

**Disadvantages:** Local-only data cannot produce population evidence. Manual
exports are not a cohort system. Opt-in collection requires substantial consent,
anonymization, abuse, deletion, and bias controls.

**Resolution:** Keep Database V2 local-only. Treat cohort contribution as a
separate future architecture with no schema assumptions in Phase 8.

**Confidence:** High for Phase 8; low for the long-term product decision because
the privacy and product requirements do not yet exist.

### 10.14 Cache Performance Thresholds

**Status:** DEFERRED

**Decision:** What measured threshold justifies AnalyticsCache or additional
event indexes?

**Possible approaches:** Set a fixed latency target now; use dataset-size
thresholds; establish targets during implementation with representative local
data and query plans.

**Advantages:** Fixed targets are clear. Size thresholds are easy to test.
Measured implementation targets reflect actual hardware and query behavior.

**Disadvantages:** Premature fixed values may be arbitrary. Size alone does not
predict query cost. Measurement requires a performance fixture and review.

**Resolution:** No AnalyticsCache threshold is needed in Phase 8 because the
cache is deferred. Before any future cache migration, define a representative
database, record query plans and latency, and approve a desktop interaction
budget. Phase 8 indexes still require query-plan evidence.

**Confidence:** High. This follows the existing measured large-data testing
practice without inventing an unsupported numeric target.

### 10.15 Append-Only Enforcement Mechanism

**Status:** APPROVED FOR PHASE 8

**Decision:** Should ApplicationEvent immutability be enforced only by
repositories or also by database constraints?

**Possible approaches:** Repository convention only; database protection only;
repository protection plus database rejection of ordinary update/delete paths
with a separate explicit purge mechanism.

**Advantages:** Repository-only enforcement is simple and migration-friendly.
Database enforcement protects every caller. Layered enforcement provides clear
application errors and defense against accidental direct writes.

**Disadvantages:** Repository convention can be bypassed by scripts. Database
rules can obstruct migrations and privacy purge if not designed carefully.
Layered enforcement requires a narrowly controlled maintenance path.

**Resolution:** Enforce append-only behavior in both persistence APIs and the
SQLite boundary for ordinary operations. Controlled migrations may rebuild the
protected table deliberately. No product deletion bypass is added until a
coordinated purge is approved and tested separately.

**Confidence:** Medium-high. Database enforcement is appropriate for historical
facts, but its exact SQLite mechanism must preserve migration and purge safety.

### 10.16 Snapshot Reprocessing

**Status:** DEFERRED

**Decision:** How should improved parsing or normalization be persisted for an
existing ResumeSnapshot?

**Possible approaches:** Overwrite the snapshot payload; create a duplicate
snapshot; append a versioned ResumeSnapshotInterpretation child.

**Advantages:** Overwrite is simple. A duplicate preserves both outputs but
misrepresents capture identity. Interpretation children preserve immutable
capture and allow analytical comparison across definition versions.

**Disadvantages:** Overwrite destroys historical explainability. Duplicate
snapshots fragment application relationships. Child interpretations add a
version-selection rule to analytics.

**Resolution:** Preserve one immutable capture-time interpretation in Phase 8;
do not add post-capture reprocessing. If later approved, reprocessing appends a
versioned ResumeSnapshotInterpretation and never overwrites the capture-time
payload.

**Confidence:** High. Deferral preserves artifact identity without introducing
an unneeded interpretation-selection rule in the first release.

### 10.17 Recommendation History Retention

**Status:** APPROVED FOR PHASE 8

**Decision:** Which recommendation outputs require durable history rather than
only current cache state?

**Possible approaches:** Keep only the current RecommendationCache; retain only
the existing numerical `score_history`; append versioned history for every
material user-visible recommendation or future prediction.

**Advantages:** Current-only storage is minimal. Existing score history preserves
today's scoring behavior. Generalized history supports explainability and audit
across changing rules.

**Disadvantages:** Current-only values cannot explain past decisions. Existing
score history omits some explanations and inputs. Generalized history increases
sensitive derived data and retention requirements.

**Resolution:** Preserve the existing `recommendations`, `score_history`, and Job
score projections with their current semantics. Add no generalized
recommendation-history or prediction entity in Phase 8.

**Confidence:** Medium-high. Explainability requires history, but exact retention
duration remains a privacy/product decision.

### 10.18 Purge and Backup Retention

**Status:** DEFERRED

**Decision:** What happens to application and resume data already present in
application-managed backups when privacy deletion is requested?

**Possible approaches:** Purge only active storage; automatically delete every
application-managed backup; let the user choose active-only or active-plus-backup
purge under a documented retention policy.

**Advantages:** Active-only purge is operationally simple. Automatic backup
deletion maximizes erasure. User choice preserves recovery while making retained
copies explicit.

**Disadvantages:** Active-only purge leaves sensitive copies. Automatic deletion
can destroy the user's recovery path unexpectedly. User choice requires backup
inventory, manifest support, and clear warnings.

**Resolution:** Do not implement active-data or backup purge behavior in the
first Phase 8 release. Retention policy, backup inventory, deletion choice,
disclosure, and recovery consequences require a separate privacy and product
approval.

**Confidence:** Medium. The persistence requirement is clear, but retention UX
and legal expectations require separate privacy approval.

### 10.19 Application Job Reassignment

**Status:** DEFERRED

**Decision:** How is an Application corrected when it was attached to the wrong
Job?

**Possible approaches:** Update foreign keys in place; move all events to the new
relationships; create a replacement Application and preserve an administrative
correction link to the original.

**Advantages:** In-place update is simple. Moving events keeps one aggregate.
Replacement preserves the original audit and makes the correction explicit.

**Disadvantages:** In-place changes silently reinterpret every event. Moving
events changes their historical meaning. Replacement requires a dedicated invalid
or superseded-aggregate workflow and careful uniqueness handling.

**Resolution:** Prohibit direct reassignment after any event exists. Define
an explicit replacement-Application correction workflow before supporting this
case; preserve the original aggregate and events until that workflow is approved.
No migration should add a generic reassignment operation.

**Confidence:** Medium-high. Silent reassignment is unsafe, while the exact
user-facing correction workflow is not yet specified.

### 10.20 WAL Crash Recovery Boundary

**Status:** APPROVED FOR PHASE 8

**Decision:** How should startup handle SQLite WAL and shared-memory sidecars
after an abnormal shutdown before migration backup begins?

**Possible approaches:** Delete sidecars before opening; let SQLite perform
normal WAL recovery; quarantine the database set and require manual recovery.

**Advantages:** Deletion simplifies startup but may discard recoverable committed
pages. Normal SQLite recovery preserves its durability contract. Quarantine is
conservative when integrity cannot be established.

**Disadvantages:** Sidecar deletion risks data loss. Normal recovery requires the
database, WAL, and shared-memory files to remain a coherent set. Quarantine can
interrupt startup and requires recovery UX.

**Resolution:** Treat the database and WAL sidecars as one crash-recovery
set. Allow SQLite to recover normally, run integrity checks, and only then create
the pre-migration backup. Quarantine and surface recovery actions if the set
cannot be opened safely; never discard WAL solely as startup cleanup.

**Confidence:** High. Durable ApplicationEvents require SQLite's committed crash
recovery state to survive before any migration or backup operation.

### 10.21 CandidateProfile Authority Consolidation

**Status:** APPROVED FOR PHASE 8

**Decision:** Should the editable CandidateProfile remain file-authoritative or
move fully into SQLite?

**Possible approaches:** Keep versioned preference files authoritative; make
SQLite authoritative and migrate the files; retain files for editing while
storing immutable analysis-input snapshots in SQLite.

**Advantages:** File authority preserves current runtime behavior. SQLite
authority centralizes backup, ownership, and transactions. A split between
editable current preferences and immutable analysis inputs preserves history
without pretending one mutable row describes old runs.

**Disadvantages:** File authority complicates coordinated backup and purge.
SQLite authority requires runtime and compatibility changes outside this task.
A split model requires explicit identity and conflict rules.

**Resolution:** Keep the current versioned preference file authoritative for
editable profile state during Phase 8, with legacy candidate/scoring files as
fallback. Align every analysis entry point to the shared file resolver. Treat
`candidate_profiles` as the durable analysis identity. Do not add immutable
analysis-input snapshots or consolidate authority in SQLite because generalized
recommendation history is deferred. Include every application-managed preference
file used by the resolver in the backup manifest. Full SQLite consolidation and
purge behavior require separate architecture decisions.

**Confidence:** Medium-high. This preserves current runtime authority without
expanding Phase 8; future generalized recommendation history must resolve its own
immutable input requirements.
