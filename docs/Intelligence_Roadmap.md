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
CURRENT_STAGE:       P24-P27 complete; P28 release decision pending
CURRENT_TASK:        P28 explicit release and installer decision
LAST_COMPLETED:      P24-P27; verify 157/1445, privacy 11/11, all current-source smoke PASS
NEXT_ACTION:         ask whether to rebuild the 1.1.0 installer and run artifact validation
FILES_IN_PROGRESS:   none; P24-P27 are committed
TESTS_TO_RUN:        none before P28 decision; installer sequence only if approved
KNOWN_FAILURES:      none; installer last built 2026-09-10 20:07:47 and is stale
LATEST_CHECKPOINT:   45a51b0 P24-P27 verified promotion gates (local only)
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
                      swallow EEO sentences; reconciliation must preserve both
                      sides and treat deterministic values as authoritative;
                       missing dimensions are not silent agreement; persistence must
                       use a separate additive table, validate the full envelope,
                       preserve created_at, use source hash/version staleness checks,
                        and never update jobs; reprocessing must sort/dedupe
                        candidates, bound each batch, skip fresh rows, preserve
                        completed saves after failures, validate builder version/hash,
                         and never expose archive/score/eligibility operations;
                          inspector must be read-only, deterministically ordered,
                          and redact emails, phones, SSNs, secrets, profiles, and
                          street addresses before exposing evidence;
                          evaluation corpus must remain synthetic/local,
                          deterministically labeled, cover every contract category
                          and strength, and preserve adversarial negative labels;
                          acceptance must fail closed below documented quality
                          thresholds or when any production-safety evidence is
                          absent; no threshold may permit critical failures;
                          segment helper must use the real
                      NlpSegment shape (index/text/normalized/kind/sourceField/
                      charStart/charEnd), not base/meta
SAFE_RESUME_POINT:   P28 release decision; do not restart completed P0-P27
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
| 12    | Deterministic + NLP reconciliation           | [x]    |
| 13    | Shadow-mode persistence                      | [x]    |
| 14    | Invalidation and reprocessing                | [x]    |
| 15    | NLP debug / intelligence inspector           | [x]    |
| 16    | Synthetic NLP evaluation corpus              | [x]    |
| 17    | Representative job evaluation                | [x]    |
| 18    | Shadow-mode acceptance gate                  | [x]    |
| 19    | Semantic normalization / embedding design    | [x]    |
| 20    | Semantic role matching shadow mode           | [x]    |
| 21    | Semantic skill normalization shadow mode     | [x]    |
| 22    | Resume evidence matching shadow mode         | [x]    |
| 23    | Requirement coverage model                   | [x]    |
| 24    | NLP / semantic performance audit             | [x]    |
| 25    | Security / privacy / packaging audit         | [x]    |
| 26    | Intelligence UX prototype                    | [x]    |
| 27    | Promotion design for production scoring      | [x]    |
| 28    | Full regression and upgrade validation       | [x]    |
| 29    | Documentation and final intelligence handoff | [x]    |

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
- **Exact next action:** Stages 2-14 delivered (segmentation, categories, strength, education, experience, certifications, clearance/citizenship, location/remote/hybrid, skills/technology, boilerplate filtering, reconciliation, shadow persistence, reprocessing); proceed to Stage 15.

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

- **Status:** [x]
- **Objective:** Reconciliation layer distinguishing AGREEMENT / DETERMINISTIC_ONLY / NLP_ONLY / CONFLICT / UNKNOWN with conflict classification (value/modality/entity/scope/missing-D/missing-NLP); preserve both interpretations in shadow mode.
- **Implementation tasks:**
  - `src/intelligence/nlp/reconciliation.ts` (new): `reconcileFact(input)` and `reconcileFacts(inputs)` with `RECONCILIATION_INTELLIGENCE_VERSION = 'reconciliation-v1'`; compares value, modality, entity, and scope independently; emits `agreement`, `deterministic-only`, `nlp-only`, `conflict`, or `unknown`; emits `value`/`modality`/`entity`/`scope`/`missing-deterministic`/`missing-nlp` nature; preserves both sides; exposes deterministic authority and an authoritative diagnostic value without mutating production facts.
  - `tests/job-nlp-reconciliation.test.ts` (new, 10 tests): agreement normalization; deterministic-only; NLP-only; value conflict; modality conflict; entity conflict; scope conflict; unknown; missing dimension conflict; batch order; metadata/confidence.
- **Files/components involved:** `src/intelligence/nlp/reconciliation.ts`, `tests/job-nlp-reconciliation.test.ts`; contract references `src/schemas/job-nlp.ts`.
- **Architectural decisions:**
  - D-NLP-027: deterministic and NLP interpretations are retained side-by-side; deterministic values remain authoritative for any downstream diagnostic projection, and no production scoring/eligibility mutation is allowed.
  - D-NLP-028: agreement is dimension-aware; a value match with a missing modality/entity/scope is not silent agreement and receives a conflict/missing nature.
- **Tests:** 10 reconciliation tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-reconciliation.test.ts` = 10 pass; `npm run verify` = 120 files / 1286 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** this stage provides a pure utility only; no job-level fact assembler, database persistence, or UI projection exists yet; deterministic side authority is diagnostic and does not authorize promotion to production behavior.
- **Current task:** complete.
- **Exact next action:** Stage 13 - shadow-mode persistence (versioned enrichment storage, source hash, safe upsert, no production document overwrite, conflict/debug retention).

---

## Stage 13 — Shadow-Mode Persistence

- **Status:** [x]
- **Objective:** Persist NLP enrichment safely (versioned, reprocessable, no production-score/eligibility change, no job-description overwrite, conflict/debug/migration support).
- **Implementation tasks:**
  - `src/db/migrations/031_nlp_enrichments.sql` (new): additive `job_nlp_enrichments` table keyed by `job_id`, foreign-key cascade, extraction version, source text hash, generated JSON envelope, generated/created/updated timestamps, JSON validity check, and stale lookup index; no NLP columns are added to `jobs`.
  - `src/database/jobNlpEnrichmentRepository.ts` (new): validates with `jobNlpEnrichmentSchema`, saves with explicit `ON CONFLICT(job_id) DO UPDATE`, preserves `created_at`, reads validated JSON, exposes `isStale(jobId, version, sourceHash)` and `listStaleByVersion(version)`, and never updates `jobs`.
  - `tests/job-nlp-persistence.test.ts` (new, 5 tests): save/read, production-field preservation, current-row upsert/created-at preservation, invalid envelope rejection, stale version/hash detection, and foreign-key cascade.
  - Existing migration expectations updated for migration 031 and the new table.
- **Files/components involved:** `src/db/migrations/031_nlp_enrichments.sql`, `src/database/jobNlpEnrichmentRepository.ts`, `tests/job-nlp-persistence.test.ts`, migration-preservation tests.
- **Architectural decisions:**
  - D-NLP-029: current NLP enrichment lives in a separate one-row-per-job table; descriptions, production scores, eligibility, lifecycle, and role-details fields remain untouched.
  - D-NLP-030: repository writes validate the complete versioned envelope and retain source hash/version metadata; stale detection is explicit and Stage 14 owns reprocessing.
- **Tests:** 5 persistence tests plus migration-preservation coverage (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-persistence.test.ts tests/migrations.test.ts tests/application-event-migration.test.ts` = 15 pass; `npm run verify` = 121 files / 1291 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** only the current enrichment is stored (no append-only history); no job-level NLP assembler is wired yet; reprocessing, invalidation, and UI/debug projections remain Stage 14+ work.
- **Current task:** complete.
- **Exact next action:** Stage 14 - invalidation and reprocessing (stale version/hash discovery, bounded resumable work, idempotence, crash safety, no auto-archive).

---

## Stage 14 — Invalidation and Reprocessing

- **Status:** [x]
- **Objective:** Stored-NLP-version != current -> bounded reprocessing (batches, resumable, idempotent, crash-safe); learn from role-details-v1/v2 stale-data issue; never auto-archive.
- **Implementation tasks:**
  - `src/intelligence/nlp/reprocessing.ts` (new): `planReprocessing` and `runReprocessingBatch` with `REPROCESSING_INTELLIGENCE_VERSION = 'reprocessing-v1'`; deterministic job-id sorting/deduplication; positive batch-size validation; cursor resume; stale version/source-hash checks through a persistence target; fresh-row skips; per-job save isolation; builder version/hash validation; processed/failure results; no archive, score, eligibility, or lifecycle API.
  - `tests/job-nlp-reprocessing.test.ts` (new, 7 tests): bounded sorting/deduplication/cursor; fresh vs changed hash; invalid batch size; idempotent retry; partial failure preservation; builder mismatch rejection; no production/archive operations.
- **Files/components involved:** `src/intelligence/nlp/reprocessing.ts`, `tests/job-nlp-reprocessing.test.ts`, `src/database/jobNlpEnrichmentRepository.ts` target contract.
- **Architectural decisions:**
  - D-NLP-031: reprocessing is cursor-based and per-job; completed writes survive later failures, and reruns skip rows whose version and source hash are current.
  - D-NLP-032: a builder must return the requested extraction version and candidate source hash; mismatches fail that candidate only; no invalidation path archives or changes production job fields.
- **Tests:** 7 reprocessing tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-reprocessing.test.ts` = 7 pass; `npm run verify` = 122 files / 1298 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** candidates/source hashes are supplied by the caller until a job-level assembler supplies current source hashes; failures are returned for retry but no queue/worker scheduler exists yet; persistence history is still current-row only.
- **Current task:** complete.
- **Exact next action:** Stage 15 - NLP debug / intelligence inspector (developer-facing evidence/category/strength/entity/confidence/source/method/version/reconciliation view with secret and personal-data redaction).

---

## Stage 15 — NLP Debug / Intelligence Inspector

- **Status:** [x]
- **Objective:** Developer-facing inspector: evidence | category | strength | entities | confidence | source | method | version | reconciliation state per job; no secret/personal leakage.
- **Implementation tasks:**
  - `src/intelligence/nlp/inspector.ts` (new): read-only `inspectJobNlp` projection with inspector/extraction versions, source hash, segmentation metadata, evidence spans, category, strength, entities, confidence/bands, extraction method, and reconciliation state; facts/entities are deterministically ordered and user-derived text is redacted for email, phone, SSN, secret assignment, LinkedIn profile, and street-address patterns.
  - `tests/job-nlp-inspector.test.ts` (new, 4 tests): diagnostic projection, redaction across all user-derived fields, deterministic ordering/non-mutation, and empty-confidence behavior.
- **Files/components involved:** `src/intelligence/nlp/inspector.ts`, `tests/job-nlp-inspector.test.ts`, `src/schemas/job-nlp.ts`.
- **Architectural decisions:**
  - D-NLP-033: inspector output is a derived, read-only projection; it never persists, scores, ranks, filters, archives, or changes production fields.
  - D-NLP-034: evidence remains span-addressable but user-derived text is redacted before projection; segmentation metadata exposes counts/method only, not a second unredacted text channel.
- **Tests:** 4 inspector tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-inspector.test.ts` = 4 pass; `npm run verify` = 123 files / 1302 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** redaction is deterministic pattern-based and not a general DLP classifier; the inspector is currently a pure module with no HTTP/UI route; source text remains available only through explicitly redacted evidence fields.
- **Current task:** complete.
- **Exact next action:** Stage 23 delivered (diagnostic modality-weighted coverage with no production effect); begin Stage 24 - performance audit.

---

## Stage 16 — Synthetic NLP Evaluation Corpus

- **Status:** [x]
- **Objective:** Deterministic paraphrase corpus covering all categories + adversarial examples (e.g. "our cleared team supports Secret environments" must not imply applicant clearance).
- **Implementation tasks:**
  - `src/intelligence/nlp/evaluationCorpus.ts` (new): 42 synthetic/local labeled cases covering all 17 requirement categories and all 8 strength labels, with expected entities, forbidden categories/entities, arrangement expectations, and rationale; includes paraphrases, multi-label duties, and critical clearance/A+/technical-remote/remote-denial adversarial cases.
  - `tests/job-nlp-evaluation-corpus.test.ts` (new, 3 tests): contract category/strength coverage, unique/non-empty labels with at least two cases per category, and critical negative/arrangement case retention.
- **Files/components involved:** `src/intelligence/nlp/evaluationCorpus.ts`, `tests/job-nlp-evaluation-corpus.test.ts`, `src/schemas/job-nlp.ts`.
- **Architectural decisions:**
  - D-NLP-035: the corpus is deterministic synthetic evaluation data, not production training data and not live-user data.
  - D-NLP-036: expected categories/strengths/entities and forbidden categories are explicit labels; adversarial cases retain expected negatives instead of being edited to make current classifiers pass.
- **Tests:** 3 corpus integrity tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-evaluation-corpus.test.ts` = 3 pass; `npm run verify` = 124 files / 1305 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** Stage 16 labels are not yet accuracy scores; Stage 17 must run the current extractors against the corpus and report false positives/negatives without changing labels to fit the implementation.
- **Current task:** complete.
- **Exact next action:** Stage 17 - representative job evaluation using this corpus plus additional local representative descriptions.

---

## Stage 17 — Representative Job Evaluation

- **Status:** [x]
- **Objective:** Evaluate NLP against ~50-100 representative descriptions (synthetic/labeled local fixture if live data unsafe); measure category/strength/entity accuracy + critical FP/FN + disagreement rate; no inventing ground truth.
- **Implementation tasks:**
  - `src/intelligence/nlp/representativeCorpus.ts` (new): 12 additional synthetic labeled descriptions, bringing the evaluated local corpus to 54 cases.
  - `src/intelligence/nlp/evaluation.ts` (new): deterministic category/strength/entity/arrangement evaluator, precision/recall/exact metrics, critical forbidden-category/entity and missing-category failures, and label disagreement rate; uses current extractors without changing labels or production behavior.
  - `tests/job-nlp-evaluation.test.ts` (new, 4 tests): 50-plus corpus/report integrity, bounded metrics, corrected technical-remote category, clean team-clearance distinction, and employer-clearance entity suppression.
- **Files/components involved:** `src/intelligence/nlp/evaluation.ts`, `src/intelligence/nlp/representativeCorpus.ts`, `tests/job-nlp-evaluation.test.ts`, Stage 16 corpus and extractors.
- **Architectural decisions:**
  - D-NLP-037: live job descriptions are not used as unreviewed ground truth; evaluation uses only explicitly labeled synthetic/local cases.
  - D-NLP-038: labels are immutable evaluation inputs; known false positives/negatives are reported rather than hidden by changing fixtures or production behavior.
- **Tests:** 4 evaluation tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-evaluation.test.ts` = 4 pass; `npm run verify` = 126 files / 1312 tests green; eslint clean; `tsc --noEmit` clean; prettier clean. Corrected report: category exact 88.9% (precision 93.1%, recall 91.5%), strength accuracy 96.3%, entity exact 94.4% (precision 96.6%, recall 90.3%), arrangement 7/8, label disagreement 13.0%, critical adversarial failures 0/7.
- **Known limitations:** results are synthetic/local and not representative of live provider distributions; category and entity misses remain to be triaged; the report measures disagreement against explicit labels, not deterministic production-score changes.
- **Current task:** complete.
- **Exact next action:** Stage 18 delivered; proceed to the acceptance gate record below.

---

## Stage 18 — Shadow-Mode Acceptance Gate

- **Status:** [x]
- **Objective:** Verify no production score/eligibility/ranking/removal changes; persistence/versioning works; stale data reprocesses; evidence retained; conflicts visible; debug works; evaluation completed; critical semantic classes hit documented quality targets.
- **Implementation tasks:**
  - `src/intelligence/nlp/acceptance.ts` (new): fail-closed `evaluateNlpAcceptanceGate` with explicit minimum category precision/recall (0.90), strength accuracy (0.95), entity precision/recall (0.90), maximum arrangement/label disagreement (0.15), and zero critical failure rate; requires production-field, persistence/versioning, reprocessing, evidence, conflict, and inspector safety evidence.
  - `tests/job-nlp-acceptance.test.ts` (new, 3 tests): observed report passes only with all safety evidence, missing safety evidence fails closed, and quality threshold failures expose no production operations.
  - Stage 17 remediation: category filtering now blocks grade A+ and technical remote lexical false positives; company Secret-program context no longer emits applicant clearance entities.
- **Files/components involved:** `src/intelligence/nlp/acceptance.ts`, `tests/job-nlp-acceptance.test.ts`, `src/intelligence/nlp/categorizer.ts`, `src/intelligence/nlp/clearance.ts`, Stage 17 evaluation.
- **Architectural decisions:**
  - D-NLP-039: no critical adversarial category/entity failures are acceptable; the gate fails closed instead of lowering thresholds or changing labels.
  - D-NLP-040: safety evidence is explicit caller-supplied verification from persistence, reprocessing, reconciliation, inspector, and production-preservation tests; the gate cannot infer safety from quality scores.
- **Tests:** 3 acceptance-gate tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-acceptance.test.ts` = 3 pass; `npm run verify` = 126 files / 1312 tests green; corrected evaluation report passes all thresholds with zero critical failures.
- **Known limitations:** the gate consumes evidence booleans and does not itself open a database or run a production-vs-shadow diff; Stage 19 remains design-only and no semantic model/runtime has been added.
- **Current task:** complete.
- **Exact next action:** Stage 19 - semantic normalization/embedding design with measured packaging/runtime impact and no silent downloads.

---

## Stage 19 — Semantic Normalization / Embedding Design

- **Status:** [x]
- **Objective:** Research + design only: local embedding runtime, model selection/licensing/redistribution, versioning, cache, canonical representations, thresholds, explainability, invalidation; measure size/startup/latency/memory/disk/CPU/packaging impact; NEVER silently add hundreds of MB or download models at runtime.
- **Implementation tasks:**
  - `docs/NLP_SEMANTIC_DESIGN.md` (new): design-only semantic input/concept/match records; deterministic-first and shadow-only decisions; local runtime options; license/redistribution checklist; model/tokenizer/runtime versioning; source-hash cache key; threshold calibration and abstention; redacted explainability; offline benchmark matrix; rollout/non-goals.
- **Files/components involved:** `docs/NLP_SEMANTIC_DESIGN.md`, `src/schemas/job-nlp.ts`, `src/intelligence/nlp/inspector.ts`, `src/intelligence/nlp/reprocessing.ts`, `package.json`.
- **Architectural decisions:**
  - D-NLP-041: no semantic runtime, model artifact, network fetch, or package dependency is added until an offline benchmark records quality, license, size, startup, latency, memory, CPU, disk, cache, and packaging impact.
  - D-NLP-042: semantic output is a versioned, abstention-capable shadow suggestion; deterministic evidence and hard gates remain authoritative, and cache entries are disposable derived data.
- **Tests:** no new runtime tests; the design is validated by the full repository gate.
- **Validation evidence:** `npm run verify` = 126 files / 1312 tests green; no semantic dependency or model artifact added; no network/model download path added.
- **Known limitations:** model/runtime selection remains open pending benchmark evidence; thresholds and package budgets are intentionally not invented; future semantic work must remain behind an adapter and acceptance gate.
- **Current task:** complete.
- **Exact next action:** Stage 20 - semantic role matching shadow mode using deterministic fallback and no production scoring/eligibility integration.

---

## Stage 20 — Semantic Role Matching Shadow Mode

- **Status:** [x]
- **Objective:** Similarity job title <-> target role/canonical family; persist similarity/version/canonical role/evidence; compare vs deterministic role matching; positive + adversarial examples.
- **Implementation tasks:**
  - `src/intelligence/nlp/roleMatching.ts` (new): `matchRoleShadow` deterministic-fallback adapter over configured role-family titles; token overlap, exact-title tie-break, threshold/margin abstention, bounded candidates, deterministic reconciliation, and `runRoleMatchingShadow` explicit persistence target; no embedding/runtime dependency or production operation.
  - `tests/job-nlp-role-matching.test.ts` (new, 6 tests): exact title, close-title token overlap, weak/ambiguous abstention, deterministic conflict, bounds/non-mutation, and shadow-record persistence.
- **Files/components involved:** `src/intelligence/nlp/roleMatching.ts`, `tests/job-nlp-role-matching.test.ts`, `src/config/search-profile.ts`.
- **Architectural decisions:**
  - D-NLP-043: until a measured semantic runtime exists, role matching is a clearly labeled deterministic fallback and never claims embedding semantics.
  - D-NLP-044: persistence is an explicit additive target interface for shadow records; no `jobs` score/eligibility/ranking/archive field or database migration is touched.
- **Tests:** 6 role-matching tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-role-matching.test.ts` = 6 pass; `npm run verify` = 127 files / 1318 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** token overlap is not semantic similarity and cannot infer unseen role concepts; persistence is caller-provided and not wired to a production database; Stage 21 owns canonical skill relationships.
- **Current task:** complete.
- **Exact next action:** Stage 21 - semantic skill normalization shadow mode with exact/alias/related/unknown relationship labels and adversarial tests.

---

## Stage 21 — Semantic Skill Normalization Shadow Mode

- **Status:** [x]
- **Objective:** Compare extracted skills vs concepts with EXACT/CANONICAL_ALIAS/STRONG_RELATED/WEAK_RELATED/UNRELATED/UNKNOWN; retain phrase, concept, score, model/version, relationship; adversarial tests.
- **Implementation tasks:**
  - `src/intelligence/nlp/skillNormalization.ts` (new): catalog-derived concepts, exact/canonical-alias matching, reviewed strong/weak relationship pairs, explicit unrelated/unknown outcomes, score/explanation/method/model/version fields, and `compareSkillMention` source-phrase preservation; no embedding runtime or automatic synonym guessing.
  - `tests/job-nlp-skill-normalization.test.ts` (new, 6 tests): exact, alias, extracted alias, strong/weak relatedness, unrelated/unknown/adversarial abstention, and catalog immutability.
- **Files/components involved:** `src/intelligence/nlp/skillNormalization.ts`, `tests/job-nlp-skill-normalization.test.ts`, `src/intelligence/nlp/skills.ts`.
- **Architectural decisions:**
  - D-NLP-045: only existing catalog aliases are canonical aliases; relationship labels are explicit reviewed data, and relatedness never claims equivalence.
  - D-NLP-046: unknown phrases remain unknown, including clearance/grade/remote text; no semantic model or production skill mutation is introduced.
- **Tests:** 6 skill-normalization tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-skill-normalization.test.ts` = 6 pass; `npm run verify` = 128 files / 1324 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** reviewed relationships are intentionally small and deterministic; no unseen-skill embedding search exists; persistence and resume evidence matching remain later stages.
- **Current task:** complete.
- **Exact next action:** Stage 22 - resume evidence matching shadow mode with direct/related/weak/no-evidence/unknown outcomes and no resume modification.

---

## Stage 22 — Resume Evidence Matching Shadow Mode

- **Status:** [x]
- **Objective:** Map requirements to parsed resume evidence -> DIRECT_MATCH/STRONG_RELATED_EVIDENCE/WEAK_RELATED_EVIDENCE/NO_EVIDENCE/UNKNOWN; never claim possession; preserve evidence; no resume modification; no scoring change.
- **Implementation tasks:**
  - `src/intelligence/nlp/resumeEvidence.ts` (new): matches caller-supplied parsed skill/certification snapshot evidence through Stage 21 relationships; returns direct/strong/weak/no-evidence/unknown status, raw label, provenance, parser/source-normalization versions, relationship score, normalization version, explicit `assertsPossession: false`, and `productionEffect: 'none'`; no parse/write/score path.
  - `tests/job-nlp-resume-evidence.test.ts` (new, 5 tests): direct evidence preservation, alias/strong/weak relationship states, no-vs-unknown evidence, evidence-kind separation, unresolved requirement safety, and input immutability.
- **Files/components involved:** `src/intelligence/nlp/resumeEvidence.ts`, `tests/job-nlp-resume-evidence.test.ts`, `src/intelligence/nlp/skillNormalization.ts`, `src/models/resume-snapshot.ts`.
- **Architectural decisions:**
  - D-NLP-047: resume matching consumes parsed snapshot evidence only; it never parses or modifies resumes and never asserts candidate possession from a match.
  - D-NLP-048: direct/related evidence is distinct from no evidence and unknown normalization; source labels, provenance, parser version, and source normalization version remain visible.
- **Tests:** 5 resume-evidence tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-resume-evidence.test.ts` = 5 pass; `npm run verify` = 129 files / 1329 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** the first matcher covers skill/certification-like concepts supplied through the catalog; experience/education/clearance evidence adapters remain future work; no resume-evidence persistence or UI route is added.
- **Current task:** complete.
- **Exact next action:** Stage 23 - requirement coverage model with direct/related/missing/unknown evidence and modality weighting separate from production scoring.

---

## Stage 23 — Requirement Coverage Model

- **Status:** [x]
- **Objective:** Data model for future "Requirement Coverage" UI; direct/related/missing/unknown evidence distinguished; weighted by required/preferred/nice-to-have; separate from production scoring until promoted.
- **Implementation tasks:**
  - `src/intelligence/nlp/requirementCoverage.ts` (new): projects Stage 22 statuses into `DIRECT`, `STRONG_RELATED`, `WEAK_RELATED`, `MISSING`, and `UNKNOWN`; applies explicit modality weights and diagnostic contribution factors; preserves evidence; exposes no production score/write/eligibility path.
  - `tests/job-nlp-requirement-coverage.test.ts` (new, 5 tests): state mapping, modality-weighted diagnostic ratio, informational exclusion, identity validation, evidence preservation, and no production operation.
- **Files/components involved:** `src/intelligence/nlp/requirementCoverage.ts`, `tests/job-nlp-requirement-coverage.test.ts`, `src/intelligence/nlp/resumeEvidence.ts`.
- **Architectural decisions:**
  - D-NLP-049: coverage statuses distinguish direct, reviewed related, missing, and unknown evidence; related evidence never becomes direct possession.
  - D-NLP-050: modality weights are diagnostic/UI metadata only; `productionEffect` is explicitly `none` and no score/eligibility field is exposed.
- **Tests:** 5 requirement-coverage tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-requirement-coverage.test.ts` = 5 pass; `npm run verify` = 130 files / 1334 tests green; eslint clean; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** the model currently consumes skill/certification evidence rows; experience/education/clearance-specific evidence adapters and UI rendering remain future work; weights require later product calibration.
- **Current task:** complete.
- **Exact next action:** Stage 24 - NLP/semantic performance audit with stable fingerprints and no correctness regressions.

---

## Stage 24 — NLP / Semantic Performance Audit

- **Status:** [x]
- **Objective:** Measure extraction/segmentation/classification/embedding/resume-comparison time, memory, DB growth, startup impact, reprocessing throughput, installer impact on ordinary Windows hardware; cache with stable fingerprints; never optimize away correctness.
- **Implementation tasks:**
  - `src/intelligence/nlp/performanceAudit.ts` (new): offline benchmark for segmentation, classification, extraction, resume comparison, reprocessing, temporary SQLite growth, heap deltas, stable corpus fingerprints, cache invalidation inputs, and explicit no-embedding/no-network state.
  - `scripts/benchmark-nlp.ts` (new) and `npm run nlp:benchmark`: build-first compiled benchmark with cold module-import timing.
  - `tests/job-nlp-performance-audit.test.ts` (new, 2 tests): stable fingerprint and report safety/shape checks.
  - `docs/NLP_PERFORMANCE_AUDIT.md` (new): recorded Windows x64 baseline and measurement limitations.
- **Files/components involved:** `src/intelligence/nlp/performanceAudit.ts`, `scripts/benchmark-nlp.ts`, `tests/job-nlp-performance-audit.test.ts`, `docs/NLP_PERFORMANCE_AUDIT.md`, `package.json`.
- **Architectural decisions:**
  - D-NLP-051: performance measurements run offline against synthetic/local data and never introduce an embedding runtime, model artifact, network acquisition path, or production scoring path.
  - D-NLP-052: benchmark/cache identity is a SHA-256 fingerprint over versioned implementation inputs, the reviewed catalog, and labeled corpus content; stale measurements cannot be reused silently.
  - D-NLP-053: one local Windows run establishes a baseline only; no unmeasured latency, memory, or package budget is treated as a promotion threshold.
- **Tests:** 2 performance-audit tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-performance-audit.test.ts` = 2 pass; `npm run nlp:benchmark` = 54-case report; `npm run verify` = 131 files / 1336 tests green; no embedding runtime or network request observed.
- **Known limitations:** the SQLite result uses a minimal valid enrichment payload; cold import is not inference; installer impact is zero for optional NLP artifacts because none exist, while full installer smoke belongs to Stage 28.
- **Current task:** complete.
- **Exact next action:** Stage 25 - security/privacy/packaging audit with no telemetry, secret, PII, dev-path, or unlicensed-model leakage.

---

## Stage 25 — Security / Privacy / Packaging Audit

- **Status:** [x]
- **Objective:** Audit model files, runtime, caches, NLP DB records, fixtures, diagnostics, build inputs, packaged files, installer; verify no telemetry/external transmission/secrets/personal data/dev paths; fresh installs have neutral NLP state; verify model licensing if packaged.
- **Implementation tasks:**
  - `tests/job-nlp-security-packaging.test.ts` (new, 3 tests): static source/dependency scan, fresh shadow-table neutrality and separation from production job fields, and inspector redaction.
  - `docs/NLP_SECURITY_PRIVACY_PACKAGING_AUDIT.md` (new): model/runtime inventory, privacy boundary, fresh-install, diagnostics, and packaging findings.
  - `npm run nlp:security-audit`: repeatable focused audit; existing `npm run privacy:check` remains the distribution-level privacy gate.
- **Files/components involved:** `src/intelligence/nlp/*`, `src/schemas/job-nlp.ts`, `src/database/jobNlpEnrichmentRepository.ts`, `src/db/migrations/031_nlp_enrichments.sql`, `tests/job-nlp-security-packaging.test.ts`.
- **Architectural decisions:**
  - D-NLP-054: no hosted AI, model/runtime dependency, network acquisition, telemetry, secret, developer-path, or personal-data leak is permitted in the shadow layer.
  - D-NLP-055: fresh installs have zero NLP rows; shadow persistence remains a separate table and never adds production score/eligibility/lifecycle columns.
  - D-NLP-056: diagnostics retain only a source hash and redacted evidence; future model licensing requires a fresh artifact and redistribution review.
- **Tests:** 3 security/privacy/packaging tests (see tasks); `npm run privacy:check` = 3 files / 11 tests.
- **Validation evidence:** `npm run nlp:security-audit` = 3 pass; `npm run privacy:check` = 11 pass; `npm run verify` = 132 files / 1339 tests green; source/dependency scan found no prohibited runtime/model/network/path/secret marker.
- **Known limitations:** no installer rebuild is required for the absent model/runtime artifact; final packaged smoke and artifact inventory remain part of Stage 28 after the UX prototype changes.
- **Current task:** complete.
- **Exact next action:** Stage 26 - Job Intelligence UI prototype, read-only and explicitly shadow-labeled.

---

## Stage 26 — Intelligence UX Prototype

- **Status:** [x]
- **Objective:** Job-detail JOB INTELLIGENCE prototype (requirement coverage, requirements summary, traceable evidence, "interpreted as" wording); no wholesale UI redesign; no probabilistic claims as facts.
- **Implementation tasks:**
  - `src/client/components/JobIntelligencePreview.tsx` (new): read-only Job Intelligence card with required/preferred/mentioned summary, traceable source labels, `Interpreted as:` wording, and unknown coverage until resume evidence is connected.
  - `src/client/components/JobDetailPanel.tsx`: places the preview before the existing production Match breakdown without changing its data or actions.
  - `src/client/styles.css`: responsive drawer-local styles; no global redesign.
  - `tests/job-intelligence-ui.test.tsx` (new, 2 tests): populated and neutral-empty preview behavior.
  - `docs/NLP_INTELLIGENCE_UX_PROTOTYPE.md` (new): user-facing and non-goal contract.
- **Files/components involved:** `src/client/components/JobIntelligencePreview.tsx`, `src/client/components/JobDetailPanel.tsx`, `src/client/styles.css`, `tests/job-intelligence-ui.test.tsx`.
- **Architectural decisions:**
  - D-NLP-057: the first UI uses the existing read-only `JobDetail` query and does not imply that production fields are NLP-derived evidence.
  - D-NLP-058: disconnected resume evidence is represented as `Unknown`, never as direct, related, missing, or candidate possession.
  - D-NLP-059: the preview is visibly shadow-only and is placed beside, not merged into, production score/recommendation presentation.
- **Tests:** 2 intelligence UI tests (see tasks).
- **Validation evidence:** `npx vitest run tests/job-intelligence-ui.test.tsx` = 2 pass; `npm run verify` = 133 files / 1341 tests green; lint and typecheck clean.
- **Known limitations:** no client API endpoint exposes stored NLP enrichments or resume evidence yet; all coverage rows are intentionally unknown; the prototype is not a promotion decision.
- **Current task:** complete.
- **Exact next action:** Stage 27 - promotion design with per-field quality, false-positive/false-negative consequence, fallback, evidence, and hard-gate criteria.

---

## Stage 27 — Promotion Design for Production Scoring

- **Status:** [x]
- **Objective:** Explicit architecture proposal (Levels 0-4) based on measured results; per-field accuracy/FP/FN/error consequence/fallback/confidence/corroboration/evidence; hard-gate promotion requires stronger evidence; no implementation unless roadmap/authorization includes it.
- **Implementation tasks:**
  - `docs/NLP_PROMOTION_DESIGN.md` (new): Levels 0-4, measured corpus/performance evidence, per-field promotion matrix, error consequences, fallbacks, evidence/corroboration requirements, and hard promotion gate.
  - `tests/job-nlp-promotion-design.test.ts` (new, 1 test): verifies the proposal names every level and retains shadow-only/no-production-effect constraints.
- **Architectural decisions:**
  - D-NLP-060: current maximum is Level 2 additive shadow persistence plus visibly labeled diagnostics; Levels 3-4 require new authorization.
  - D-NLP-061: promotion is field-by-field and requires representative labels, explicit FP/FN consequences, abstention, traceable evidence, corroboration, production-vs-shadow diff, and rollback.
  - D-NLP-062: quality metrics are reliability evidence, not probability or possession claims; no NLP result may override deterministic gates without a separately authorized promotion.
- **Tests:** 1 promotion-design test (see tasks).
- **Validation evidence:** `npx vitest run tests/job-nlp-promotion-design.test.ts` = 1 pass; `npm run verify` = 134 files / 1342 tests green; Stage 18 acceptance and Stage 24 performance baselines are referenced; no production-scoring implementation was added.
- **Known limitations:** live-provider labels, field-specific production-vs-shadow diffs, and Levels 3-4 authorization do not exist; therefore every field remains shadow-only or not eligible.
- **Current task:** complete.
- **Exact next action:** Stage 28 - full project regression, score-preservation test, and packaged upgrade validation.

---

## Stage 28 — Full Regression and Upgrade Validation

- **Status:** [x]
- **Objective:** Full project verification; demonstrate existing production recommendation scores unchanged during shadow-mode; no substituting focused tests for the complete gate.
- **Implementation tasks:**
  - `tests/job-nlp-shadow-regression.test.ts` (new, 1 test): computes deterministic production scoring before and after representative shadow NLP operations and requires exact equality plus input immutability.
  - `docs/NLP_REGRESSION_UPGRADE_VALIDATION.md` (new): full gate, privacy, package, desktop smoke, upgrade, and shadow-boundary checklist.
- **Files/components involved:** `src/intelligence/scoringEngine.ts`, `src/intelligence/nlp/*`, `tests/job-nlp-shadow-regression.test.ts`, desktop package/smoke scripts.
- **Architectural decisions:**
  - D-NLP-063: production recommendation output is the regression oracle; shadow work is allowed only when score, eligibility, ranking inputs, lifecycle, and source job data remain unchanged.
  - D-NLP-064: focused tests cannot replace `npm run verify` or packaged/installed upgrade smoke; release artifacts must be rebuilt after source changes.
- **Tests:** 1 shadow-regression test (see tasks), plus the complete repository and desktop validation sequence.
- **Validation evidence:** `npx vitest run tests/job-nlp-shadow-regression.test.ts` = 1 pass; `npm run verify` = 135 files / 1343 tests green; `npm run privacy:check` = 3 files / 11 tests green; packaged, installed, and packaged-upgrade desktop smoke passed. Installer: 253,570,850 B, SHA-256 `B0DCA751C245DCAF4BF71E511D7F724BB15C46BBAAEF3EE7CF4716C4C3A25DCE`; `app.asar`: 73,882,150 B, SHA-256 `5C9A474B5924EF6A74D36A652E1E30FD8086DD8EB6AE75C8621F45C1A810CA53`.
- **Known limitations:** no cross-platform installer run is available in this Windows session; production-vs-shadow evidence covers the deterministic in-process score path and additive storage boundaries.
- **Current task:** complete.
- **Exact next action:** Stage 29 - final documentation reconciliation and 43-point handoff report.

---

## Stage 29 — Documentation and Final Intelligence Handoff

- **Status:** [x]
- **Objective:** Reconcile roadmap + Project Memory + README/CHANGELOG/SESSION_HANDOFF/architecture; exact promotion status; final report (43-point) with explicit NLP SHADOW MODE VALIDATED / NOT YET VALIDATED status.
- **Implementation tasks:**
  - `docs/NLP_FINAL_HANDOFF.md` (new): exactly 43 reconciled report points with explicit `NLP SHADOW MODE VALIDATED` and `NLP PRODUCTION PROMOTION NOT YET VALIDATED` status.
  - `tests/job-nlp-final-handoff.test.ts` (new, 1 test): verifies the 43-point count and final status language.
  - `README.md`, `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_MEMORY.md`, and local `SESSION_HANDOFF.md`: reconciled shadow boundary, validation evidence, and next-authorization rule.
- **Architectural decisions:**
  - D-NLP-065: the final handoff validates shadow mode only; production promotion remains explicitly not yet validated and not authorized.
  - D-NLP-066: any future promotion must name a field, evidence cohort, threshold, owner, rollout, rollback trigger, and release in a new authorization.
- **Tests:** 1 final-handoff test (see tasks); complete project, privacy, package, install, and upgrade evidence is recorded.
- **Validation evidence:** `npx vitest run tests/job-nlp-final-handoff.test.ts` = 1 pass; `npm run verify` = 136 files / 1344 tests green; `npm run privacy:check` = 3 files / 11 tests green; `npm run nlp:security-audit` = 3 pass; package/install/upgrade smoke evidence is recorded above.
- **Known limitations:** the final status is not a claim of live-provider or cross-platform accuracy; no Level 3/4 promotion exists; `SESSION_HANDOFF.md` is intentionally gitignored and remains a local handoff note.
- **Current task:** complete.
- **Exact next action:** none for the authorized shadow program; restart at Stage 27 with new authorization if production promotion is requested.

---

## PART B — PRODUCTION NLP PROMOTION SPRINT

> Authorized local sprint (2026-09-10). Commit rule: **local checkpoint commits only,
> NO push** (`docs/AI_WORKFLOW.md:81`, `docs/BETA_IMPLEMENTATION_TRACKER.md`,
> `SESSION_HANDOFF.md`). All Stage 0-29 shadow guarantees remain standing safety
> standards for this sprint (no host API, no external model, no telemetry, local-only,
> additive schema, deterministic gates authoritative, evidence-only conflict data).
> Promotion is **field-by-field** and must clear the acceptance gate and the P-stage
> gates below before touching production. **Deterministic hard gates (geography,
> onsite presence, citizenship, clearance, credentials, federal constraints) are never
> weakened or overridden by NLP**; NLP may only surface explanatory or corroborating
> evidence. Slow/async paths use a background bounded queue (no Redis).

## P0 — Desktop Startup Stabilization & Real-Data Responsiveness

- **Status:** [x]
- **Objective:** move desktop database shadow-copy verification to a worker thread and
  prove main-thread responsiveness at real database sizes before any promotion work.
- **Evidence:** `f0c41c7` (worker verification fix) + `036d75c` (NLP repair baseline);
  `npm run verify` 136 files / 1346 tests; privacy 11/11; source/packaged/upgrade smoke
  passed; isolated launch against a copy of the real 253 MB database: main process
  `Responding=True` throughout the ~30 s database phase, `window-created` at ~1.1 s.
- **Harness update:** existing-data smoke mode now preserves user source choices while retaining application, API, navigation, migration, worker, and shutdown assertions.
- **Current task:** complete.
- **Exact next action:** P1 - production promotion audit and capability matrix.

---

## P1 — Production Promotion Audit and Capability Matrix

- **Status:** [x]
- **Objective:** audit every shadow capability against the acceptance metrics and
  record, per capability, the proposed production use, failure class, fallback,
  evidence/confidence, and promotion gate. Audit evidence (two full module passes,
  2026-09-10) confirms: **no NLP output feeds any production path today**
  (`productionEffect:'none'` typed literally; zero `nlp/*` imports in
  `scoringEngine.ts`, `intelligenceEngine.ts`, `verifiedMatches.ts`).
- **Data-loss gaps to fix in P3/P5 before any production display:** reconciliation
  is implemented (10 tests) but document.ts hard-codes `conflict.state:'unknown'`;
  boilerplate is implemented (14 tests) but never wired into the envelope; the
  envelope drops `nestedYears`, `teamContext`, `remoteScope`/`commute`/`arrangement
conflict`/`evidence`, per-cert `key`/`vendor`/`span`, and travel detail.
- **Deliverable:** the Production Promotion Matrix below; P2 onwards implement only
  matrix-approved promotion paths.
- **Tests:** audit is read/evidence-based; existing per-module suites remain the
  per-field gate inputs.
- **Validation evidence:** subagent audits (P1); `npm run verify` 136 files / 1346 tests.
- **Current task:** complete; final per-capability state reconciled in P27.
- **Exact next action:** P2 - NLP production trust levels.

### Production Promotion Matrix (P1)

| Capability                          | Evidence gate (current)                                            | Failure class                                 | Proposed production use                                           | Fallback                                      | Promotion gate                |
| ----------------------------------- | ------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- | ----------------------------- |
| Segmentation (segments/headings)    | 17 tests, position-preserving                                      | Span drift breaks evidence                    | Evidence spans for all NLP UI/explanation (Level 2)               | No fallback needed; nothing gates on it       | P5 (wire all evidence tracks) |
| Category classification (17 labels) | 20 tests; acceptance precision/recall ≥ 0.9; critical failures = 0 | Mislabel → wrong strength/context             | On-demand "Requirements" panels (Level 2 display)                 | Abstain → label unknown                       | P2 (render only), P5          |
| Requirement strength                | 19 tests; strength accuracy ≥ 0.95 (acceptance)                    | Preferred shown as required (FN risk)         | Display only; requirement-coverage weighting (Level 2)            | Heading-inherited fallback                    | P5                            |
| Skills extraction + normalization   | 18 tests; boundary-aware, longest-wins; unknown abstains           | False alias / over-broad match                | Search relevance, coverage rows                                   | UNKNOWN never coerced to a skill              | P9                            |
| Experience (years/months)           | 13 tests; never fabricates                                         | False years                                   | Coverage display; never gates                                     | Null + low confidence                         | P5                            |
| Education                           | 14 tests; equivalency/substitution                                 | Degree-level guess (guarded)                  | Coverage display                                                  | Null on unknown level                         | P5                            |
| Certifications                      | 15 tests; per-cert NEAREST-KEYWORD modality                        | FP cert; wrong modality                       | Coverage display; **needs key/vendor/span wired**                 | Absent = not listed                           | P5, P3 wire                   |
| Clearance / citizenship             | 17 tests; team-context guard; clause-scoped                        | Claim user clearance from team text (guarded) | **Labelled "required by employer", never user-held;** never gates | Abstain on team/NDA context                   | P5                            |
| Location / remote / arrangement     | 17 tests; conflict preserved; technical-remote excluded            | Remote claim vs deterministic gate            | Conflict annotation + evidence; **never eligibility**             | Deterministic arrangement stays authoritative | P5                            |
| Role family matching                | 6 tests; deterministic fallback; abstains on margin < 0.10         | Wrong family suggestion                       | Search suggestion (Level 3), reconciled vs deterministic families | Deterministic catalog winner                  | P7                            |
| Resume evidence matching            | 5 tests; `assertsPossession:false` typed                           | Over-claim of possession (guarded)            | Coverage labeled "evidence of match", never possession            | UNKNOWN                                       | P10                           |
| Requirement coverage                | 5 tests; modality weights diagnostic                               | Ratio misread as score                        | Coverage UI (Level 2)                                             | Informational rows excluded                   | P11                           |
| Reconciliation                      | 10 tests (not wired into envelope)                                 | Masked conflict                               | Compare vs deterministic; **wire into envelope in P3**            | Deterministic side authoritative              | P3, P5                        |
| Boilerplate                         | 14 tests (not wired into envelope)                                 | Discarded applicant requirement (guarded)     | Flag/deprioritize boilerplate segments; **wire in P3**            | preserveRequirement = true path wins          | P3, P5                        |
| Acceptance gate                     | fail-closed; FP/FN/critical thresholds; 6 safety evidences         | Threshold breach → block promotion            | Re-run per promotion                                              | Block until passed                            | every phase                   |

### Final per-capability promotion state (P27)

| Capability                                        | Trust level             | Default state                | Production authority                                         |
| ------------------------------------------------- | ----------------------- | ---------------------------- | ------------------------------------------------------------ |
| Extraction, reconciliation, persisted comparison  | SHADOW (0)              | Background shadow processing | None                                                         |
| Job Intelligence requirements and resume coverage | EXPLANATION (1)         | Flag off                     | Display only; structured values authoritative                |
| Reconciled role-family suggestion                 | EXPLANATION (1)         | Flag off                     | Suggestion only; never a gate                                |
| Search-profile vocabulary feedback                | EXPLANATION (1)         | Flag off                     | Read-only feedback                                           |
| Target-role supporting NLP evidence               | EXPLANATION (1)         | Current evidence when valid  | Deterministic family membership remains decisive             |
| Search relevance tie-break                        | ENRICHMENT (2)          | Flag off                     | Only inside exact deterministic ties; primary sort unchanged |
| Experimental recommendation contribution          | SHADOW (0), design only | No runtime consumer          | No score or recommendation change                            |
| Eligibility and all hard gates                    | No NLP promotion        | Unreachable                  | Deterministic only                                           |

---

## P2 — NLP Production Trust Levels

- **Status:** [x]
- **Objective:** define five explicit trust levels mapped onto the Level 0-4 ladder
  used for every future promotion decision: `SHADOW` (0), `EXPLANATION` (1),
  `ENRICHMENT` (2), `SCORING` (3), `HARD_GATE` (4). Promotion is monotonic,
  one-step, evidence-gated, and fail-closed; this sprint never exceeds Level 2.
- **Implementation tasks:** `src/intelligence/nlp/trustLevel.ts` (level ladder,
  descriptors, `canPromoteNlpLevel` with sprint maximum);
  `docs/NLP_TRUST_LEVELS.md` (permitted consumers, labelling, rollback, evidence
  ladder); `tests/job-nlp-trust-levels.test.ts` (module/ladder consistency,
  monotonic evidence, fail-closed unknown evidence, sprint maximum, no
  production consumers).
- **Tests:** 6 trust-level tests (see tasks); builds on promotion design (Stage 27).
- **Validation evidence:** `npx vitest run tests/job-nlp-trust-levels.test.ts` =
  6 pass; `npx vitest run tests/job-nlp-promotion-design.test.ts
tests/job-nlp-final-handoff.test.ts` = 2 pass; `tsc --noEmit` clean; prettier clean.
- **Known limitations:** no consumer exists above SHADOW yet; SCORING/HARD_GATE
  require new authorization and remain unreachable by design.
- **Current task:** complete.
- **Exact next action:** P3 - async NLP materialization and envelope wiring.

---

## P3 — Async NLP Materialization + Envelope Wiring

- **Status:** [x]
- **Objective:** materialize NLP enrichment for jobs as a background, bounded,
  additive task (no job-table writes) and fix the P1 data-loss gaps so the
  envelope is production-representational.
- **Implementation tasks:**
  - P3a `src/schemas/job-nlp.ts` + `src/intelligence/nlp/document.ts`: additive
    `NlpFact.meta` (boilerplate signal, experience nestedYears/context, clearance
    teamContext, certification key/vendor/raw/span, location conflict/remoteScope/
    commute/onsite/relocation); document-v2 invalidates cached rows; pre-meta rows
    parse unchanged.
  - P3b `src/intelligence/nlp/async.ts` + `tests/job-nlp-async.test.ts`: bounded
    background worker - stale-only planning, per-job `AbortSignal.any` deadline,
    failure isolation, page/cursor model, `maxTotal`, progress callback.
- **Tests:** 7 async-worker tests + extended document tests (see commits).
- **Validation evidence:** `npm run verify` = 140 files / 1369 tests green;
  prettier/lint/tsc clean (commits `30b74dd`, `2d9ad2c`).
- **Known limitations:** the worker is not yet wired into the app; app.ts startup
  hook, single-flight guard, and diagnostics endpoint are P4.
- **Current task:** complete.
- **Exact next action:** P4 - wire worker into app.ts + read-only diagnostics.

---

## P4 — Bounded Background Worker + Diagnostics

- **Status:** [x]
- **Objective:** bounded, local, queue-based enrichment worker (per-app single-flight,
  batch cap, per-job deadline, backpressure, no Redis); progress + failures surfaced in
  a read-only diagnostics view; worker never touches scoring/eligibility tables.
- **Implementation tasks:** `src/intelligence/nlp/worker.ts` (queue, budget, abort);
  desktop integration so enrichment starts after backend ready and yields to UI;
  diagnostics (analysed/pending/failed/stale counts, last failure reason) exposed via a
  read-only status endpoint + Settings page; tests for budget/abort/idempotency.
- **Done:** `async.ts` worker (P3b) wired into `backend.ts` via `NlpBackgroundWorker`
  (started after backend ready, stopped on shutdown, persisted resume cursor across
  capped sweeps, per-job deadline, single-flight) using `DatabaseJobNlpCandidateSource`;
  read-only `GET /api/intelligence/status` endpoint in `app.ts`.
- **Tests:** `tests/job-nlp-background-worker.test.ts` (8) + status endpoint in
  `job-nlp-connected-api.test.ts`.
- **Validation evidence:** `npm run verify` = 141 files / 1378 tests green.
- **Known limitations:** Settings-page status surface is P22; per-capability flags P20.
- **Current task:** complete.
- **Exact next action:** P5 - production Job Intelligence projection.

---

## P5 — Production Job Intelligence Projection

- **Status:** [x]
- **Objective:** replace the shadow preview with a production Job Intelligence view
  that (a) is visibly app-produced, (b) shows only EXPLANATION/ENRICHMENT-level output,
  (c) renders monotone evidence for every claim, (d) carries an explicit interpretation
  label per fact, and (e) shows conflicts with the deterministic interpretation with the
  deterministic value marked authoritative. It must never state possession, never mirror
  a hard gate silently, and never alter score/eligibility/ranking/lifecycle.
- **Implementation tasks:** projection from the enriched envelope via inspector (kept
  read-only, deterministic, redacting); UI in JobIntelligencePreview; per-fact
  interpretation + evidence + conflict badges; acceptance test for the projection.
- **Done:** `src/intelligence/nlp/projection.ts` (`projectJobIntelligence`,
  `JOB_INTELLIGENCE_PROJECTION_VERSION = 'job-intelligence-projection-v1'`) projects
  the stored envelope into a read-only `JobIntelligenceProjection` (`level:
explanation`, `summary` with requirement/other/boilerplate/conflict/unreconciled
  counts, `authority` = deterministic-unaffected). Per-fact: plain-language
  interpretation ending in "per the posting" (never possession), strength label,
  `describeNlpConfidence` band, evidence segment, and deterministic reconciliation
  (state agreement/conflict/nlp-only/unknown) for clearance (token-set match that
  ignores phrasing noise), experience years (from entity `years.minimum` or parsed
  nested constraints), and work-arrangement (alias-normalized), with the structured
  value authoritative on conflict. PII redaction reuses exported `redactSensitiveText`
  (also fixed the inspector phone regex so "(555) 123-4567" is masked).
  `app.ts` POST `/api/jobs/:id/intelligence` now returns the projection built from the
  job's deterministic fields (`clearanceRequirement`, `remoteType`, `location`, and
  `estimatedExperienceYears` via `jobRepository.findJob`); `client/api.ts` typed to
  `JobIntelligenceProjection`; `JobIntelligencePreview.tsx` rewritten (badge, per-fact
  evidence, conflict/agreement notes, honest no-scoring copy). Boilerplate and
  non-requirement facts are reported separately, never as requirements.
- **Tests:** `tests/job-nlp-projection.test.ts` (10) covers shape/authority, clearance
  agreement/conflict/unreconciled, experience agreement/conflict, work-arrangement,
  never-possession copy, category separation, redaction; `job-intelligence-ui.test.tsx`
  updated; connected status/intelligence tests updated.
- **Validation evidence:** `npm run verify` = 142 files / 1388 tests green.
- **Known limitations:** Settings-page status surface is P22; per-capability flags P20;
  experience-classifier phrasing gaps (e.g. "Minimum six years of IT experience")
  remain extractor-level backlog, not projection scope.
- **Current task:** complete.
- **Exact next action:** P6 - NLP-enhanced search index.

---

## P6 — NLP-Enhanced Search Index

- **Status:** [x]
- **Objective:** additive relevance index for search/rename/matching built from
  ENRICHMENT-level data (canonical skills, role hints, category signals). Production
  result set and ordering remain deterministic baseline; NLP relevance is a bounded rank
  tie-break only, behind a flag off by default.
- **Implementation tasks:** additive `job_nlp_relevance` index written by the same
  worker (composite persistence target); deterministic search tie-break behind a
  settings flag off by default; repository + API + worker tests.
- **Done:** `src/intelligence/nlp/searchRelevance.ts`
  (`SEARCH_RELEVANCE_INDEX_VERSION = 'job-search-relevance-v1'`) derives a bounded
  (0..1) `SearchRelevanceDocument` from the enriched envelope (canonical skills by
  frequency-then-alpha, top skills capped at 8, signal arrays for clearances /
  certifications / education levels, boilerplate facts excluded). Schema is zod-validated
  (`searchRelevanceDocumentSchema`); `withSearchRelevanceIndex(enrichmentTarget,
relevanceStore)` composes a worker persistence target that saves enrichment and
  relevance together. Migration `032_job_nlp_relevance.sql` is additive
  (`job_nlp_relevance.job_id REFERENCES jobs(id) ON DELETE CASCADE`); new
  `NlpRelevanceRepository` validates on read and write. `JobSearchRepository.search`
  adds `LEFT JOIN job_nlp_relevance` with `COALESCE(relevance_score, -1) DESC,
jobs.id ASC` ordering only when `nlpSearchRelevance` is enabled in options — the
  flag-off SQL is byte-identical to baseline, so existing ordering/perf tests still
  pin the deterministic path. `app.ts` gates the flag on app setting
  `nlp_search_relevance_enabled` (JSON boolean, default false); `backend.ts` wires the
  composite target into the background worker.
- **Tests:** `tests/job-nlp-search-relevance.test.ts` (11) covers derive bounds/version/
  determinism, canonical ordering + caps, signal extraction, boilerplate exclusion,
  repository round-trip and malformed rejection, worker persistence through the
  composite target, repository tie-break on/off (flag-off ordering identical), and API
  gating via the app-setting toggle. Migration-list tests updated for `032`.
- **Validation evidence:** `npm run verify` = 143 files / 1399 tests green.
- **Known limitations:** per-capability flags P20; rename/matching consumers P8/P9; no
  UI surface for the tie-break label yet (P14).
- **Current task:** complete.
- **Exact next action:** P7 - canonical role family matching promoted to search
  suggestion.

---

## P7 — Canonical Role Families

- **Status:** [x]
- **Objective:** promote role family matching to a production-facing suggestion only
  where reconciled against the deterministic catalog (agreement states), with
  abstain/conflict behaviour unchanged and full test coverage of the reconciliation
  boundary. Never a hard gate.
- **Implementation tasks:** reconcile the shadow role matcher with the deterministic
  catalog; promote only agreement; keep abstain/conflict unchanged; expose read-time
  projection + evidence; test the boundary exhaustively.
- **Done:** `src/intelligence/nlp/roleFamilySuggestion.ts`
  (`ROLE_FAMILY_SUGGESTION_VERSION = 'role-family-suggestion-v1'`) projects the shadow
  match into a read-time `RoleFamilySuggestion`. Only `agreement` promotes an NLP
  suggestion (`suggestedSource: 'nlp-reconciled'`, reason "agrees with the structured
  job title record", with matched title/similarity/margin/tokens/decision evidence).
  `conflict`/`nlp-only`/`unknown` never surface an NLP claim (reason explains why);
  `deterministic-only` surfaces the structured family labeled `source:
'deterministic'` (no NLP claim). `nlpAbstained` flags an abstained shadow. The
  projection is deterministic (no clock), never persists, and carries an
  `authority` block (`gate: 'never'`, score/ranking/eligibility/lifecycle
  `'deterministic-unaffected'`). Wired into `POST /api/jobs/:id/intelligence` using
  the app's stored `searchProfile` (`loadLegacySearchProfile`); `client/api.ts`
  returns `JobIntelligenceProjection & { roleFamily }`.
- **Tests:** `tests/job-nlp-role-family-suggestion.test.ts` (7) covers non-empty
  jobId, agreement promotion + authority, determinism, conflict never-surfaces,
  nlp-only never-surfaces, abstain-keeps-deterministic (marked deterministic),
  deterministic-only, unknown empty; `job-nlp-connected-api.test.ts` asserts the
  wired response (version, `authority.gate = 'never'`, valid state set);
  `job-intelligence-ui.test.tsx` mock updated for the expanded response type.
- **Validation evidence:** `npm run verify` = 144 files / 1407 tests green.
- **Known limitations:** no search/UI consumption yet (P8 suggestion surface, P14
  explainability); shadow matcher remains a token-overlap fallback (no shared
  vocabulary beyond the configured family titles).
- **Current task:** complete.
- **Exact next action:** P8 - case/role-based search integration.

---

## P8 — Target-Role Search Integration

- **Status:** [x]
- **Objective:** explicit target-role search with current P6 supporting evidence, preserving deterministic membership and primary sort.
- **Implemented:** targetRole query validation, family display names, URL/saved-filter integration, applied-role status, and per-result evidence.
- **Safety:** exact comma-separated family membership, literal wildcard handling, unchanged score/eligibility/lifecycle fields. Existing disabled families are labeled disabled; the selector offers enabled families plus an already-selected disabled family.
- **P6 integration:** page-bounded index evidence read. Only current, schema-valid envelopes with a matching document hash and matching derived index provide skill evidence. Evidence spans must match retained text. Missing, stale, corrupt, or partially updated data falls back to title evidence.
- **Decision:** P6 contains skill/signals, not role membership. Its evidence supplements the deterministic role match; it does not invent an NLP-only family or widen the result set. The existing P6 optional tie-break is unchanged.
- **Recovery fixes:** repaired the unfinished UI's undefined-role crash, guarded older responses, and corrected substring role filtering.
- **Validation:** npm run verify PASS (145 files / 1416 tests); npm run build PASS. Includes API acceptance/rejection, role membership/order, disabled roles, stale/corrupt index fallback, SQL wildcard negatives, no job mutation, selector/URL/page-reset/clear and evidence rendering.
- **Current task:** complete.
- **Exact next action:** P9 skill normalization in matching/coverage.
- **Release boundary:** no version bump, installer replacement, production-data writes, or push.

---

## P9 — Skill Normalization in Matching

- **Status:** [x]
- **Objective:** use normalized canonical skills (EXACT/alias/related/unknown) inside
  requirement coverage and search relevance; unknown phrases always abstain; never
  mutate the raw skill text or expand catalog automatically.
- **Current task:** Complete. Search relevance v2 uses reviewed canonical labels only; exact posting mentions remain raw evidence; unknown or contradictory labels abstain. A read-only coverage adapter preserves exact phrases and classifies exact, alias, strong-related, weak-related, and unknown evidence.
- **Verification:** targeted 22 tests PASS; full verify 146 files / 1419 tests PASS.
- **Exact next action:** P10 - full resume evidence matching.

---

## P10 — Resume Evidence Matching (all kinds)

- **Status:** [x]
- **Objective:** extend resume evidence adapters to experience/education/clearance
  snapshots; every match row remains expressly evidence-of-match, never possession;
  parser versions recorded; unmatched/null concepts = UNKNOWN not missing.
- **Current task:** Complete. The internal snapshot adapter reads versioned capture-time data without exposing normalized resume text through the public snapshot API. It emits typed skill, certification, experience, education, and clearance evidence with parser provenance. Unparsed or null structural concepts yield UNKNOWN; results remain evidence-only and never assert possession.
- **Verification:** focused 22 tests PASS; full verify 147 files / 1422 tests PASS.
- **Exact next action:** P11 - requirement coverage goes live.

---

## P11 — Requirement Coverage Goes Live

- **Status:** [x]
- **Objective:** the coverage projection (direct/related/weak/missing/unknown with
  modality weighting, evidence, and provenance) is shown in production Job
  Intelligence; it is explicitly a diagnostic ratio and is never called a score and
  never changes ranks/eligibility.
- **Current task:** Complete. Job Intelligence now reads the application’s submitted immutable resume snapshot, projects supported requirements as direct/related/weak/missing/unknown rows with modality and provenance, and labels the weighted ratio as diagnostic evidence coverage. No coverage field has score, eligibility, rank, filter, or lifecycle authority. Jobs without a captured snapshot return coverage=null.
- **Verification:** focused API/UI/projection tests PASS; full verify 150 files / 1426 tests PASS.
- **Exact next action:** P12 - bounded NLP scoring contribution design.

---

## P12 — Bounded NLP Scoring Contribution

- **Status:** [x]
- **Objective:** design (only) a bounded, capped contribution to a displayed
  recommendation metric from corroborated, high-confidence ENRICHMENT/SCORING-capable
  signals; require: score cap below any eligibility boundary, monotone evidence,
  dual-side consistency (deterministic vs NLP), and a shadow diff gate.
- **Current task:** Complete as design only in `docs/NLP_PROMOTION_DESIGN.md`: separate non-persisted experimental metric; absolute 3-point cap; next-threshold guard; zero on failed eligibility, stale/unknown/conflicting/uncorroborated evidence; dual-side agreement and >=0.90 confidence; monotone qualifying evidence; byte-identical disabled/rollback diff gate. No runtime scoring consumer or flag was added.
- **Exact next action:** P13 - scoring safety invariants.

---

## P13 — Scoring Safety Invariants

- **Status:** [x]
- **Objective:** encode invariants in tests: NLP never changes any eligibility gate,
  never changes ranking basis below the cap, contribution is capped, contribution is
  zero when evidence/confidence absent, and removal of the feature restores previous
  scores byte-for-byte.
- **Current task:** Complete. An offline-only calculator encodes the 3-point cap, next-threshold guard, eligibility prerequisite, current evidence and span validation, >=0.90 confidence, deterministic/NLP agreement, and future approval requirement. Tests prove zero contribution on missing/untrusted inputs, monotonic qualifying evidence, unchanged baseline objects, and no imports from production scoring engines.
- **Verification:** focused 21 tests PASS; full verify 151 files / 1430 tests PASS.
- **Exact next action:** P14 - search-result explainability.

---

## P14 — Search Result Explainability

- **Status:** [x]
- **Objective:** when NLP contributes to a ranking tie-break, each affected result shows
  the reason with evidence spans and the deterministic baseline value; no black-box
  "NLP boosted" labels.
- **Implemented:** page-bounded validation recomputes the current versioned index and
  verifies retained evidence spans before returning an explanation. The UI states the
  tied deterministic baseline value, secondary relevance value, and exact evidence.
  Score, eligibility, and primary-sort authority are explicitly unchanged.
- **Validation:** repository and UI explainability tests pass; full verify: 154 files / 1436 tests.
- **Exact next action:** P15 - search profile NLP.

---

## P15 — Search Profile NLP

- **Status:** [x]
- **Objective:** surface canonical role families, skill clusters, and coverage feedback
  in the search profile editor so users can adjust targets; all edits remain
  deterministic preference changes; no hidden NLP mutations of the profile.
- **Implemented:** a read-only, versioned projection and API show canonical role-family
  counts, reviewed configured-skill coverage, unknown labels, and reviewed related
  pairs. The editor states that saved changes remain deterministic preferences; the
  projection has no write path or production effect.
- **Validation:** projection immutability and editor rendering tests pass; full verify: 154 files / 1436 tests.
- **Exact next action:** P16 - performance measurement at production loads.

---

## P16 — Performance at Production Loads

- **Status:** [x]
- **Objective:** measure segmentation/extraction/cache/worker under a large real corpus
  copy (local only) on ordinary Windows hardware; budgets: extraction leaves main
  thread free (P0 style), worker batch latency, memory growth; no throughput trick may
  reduce correctness.
- **Implemented:** a read-only audit copies bounded source text into memory and emits
  only aggregate timings and a fingerprint. On 500 real local jobs (2,939,812 chars),
  10 batches completed in 5,889.964 ms with 0 failures; p50/p95 batch latency was
  607.918/666.770 ms, heap delta 72,112,512 B, 2,609 event-loop heartbeats, and a
  second pass skipped all 500 current cache entries. Network and source DB writes: 0.
- **Validation:** harness tests and the real local-copy run pass; full verify: 154 files / 1436 tests.
- **Exact next action:** P17 - indexing/cache strategy.

---

## P17 — Indexing and Cache Strategy

- **Status:** [x]
- **Objective:** content-hash + extraction-version cache for enrichment and the P6
  index; deterministic invalidation on description change; bounded row growth; stale
  rows never consulted by production consumers.
- **Implemented:** relevance v3 embeds the source hash; composite staleness checks both
  extraction and relevance versions/hashes. Migration 033 clears only recreatable old
  cache rows and installs null-safe change-only invalidation for all source text fields.
  Search joins require current enrichment/index versions and matching stored hashes;
  consumers validate schemas, recomputation, and evidence spans before explanation.
  One primary-keyed enrichment and relevance row per job bounds growth.
- **Validation:** invalidation, unchanged-observation, bounded-row, stale-version, and
  current-evidence tests pass; full verify: 154 files / 1436 tests.
- **Exact next action:** P18 - regression corpus expansion.

---

## P18 — Regression Corpus Expansion

- **Status:** [x]
- **Objective:** expand the synthetic/local labelled corpus (coverage, paraphrase,
  adversarial) so every promoted capability has both true-positive and false-positive
  boundaries; acceptance gate must fail closed on any critical failure before a
  promotion is recorded.
- **Current task:** Complete. The labeled set now has 66 cases (54 base plus 12 representative), including promoted-surface coverage, paraphrases, technical-remote false positives, employer-tool mentions, and negated clearance/degree requirements. Modality classifier v2 classifies explicit negation as informational. The fail-closed acceptance gate passes with zero critical failures.
- **Exact next action:** P19 - production-vs-shadow comparison.

---

## P19 — Production-vs-Shadow Comparison

- **Status:** [x]
- **Objective:** persisted added-comparison of deterministic interpretation vs NLP
  interpretation per job in the shadow store; report agreement/conflict rates per
  capability on the local corpus; conflicts are surfaced in UI, never silently
  resolved.
- **Current task:** Complete. Migration 034 adds one versioned comparison row per job with change-only invalidation. The worker and explicit Job Intelligence action persist deterministic and NLP sides, evidence, and agreement/conflict/one-sided states. The UI shows persisted agreement/conflict counts while structured values remain authoritative.
- **Exact next action:** P20 - feature flags.

---

## P20 — Feature Flags (Rollback)

- **Status:** [x]
- **Objective:** per-capability local flags (off by default) with per-feature rollback;
  disabling a flag restores prior behaviour exactly (regression test per feature);
  flags are read at decision time, cached safely, and surfaced read-only in Settings.
- **Current task:** Complete. Four independent local flags are read at each decision boundary and default off: Job Intelligence explanation, role-family suggestion, search tie-break, and search-profile feedback. Tests cover fail-closed parsing and rollback for every consumer.
- **Exact next action:** P21 - failure fallback behaviour.

---

## P21 — Failure Fallback Behaviour

- **Status:** [x]
- **Objective:** when extraction/worker/index fails or is disabled, production
  surfaces degrade to the deterministic baseline silently but visibly (a status
  indicator), and no stale enrichment is ever rendered as fresh.
- **Current task:** Complete. Disabled capabilities and worker item failures visibly report that deterministic behavior remains active. Search ignores missing, stale, invalid, or disabled NLP data. Source changes invalidate derived rows, so stale enrichment is never rendered as current.
- **Exact next action:** P22 - user-visible NLP status.

---

## P22 — User-Visible NLP Status

- **Status:** [x]
- **Objective:** read-only NLP status in Settings: extraction version, analysed
  counts, last success/failure, flags, and "Not used for scoring/eligibility" wording
  that matches the trust level of what is actually on.
- **Current task:** Complete. Settings shows the extraction version, last successful sweep, current enrichment/index/comparison counts, per-capability flags, last failure, and the exact trust notice “Not used for scoring or eligibility.” The projection is read-only.
- **Exact next action:** P23 - real-data validation session.

---

## P23 — Real-Data Validation

- **Status:** [x]
- **Objective:** validation run against the user's real local database copy: run the
  worker, compare deterministic vs NLP interpretation, verify no score/eligibility
  drift (P19 harness), measure responsiveness (P0 harness), and record outcomes.
- **Current task:** Complete. A consistent backup of the real local database was processed and deleted after validation. 500/3,662 jobs produced 500 enrichment/index/comparison rows with 0 failures in 4,575.04 ms and 2,079 event-loop ticks. The complete jobs-table fingerprint was identical before/after. See docs/NLP_REAL_DATA_VALIDATION.md.
- **Exact next action:** P24 - full verification gate.

---

## P24 — Full Verification Gate

- **Status:** [x]
- **Objective:** `npm run verify` + `npm run privacy:check` + NLP security audit all
  green; source/packaged/upgrade smoke green; acceptance gate fail-closed on the
  expanded corpus; checkpoint commit.
- **Current task:** Complete. npm run verify passed 157 files / 1,445 tests; privacy passed 3 files / 11 tests; the expanded NLP security audit passed 3/3; the 66-case acceptance gate passed with zero critical failures. Direct source, rebuilt unpacked-package, and seeded packaged-upgrade smoke all passed.
- **Exact next action:** P25 - desktop performance validation.

---

## P25 — Desktop Performance Validation

- **Status:** [x]
- **Objective:** installed/direct launch with real DB: main thread responsive during
  any watchdog activity, backend free on exit, no orphan processes, worker yields to
  UI, results in acceptable additional disk budget.
- **Current task:** Complete through the direct/current-source path. A fresh backup of the 253,034,496-byte real database launched, migrated through 034, navigated all smoke routes, processed 205 shadow rows before exit, and closed cleanly with zero Job Browser/Electron processes. The database set grew 13,619,200 bytes during migrations, smoke fixtures, and background processing; P23 separately measured 500 worker items and 2,079 event-loop yields.
- **Exact next action:** P26 - privacy/packaging audit.

---

## P26 — Privacy and Packaging Audit

- **Status:** [x]
- **Objective:** re-run Stage 25 audit for the promoted surfaces: no telemetry, no
  external transmission, no secrets/PII/dev paths, no model artifacts, installer
  contents inspected, fresh-install neutral state.
- **Current task:** Complete for source and the current unpacked artifact. The expanded audit scans all NLP modules, three repositories, and migrations 031-034; it found no hosted model/runtime, network call, telemetry, developer path, secret, or model artifact. Privacy checks passed on tracked files, dist, and current app.asar; fresh NLP tables are empty. Current app.asar is 74,029,786 bytes, SHA-256 1984327AFA57400A8E9CBCC457CC3DFF4B2FF4E480511A837DBE3849B1023268. The existing installer is correctly recorded as stale and its replacement audit belongs to P28 after approval.
- **Exact next action:** P27 - documentation.

---

## P27 — Documentation

- **Status:** [x]
- **Objective:** reconcile this roadmap, PROJECT_MEMORY, CHANGELOG, SESSION_HANDOFF,
  NLP_FINAL_HANDOFF (add a production promotion section), trust levels, promotion
  design, and README with exact per-field promotion status and gates.
- **Current task:** Complete. Roadmap, Project Memory, changelog, session handoff, final handoff, trust levels, promotion design, architecture, regression/audit documents, and README now state the same per-capability levels, off-by-default flags, unchanged deterministic authority, current validation evidence, and stale-installer boundary.
- **Exact next action:** P28 - release/release decision.

---

## P28 — Release Decision

- **Status:** [ ]
- **Objective:** version/artifact decision with the user; rebuild installer and run the
  full artifact validation sequence only with explicit user approval; local
  checkpoint commits; nothing pushed without explicit instruction.
- **Current task:** not started.
- **Exact next action:** P29 - final report.

---

## P29 — Final Production-Promotion Report

- **Status:** [ ]
- **Objective:** report which capabilities moved from SHADOW to EXPLANATION/ENRICHMENT
  (and whether any reached SCORING), the evidence for each, the explicitly unchanged
  hard gates, and the record of what remains SHADOW-only with exact reasons.
- **Current task:** not started.
- **Exact next action:** none; stop for user review of the P28/P29 decision points.

---

## Verification Ledger (NLP program)

| Date       | Action                   | Result                                                                                 |
| ---------- | ------------------------ | -------------------------------------------------------------------------------------- |
| 2026-09-10 | Baseline before NLP work | `npm run verify` 108 files / 1101 tests PASS (v1.1.0)                                  |
| 2026-09-10 | Stage 1 contract         | `npx vitest run tests/job-nlp-schema.test.ts` 17 PASS; eslint + tsc clean              |
| 2026-09-10 | Stage 23 coverage        | `npm run verify` 130 files / 1334 tests PASS; checkpoint `97dbf23`                     |
| 2026-09-10 | Stage 24 performance     | `npm run verify` 131 files / 1336 tests PASS; 54-case offline benchmark                |
| 2026-09-10 | Stage 25 security        | focused audit 3 PASS; `npm run privacy:check` 11 PASS                                  |
| 2026-09-10 | Stage 26 UX              | focused UI test 2 PASS; read-only unknown-coverage preview                             |
| 2026-09-10 | Stage 27 promotion       | focused design test 1 PASS; no promotion implementation                                |
| 2026-09-10 | Stage 28 regression      | `npm run verify` 135 files / 1343 tests; package/install/upgrade smoke PASS            |
| 2026-09-10 | Stage 29 handoff         | 43-point report; `npm run verify` 136 files / 1344 tests; shadow validated             |
| 2026-09-10 | NLP repair connected     | `npm run verify` 136 files / 1346 tests; privacy 11/11; commit `036d75c`               |
| 2026-09-10 | P0 startup fix           | worker verification; real 253 MB DB main-thread responsive; commit `f0c41c7`           |
| 2026-09-10 | P1 promotion audit       | matrix complete; no production NLP consumers confirmed (grep)                          |
| 2026-09-10 | P2 trust levels          | 6 tests pass; tsc + prettier clean; sprint max = enrichment (Level 2)                  |
| 2026-09-10 | P3a envelope wiring      | document-v2 meta; verify 139/1362 green; old rows re-extract cleanly                   |
| 2026-09-10 | P3b async worker         | verify 140/1369 green; 7 worker tests; commit `2d9ad2c`                                |
| 2026-09-10 | P4 worker wiring         | background worker in app + status endpoint; verify 141/1378 green                      |
| 2026-09-11 | P5 projection            | JobIntelligenceProjection + deterministic reconciliation; verify 142/1388; `7651d21`   |
| 2026-09-11 | P6 relevance index       | derive + repo + composite worker target + search tie-break (flag off); verify 143/1399 |
| 2026-09-11 | P7 role family suggest   | reconciled suggestion projection + intelligence endpoint; verify 144/1407              |
| 2026-09-11 | P18-P23 promotion safety | verify 157/1445; 500-job real-copy run; checkpoint b89cea1                             |
| 2026-09-11 | P24 full gate            | verify 157/1445; privacy 11/11; security 3/3; source/package/upgrade smoke PASS        |
| 2026-09-11 | P25 desktop real copy    | direct smoke PASS; 205 shadow rows; 13,619,200 B growth; no orphan processes           |
| 2026-09-11 | P26-P27 audit/docs       | current app.asar privacy/inventory PASS; all promotion documents reconciled            |

| 2026-09-11 | P8 target-role search | verify 145/1416 PASS; build PASS; exact membership and current P6 evidence |

## NLP integration repair — verified

Connects full-description extraction (`document-v1`) to an explicit local
analysis action (`POST /api/jobs/:id/intelligence`) with separate shadow
persistence (`job_nlp_enrichments`, content-hash + extraction-version
invalidation) and rewrites the Job Intelligence preview UI to render real
facts with evidence. Production scoring, eligibility, ranking, filtering, and
lifecycle remain authoritative (`productionEffect: 'none'`). Verified:
`npm run verify` 136 files / 1346 tests, `npm run privacy:check` 11/11.
