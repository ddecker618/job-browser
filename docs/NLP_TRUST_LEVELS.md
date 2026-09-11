# NLP Production Trust Levels

> Phase 2 (P2) of the production NLP promotion sprint. Companion to
> `docs/NLP_PROMOTION_DESIGN.md` (numeric Level 0-4 ladder, Stage 27) and the
> capability matrix in `docs/Intelligence_Roadmap.md`. The source of truth for
> the ladder itself is `src/intelligence/nlp/trustLevel.ts`; this document is
> validated against it by `tests/job-nlp-trust-levels.test.ts`.

## Purpose

Every NLP capability must be assigned exactly one trust level. The level
decides who may consume the output, how it must be labelled, what evidence
must exist before the level is reached, and how the promotion is rolled back.
A capability is promoted only field-by-field, one level at a time.

**Hard boundary.** At every level, deterministic eligibility gates (geography,
onsite presence, citizenship, clearance, credentials, federal constraints)
remain authoritative. No NLP output overrides, weakens, or silently substitutes
for a deterministic gate. NLP may only surface explanatory or corroborating
evidence, and the deterministic value is always marked authoritative on any
conflict.

**Sprint boundary.** This authorized sprint never promotes any field above
Level 2 - ENRICHMENT. Levels 3 (SCORING) and 4 (HARD_GATE) require a new,
separate field-specific authorization (consistent with decision D-NLP-060).

## The ladder

| Level | Key         | Label       | What it may do                                                   | Permitted consumers                                                 | Rollback                                      |
| ----- | ----------- | ----------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| 0     | shadow      | SHADOW      | Analyze, extract, persist, compare, annotate                     | Stores, diagnostics, off-screen comparison                          | Delete/ignore rows; nothing else was affected |
| 1     | explanation | EXPLANATION | Explain production values in typed add-on panels                 | Add-on display panels; never ranking or gates                       | Remove panels; production values unchanged    |
| 2     | enrichment  | ENRICHMENT  | Feed an additive relevance index / search tie-break              | Relevance index and search tie-break behind a flag (off by default) | Flip flag; prior behavior restored exactly    |
| 3     | scoring     | SCORING     | Bounded capped contribution to a displayed recommendation metric | Recommendation metric display only; needs authorization             | Flip flag + cap; byte-identical prior scores  |
| 4     | hard-gate   | HARD_GATE   | Override deterministic eligibility (NOT authorized)              | None in this program                                                | Not applicable - never reachable              |

## Permitted consumers

- **SHADOW (0).** The current state. Output is persisted in the additive
  `job_nlp_enrichments` table and consumed by diagnostics and by the
  `POST /api/jobs/:id/intelligence` endpoint. It is never consulted by any
  production decide path, never rendered opaquely as a fact, and never
  influences score, eligibility, ranking, filtering, or lifecycle.
- **EXPLANATION (1).** Output may be attached to production display as a typed
  add-on (never merged into the produced value). Every claim must carry an
  interpretation label, an evidence span, and, where the deterministic
  interpretation differs, an explicit "deterministic value is authoritative"
  marker.
- **ENRICHMENT (2).** Output feeds an additive relevance index and a bounded
  search tie-break behind a feature flag that is off by default. It still
  never touches eligibility, scoring, or ranking baselines; the deterministic
  result set and ordering remain the baseline.
- **SCORING (3).** Output may contribute a bounded, percentage-capped amount
  to a displayed recommendation metric only. Requires a new authorization.
  The cap sits strictly below any eligibility boundary and removal restores
  prior scores exactly.
- **HARD_GATE (4).** Out of scope. No path in this program may assign it.

## Evidence ladder (accumulative)

A capability at level N must hold every piece of evidence from levels below N
plus the new requirements for level N. `canPromoteNlpLevel()` in
`src/intelligence/nlp/trustLevel.ts` enforces this monotonically and
fail-closed: unknown evidence outside the checklist is rejected, skipped
levels are rejected, and the sprint maximum is enforced.

- **Level 1 adds:** per-fact interpretation label; rendered evidence spans;
  authoritative-deterministic marker on conflict.
- **Level 2 adds:** content-hash + extraction-version cache; bounded background
  materialization; rollback flag that restores prior behavior exactly.
- **Level 3 adds:** score cap below any eligibility boundary; production-vs-
  shadow diff gate; dual-side consistency (deterministic + NLP).
- **Level 4 adds:** explicit field-specific authorization; user-visible
  correction and audit path.

## Promotion rules

1. One step at a time: `shadow -> explanation -> enrichment -> scoring ->
hard-gate`. No skipping.
2. Every required evidence item for the target level must be present.
3. Evidence outside the level checklist invalidates the promotion (fail-closed).
4. The sprint maximum (`SPRINT_MAXIMUM_LEVEL = 'enrichment'`) cannot be
   exceeded.
5. A promotion is recorded in `docs/Intelligence_Roadmap.md` per capability via
   the matrix, with the evidence run and the acceptance-gate result.

## Current status

All capabilities are at **Level 0 (SHADOW)**. Nothing consulted by production
uses NLP output today; the P1 audit verified `productionEffect: 'none'` and
zero `nlp/*` imports in the scoring/eligibility/search chains. P3 onwards
materialize and wire the envelope; capability-level promotions will move rows
of the matrix from SHADOW to EXPLANATION/ENRICHMENT with recorded evidence.
