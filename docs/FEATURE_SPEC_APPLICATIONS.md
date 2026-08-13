# Feature Spec: Application Management

> **Authority:** This document defines current user-facing application behavior
> and the approved first Phase 8 Application Management release. Persistence
> invariants belong in `DATABASE_V2.md`; delivery order belongs in
> `IMPLEMENTATION_ROADMAP.md`.

## Overview

Application Management extends discovered Jobs into a durable record of actions
and outcomes. Job Browser records an application; it does not submit one or
interact with an employer's application system on the user's behalf.

The first Phase 8 release adds a dedicated application list, detail view, and
immutable timeline over the basic application persistence that already exists.
One Application represents at most one application attempt for a Job.

## Current Behavior

The current product implements the Milestone 8.3 Application Management
workflow over the existing Job compatibility foundation:

- `/applications` provides status and case-insensitive exact Company filters,
  recent-activity ordering, and opaque cursor pagination.
- `/applications/:applicationId` provides immutable copied context, mutable
  summary notes, and the complete correction-aware timeline.
- The Jobs workflow and Job detail panel provide a visible Applied confirmation
  flow. Lifecycle, Note, replacement, and Void dialogs support exact or
  date-only occurrence entry and accessible keyboard/focus behavior.
- The six loopback REST endpoints cover list, detail, timeline, Applied-only
  creation, one discriminated event union, and summary notes. They return stable
  bounded `400`, `404`, and `409` errors and add no IPC.
- Retry-safe commands retain the client-allocated opaque Event ID and canonical
  payload. Event append, `ApplicationRepository.reproject()`, and post-fold Job
  compatibility commit in one transaction; summary notes do not synchronize the
  Job, and a Legacy State Imported winner does not auto-map.
- `JobRepository.changeStatus()` retains dashboard and Job workflow
  compatibility through the same canonical projection fold.

Migration `016_application_event_foundation.sql` remains untouched. Migration
`017_application_management_indexes.sql` supplies the exact list, status,
Company, and timeline access paths and protects copied context, identity, and
user-event metadata definition. `applications`, `application_history`, and
`application_effective_events` remain the only aggregate, ledger, and effective
projection boundary.

> **Milestone status (2026-08-10):** Milestone 8.3 is Architect-approved.
> Milestone 8.4 (ResumeSnapshot capture on Applied/replacement events) is
> complete in the current worktree; final Architect acceptance is being
> requested. Phase 8 is not complete. Coordinated backup/restore, Company
> identity, outcome analytics, and integrated release certification remain
> unimplemented and belong to later milestones.

## Goals

- Preserve an understandable, append-only history for each Application.
- Make current status, application-time context, and recent activity visible.
- Record richer outcomes without losing compatibility with the existing Job
  workflow.
- Preserve the exact Resume used when the user identifies one.
- Support truthful historical entry, including unknown or imprecise legacy data.
- Keep all authoritative application actions available offline.

## Non-Goals

The first Phase 8 release does not:

- Submit applications or messages to employers.
- Support multiple application attempts for one Job.
- Store cover letters or additional submitted documents.
- Add FollowUps, Reminders, scheduled actions, or notifications.
- Add Application archiving, hard deletion, privacy purge, or Job reassignment.
- Add a User account, owner ID, authentication, sync, or cross-install analytics.
- Add outcome predictions or change current deterministic recommendation
  behavior.

## User Stories

- As a job seeker, I can record that I applied to a discovered Job without
  creating duplicate Applications if a request is retried.
- As a job seeker, I can record recruiter contact, interview stages, offers, and
  outcomes with the date they occurred.
- As a job seeker, I can view the current state and the complete timeline that
  produced it.
- As a job seeker, I can correct a mistaken event without erasing the original
  record.
- As a job seeker, I can record the exact application URL and Resume I used.
- As a job seeker, I can distinguish application-time title, Company, location,
  and source context from later Job updates.
- As a returning user, I retain all current Application IDs, history, and coarse
  Job workflow behavior after migration.

## Application Creation

### Normal Creation

A normal new Application is created when the user records Applied for a Job.
The operation appends the Applied event and creates the current Application
projection atomically. A retry of the same command must not create a second
Application or duplicate event.

At most one Application may exist for a Job. Recording a later lifecycle event
updates that Application; it never creates another attempt. Reapplication
behavior is deferred.

Saved, Interested, Resume Ready, and similar pre-application organization remain
part of the Job workflow. They do not create an Application.

### Historical and Migrated Creation

The user may record an Application after the fact by supplying a supportable
Applied date. Backdated entry is allowed. Date-only input remains date-only and
must not be displayed as an exact timestamp.

Migration may create an Application from existing aggregate or history evidence
without fabricating an Applied observation. Migration-only Legacy State Imported
and Unknown Legacy State values preserve uncertainty and are never selectable by
the user.

### Application-Time Context

Applied creation pre-fills the following context for visible user confirmation or
correction. The confirmed values are copied when the Applied event is recorded:

- Job title and Company display name.
- Location when present.
- Exact application URL selected or entered by the user when present.
- Source ID, provider ID, and source label when known.

The Application retains its Job relationship, but later discovery refreshes do
not rewrite copied context. The first release does not copy the full Job
description or provider payload.

## Lifecycle Model

Application current state is the latest effective status-bearing event ordered
by occurrence time, record time, and stable event identity. The Application row
is a query projection; the timeline is the authority.

### Selectable Statuses

| Status              | User-facing meaning                                                         | Outcome class |
| ------------------- | --------------------------------------------------------------------------- | ------------- |
| Applied             | Creation only: the application was submitted to the employer or its system. | Active        |
| Recruiter Contact   | A recruiter or employer made substantive application-related contact.       | Active        |
| Phone Screen        | An initial phone or video screening conversation occurred.                  | Active        |
| Technical Interview | A technical assessment or technical interview occurred.                     | Active        |
| Manager Interview   | An interview with the hiring manager or equivalent decision-maker occurred. | Active        |
| Final Interview     | The user identified an interview as the final interview stage.              | Active        |
| Interview           | Explicit fallback when the interview stage is unknown.                      | Active        |
| Offer               | The employer made an offer.                                                 | Active        |
| Accepted            | The user accepted an offer.                                                 | Outcome       |
| Rejected            | The employer communicated rejection.                                        | Outcome       |
| Ghosted             | The user explicitly recorded that the employer stopped responding.          | Outcome       |
| Withdrawn           | The user withdrew from consideration.                                       | Outcome       |

Interview (stage unknown) is an explicit fallback when a specific stage is not
known and also remains valid for migrated history and compatibility writes.
Dedicated Application actions present specific stages first. Unknown Legacy
State is migration-only.

Saved, Interested, Resume Ready, and Archived are not Application statuses in
the first Phase 8 release. Archived and deletion behavior remain deferred.

### Transitions and Reopening

The first release does not enforce a strict state graph. After creation, any
selectable non-Applied lifecycle event may follow any status event. Applied is
not exposed as a later lifecycle action; a factual correction to Applied uses
replacement. A later event after Accepted, Rejected, Ghosted, or Withdrawn
becomes the current state; the prior outcome remains visible in history.

This permissive event model represents real recruiter behavior without silently
rewriting prior facts. It must not be implemented as direct status editing.
Scheduled future interviews are not recorded as occurred events; scheduling and
reminders are deferred.

### Event Time

- New occurrence-bearing events default to the current time.
- For an occurrence-bearing command, the user may provide a past date, date and
  time, or date-only value.
- An occurrence-bearing event cannot be intentionally dated in the future. Void
  inherits the target's occurrence fields under the correction rules below.
- Occurrence time and record time remain distinct.
- Backdated entry may change the chronological timeline and derived projection.
- Unknown or approximate legacy precision remains visible and is not upgraded by
  migration.

## Timeline and Corrections

Across the first release, status events, Note events, and later Milestone 8.4
Resume-association corrections form the Application timeline. Events are
append-only after commit.

A user corrects an eligible current terminal event by appending a replacement or
Void event that identifies the target. Milestone 8.3 eligibility additionally
requires normalized recorded time and excludes Void, migration, and superseded
events. The current projection is rebuilt from the effective events. The target
and correction remain available in audit detail; ordinary timeline display may
visually de-emphasize superseded values but must identify that a correction
occurred.

A void is rejected if it would leave the Application without an effective
status-bearing event. Event editing and event deletion are not exposed as normal
operations.

Application summary notes are mutable and optimized for current context. A note
that must appear historically is appended as a Note event. Existing `jobs.notes`
remains Job-level compatibility state and is not silently migrated into an
Application note.

## Resume Association (Milestone 8.4)

Selecting a Resume is optional. The current default Resume is never associated
implicitly.

When the user selects a Resume while recording Applied:

1. Job Browser verifies and copies the exact file into immutable snapshot
   storage.
2. It records the capture-time normalized interpretation and integrity metadata.
3. It commits the ResumeSnapshot, Applied event, and Application projection as
   one logical operation.

If the selected Resume cannot be read, copied, hashed, or persisted, the
Application action fails without recording Applied. The user may retry or
explicitly record the Application without a Resume. Job Browser must never fall
back to the latest or default Resume.

An incorrect association is fixed with an append-only Resume-association
correction. Deleting or changing the library Resume does not alter a retained
snapshot.

## Job Workflow Compatibility

`jobs.status` remains the coarse Job-organization workflow during Phase 8. After
a status-bearing event, replacement, or Void is appended, the Application is
reprojected and the compatible Job status is derived from the post-fold current
Application status. A Job status and history row are written in the same
transaction only when that coarse value changes:

| Application status                                                                                                             | Compatible Job status |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| Applied or Recruiter Contact                                                                                                   | `applied`             |
| Phone Screen, Technical Interview, Manager Interview, Final Interview, or Interview (stage unknown or retained legacy generic) | `interview`           |
| Offer or Accepted                                                                                                              | `offer`               |
| Rejected or Ghosted                                                                                                            | `rejected`            |
| Withdrawn                                                                                                                      | `ignored`             |

An explicit Application action still appends its richer event when the coarse
Job status is already unchanged, such as moving from Phone Screen to Technical
Interview.

The existing Job-status API remains compatible: a change to `applied`,
`interview`, `offer`, or `rejected` appends the corresponding coarse Application
event and upserts the one Application. A no-op request for the Job's current
status appends nothing. Other direct Job-status changes do not infer an
Application event and never erase an existing Application.

## Views and Queries

The first release provides across Milestones 8.3 through 8.7:

- A paginated Application list with current status, copied title and Company,
  applied date when known, and recent activity.
- Filters for current status and Company.
- An Application detail view with copied application-time context, exact
  application URL, submitted ResumeSnapshot when known, summary notes, and Job
  link.
- A chronological timeline with status, notes, occurrence precision, and visible
  correction state.
- History queries that distinguish current outcome from ever reaching an
  outcome.

Unknown Company, Resume, source, URL, or date values remain visible as unknown;
the UI does not guess them from current Job or Resume state.

## Validation Rules

- Job ID must identify an existing retained Job.
- A second Application for the same Job is an idempotent replay only when the
  Event ID, complete canonical command payload, and copied Application context
  match. A different Event ID or payload is a conflict that identifies the
  existing Application; another attempt is never inserted.
- User-selectable event type and occurrence precision must be valid canonical
  values. The server derives resulting status from the validated event type.
- New application URLs, when supplied, must be absolute HTTP or HTTPS URLs.
- New Applied records require copied title and Company display text; location,
  source, URL, and Resume remain optional.
- A selected Resume must pass the complete snapshot operation or the action
  fails.
- Corrections must target an eligible current terminal event in the same
  Application, require normalized recorded time, exclude Void and migration
  events, and must not create a supersession cycle.
- Application writes must complete locally and transactionally without a
  provider request.

## Milestone 8.3 Architect Decisions

This section is the binding product and API contract for Milestone 8.3. It
resolves implementation choices that were intentionally left open by the
broader first-release specification. The completed implementation follows these
decisions; a change requires a new Architect decision.

### Creation and Idempotency

- Only the Applied creation command creates an Application. Note, lifecycle,
  replacement, and Void commands require an existing Application.
- The client allocates an opaque Event ID before its first request and reuses it
  on retry. UUID generation is permitted, but readers must continue to accept
  opaque non-UUID IDs.
- The server allocates the Application ID during the first successful creation
  transaction. Application ID is not part of the client command.
- An Applied creation request is idempotent only when its Event ID and complete
  canonical command payload match an existing creation event and Application
  context. The replay returns the existing event and current Application
  projection without a new write or timestamp change.
- Reusing an Event ID with any different command field is a conflict. Recorded
  time, server-generated Application ID, and other server bookkeeping values are
  excluded from command-payload equality.
- If an Application already exists for the Job under a different Event ID, the
  creation request is rejected with the existing Application ID. The caller must
  open that Application rather than create another attempt.
- Applied is a creation action in the dedicated Milestone 8.3 workflow. A later
  user correction to Applied uses replacement. The existing Job-status
  compatibility path may retain repeated coarse Applied events, but the new
  Application service does not expose repeated Applied as a lifecycle command.

### Lifecycle and Job Compatibility

- Dedicated lifecycle commands require an existing Application and accept
  Recruiter Contact, Phone Screen, Technical Interview, Manager Interview, Final
  Interview, Interview (stage unknown), Offer, Accepted, Rejected, Ghosted, and
  Withdrawn. Unknown Legacy State and migration event types are never
  user-selectable.
- Interview (stage unknown) is an explicit truthful fallback only when a more
  specific stage is not known. The UI should present the specific stages first.
- The lifecycle remains permissive: repeated non-Applied types and events after
  outcomes are allowed. No strict transition graph or terminal lock is added.
- After a status-bearing event, replacement, or Void is appended and the
  Application is reprojected, Job compatibility is derived from the post-fold
  current Application status, not directly from the new event.
- A `job_status_history` row is appended only when the coarse Job status changes.
  A rich event is still appended when its coarse mapping is unchanged.
- Note events and mutable summary-note updates never change `jobs.status` or
  append `job_status_history`.
- Legacy State Imported and Unknown Legacy State have no automatic Job-status
  mapping. Normal Milestone 8.3 commands cannot create either value.

### Time and Precision

- The API accepts an exact occurrence as an ISO-8601 date-time with `Z` or an
  explicit offset. It is normalized to UTC for sorting while retaining the
  canonical UTC source value.
- The API accepts date-only occurrence input as `YYYY-MM-DD`. The stored
  precision value is `date`; product copy may describe it as date-only.
- Date-only input retains the source date and uses that date at
  `00:00:00.000Z` only as a deterministic sort value. The sort value must never
  be displayed as an observed midnight time.
- Exact date-time entry from the desktop UI is interpreted in the local system
  timezone and converted to an ISO-8601 value with an explicit offset or `Z`
  before submission.
- Exact occurrences later than the current instant are rejected. Date-only
  values later than the local system calendar date are rejected; today is
  allowed.
- Recorded time is always server-generated UTC at the write boundary and is not
  accepted from the client.

### Copied Context, URL, and Source

- Applied creation pre-fills title, Company display text, and optional location
  from the retained Job, but the user must see and confirm those values before a
  historical or current Application is recorded. Title and Company are required.
- The user may correct the pre-filled title, Company text, or location before
  submission. The confirmed values become immutable application-time context.
- Milestone 8.3 provides no post-creation context-edit endpoint. A wrong Job
  association remains deferred, and a historical clarification may be recorded
  as a Note without silently rewriting copied context.
- Application URL is optional. The user may select one known Job application URL,
  enter another absolute HTTP/HTTPS URL, or explicitly record it as unknown.
- When more than one URL or source membership exists, no arbitrary value is
  selected silently. A single known value may be preselected only when it remains
  visible for confirmation.
- A selected Source ID must belong to the Job. Provider ID and source label are
  copied from backend-owned Source data rather than accepted as authoritative
  client text. A manually entered URL may have unknown source context.
- Company filtering in Milestone 8.3 uses case-insensitive exact matching of the
  copied Company display text. It does not create or resolve Company identity.

### Lists, Detail, and Timeline

- The Application list defaults to 25 rows and accepts at most 100 rows per
  request.
- List ordering is recent recorded activity descending, then Application ID
  ascending. Null activity sorts last. The cursor is an opaque base64url-encoded
  versioned payload containing `v: 1`, `lastRecordedAt`, and `applicationId`.
- List filters accept one current Application status and one case-insensitive
  exact copied-Company value per request. Multi-select filters are not part of
  Milestone 8.3.
- The list's recent-activity value is `last_recorded_at`. Detail may distinguish
  it from `last_event_at`.
- The timeline returns the complete audit ledger for one Application without a
  separate pagination contract. It is ordered chronologically by effective
  occurrence sort fallback, recorded sort, and stable Event ID, all ascending.
  One-Application scope is the approved natural bound.
- Timeline presentation must identify effective, superseded, replacement, and
  Void records. Audit detail is an expansion of the timeline record, not a
  separate product workflow.
- Milestone 8.3 exposes current-state filtering and the complete timeline. It
  does not add aggregate current-versus-ever outcome endpoints, rates, charts,
  or analytics; those remain Milestone 8.7 work.
- Application URLs open only through the existing approved external-link
  boundary. No Application-specific IPC or renderer filesystem access is added.

### Notes and Corrections

- Mutable Application summary notes use explicit save, are limited to 10,000
  characters, normalize an all-whitespace value to null, and use local
  last-write-wins behavior. Editing them creates no event.
- Immutable Note-event text is limited to 4,000 characters. It uses the normal
  occurrence-time contract and may be replaced or voided like another eligible
  terminal event.
- Correction targets must be current terminal events in the same Application.
  Superseded ancestors, Void events, Legacy State Imported, Legacy Applied Date
  Imported, and events without normalized recorded time are not eligible targets
  in Milestone 8.3.
- A status-bearing target may be replaced by a complete user-selectable
  status-bearing event of another canonical type. A Note target may be replaced
  only by another Note. Omitted core values are never inherited.
- A Void has no client-entered occurrence. It retains the target's occurrence
  source value, normalized sort value, and precision for deterministic audit
  placement, while its recorded time identifies when the correction was made.
- A terminal Void cannot itself be corrected or voided in Milestone 8.3. A later
  independent lifecycle fact may still be appended under the permissive model.
- A Void that would leave no effective status-bearing event is rejected.
- Correction reason text is optional and, when supplied, is stored as immutable
  event notes under the 4,000-character event-note limit.

### API Contract

Milestone 8.3 uses the following loopback REST surface:

| Method  | Endpoint                                    | Purpose                                                         |
| ------- | ------------------------------------------- | --------------------------------------------------------------- |
| `GET`   | `/api/applications`                         | Cursor-paginated projections and current-state filters.         |
| `GET`   | `/api/applications/:applicationId`          | Current projection and copied-context detail.                   |
| `GET`   | `/api/applications/:applicationId/timeline` | Complete ordered audit ledger and correction state.             |
| `POST`  | `/api/applications`                         | Create one Application with its first Applied event.            |
| `POST`  | `/api/applications/:applicationId/events`   | Append lifecycle, Note, replacement, or Void through one union. |
| `PATCH` | `/api/applications/:applicationId/notes`    | Update mutable summary notes only.                              |

Creation and event requests include the client-allocated Event ID. The event
endpoint uses a discriminated payload kind: `lifecycle`, `note`, `replace`, or
`void`. The server derives Application ID, Job ID, resulting status, recorded
time, actor, normalized sort values, and copied provider/source labels where
applicable.

Successful creation and new event writes return `201`. Identical idempotent
replays and successful note updates return `200`. Validation failures return
`400`, missing retained records return `404`, and existing-Application,
idempotency, stale-target, or correction-chain conflicts return `409`. Errors use
the existing bounded API error shape with a stable machine-readable code.

New explicit Application events use actor `user` and definition version
`application-event-v1`; the client cannot override either. Metadata is a
versioned object and remains optional beyond its required definition marker.

No event update/delete, Application delete/archive, ResumeSnapshot, Company,
analytics, reminder, follow-up, user, or synchronization endpoint is authorized
by Milestone 8.3.

### Release Boundary

Milestone 8.3 is implemented and verified independently, but it is not the
integrated Phase 8 release gate. ResumeSnapshot, coordinated backup/restore,
Company identity, analytics, and final Phase 8 release certification remain
Milestones 8.4 through 8.8. Milestone 8.3 adds no external managed files and
must not be described as completing Phase 8.

## Acceptance Criteria

These are first-release acceptance criteria. Milestone 8.3 completion covers the
criteria that do not require ResumeSnapshot, Company identity, analytics, or
another later-milestone boundary. ResumeSnapshot criteria belong to Milestone
8.4, and aggregate current-versus-ever history queries belong to Milestone 8.7.

- Marking a Job Applied creates exactly one Application and one effective Applied
  event while preserving the current Job workflow update.
- Retrying the same request does not duplicate the Application or event.
- Each selectable lifecycle action appends an immutable event and produces a
  projection reproducible from the effective timeline.
- A later event after an outcome changes current state without deleting the
  earlier outcome.
- A replacement or void preserves the original event and deterministically
  rebuilds the projection.
- Backdated and date-only events retain their input precision and deterministic
  ordering.
- Selecting a Resume either creates and associates a verified immutable snapshot
  or leaves the entire action uncommitted.
- Recording without a Resume succeeds without consulting the default Resume.
- Discovery refresh, Source deletion, Resume changes, and later Job Company
  grouping changes do not rewrite copied Application context or events.
- Migration preserves all existing Application and history IDs, handles
  aggregate-only and history-only data, and does not force Application state to
  equal `jobs.status`.
- Application list, detail, status filters, and timeline remain available
  offline and use bounded indexed queries.
- Ordinary repository calls and direct SQL cannot update or delete retained
  ApplicationEvents.

## Deferred and Future Expansion

The following require separate behavior and architecture approval:

- Multiple attempts or reapplications to one Job.
- Strict transition graphs or workflow-specific terminal locks.
- Application archive, hard delete, coordinated privacy purge, and backup purge.
- Replacement-Application correction for a wrong Job association.
- FollowUps, Reminders, recurrence, notifications, and scheduled interviews.
- Cover letters and generic immutable ApplicationMaterial records.
- Additional submitted Resume versions for one Application.
- User accounts, ownership reassignment, synchronization, and cross-install
  analytics.
