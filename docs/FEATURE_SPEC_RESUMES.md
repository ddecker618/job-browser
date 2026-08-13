# Feature Spec: Resume Management and Snapshots

> **Authority:** This document defines current Resume-library behavior and the
> approved first Phase 8 ResumeSnapshot behavior. Persistence mechanics belong
> in `DATABASE_V2.md`; recommendation and explanation behavior belongs in
> `FEATURE_SPEC_AI_ASSISTANT.md`.

## Overview

Resume Management provides a local library of uploaded career documents.
ResumeSnapshots add an immutable record of the exact document associated with an
Application so later library changes cannot rewrite application history.

Resume and ResumeSnapshot are separate concepts:

- **Resume:** Mutable library metadata and the current parse result for one
  uploaded local file.
- **ResumeSnapshot:** Immutable exact bytes, capture metadata, and capture-time
  interpretation associated with an Application.

The first Phase 8 release does not introduce logical resume families, editable
resume versions, or generated documents. Each upload remains an independent
Resume.

## Current Behavior

The current product already supports a local Resume library:

- Upload, list, rename, default selection, delete, and re-score operations.
- A 10 MiB upload limit.
- Local extraction from `.txt`, `.md`, `.docx`, and text-based `.pdf` files.
- Clear failure for scanned or image-only PDFs because OCR is unsupported.
- Skill and certification extraction by matching text against the current
  configured catalogs and aliases.
- Reviewable profile proposals for extracted qualifications not already in the
  editable CandidateProfile preferences.
- Persisted parsing status, parsing error, extracted values, file metadata, and
  the managed local file path.

Parsing failure does not normally reject the upload. The file and Resume row are
retained with `failed` status, an error, and empty extracted values. Unsupported
formats, including legacy `.doc`, follow this failed-record behavior even though
the current file picker advertises `.doc`.

The first uploaded Resume becomes the default. Selecting another default clears
the previous default. Renaming changes only the display name. Re-scoring combines
the Resume's current extracted qualifications with the current CandidateProfile
for a new analysis; it does not reparse or version the Resume.

Deleting a current Resume removes its database record and then its managed file
when present. Current application-managed backups copy SQLite only; they do not
back up Resume files or provide coordinated restore.

Current Resume rows retain absolute storage paths. Phase 8 must preserve those
paths during normal upgrade and make them portable during verified restore.

ResumeSnapshots are implemented in the current product (Milestone 8.4):
capture runs only when an Applied or resume-bearing replacement event records a
selected Resume, and the snapshot shares one transaction with the event and
Application projection. Coordinated backup/restore over the full persistence set
remains a later milestone.

## Goals

- Preserve current Resume-library identities and behavior through Phase 8.
- Keep exact uploaded documents and parsing local.
- Distinguish mutable current library state from immutable application-time
  evidence.
- Capture a selected Resume as one logical operation with the Application event.
- Preserve parser and normalization provenance for every snapshot.
- Back up and restore SQLite and managed career files as one verified persistence
  set.

## Non-Goals

The first Phase 8 release does not:

- Add OCR for scanned or image-only PDFs.
- Add `.doc` parsing.
- Group uploads into a resume family or revision chain.
- Replace an existing Resume file in place.
- Reprocess a historical snapshot with a new parser.
- Generate or export DOCX, tailored resumes, or cover letters.
- Add automatic file cleanup, snapshot deletion, or privacy purge behavior.
- Upload Resume or profile content to an external service.
- Change CandidateProfile or scoring preference authority from current local
  files to SQLite.

## Resume Library Behavior

### Upload and Identity

Each successful upload request creates a new Resume identity and a managed local
file. Uploading the same bytes or filename again creates another Resume; the
first Phase 8 release performs no automatic duplicate merge or version linking.

Display name is user-editable. Original filename, uploaded file identity, and
creation time remain historical metadata. A rename does not rename or alter the
stored bytes.

The default Resume is a current library preference used by existing analysis
workflows. It is never evidence that the Resume was used for an Application.

### Parsing

Supported extraction inputs remain:

| Input                                | Behavior                                                       |
| ------------------------------------ | -------------------------------------------------------------- |
| `.txt` and `.md`                     | Decode as UTF-8 text and normalize locally.                    |
| `.docx`                              | Extract raw text locally.                                      |
| Text-based `.pdf`                    | Extract text locally from each page.                           |
| Scanned or image-only `.pdf`         | Retain a failed Resume with an OCR-not-supported explanation.  |
| `.doc` or another unsupported format | Retain a failed Resume with an unsupported-format explanation. |

The upload limit remains 10 MiB. A request with no file or a file rejected by the
transport limit does not create a Resume.

Parser failure after file receipt creates a failed Resume record rather than
claiming successful extraction. The UI must show the parsing error. Empty
extraction results from a successful parser are distinct from parser failure.

### Normalization and Extraction

Exact file bytes are the source artifact. Parsed text, normalized text, extracted
Skills, extracted Certifications, and profile proposals are derived
interpretations, not observed facts.

The current parser finds only configured Skill and Certification names or
aliases present in normalized text. It does not claim general semantic
extraction. Approving a proposal updates the current editable profile preference
through the existing preference boundary; rejecting one leaves the profile
unchanged.

Current Resume extraction arrays remain mutable library results. They are not
used as application-time history after a ResumeSnapshot exists.

### Rename, Default, Re-score, and Delete

- Rename changes the library display label only.
- Set Default selects exactly one current default when Resumes exist.
- Re-score invokes current deterministic analysis using the current profile and
  stored extraction results. It does not mutate snapshot history.
- Delete removes the library Resume and managed source file. Any retained
  ResumeSnapshot created from it remains intact and displays its copied source
  identity and filename.

The first release does not expose archive, undelete, replacement, or automatic
cleanup behavior.

## ResumeSnapshot Behavior

### Capture Trigger

A ResumeSnapshot is created only when the user records that a known Resume was
used for an Application. Uploading, renaming, setting a default, re-scoring, or
approving profile proposals does not create a snapshot.

Selecting a Resume for an Application is optional. Job Browser does not
implicitly select the current default. A historical Application receives a
snapshot only when the user supplies or confirms the exact historical document;
the system never snapshots the current Resume and presents it as past evidence.

### Captured Content

The snapshot preserves:

- Exact immutable file bytes in application-managed snapshot storage.
- Cryptographic hash, size, original filename, media type, and extension.
- Copied source Resume identity and an optional live library relationship.
- One versioned capture-time normalized payload.
- Parser version, normalization version, parsing status, and parsing error.
- Capture-time Skill and Certification relationships with raw labels and
  extraction provenance.
- Snapshot creation time, distinct from Application occurrence time.

The capture-time interpretation may record a parser failure while still
preserving valid exact bytes. A parser failure therefore does not by itself
prevent the user from recording that the file was submitted; the snapshot stores
a valid versioned failure payload and the Application shows the limitation.

### Logical Atomicity

Snapshot capture and the associated Application event are one user-visible
operation:

1. Verify that the selected Resume file is inside managed storage and matches
   its known integrity metadata.
2. Copy exact bytes to a temporary snapshot path, hash and verify them, and
   atomically move them to an opaque final storage key.
3. Commit snapshot metadata, the ApplicationEvent, and the Application
   projection in one SQLite transaction.
4. Remove or quarantine an unreferenced file if the database transaction fails.

If reading, confinement, integrity, copying, hashing, or persistence fails, no
Application event is recorded. The user may retry or explicitly continue without
a Resume. The system never substitutes another Resume.

### Relationships and Reuse

One Application references zero or one submitted ResumeSnapshot in the first
release. Additional submitted Resume versions and other materials are deferred.

The system may reuse an existing immutable snapshot only when the complete
capture identity is identical, including source Resume identity, bytes,
filename, media metadata, normalized payload, and interpretation versions.
Content hash alone is insufficient. Reuse is an internal storage decision and
does not merge Applications or hide their separate events.

An incorrect Application association is changed by an append-only material
correction. Neither the old snapshot nor the original event is edited.

### Immutability and Retention

Snapshot bytes, storage identity, integrity metadata, original filename,
capture-time payload, and capture-time versions are immutable.

- Resume rename, default selection, re-score, reparse, or deletion does not
  change a snapshot.
- A snapshot referenced by an Application or event cannot be deleted.
- The first release exposes no direct snapshot delete or automatic retention
  cleanup.
- Missing or corrupt snapshot files are surfaced as integrity errors and never
  replaced from a mutable Resume.
- Post-capture parser reprocessing is deferred. A future design must append an
  interpretation and retain the capture-time output.

## Storage, Backup, and Restore

Current Resume files remain under the configured managed Resume directory.
Snapshot files use a separate managed snapshot directory and opaque relative
storage keys. All file resolution must remain confined to its configured root.
The backup manifest maps each current Resume ID to a portable relative key even
while its compatibility row stores an absolute path.

ResumeSnapshot support must not be released until coordinated backup and restore
cover the complete Phase 8 persistence set:

- SQLite.
- Current Resume library files referenced by SQLite.
- ResumeSnapshot files referenced by SQLite.
- Application-managed CandidateProfile and scoring preference files that remain
  authoritative outside SQLite.

Backup serializes SQLite writes and every writer for manifest-covered Resume,
snapshot, CandidateProfile, and scoring preference files; creates a SQLite
online backup; copies the authoritative external files; and records every
relative key, hash, size, role, and owning identity in a manifest. It succeeds
only when the manifest verifies.

Restore is an explicit verified offline operation. It restores files beneath the
current managed roots, replaces SQLite, rewrites restored absolute Resume paths
by Resume ID when the managed root differs, and validates every manifest entry
before the set becomes active. Missing or corrupt files produce a visible
degraded state; restore never silently substitutes current content.

Credentials, logs, diagnostics, temporary files, quarantined files, and previous
backup sets are outside this persistence-set manifest.

## Validation Rules

- Upload requires a file no larger than 10 MiB.
- Supported parsing is limited to `.txt`, `.md`, `.docx`, and text-based `.pdf`.
- Unsupported or unreadable content must never be labeled parsed successfully.
- Stored file access must remain within the configured Resume or snapshot root.
- Snapshot capture requires readable exact bytes and verifiable hash and size.
- A selected Resume snapshot failure leaves the related Application operation
  uncommitted.
- Snapshot metadata and its capture-time interpretation must identify schema,
  parser, and normalization versions.
- A live Resume relationship may disappear, but copied snapshot provenance and
  bytes remain.
- No current or default Resume may be inferred for migrated Application history.

## Privacy

Resume bytes, parsed content, extracted qualifications, profile proposals, and
snapshots are sensitive local data. This feature authorizes no external upload,
remote inference, telemetry contribution, or cross-install analytics.

Snapshot files inherit the Application history retention boundary. The first
Phase 8 release intentionally provides no partial deletion or purge claim.
Active-data deletion, backup retention, and copies created outside Job Browser
require a separately approved privacy workflow.

## Acceptance Criteria

- Existing Resume IDs, files, metadata, default selection, parsing status,
  proposals, and operations survive Phase 8 migration unchanged.
- TXT, Markdown, DOCX, and text-based PDF extraction remains local and produces
  the current catalog-matched qualification behavior.
- Image-only PDF and unsupported-format uploads remain failed records with a
  visible explanation rather than successful parses.
- Separate uploads remain separate Resume identities even when names or bytes
  match.
- Recording Applied with no selected Resume creates no snapshot and does not use
  the default Resume.
- Recording Applied with a valid selected Resume creates a verified immutable
  snapshot and associates it in the same logical operation.
- File or persistence failure during selected snapshot capture records neither
  the Application event nor a dangling snapshot row.
- A capture-time parse failure may retain the exact snapshot with explicit failed
  interpretation status.
- Rename, default change, re-score, profile proposal review, and source Resume
  deletion do not alter retained snapshots.
- Migration does not manufacture snapshots for existing Applications.
- Backup and restore verify SQLite, Resume files, snapshot files, and
  authoritative profile/scoring preference files as one manifest-defined set.
- Restoring to a different managed Resume root rewrites every restored absolute
  compatibility path to its verified new location before activation.
- Missing, corrupt, orphaned, temporary, and quarantined files are detected and
  never substituted silently.

## Deferred and Future Expansion

- Resume family, revision lineage, archive, replacement, and undelete behavior.
- Post-capture reprocessing and additional ResumeSnapshotInterpretations.
- OCR and additional input formats.
- Automatic orphan cleanup, snapshot deletion, coordinated privacy purge, and
  backup-retention controls.
- Multiple submitted Resume versions or other materials per Application.
- Best-Resume guidance, missing-keyword explanations, and outcome-based
  recommendations under the intelligence specification.
- Tailored resume generation, cover-letter generation, and DOCX export.
- External processing, synchronization, User ownership, and cross-install
  analytics.
