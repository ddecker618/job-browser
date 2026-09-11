# NLP Promotion Design

Status: design complete; **NLP SHADOW MODE remains active and nothing is
promoted into production scoring or eligibility.**

This document defines what would be required for a future promotion. It is not
authorization to implement promotion.

## Promotion Levels

| Level | Meaning                                                                                                   | Current state                   |
| ----- | --------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 0     | Contract and offline evaluation only; no user-facing effect                                               | Complete                        |
| 1     | Read-only diagnostics with redacted evidence and explicit abstention                                      | Complete                        |
| 2     | Additive persisted shadow records and a clearly labeled UI projection; production fields remain untouched | Current maximum, complete       |
| 3     | User-assisted suggestion that requires explicit review and writes only an auditable user decision         | Not implemented                 |
| 4     | Production scoring or deterministic-gate integration for a named field                                    | Not authorized; not implemented |

Levels 3 and 4 require a new roadmap authorization. A higher quality score on
the current synthetic corpus does not authorize either level.

## Measured Evidence

The 54-case local labeled corpus currently reports:

- Category exact accuracy 88.9%; precision 93.1%; recall 91.5%.
- Strength accuracy 96.3%.
- Entity exact accuracy 94.4%; precision 96.6%; recall 90.3%.
- Arrangement agreement 7/8.
- Label disagreement 13.0%.
- Critical adversarial failures 0/7.
- Stage 18 acceptance thresholds pass with the required safety evidence.
- Stage 24 provides a Windows x64 offline performance baseline; it is not a
  cross-machine production budget.

These results are synthetic/local and do not establish live-provider accuracy.

## Field Promotion Matrix

| Field                | Current evidence                                   | FP consequence                                     | FN consequence                       | Required fallback                                             | Confidence/corroboration requirement                                            | Promotion state |
| -------------------- | -------------------------------------------------- | -------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------- |
| Requirement category | 54 labeled cases; 93.1% precision / 91.5% recall   | Irrelevant text appears as a requirement           | Relevant requirement is omitted      | Deterministic category rules plus `UNKNOWN`                   | Source span, category version, reviewed labels, independent adjudication        | Shadow only     |
| Requirement strength | 54 labeled cases; 96.3% accuracy                   | Preferred text looks mandatory or vice versa       | Modality is understated              | `informational` or `unknown`; never invent modality           | Clause-local evidence, one strength axis, labeled ambiguity review              | Shadow only     |
| Entity extraction    | 54 labeled cases; 96.6% precision / 90.3% recall   | Wrong credential/location/number is displayed      | User misses a material fact          | Preserve raw text and abstain                                 | Exact span, parser/version, entity type, redaction                              | Shadow only     |
| Work arrangement     | 7/8 arrangement agreement                          | User sees remote/hybrid/onsite incorrectly         | User misses a work constraint        | Existing deterministic arrangement/gate remains authoritative | Structured provider value plus labeled text corroboration                       | Shadow only     |
| Role matching        | Deterministic fallback only; no semantic benchmark | Unrelated role is presented as equivalent          | Related role is missed               | Title-family matcher with threshold/margin abstention         | Labeled role pairs, bounded candidates, reviewed false positives                | Not eligible    |
| Skill normalization  | Reviewed catalog relationships only                | Related skill is presented as equivalent           | Alias/related skill is missed        | Exact/alias result or `UNKNOWN`                               | Reviewed relationship table, raw phrase, target concept, no possession claim    | Not eligible    |
| Resume evidence      | Skill/certification-like parsed evidence only      | Job requirement appears satisfied without evidence | Evidence is overlooked               | `NO_EVIDENCE` vs `UNKNOWN`; no possession claim               | Parsed snapshot provenance, parser/version, source normalization, corroboration | Not eligible    |
| Requirement coverage | Diagnostic modality weighting only                 | Coverage ratio overstates readiness                | Coverage ratio understates readiness | Unknown until evidence exists                                 | Requirement identity, modality, evidence state, source trace                    | Not eligible    |

Accuracy, precision, and recall are not confidence probabilities. Any future
promotion must keep reliability, evidence completeness, and abstention separate.

## Hard Promotion Gate

No named field may move above Level 2 unless all of the following are recorded:

1. A frozen, stratified, locally reviewable labeled corpus representative of
   the target provider mix and field distribution.
2. Per-field precision, recall, exact agreement, false-positive count,
   false-negative count, and error consequence.
3. Critical adversarial false positives and false negatives at zero, or an
   explicit product decision that accepts a documented consequence.
4. Deterministic fallback and abstention behavior for missing, ambiguous, stale,
   malformed, and unsupported inputs.
5. Evidence spans, source field, parser/model/runtime versions, input hash,
   confidence reliability, and corroboration state for every material result.
6. Production-vs-shadow score, eligibility, ranking, filtering, lifecycle, and
   removal diff with zero unexplained changes.
7. Measured latency, memory, disk/cache, startup, packaging, and network results
   on supported ordinary Windows hardware.
8. Security, privacy, license, redaction, rollback, invalidation, and fresh
   install evidence.
9. A user-visible correction and audit path for any Level 3 suggestion.
10. Explicit roadmap authorization naming the field, rollout cohort, threshold,
    owner, rollback trigger, and release.

Until then, deterministic gates remain authoritative and all shadow results keep
`productionEffect: 'none'`.

## P12 Bounded Contribution Design (DESIGN ONLY)

This section is a reviewable design contract. It does not authorize or implement a production scoring contribution. The current job score, recommendation, eligibility, ordering, filtering, and persisted fields remain unchanged.

### Proposed output and cap

A future authorized implementation may expose a separate, clearly named `experimentalRecommendationMetric`. It must never replace or be persisted as `jobs.score` or `jobs.recommendation`. The proposed contribution is bounded to **0–3.0 points** and is zero unless the deterministic result already passes every hard eligibility gate.

The future formula is:

`contribution = min(3.0, qualifyingSignalTotal, max(0, nextDeterministicRecommendationThreshold - baselineScore - 0.001))`

`experimentalRecommendationMetric = min(100, baselineScore + contribution)`

The next-threshold guard prevents the experimental contribution from changing the deterministic recommendation band. When there is no higher threshold, the absolute 3-point cap still applies and the deterministic label remains unchanged. Eligibility is a separate boolean decision and is never read from, inferred from, or changed by this metric.

### Qualifying signals

A signal contributes only when all conditions hold: the source hash and parser/index versions are current; its exact evidence span validates; confidence is at least 0.90; the deterministic and NLP interpretations agree; neither side is unknown; no conflict exists; and the capability is explicitly approved for Level 3 in a future roadmap authorization. Related skill evidence does not qualify as equivalence. Missing, stale, malformed, unsupported, weak, conflicting, or NLP-only evidence contributes zero.

The proposed allocation is at most 1 point for an approved role-family agreement and at most 2 points for corroborated requirement evidence. Adding another qualifying corroborated signal cannot reduce the contribution. Adding a conflict does not create a negative contribution; it disqualifies only the affected signal and remains visible.

### Shadow diff gate

Before any future activation, a frozen local corpus must compare the deterministic baseline with the proposed calculation. The gate passes only if: feature-disabled outputs are byte-identical; eligibility, recommendation label, persisted score, rank outside an existing equal-score tie, filters, lifecycle, and removal decisions have zero changes; every nonzero diagnostic contribution has current evidence and dual-side agreement; and rollback removes the diagnostic field while restoring the exact baseline response. Any unexplained difference fails closed.

### Authorization boundary

The design supplies no runtime flag, database column, score-engine import, or production consumer. Level 3 remains blocked by `SPRINT_MAXIMUM_LEVEL = 'enrichment'`. Implementing or activating this proposal requires a later explicit field-specific authorization and completion of the hard promotion gate.
