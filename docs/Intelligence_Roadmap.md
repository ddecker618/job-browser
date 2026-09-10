# Job Browser Intelligence Roadmap

> **AUTHORITATIVE implementation tracker for the Job Browser Intelligence / NLP
> program.** This document supersedes the earlier "historical concept roadmap"
> framing: it is now the required resume point and stage registry for the
> NLP-assisted job-description intelligence program.
>
> Companion durable-memory document: `docs/PROJECT_MEMORY.md` (== the program's
> `Project_Memory.md` mandate). Repo evidence (`src/`, `tests/`) wins over any
> stale claim in this file. If documentation conflicts with source/tests, fix
> the documentation and continue.

## Naming decision (program-file mapping)

The program mandates files `Intelligence_Roadmap.md` and `Project_Memory.md`.
This repository keeps documentation under `docs/` and already contained
`docs/Intelligence_Roadmap.md` and `docs/PROJECT_MEMORY.md`; per the
"repository conventions dictate" rule these existing files play the mandated
roles:

| Program name              | Repository document            |
| ------------------------- | ------------------------------ |
| `Intelligence_Roadmap.md` | `docs/Intelligence_Roadmap.md` |
| `Project_Memory.md`       | `docs/PROJECT_MEMORY.md`       |

---

## Status Legend

`[x]` complete · `[>]` in progress · `[ ]` not started · `[!]` blocked · `[-]` deferred

---

## RESUME POINT (read this first)

```
CURRENT_STAGE:       11 (boilerplate/filtering) - Stage 12 is next
CURRENT_TASK:        Begin Stage 12 (deterministic and NLP reconciliation)
LAST_COMPLETED:      Stage 11 - boilerplate/non-requirement filtering + 14 tests; npm run verify (119 files / 1276 tests)
NEXT_ACTION:         Stage 12 - compare deterministic facts and NLP facts, record agreement/conflict, and preserve deterministic authority
FILES_IN_PROGRESS:   src/intelligence/nlp/boilerplate.ts, tests/job-nlp-boilerplate.test.ts
TESTS_TO_RUN:        npx vitest run tests/job-nlp-boilerplate.test.ts; full npm run verify
KNOWN_FAILURES:      none
LATEST_CHECKPOINT:   created after this roadmap update (NLP Stage 11 checkpoint)
DO_NOT_REPEAT:       keep category and strength separate; evidence spans must be
                     validated; never touch production scoring; catalog matching must
                     not over-broaden ("grade A+" is not CompTIA A+ -> blockWhen);
                     per-cert modality uses NEAREST-KEYWORD distance with
                     precedence tie-break (whole-window precedence misfires when a
                     segment mixes "preferred, ... required"); array order = span
                     order (sort by span.start); location state codes must be
                     context-filtered because normalizeStateCode accepts any two
                     letters; strip "based in" prefixes from city captures; do not
                     infer unrestricted remote from technical remote terminology;
                     preserve remote-vs-deterministic conflicts (especially
                     occasional onsite) instead of changing a gate; excluded states
                     and commute miles are evidence only; skill aliases must be
                     boundary-aware and overlapping aliases must prefer the longest
                     evidence; raw skill text must remain separate from canonical
                      names; per-mention context is clause-scoped; boilerplate
                      signals must never discard applicant-directed requirements;
                      generic soft skills such as excellent communication remain
                      requirements; broad company-description patterns must not
                      swallow EEO sentences; segment helper must use the real
                      NlpSegment shape (index/text/normalized/kind/sourceField/
                      charStart/charEnd), not base/meta
SAFE_RESUME_POINT:   Stage 12 start
```

---

## Historical product-vision roadmap (retained for context)

> Retained verbatim from the earlier concept roadmap. This section describes the
> long-term product vision, NOT the current NLP implementation sequence. The
> NLP program stages below define implementation order.

## Purpose

This document describes the long-term roadmap for adding intelligence and analytics to Job Browser.

The objective is not to become another job board. The objective is to learn from real application outcomes to improve future job recommendations.

### Phase 1 - Persistent Application History

Goal: persist application history whenever a user marks a job as applied. Record: application ID, job ID, company, job title, source, original job URL, date discovered, date applied, current status. Statuses: Applied, Interview, Rejected, Ghosted, Offer, Withdrawn, Pending.

### Phase 2 - Outcome Tracking

Allow users to update applications over time with events (phone screen, technical interview, final interview, offer, rejection, ghosted) and timestamps.

### Phase 3 - Resume Snapshots

Instead of storing only the current resume, preserve a snapshot of the applicant's qualifications at the time they applied (skills, certifications, education, years of experience, projects, military experience, clearance, portfolio, GitHub). Prevents historical applications from changing as resumes evolve.

### Phase 4 - Job Normalization

Normalize job requirements into structured fields (required/preferred skills, certifications, experience, education, salary, remote status, employment type).

### Phase 5 - Anonymous Analytics

Generate anonymous aggregate statistics (response/interview/offer rates, response time, common required skills). No individual applicant data exposed.

### Phase 6 - Correlation Engine

Identify meaningful relationships (certification/skill/experience -> interview/offer rate) with sample sizes always shown.

### Phase 7 - Recommendation Engine

Begin recommendations (high-probability opportunities, skills worth learning, resume improvements, better companies/roles). Always explain why.

### Phase 8 - Predictive Intelligence

Only after sufficient historical data exists: interview/offer probability, personalized application ranking, confidence scores + sample sizes.

---

# NLP JOB INTELLIGENCE IMPLEMENTATION PROGRAM

## Program guardrails (never violate)

1. Deterministic eligibility gates remain authoritative. NLP never overrides hard facts (impossible location, required onsite, citizenship, required active clearance, mandatory certification, federal constraints).
2. NLP operates in SHADOW MODE until an explicit acceptance gate promotes it.
3. Manual removal/archive stays user-controlled; NLP never auto-deletes.
4. Every material NLP fact must carry source evidence, extraction method, extraction version, confidence.
5. Never silently guess through extraction conflicts; represent conflicts explicitly.
6. Generalize parsing with synthetic paraphrase tests; never hardcode individual employers/jobs.
7. No paid/cloud AI dependencies without explicit authorization; local-first.
8. No telemetry; NLP artifacts remain local.
9. No destructive production-data modification; backup + safe reconciliation patterns.
10. No scoring change from NLP during the initial extraction program.

## Stage registry

| Stage | Scope                                        | Status |
| ----- | -------------------------------------------- | ------ |
| 0     | Current intelligence architecture audit      | [x]    |
| 1     | NLP data contract and versioning             | [x]    |
| 2     | Sentence / segment intelligence              | [x]    |
| 3     | Requirement category classification          | [x]    |
| 4     | Requirement strength / modality              | [x]    |
| 5     | Education intelligence                       | [x]    |
| 6     | Experience intelligence                      | [x]    |
| 7     | Certification intelligence                   | [x]    |
| 8     | Clearance and citizenship intelligence       | [x]    |
| 9     | Location / remote / hybrid intelligence      | [x]    |
| 10    | Skill and technology extraction              | [x]    |
| 11    | Boilerplate and non-requirement filtering    | [x]    |
| 12    | Deterministic + NLP reconciliation           | [ ]    |
| 13    | Shadow-mode persistence                      | [ ]    |
| 14    | Invalidation and reprocessing                | [ ]    |
| 15    | NLP debug / intelligence inspector           | [ ]    |
| 16    | Synthetic NLP evaluation corpus              | [ ]    |
| 17    | Representative job evaluation                | [ ]    |
| 18    | Shadow-mode acceptance gate                  | [ ]    |
| 19    | Semantic normalization / embedding design    | [ ]    |
| 20    | Semantic role matching shadow mode           | [ ]    |
| 21    | Semantic skill normalization shadow mode     | [ ]    |
| 22    | Resume evidence matching shadow mode         | [ ]    |
| 23    | Requirement coverage model                   | [ ]    |
| 24    | NLP / semantic performance audit             | [ ]    |
| 25    | Security / privacy / packaging audit         | [ ]    |
| 26    | Intelligence UX prototype                    | [ ]    |
| 27    | Promotion design for production scoring      | [ ]    |
| 28    | Full regression and upgrade validation       | [ ]    |
| 29    | Documentation and final intelligence handoff | [ ]    |

---

## Stage 0 — Current Intelligence Architecture Audit

- **Status:** [x]
- **Objective:** Locate and document the full job-intelligence pipeline before any NLP work; determine whether NLP/semantic functionality already exists; record baseline tests.
- **Pipeline trace (documented):**
  raw job description
  -> NormalizedJob (`src/normalizer/jobNormalizer.ts` `normalizeJob()`, schema `src/schemas/normalized-job.ts`; called by every provider adapter in `src/providers/*`)
  -> `jobs` SQLite row via `JobRepository.upsertObservation()` (`src/repositories/job-repository.ts:133`; columns `description`, `requirements`, `preferred_qualifications`, `role_details_json`)
  -> `IntelligenceEngine.analyze()` (`src/intelligence/intelligenceEngine.ts:34`) runs `verifyPosting()` (`verificationService.ts:204`), then IN PARALLEL `scoreJob()` (`scoringEngine.ts:33`) and `extractRoleDetails()` (`roleDetailsExtractor.ts:133`)
  -> `IntelligenceRepository.saveIntelligence()` writes `role_details_json`, `score_version`, `score_input_hash`, recommendations/score_history (`intelligenceRepository.ts:60`)
  -> `backend.ts:220` calls `reconcileStaleData()` on startup (backfill role details -> invalidate stale scores -> bounded reprocess).
- **Versioning found:**
  - `ROLE_DETAILS_VERSION = 'role-details-v2'` (`src/schemas/role-details.ts:21`) — independent of scoring rules.
  - `SCORING_RULES_VERSION = '2026-08-15-geographic-eligibility-v1'` (`src/intelligence/scoringVersion.ts`).
  - `createScoreVersion()`/`createScoreInputHash()` SHA-256 payload identities (`scoreIdentity.ts`).
  - Migration head `030_employer_aliases.sql`; `role_details_json` added in `028_role_details.sql`; verification columns in `012`; score version/backfill in `013`.
- **Deterministic methods:** regex + config catalog matching only (`extractTermsFromText`, `src/skills/skillExtractor.ts`). Zero NLP/embeddings/LLM/ML in the codebase — confirmed by grep.
- **Eligibility gates (hard, authoritative):** closed posting, commission/physical/schedule gate, Illinois exclusion, remote-region restriction, professional-engineering-required-without-credential, active-clearance-required-without-eligibility, geographic (onsite/hybrid) commute block (`geographicEligibility.ts`, `locationEligibility.ts`, `federalEligibility.ts`, `scoringEngine.ts applyVerification()`).
- **Consumers:** `GET /api/jobs/:id` (role_details_json, 409 on stale version), `dashboardRepository` role-details parse, client `RoleDetailsSection` in `JobDetailPanel.tsx`, JobsPage recommendation cell, AnalyticsPage distribution.
- **Baseline verification:** `npm run verify` = 108 files / 1101 tests PASS at 1.1.0 (2026-09-10).
- **Confirmed extension surface:** NLP shadow layer is green-field. Extension points: a new `src/intelligence/nlp/*` module tree, a new independently-versioned schema (`job-nlp-v1`), reconciliation in `intelligenceEngine.ts`, bounded startup reprocessing pattern from `backfill-role-details.ts` (batch size 200).
- **Architectural decisions recorded:**
  - D-NLP-001: NLP is green-field shadow-only; additively versioned `job-nlp-v1`; never hand-edits `role-details-v2` documents.
  - D-NLP-002: Promotion requires the Stage 18 acceptance gate + Stage 27 proposal; no scoring changes in stages 0-18.
  - D-NLP-003: evidence strings mirror the `evidence: string[]` convention already used by `RoleDetails`.
  - D-NLP-004: category and requirement strength are SEPARATE dimensions.
- **Tests:** baseline `npm run verify` green (see validation).
- **Validation evidence:** pipeline + versioning + gate inventory captured above from source; no behavior modified (docs-only).
- **Known limitations:** coordinate atlas is small (15 cities); `role_details_json` currently persists only in `IntelligenceEngine.analyze()` while backfill persists independently; explanations are unformatted text, not structured.
- **Current task / exact next action:** done — persist this audit (this file), then start Stage 1 (NLP data contract + versioning).

---

## Stage 1 — NLP Data Contract and Versioning

- **Status:** [x]
- **Objective:** Define the independently versioned NLP enrichment contract before any model behavior; keep category and strength separate; explicit evidence/provenance; no role-details-v2 semantic change.
- **Implementation tasks:**
  - `src/schemas/job-nlp.ts` (new): `NLP_EXTRACTION_VERSION = 'job-nlp-v1'`, `NLP_ROLE_DETAILS_RELATIONSHIP = 'additive-shadow'`, categories (17) + strengths (8) as SEPARATE enums, extraction methods (6), evidence/source/segment-kind/entity-type/conflict-state/conflict-nature enums, per-fact `conflict` block, `JobNlpEnrichment` envelope (version/generatedAt/sourceTextHash/segments/facts), `describeNlpConfidence()` band labels.
  - Span-integrity `superRefine` (charEnd >= charStart) on evidence + segment; deprecated `ZodIssueCode` avoided ('custom' literal).
  - `tests/job-nlp-schema.test.ts` (new, 17 tests).
- **Files/components involved:** `src/schemas/job-nlp.ts`, `tests/job-nlp-schema.test.ts`.
- **Architectural decisions:**
  - D-NLP-005: NLP contract is independent of role-details-v2; `additive-shadow` relationship; `NLP_EXTRACTION_VERSION` gates reprocessing (Stage 14).
  - D-NLP-006: evidence records segment text + source field + segment index + character span (compatible with Stage-2 tracing).
  - D-NLP-007: confidence is 0..1 reliability per extraction method + evidence — not a probability, not a qualification claim.
- **Tests:** 17 schema tests (version independence, category×strength cross-product validates, fused-strength rejection, unknown category/method rejection, confidence bounds, evidence provenance, span integrity, conflict-state/nature enums, envelope acceptance + stale-version rejection).
- **Validation evidence:** `npx vitest run tests/job-nlp-schema.test.ts` = 17 pass; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** contract is schema-only — no extractor produces these documents yet (stages 2-11); conflict values stay null until Stage 12.
- **Current task:** complete.
- **Exact next action:** Stages 2-11 delivered (segmentation, categories, strength, education, experience, certifications, clearance/citizenship, location/remote/hybrid, skills/technology, boilerplate filtering); proceed to Stage 12.

---

## Stage 2 — Sentence / Segment Intelligence

- **Status:** [x]
- **Objective:** Robust segmentation of job-description prose (sentences, bullet lists, HTML-derived text, headings, fragments, colon/semicolon lists), preserving source-location tracing.
- **Implementation tasks:**
  - `src/intelligence/nlp/segmenter.ts` (new): `buildSegment()`/`segmentRoleDescription()`/`cleanedRoleDescription()`; position-preserving HTML entity/tag cleaning (`cleanForSegmentation`, `<p>` and `</p>` both to equal-length whitespace/`\n`); ordered/distinct heading/bullet/list-item detection; sentence splitting with sentence-continuation check + abbreviation guard set (U.S., Ph.D., M.S., B.S., St., etc.); colon/semicolon fragment boundaries; sentence-kind merging for multi-line paragraphs; trimmed span alignment over the cleaned view.
  - Heading detector hardened: rejects prose punctuation `.?!;,` and caps length at 60 — "Remote position. ..." must NOT classify as a heading.
  - `tests/job-nlp-segmenter.test.ts` (new, 17 tests): simple sentence + contract-valid segment; multi-sentence paragraph including "St. Louis." abbreviation case; U.S. abbreviation no-split; colon-delimited label fragment; semicolon fragments; comma clauses stay single; bullet lists; numbered items; HTML-derived content; section-heading detection; verbatim evidence text + valid spans per segment; contiguous global indices; stable source-field ordering; malformed provider formatting; position-preserving HTML cleaning; EEO boilerplate; title as heading.
- **Files/components involved:** `src/intelligence/nlp/segmenter.ts`, `tests/job-nlp-segmenter.test.ts`.
- **Architectural decisions:**
  - D-NLP-008: segmentation operates on a position-preserving cleaned view and emits verbatim original slices with `[charStart, charEnd)` spans — evidence text of the original move text maps 1:1 to source strings.
  - D-NLP-009: segments carry contiguous global `index` values across all fields in field order (title, location, description, requirements, preferredQualifications); classification stages (3+) consume these segments.
- **Tests:** 17 segmenter tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-segmenter.test.ts tests/job-nlp-schema.test.ts` = 34 pass; `npm run verify` = 110 files / 1135 tests green, eslint clean, `tsc --noEmit` clean, prettier clean.
- **Known limitations:** segmentation is layout+punctuation heuristics only — it does not yet classify content (Stage 3) or distinguish required vs preferred (Stage 4).
- **Current task:** complete.
- **Exact next action:** Stage 3 - classify meaningful segments (skill/experience/education/certification/clearance/citizenship/location/work arrangement/travel/schedule/responsibility/compensation/benefit/company description/EEO/unknown) with multi-label support.

---

## Stage 3 — Requirement Category Classification

- **Status:** [x]
- **Objective:** Classify meaningful segments (skill/experience/education/certification/clearance/citizenship/location/work arrangement/travel/schedule/responsibility/compensation/benefit/company description/EEO/unknown) with multi-label support.
- **Implementation tasks:**
  - `src/intelligence/nlp/categorizer.ts` (new): deterministic, explainable multi-label classifier (`classifySegment`/`classifySegments`) over all 17 categories; per-category pattern rule lists on normalized text; `CATEGORY_CLASSIFIER_VERSION = 'category-classifier-v1'`; confidence mapping (strong categories 0.85, weak/unknown 0.4-0.7, EEO 0.9); `asSegmentInputs` helper for isolated segment feeding.
  - Clearance guard: `clearance` category fires ONLY with clearance vocabulary AND applicant-directed language (must/required/ability/eligible/possess/hold/candidate); "Our cleared team supports Secret environments." -> `company-description`, never `clearance`.
  - EEO dominance: `legal-eeo-boilerplate` is mutually exclusive with non-company categories.
  - Experience signal hardened: bare word "experience" alone (e.g., "or equivalent experience") does NOT trigger `experience`; requires years/duration/hands-on/prior/experienced/domain patterns.
  - Failure found + fixed during development: certification rule was missing from `CATEGORY_RULES` (unknown returned for "Security+ required."); `+` in cert labels is a regex quantifier and must be escaped.
  - `tests/job-nlp-categorizer.test.ts` (new, 20 tests): one assertion per category, multi-label (employment-type+schedule, compensation+benefit), experience/education equivalency, EEO dominance, clearance-vs-company adversarial guard, skill-vs-tool (Splunk SIEM not clearance), indices propagation, confidence bounds, method/version reporting.
- **Files/components involved:** `src/intelligence/nlp/categorizer.ts`, `tests/job-nlp-categorizer.test.ts`.
- **Architectural decisions:**
  - D-NLP-010: classification is a deterministic rule pass producing `SegmentClassification` per segment (segmentIndex + categories + confidence + method/version); factual `NlpFact` documents are NOT emitted yet — strength/modality (Stage 4) + entity/evidence assembly feed fact construction.
  - D-NLP-011: multi-label by design; category ordering deterministic; unknown only when no rule fires.
- **Tests:** 20 classifier tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-categorizer.test.ts` = 20 pass; `npm run verify` = 111 files / 1155 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** category classification is vocabulary-pattern based — no skill entity normalization yet (Stage 10), no strength/modality (Stage 4), clearance level/citizenship detail extraction (Stage 8), compensation entity parsing (Stage 11/12).
- **Current task:** complete.
- **Exact next action:** Stage 4 - strength/modality classifier (required/preferred/nice-to-have/alternative/equivalency/future/post-hire/ability-to-obtain/informational) with extensive paraphrase + adversarial tests.

---

## Stage 4 — Requirement Strength / Modality

- **Status:** [x]
- **Objective:** Distinguish required/preferred/nice-to-have/alternative/equivalency/future/post-hire/ability-to-obtain/informational with extensive paraphrase + adversarial tests.
- **Implementation tasks:**
  - `src/intelligence/nlp/strength.ts` (new): `classifyStrength(segment, categories)` -> `SegmentStrength` with `STRENGTH_CLASSIFIER_VERSION = 'modality-classifier-v1'`; exactly ONE strength per statement; deterministic precedence `required-after-hire > ability-to-obtain > equivalent-accepted > required > preferred > nice-to-have > informational > unknown`; phrase-paraphrase rules per strength; `be able to obtain` handled so ability-to-obtain beats required.
  - D-NLP-012: modality markers apply ONLY to requirement categories (skill, experience, education, certification, clearance, citizenship); the other categories (benefit, compensation, company-description, legal-eeo-boilerplate, responsibility, location, work-arrangement, travel, schedule, employment-type, unknown) default to `informational` when no marker is present — bare "Remote position." reads informational.
  - 19 tests: explicit required/preferred; post-hire timeline; ability-to-obtain beats required; equivalency (incl. precedence over "preferred"); bare requirement -> unknown (low confidence); EEO/benefits/pure-responsibility -> informational; skill-bearing responsibility -> unknown; remote-vs-must-reside; travel+required; paraphrases (we require / mandatory / ideally / desired / a plus / nice to have / in lieu of / substitute / eligibility); method+version reporting; strength coexists with category.
- **Files/components involved:** `src/intelligence/nlp/strength.ts`, `tests/job-nlp-strength.test.ts`.
- **Architectural decisions:**
  - D-NLP-012 (definition): see tasks.
  - D-NLP-013: strength is per-statement, not per-category; category+strength of a segment become the axes of future `NlpFact` documents (Stages 5-11 fill in entities, Stage 12 reconciliation).
- **Tests:** 19 strength tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-strength.test.ts` = 19 pass; `npm run verify` = 112 files / 1174 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** section context ("Preferred Qualifications" heading) not yet used to boost intent (Stage 5-11 area); no chained compound requirements ("required for X, preferred for Y") disambiguation.
- **Current task:** complete.
- **Exact next action:** Stage 5 - education intelligence (degree level, field, required/preferred, equivalency, experience substitution, combined education/experience).

---

## Stage 5 — Education Intelligence

- **Status:** [x]
- **Objective:** Extract/normalize degree level, field, required/preferred, equivalency, experience substitution, combined education/experience requirements.
- **Implementation tasks:**
  - `src/intelligence/nlp/education.ts` (new): `extractEducation(segment)` -> `EducationExtraction` with `EDUCATION_INTELLIGENCE_VERSION = 'education-intelligence-v1'`; degree level precedence doctorate > master > bachelor > associate > high-school; generic "degree" -> `unknown` level (never guessed); field capture from "in/of/majoring in" phrases with lookahead separators + conservative known-field normalization; equivalency detection (experience vs education vs credential vs combination vs none); experience-substitution years extraction (`or 4 years of related experience`); combined-requirement flag; `degreeSpan` tracing; batch helper `extractEducationBatch`.
  - 14 tests: bachelor+major, master+preferred, doctorate+field, associate, high-school/GED, generic-degree-unknown, experience substitution years, or-equivalent-experience, equivalent education, in-lieu-of, combined degree marking, no-content low confidence, span/version metadata, known vs arbitrary field normalization.
- **Files/components involved:** `src/intelligence/nlp/education.ts`, `tests/job-nlp-education.test.ts`.
- **Architectural decisions:**
  - D-NLP-014: education facts emit degrees + equivalency + substitution years as extracted entities; field values normalized to known vocabulary when present, otherwise conservative lowercased original (never fabricated).
  - D-NLP-015: `extractEducationBatch(segments, categoriesByIndex)` only processes `education`-categorized segments so category classification gates entity extraction.
- **Tests:** 14 education tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-education.test.ts` = 14 pass; `npm run verify` = 113 files / 1188 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** no GPA/minor/institution extraction; field capture is phrase-anchored (`in/of`); no degree-equivalency for specific laddered degrees beyond level precedence.
- **Current task:** complete.
- **Exact next action:** Stage 6 - experience intelligence (min/preferred years, ranges, domain, role context, nested experience, alternatives; never fabricate years; preserve ranges).

---

## Stage 6 — Experience Intelligence

- **Status:** [x]
- **Objective:** Extract min/preferred years, ranges, domain, role context, nested experience, alternatives; never fabricate years; preserve ranges.
- **Implementation tasks:**
  - `src/intelligence/nlp/experience.ts` (new): `extractExperience(segment)` -> `ExperienceExtraction` with `EXPERIENCE_INTELLIGENCE_VERSION = 'experience-intelligence-v1'`; primary `years` (range / at-least / at-most / unknown via range, explicit min/max, "or more", "+" markers with deterministic precedence); `nestedYears` ("including 2 years of X", "5 of which in X"); `months` kept separate (never converted to years); `domains` with stopword filtering and known-phrase capture; `alternatives` split on bare "or"; role `context`; ranges preserved end-to-end (3-5 stays min 3 max 5).
  - Regex hygiene: `matchAll` clone helper for global matching (avoids shared-regex state); primary years parsed from the FULL segment (not the pre-'or' chunk); `String#includes('+')` instead of regex for plus-sign detection.
  - `tests/job-nlp-experience.test.ts` (new, 13 tests): bare years unknown-modifier; nested clauses; range preservation; explicit min/max; plus-sign; or-more; months-not-years; of-which nesting; domains; no-fabrication (no years -> years null, low confidence); or-alternatives; method/version metadata.
- **Files/components involved:** `src/intelligence/nlp/experience.ts`, `tests/job-nlp-experience.test.ts`.
- **Architectural decisions:**
  - D-NLP-016: years are NEVER fabricated or converted (months are not years; no rounding); modifiers are only assigned from explicit wording.
  - D-NLP-017: domain extraction filters stopwords so "experience in X operations" captures `X operations`, never the literal word "experience".
- **Tests:** 13 experience tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-experience.test.ts` = 13 pass; `npm run verify` = 114 files / 1201 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** no semantic range interpretation ("2-4" may mean preferred range not literal); alternatives limited to "or" + year clauses; role-context capture is phrase heuristics only.
- **Current task:** complete.
- **Exact next action:** Stage 7 - certification intelligence (normalize known certs: Security+, Network+, A+, CySA+, SecurityX/CASP+, CISSP, CISM, CCNA, Microsoft/Azure/AWS families; required/preferred/equivalent/after-hire/must-obtain; no false equivalencies).

---

## Stage 7 — Certification Intelligence

- **Status:** [x]
- **Objective:** Normalize known certs (Security+, Network+, A+, CySA+, SecurityX/CASP+, CISSP, CISM, CCNA, Microsoft/Azure/AWS families); distinguish required/preferred/equivalent/after-hire/must-obtain; no false equivalencies.
- **Implementation tasks:**
  - `src/intelligence/nlp/certifications.ts` (new): `CERTIFICATION_CATALOG` of known certifications (Comptia: Security+, Network+, A+, CySA+, SecurityX, CASP+; ISC2 CISSP; ISACA CISM; Cisco CCNA/CCNP/CCIE; families AWS/Azure/Microsoft) with canonical `key`/`name`/`vendor`; per-cert local modality via NEAREST-KEYWORD distance with previous-precedence tie-break (required-after-hire > ability-to-obtain > equivalent-accepted > required > preferred > nice-to-have > unknown); equivalency flag; `blockWhen` guards prevent "grade A+" from matching CompTIA A+; results sorted by span.start; batch gated on the `certification` category; `CERTIFICATION_INTELLIGENCE_VERSION = 'certification-intelligence-v1'`; `certificationCatalog()` export for testability.
  - `tests/job-nlp-certifications.test.ts` (new, 15 tests): catalog coverage; Security+ required with exact span; mixed preferred/required per-cert modality; equivalency phrases; after-hire vs bare requirement; ability-to-obtain; multi-cert statement; SecurityX/CASP+; vendor families (Azure + Microsoft both matched; AWS); no invented certs from plain security language; grade-A+ guard; raw/span integrity; empty result; batch gate.
- **Architectural decisions:**
  - D-NLP-018: modality is assigned per certification from the nearest matching keyword (distance = 0 when the cert falls inside the keyword span); precedence order breaks distance ties. Whole-window precedence proved to misattribute mixed "preferred ... required" segments.
- **Tests:** 15 certification tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-certifications.test.ts` = 15 pass; `npm run verify` = 115 files / 1216 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** family-level matches (AWS/Azure/Microsoft) are coarse and rely on the certification category gate to avoid false positives; the catalog is curated (unknowable certs are not guessed); `cross-certification` equivalencies are NOT claimed (a Microsoft cert is never equated to a Comptia cert).
- **Current task:** complete.
- **Exact next action:** Stage 8 - clearance and citizenship intelligence (clearance level/current/ability-to-obtain/maintain/preferred/public-trust; citizenship; adversarial "cleared team" sentences must not imply applicant clearance).

---

## Stage 8 — Clearance and Citizenship Intelligence

- **Status:** [x]
- **Objective:** Separate clearance level/current/ability-to-obtain/maintain/preferred/public-trust from citizenship; adversarial "cleared team" sentences must not imply applicant clearance.
- **Implementation tasks:**
  - `src/intelligence/nlp/clearance.ts` (new): `extractClearance(segment)` -> `ClearanceExtraction` with `CLEARANCE_INTELLIGENCE_VERSION = 'clearance-intelligence-v1'`; clearance catalog for Top Secret/SCI, Top Secret, Secret, Confidential, Public Trust, SCI, SSBI, and polygraph; generic clearance fallback with `unknown` level; per-clearance status (`current`, `maintenance`, `ability-to-obtain`, `required`, `preferred`, `unknown`) from nearest clause-scoped language; citizenship entities kept separate for U.S. citizen, permanent resident/green card, and work authorization; `teamContext` guard for employer-directed "our cleared team" language; `extractClearanceBatch` gated on `clearance` or `citizenship` categories.
  - `tests/job-nlp-clearance.test.ts` (new, 17 tests): level catalog; TS/SCI overlap dedupe; required/current/ability-to-obtain/maintenance statuses; SSBI + polygraph; slash notation; unknown generic clearance; confidential-NDA negative case; raw/span integrity; employer/team adversarial guard; applicant-directed clearance; U.S. citizenship; permanent resident and work authorization separation; citizenship + clearance clause independence; batch category gate; version metadata.
- **Files/components involved:** `src/intelligence/nlp/clearance.ts`, `tests/job-nlp-clearance.test.ts`.
- **Architectural decisions:**
  - D-NLP-019: clearance entities and citizenship entities are separate outputs; citizenship or work authorization never implies a clearance, and clearance never implies citizenship.
  - D-NLP-020: applicant-status/modality matching is scoped to semicolon-delimited clauses; employer-directed team context is explicitly blocked unless applicant-directed language is present. Clearance-level matches are overlap-deduplicated so `TS/SCI` does not also emit bare `Top Secret`.
- **Tests:** 17 clearance/citizenship tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-clearance.test.ts` = 17 pass; `npm run verify` = 116 files / 1233 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** clause scoping currently uses semicolons only to avoid splitting abbreviations such as `U.S.`; clearance and citizenship catalogs are deterministic and curated; no adjudication/date/agency normalization yet.
- **Current task:** complete.
- **Exact next action:** Stage 9 - location / remote / hybrid intelligence (remote, hybrid, onsite, commute distance, excluded states, occasional onsite, relocation, travel; compare with the existing geographic engine and never weaken hard gates).

---

## Stage 9 — Location / Remote / Hybrid Intelligence

- **Status:** [x]
- **Objective:** Interpret remote/hybrid/onsite/commuting-distance/excluded-states/occasional-onsite/relocation/travel; do NOT let the word "remote" imply unrestricted remote; compare NLP output vs existing geographic engine and record conflicts; never weaken hard gates.
- **Implementation tasks:**
  - `src/intelligence/nlp/location.ts` (new): `extractLocation(segment)` -> `LocationExtraction` with `LOCATION_INTELLIGENCE_VERSION = 'location-intelligence-v1'`; conservative remote/hybrid/onsite classification with explicit remote-denial and technical-remote guards; existing deterministic arrangement classification exposed beside the NLP result with an `arrangementConflict` flag; city/state mentions with exact spans; nationwide/state-limited/unspecified remote scope; excluded states; commute requirement with optional numeric miles (never calculated); occasional vs regular onsite; relocation required/preferred/available/not-available; travel mention/requirement/percentage/overnight; `extractLocationBatch` gated on `location`, `work-arrangement`, or `travel` categories.
  - `tests/job-nlp-location.test.ts` (new, 17 tests): remote/hybrid/denial/technical terminology; occasional onsite conflict; city/state evidence spans; full state names and multiple remote states; nationwide remote; excluded state evidence; commute miles and nonnumeric commuting distance; relocation statuses; travel percent/overnight; no invented travel; category gate; metadata; conservative empty output.
- **Files/components involved:** `src/intelligence/nlp/location.ts`, `tests/job-nlp-location.test.ts`; existing comparison reference `src/domain/work-arrangement.ts`.
- **Architectural decisions:**
  - D-NLP-021: location intelligence reports arrangement conflicts with existing deterministic work-arrangement classification but never resolves the conflict by changing production eligibility, score, ranking, or filtering.
  - D-NLP-022: no NLP location fact fabricates a city, state, distance, or unrestricted remote scope; excluded states, commute constraints, relocation, and travel remain shadow evidence until a later reconciliation stage.
- **Tests:** 17 location/remote/hybrid tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-location.test.ts` = 17 pass; `npm run verify` = 117 files / 1250 tests green; eslint clean; `tsc --noEmit` clean; prettier clean. A transient API `fetch failed: bad port` occurred once during a parallel full run; the three affected API files passed on rerun and the subsequent full gate passed.
- **Known limitations:** city extraction is intentionally limited to city/state forms; state-limited scope is text evidence, not geographic eligibility; clause context is heuristic; occasional onsite can conflict with existing deterministic precedence; no provider-field or geographic-engine persistence/reconciliation exists yet.
- **Current task:** complete.
- **Exact next action:** Stage 10 - skill and technology extraction (required/preferred/mentioned/environment/responsibility; conservative alias normalization while preserving raw entities).

---

## Stage 10 — Skill and Technology Extraction

- **Status:** [x]
- **Objective:** Extract skills/technologies; distinguish required/preferred/mentioned/environment/responsibility; normalize aliases conservatively preserving original entity.
- **Implementation tasks:**
  - `src/intelligence/nlp/skills.ts` (new): `extractSkills(segment, catalog?)` -> `SkillExtraction` with `SKILL_INTELLIGENCE_VERSION = 'skill-intelligence-v1'`; configurable catalog entries plus a conservative default catalog; boundary-aware alias matching; raw alias/canonical name/normalized name/span preservation; skill vs technology kind; per-mention context (`required`, `preferred`, `mentioned`, `environment`, `responsibility`) using nearest clause-scoped markers; overlap dedupe prefers longer evidence; `extractSkillsBatch` gated on the `skill` category.
  - `tests/job-nlp-skills.test.ts` (new, 12 tests): canonical technologies and aliases; embedded-word negative case; skill/technology separation; overlapping alias preference; required/preferred labels; environment/responsibility labels; unqualified mentions; clause isolation; raw/span integrity; batch gate; metadata/confidence; conservative empty output.
- **Files/components involved:** `src/intelligence/nlp/skills.ts`, `tests/job-nlp-skills.test.ts`; configured catalog reference `src/skills/skillExtractor.ts` and `config/scoring-config.json`.
- **Architectural decisions:**
  - D-NLP-023: catalog normalization preserves exact raw evidence and never changes the existing production skill extractor or scoring catalog; caller-supplied catalogs take precedence over the standalone default catalog.
  - D-NLP-024: skill/technology kind and contextual role are independent annotations; context is per mention and semicolon-scoped so a later required/preferred clause cannot bleed into an earlier entity.
- **Tests:** 12 skill/technology tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-skills.test.ts` = 12 pass; `npm run verify` = 118 files / 1262 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** default technology classification is a curated fallback; unknown skills are not guessed; context is lexical and clause-scoped; no semantic synonym expansion or production catalog mutation exists yet.
- **Current task:** complete.
- **Exact next action:** Stage 11 - boilerplate and non-requirement filtering (EEO, benefits, marketing, legal, accommodation, compensation, cultural, and description content; preserve real soft-skill requirements).

---

## Stage 11 — Boilerplate and Non-Requirement Filtering

- **Status:** [x]
- **Objective:** Identify EEO/benefits/marketing/legal/accommodation/compensation/cultural/description content; conservative with generic soft skills ("excellent communication" may be a real requirement).
- **Implementation tasks:**
  - `src/intelligence/nlp/boilerplate.ts` (new): `extractBoilerplate(segment)` -> `BoilerplateExtraction` with `BOILERPLATE_INTELLIGENCE_VERSION = 'boilerplate-intelligence-v1'`; signal kinds for EEO, benefits, marketing, legal, accommodation, compensation, culture, and company description; exact signal spans; requirement-signal detection; conservative disposition (`boilerplate`, `requirement`, `mixed`, `unknown`); `isBoilerplate` is false whenever applicant-directed or genuine soft-skill requirement evidence exists; `extractBoilerplateBatch` remains additive and never deletes segments.
  - `tests/job-nlp-boilerplate.test.ts` (new, 14 tests): EEO, benefits, compensation, marketing/company description, legal/accommodation, culture, soft-skill preservation, mixed benefits requirement, compensation responsibility, required background check, unrelated prose, span evidence, batch behavior, metadata/confidence.
- **Files/components involved:** `src/intelligence/nlp/boilerplate.ts`, `tests/job-nlp-boilerplate.test.ts`.
- **Architectural decisions:**
  - D-NLP-025: boilerplate classification is a later-stage signal, not a destructive filter; segments remain available for reconciliation and diagnostics.
  - D-NLP-026: any applicant-directed requirement, responsibility, or real generic soft-skill signal changes disposition to `requirement`/`mixed` and sets `preserveRequirement = true`; EEO/company-description overlap is kept separate and broad company patterns do not swallow EEO evidence.
- **Tests:** 14 boilerplate/filtering tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-boilerplate.test.ts` = 14 pass; `npm run verify` = 119 files / 1276 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** phrase rules are conservative and English-only; no section-level filtering context or fact assembler exists yet; mixed statements intentionally require later reconciliation rather than automatic removal.
- **Current task:** complete.
- **Exact next action:** Stage 12 - deterministic + NLP reconciliation (agreement/conflict states, deterministic authority, value/modality/entity/scope conflict details, still shadow-only).

---

## Stage 12 — Deterministic + NLP Reconciliation

- **Status:** [ ]
- **Objective:** Reconciliation layer distinguishing AGREEMENT / DETERMINISTIC_ONLY / NLP_ONLY / CONFLICT / UNKNOWN with conflict classification (value/modality/entity/scope/missing-D/missing-NLP); preserve both interpretations in shadow mode.
- **Current task / exact next action:** defined on completion of Stage 11.

---

## Stage 13 — Shadow-Mode Persistence

- **Status:** [ ]
- **Objective:** Persist NLP enrichment safely (versioned, reprocessable, no production-score/eligibility change, no job-description overwrite, conflict/debug/migration support).
- **Current task / exact next action:** defined on completion of Stage 12.

---

## Stage 14 — Invalidation and Reprocessing

- **Status:** [ ]
- **Objective:** Stored-NLP-version != current -> bounded reprocessing (batches, resumable, idempotent, crash-safe); learn from role-details-v1/v2 stale-data issue; never auto-archive.
- **Current task / exact next action:** defined on completion of Stage 13.

---

## Stage 15 — NLP Debug / Intelligence Inspector

- **Status:** [ ]
- **Objective:** Developer-facing inspector: evidence | category | strength | entities | confidence | source | method | version | reconciliation state per job; no secret/personal leakage.
- **Current task / exact next action:** defined on completion of Stage 14.

---

## Stage 16 — Synthetic NLP Evaluation Corpus

- **Status:** [ ]
- **Objective:** Deterministic paraphrase corpus covering all categories + adversarial examples (e.g. "our cleared team supports Secret environments" must not imply applicant clearance).
- **Current task / exact next action:** defined on completion of Stage 15.

---

## Stage 17 — Representative Job Evaluation

- **Status:** [ ]
- **Objective:** Evaluate NLP against ~50-100 representative descriptions (synthetic/labeled local fixture if live data unsafe); measure category/strength/entity accuracy + critical FP/FN + disagreement rate; no inventing ground truth.
- **Current task / exact next action:** defined on completion of Stage 16.

---

## Stage 18 — Shadow-Mode Acceptance Gate

- **Status:** [ ]
- **Objective:** Verify no production score/eligibility/ranking/removal changes; persistence/versioning works; stale data reprocesses; evidence retained; conflicts visible; debug works; evaluation completed; critical semantic classes hit documented quality targets.
- **Current task / exact next action:** defined on completion of Stage 17.

---

## Stage 19 — Semantic Normalization / Embedding Design

- **Status:** [ ]
- **Objective:** Research + design only: local embedding runtime, model selection/licensing/redistribution, versioning, cache, canonical representations, thresholds, explainability, invalidation; measure size/startup/latency/memory/disk/CPU/packaging impact; NEVER silently add hundreds of MB or download models at runtime.
- **Current task / exact next action:** defined on completion of Stage 18.

---

## Stage 20 — Semantic Role Matching Shadow Mode

- **Status:** [ ]
- **Objective:** Similarity job title <-> target role/canonical family; persist similarity/version/canonical role/evidence; compare vs deterministic role matching; positive + adversarial examples.
- **Current task / exact next action:** defined on completion of Stage 19.

---

## Stage 21 — Semantic Skill Normalization Shadow Mode

- **Status:** [ ]
- **Objective:** Compare extracted skills vs concepts with EXACT/CANONICAL_ALIAS/STRONG_RELATED/WEAK_RELATED/UNRELATED/UNKNOWN; retain phrase, concept, score, model/version, relationship; adversarial tests.
- **Current task / exact next action:** defined on completion of Stage 20.

---

## Stage 22 — Resume Evidence Matching Shadow Mode

- **Status:** [ ]
- **Objective:** Map requirements to parsed resume evidence -> DIRECT_MATCH/STRONG_RELATED_EVIDENCE/WEAK_RELATED_EVIDENCE/NO_EVIDENCE/UNKNOWN; never claim possession; preserve evidence; no resume modification; no scoring change.
- **Current task / exact next action:** defined on completion of Stage 21.

---

## Stage 23 — Requirement Coverage Model

- **Status:** [ ]
- **Objective:** Data model for future "Requirement Coverage" UI; direct/related/missing/unknown evidence distinguished; weighted by required/preferred/nice-to-have; separate from production scoring until promoted.
- **Current task / exact next action:** defined on completion of Stage 22.

---

## Stage 24 — NLP / Semantic Performance Audit

- **Status:** [ ]
- **Objective:** Measure extraction/segmentation/classification/embedding/resume-comparison time, memory, DB growth, startup impact, reprocessing throughput, installer impact on ordinary Windows hardware; cache with stable fingerprints; never optimize away correctness.
- **Current task / exact next action:** defined on completion of Stage 23.

---

## Stage 25 — Security / Privacy / Packaging Audit

- **Status:** [ ]
- **Objective:** Audit model files, runtime, caches, NLP DB records, fixtures, diagnostics, build inputs, packaged files, installer; verify no telemetry/external transmission/secrets/personal data/dev paths; fresh installs have neutral NLP state; verify model licensing if packaged.
- **Current task / exact next action:** defined on completion of Stage 24.

---

## Stage 26 — Intelligence UX Prototype

- **Status:** [ ]
- **Objective:** Job-detail JOB INTELLIGENCE prototype (requirement coverage, requirements summary, traceable evidence, "interpreted as" wording); no wholesale UI redesign; no probabilistic claims as facts.
- **Current task / exact next action:** defined on completion of Stage 25.

---

## Stage 27 — Promotion Design for Production Scoring

- **Status:** [ ]
- **Objective:** Explicit architecture proposal (Levels 0-4) based on measured results; per-field accuracy/FP/FN/error consequence/fallback/confidence/corroboration/evidence; hard-gate promotion requires stronger evidence; no implementation unless roadmap/authorization includes it.
- **Current task / exact next action:** defined on completion of Stage 26.

---

## Stage 28 — Full Regression and Upgrade Validation

- **Status:** [ ]
- **Objective:** Full project verification; demonstrate existing production recommendation scores unchanged during shadow-mode; no substituting focused tests for the complete gate.
- **Current task / exact next action:** defined on completion of Stage 27.

---

## Stage 29 — Documentation and Final Intelligence Handoff

- **Status:** [ ]
- **Objective:** Reconcile roadmap + Project Memory + README/CHANGELOG/SESSION_HANDOFF/architecture; exact promotion status; final report (43-point) with explicit NLP SHADOW MODE VALIDATED / NOT YET VALIDATED status.
- **Current task / exact next action:** defined on completion of Stage 28.

---

## Verification Ledger (NLP program)

| Date       | Action                   | Result                                                                    |
| ---------- | ------------------------ | ------------------------------------------------------------------------- |
| 2026-09-10 | Baseline before NLP work | `npm run verify` 108 files / 1101 tests PASS (v1.1.0)                     |
| 2026-09-10 | Stage 1 contract         | `npx vitest run tests/job-nlp-schema.test.ts` 17 PASS; eslint + tsc clean |
