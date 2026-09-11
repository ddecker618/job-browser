## Recovery checkpoint — P10 complete

P10 is complete and verified (147 files / 1422 tests). Snapshot evidence adapters now cover skills, certifications, experience, education, and clearance with parser provenance. Unparsed structural data produces UNKNOWN; normalized resume text remains internal and public snapshot responses do not expose it. Next: P11 diagnostic requirement coverage in Job Intelligence. No installer, production data, or remote push was touched.

## Active recovery checkpoint — P10 in progress

P9 committed as e21e898. P10 adds internal snapshot evidence retrieval and typed skill, certification, experience, education, and clearance adapters. Null or unparsed structured values must produce UNKNOWN, and every result remains evidence-only with parser provenance. No installer or production-data changes.

## Recovery checkpoint — P9 complete

P9 is complete and verified: reviewed canonical skills now drive relevance and skill coverage, source phrases remain unchanged, unknown terms abstain, and stale relevance indexes rebuild. Full verification passed 146 files / 1419 tests. Next: P10 resume evidence adapters for experience, education, and clearance. No installer, production data, or remote push was touched.

## Active recovery checkpoint — P9 in progress

P8 committed as e0eadf5. P9 connects reviewed canonical skills to relevance and coverage; raw text remains unchanged, unknown terms abstain. Run targeted normalized-consumer/search tests, then full verify. Continue P10 onward after P9; no checkpoint is a request to stop. No installer or production data changes.

# Job Browser Project Memory

## Current recovery checkpoint — P8 complete (2026-09-11)

P7 baseline is e99c80e. P8 is complete: explicit target-role selection and exact
structured-family membership; current P6 indexed skill evidence supplements title
evidence without widening the result set. Missing/stale/corrupt derived evidence
falls back safely. Production scores, eligibility, lifecycle, and default ordering
are preserved. Full verification: 145 files / 1416 tests; production build PASS.
No installer rebuilt, no version bumped, no data migration, nothing pushed.
The next implementation task is P9 in docs/Intelligence_Roadmap.md. Resolve the P8
checkpoint hash with git log. Historical shadow/beta resume instructions below
are retained as history and do not supersede this checkpoint.

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
9.5 workstream is also complete and Architect-approved. The versioned Employer
Seed Manifest Import (1.0.21) is complete. Migration head is
`030_employer_aliases.sql`; current version is 1.0.25.

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

## Employer Seed Manifest Import (1.0.21)

Employers and career sites can be imported in bulk from versioned JSON/CSV
manifests (`employer-seed-manifest-v1`) through the `EmployerSeedImporter`
(`src/discovery/employerSeedImporter.ts`), the `npm run employers:import` CLI
(`src/discovery/cli/import-employers.ts`), and `POST /api/employer-discovery/import`.
Identity resolution is deterministic and idempotent: employers by exact
normalized domain → alias (`030_employer_aliases.sql`) → normalized name; career
sites by exact URL → URL identity (`src/domain/urlIdentity.ts`) → ATS
family+tenant → health effective URL → retained evidence; Sources by site link →
URL identity → canonical configuration JSON → ATS tenant. Writes are batched in
transactions of ≤25 with full-batch rollback on database errors; `--dry-run`
performs no writes. Imported sites are URL-fingerprinted (no network) and
importer evidence is added after verification so it survives the evidence wipe.
Retired sites are reused as-is; existing disabled/archived Sources are never
auto-re-enabled.

## NLP Job Intelligence Program (shadow mode)

Program tracker: `docs/Intelligence_Roadmap.md` (authoritative). This section
records durable architectural truth only.

- **Execution model:** NLP is additive and shadow-only. The deterministic
  pipeline (`roleDetailsExtractor.ts`, `verificationService.ts`, `scoringEngine.ts`)
  remains authoritative and untouched by NLP. NLP may analyze, classify,
  extract, normalize, persist, compare, and expose diagnostics; it must NOT
  change production score, eligibility, ranking, filtering, or removal.
- **NLP extraction identity:** `NLP_EXTRACTION_VERSION = 'job-nlp-v1'`
  (`src/schemas/job-nlp.ts`), independent of `ROLE_DETAILS_VERSION =
'role-details-v2'`. Relationship is `additive-shadow`. A stored NLP version
  != current version marks a job eligible for bounded reprocessing (Stage 14
  invalidation pattern mirrors role-details backfill batch size 200).
- **Contract semantics:** requirement CATEGORY and STRENGTH are separate axes
  (17 categories, 8 strengths). Every material fact carries evidence (segment
  text + source field + segment index + char span), extraction method,
  extraction version, confidence 0..1, and a `conflict` block
  (AGREEMENT/DETERMINISTIC_ONLY/NLP_ONLY/CONFLICT/UNKNOWN + nature + values).
- **Pipeline shape (existing, unchanged):** raw description -> `NormalizedJob`
  (`jobNormalizer.ts`) -> `jobs` row -> `IntelligenceEngine.analyze()`
  (parallel `scoreJob()` + `extractRoleDetails()`) -> `role_details_json`,
  `score_version`, `score_input_hash` -> startup `reconcileStaleData()`
  (backfill role details -> invalidate stale scores -> bounded reprocess).
- **Segmentation (Stage 2):** `src/intelligence/nlp/segmenter.ts` splits
  description prose into `NlpSegment[]` (sentences, numbered/bullet items,
  headings, colon/semicolon fragments) with full source-field + span tracing.
  It cleans HTML position-preservingly (`cleanForSegmentation`: tags -> equal
  whitespace, block tags -> `\n`; entity unescape padded to original length),
  so every `[charStart, charEnd)` is a 1:1 index into the original source
  string and evidence text is always the verbatim original slice. Segments get
  contiguous global `index` values across fields in field order (title,
  location, description, requirements, preferredQualifications) per D-NLP-008/
  D-NLP-009. Heading detection rejects prose (punctuation `.?!;,`, length > 60)
  so sentences beginning "Remote ..." are never headings. Classification
  (Stage 3+) consumes these segments.
- **Category classification (Stage 3):** `src/intelligence/nlp/categorizer.ts`
  is a deterministic multi-label classifier over the 17 contract categories
  (`CATEGORY_CLASSIFIER_VERSION = 'category-classifier-v1'`), emitting
  `SegmentClassification` (segmentIndex + categories + confidence +
  method/version) but NOT yet `NlpFact` documents. `clearance` requires
  applicant-directed language ("our cleared team" -> `company-description`).
  `legal-eeo-boilerplate` is dominant/mutually exclusive. Bare "experience"
  alone does not trigger `experience`. Certification labels with `+` must be
  regex-escaped. Confidence: strong 0.85, weak/unknown 0.4-0.7, EEO 0.9.
- **Strength/modality (Stage 4):** `src/intelligence/nlp/strength.ts`
  classifies exactly one strength per statement
  (`STRENGTH_CLASSIFIER_VERSION = 'modality-classifier-v1'`) with precedence
  required-after-hire > ability-to-obtain > equivalent-accepted > required >
  preferred > nice-to-have > informational > unknown. Modality markers apply
  only to requirement categories (skill/experience/education/certification/
  clearance/citizenship); other categories default to `informational` when
  unmarked. "be able to obtain" must resolve to ability-to-obtain BEFORE
  required (D-NLP-012/013).
- **Education intelligence (Stage 5):** `src/intelligence/nlp/education.ts`
  extracts degree level (doctorate > master > bachelor > associate >
  high-school; generic "degree" -> unknown), field, equivalency (experience/
  education/credential/combination/none), substitution years, combined flag,
  and degree spans. Field values are normalized to known vocabulary or kept
  as conservative lowercased originals - never fabricated (D-NLP-014/015).
- **Experience intelligence (Stage 6):** `src/intelligence/nlp/experience.ts`
  extracts min/preferred years, ranges, nested clauses, months (never
  converted to years), domains (stopword-filtered), and or-alternatives.
  Years are never fabricated (D-NLP-016/017).
- **Certification intelligence (Stage 7):** `src/intelligence/nlp/certifications.ts`
  normalizes a curated catalog of known certifications and families, assigns
  per-cert modality by nearest-keyword distance (precedence tie-break), and
  guards against false equivalencies (e.g., "grade A+" is not CompTIA A+).
- **Clearance/citizenship intelligence (Stage 8):**
  `src/intelligence/nlp/clearance.ts` keeps clearance levels/statuses separate
  from U.S. citizenship, permanent residency, and work authorization. Status
  matching is clause-scoped; `TS/SCI` overlap is deduped; employer-directed
  phrases such as "our cleared team" never imply applicant clearance
  (D-NLP-019/020).
- **Location/remote/hybrid intelligence (Stage 9):**
  `src/intelligence/nlp/location.ts` extracts arrangement, city/state evidence,
  remote scope, excluded states, commute language, occasional onsite,
  relocation, and travel without changing geographic eligibility. It reports
  conflicts with the existing arrangement classifier rather than resolving them
  in production (D-NLP-021/022).
- **Skill/technology intelligence (Stage 10):**
  `src/intelligence/nlp/skills.ts` uses boundary-aware configurable aliases,
  preserves raw evidence, separates skill vs technology entities, and labels
  each mention as required/preferred/mentioned/environment/responsibility. It
  never mutates the production scoring catalog (D-NLP-023/024).
- **Boilerplate intelligence (Stage 11):**
  `src/intelligence/nlp/boilerplate.ts` identifies EEO, benefits, marketing,
  legal, accommodation, compensation, culture, and company-description signals
  without destructively filtering segments. Applicant-directed requirements and
  generic soft skills are preserved for reconciliation (D-NLP-025/026).
- **Reconciliation (Stage 12):**
  `src/intelligence/nlp/reconciliation.ts` compares deterministic and NLP
  values, modality, entity, and scope independently, preserves both sides, and
  records agreement/one-sided/conflict/unknown states. Deterministic authority
  remains diagnostic and shadow-only (D-NLP-027/028).
- **Shadow persistence (Stage 13):**
  `job_nlp_enrichments` is an additive one-row-per-job table written through
  `JobNlpEnrichmentRepository`; full envelopes are schema-validated, source
  hashes/versions are stored, created timestamps survive upserts, and production
  `jobs` fields are never updated (D-NLP-029/030).
- **Invalidation/reprocessing (Stage 14):**
  `src/intelligence/nlp/reprocessing.ts` provides bounded cursor planning and
  per-job execution. Current version/source-hash rows are skipped, completed
  saves survive later failures, and builder mismatches fail safely without
  touching archive, score, eligibility, or lifecycle state (D-NLP-031/032).
- **Debug inspector (Stage 15):**
  `src/intelligence/nlp/inspector.ts` exposes a deterministic, read-only
  projection of evidence, category, strength, entities, confidence, source,
  method, version, and reconciliation state. User-derived text is redacted for
  common personal and secret patterns before projection; no persistence or
  production-field path exists (D-NLP-033/034).
- **Synthetic evaluation corpus (Stage 16):**
  `src/intelligence/nlp/evaluationCorpus.ts` contains 42 deterministic local
  cases covering all 17 categories and all 8 strengths, with explicit entity,
  forbidden-category/entity, and arrangement labels. Adversarial cases remain
  labeled for critical false positives such as team clearance, grade A+, and
  technical remote terminology (D-NLP-035/036).
- **Representative evaluation (Stage 17):**
  `src/intelligence/nlp/evaluation.ts` runs the 42-case corpus plus 12
  additional synthetic descriptions and reports category/strength/entity/
  arrangement precision, recall, exact accuracy, critical FP/FN, and label
  disagreement without changing labels or production behavior. Current report:
  54 cases, category exact 88.9%, strength 96.3%, entity exact 94.4%, and zero
  critical adversarial failures after blocking grade A+, technical-remote, and
  employer Secret-program false positives (D-NLP-037/038).
- **Shadow acceptance (Stage 18):**
  `src/intelligence/nlp/acceptance.ts` fails closed below documented category,
  strength, entity, disagreement, and critical-failure thresholds, and requires
  explicit evidence for production-field preservation, persistence/versioning,
  stale reprocessing, evidence retention, conflict visibility, and inspector
  behavior (D-NLP-039/040).
- **Semantic design (Stage 19):**
  `docs/NLP_SEMANTIC_DESIGN.md` is the design-only boundary for future local
  semantic normalization. No model/runtime/dependency/download is approved;
  future adapters require pinned artifact/tokenizer/runtime versions, source
  hash invalidation, calibrated thresholds, abstention, redacted explainability,
  and offline package/performance/license measurements (D-NLP-041/042).
- **Role matching shadow mode (Stage 20):**
  `src/intelligence/nlp/roleMatching.ts` compares configured role-family titles
  with a deterministic token-overlap fallback, abstains on weak/ambiguous
  matches, reconciles against deterministic title families, and persists only
  through an explicit caller target. It has no embedding/runtime or production
  score path (D-NLP-043/044).
- **Skill normalization shadow mode (Stage 21):**
  `src/intelligence/nlp/skillNormalization.ts` retains exact phrases and
  catalog aliases, applies only reviewed strong/weak relationships, and reports
  unrelated/unknown outcomes without guessing canonical skills or claiming
  equivalence (D-NLP-045/046).
- **Resume evidence matching (Stage 22):**
  `src/intelligence/nlp/resumeEvidence.ts` consumes parsed snapshot evidence and
  returns direct/strong/weak/no-evidence/unknown states while preserving raw
  labels, provenance, parser/source-normalization versions, and normalization
  scores. It explicitly makes no possession claim and has no production write or
  scoring path (D-NLP-047/048).
- **Requirement coverage (Stage 23):**
  `src/intelligence/nlp/requirementCoverage.ts` projects evidence into direct,
  strong-related, weak-related, missing, and unknown rows, with explicit
  modality weights and diagnostic contribution factors. Coverage is a UI/shadow
  projection only and has `productionEffect: 'none'` (D-NLP-049/050).
- **Performance audit (Stage 24):**
  `src/intelligence/nlp/performanceAudit.ts` and `npm run nlp:benchmark` measure
  the deterministic local pipeline, temporary shadow persistence, reprocessing,
  heap deltas, cold module import, and stable cache fingerprints. No embedding
  runtime, model artifact, network request, or production effect is present
  (D-NLP-051/052/053). Baseline details live in
  `docs/NLP_PERFORMANCE_AUDIT.md`.
- **Security/privacy/packaging audit (Stage 25):**
  `npm run nlp:security-audit` statically checks the shadow NLP scope for model,
  hosted-AI, network, secret, developer-path, and prohibited dependency markers;
  it also verifies fresh NLP persistence is empty and inspector output redacts
  sensitive values. `npm run privacy:check` remains the distribution gate
  (D-NLP-054/055/056). Findings live in
  `docs/NLP_SECURITY_PRIVACY_PACKAGING_AUDIT.md`.
- **Intelligence UX prototype (Stage 26):**
  `src/client/components/JobIntelligencePreview.tsx` adds a drawer-local,
  read-only Job Intelligence preview with required/preferred/mentioned summary,
  source labels, and `Interpreted as:` wording. Resume coverage is explicitly
  `Unknown` until a separate read-only evidence endpoint exists; production
  score/recommendation UI remains unchanged (D-NLP-057/058/059). Details live in
  `docs/NLP_INTELLIGENCE_UX_PROTOTYPE.md`.
- **Promotion design (Stage 27):**
  `docs/NLP_PROMOTION_DESIGN.md` defines Levels 0-4 and a field-by-field hard
  promotion gate. The current maximum is Level 2 additive shadow output; no
  production scoring, eligibility, ranking, filtering, lifecycle, or removal
  promotion is authorized (D-NLP-060/061/062).
- **Regression and upgrade validation (Stage 28):**
  `tests/job-nlp-shadow-regression.test.ts` proves representative shadow
  operations leave deterministic `scoreJob` output and source input unchanged.
  The full verification, privacy gate, rebuilt Windows installer, packaged
  smoke, installed smoke, and packaged upgrade smoke all pass (D-NLP-063/064).
- **Final handoff (Stage 29):**
  `docs/NLP_FINAL_HANDOFF.md` records exactly 43 points and the final boundary:
  NLP shadow mode is validated, while production promotion is not yet validated
  or authorized. README, changelog, architecture, roadmap, and local session
  handoff point to this status (D-NLP-065/066).
- **Deterministic gates that NLP must never override:** closed posting,
  commission/physical/schedule gate, Illinois exclusion, remote-region
  restriction, professional-engineering-required, active-clearance-required,
  geographic (onsite/hybrid) commute block.
- **No model/runtime dependency yet.** Stages 19+ (semantic/embedding) are
  design-first; no external AI services, no silent model downloads, no
  telemetry. Packaging impact of any future model must be measured first.

## NLP integration repair — verified

The connected shadow envelope: full-description extraction (`document-v1`) is
exposed through an explicit local analysis action (`POST
/api/jobs/:id/intelligence`) and persisted additively in
`job_nlp_enrichments`, keyed by content hash + `job-nlp-v1` extraction
version with bounded invalidation. The Job Intelligence preview renders real
facts with evidence and always labels interpretations; it never feeds
production scoring (deterministic scoring is unchanged, `productionEffect:
'none'`).
