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
