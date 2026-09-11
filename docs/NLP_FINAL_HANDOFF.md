# NLP Intelligence Final Handoff

Date: 2026-09-11

## Final Status

**NLP EXPLANATION AND ENRICHMENT PROMOTION VALIDATED**

**NLP SCORING AND HARD-GATE PROMOTION NOT AUTHORIZED**

The validation covers the local deterministic shadow contract, evidence,
persistence boundary, diagnostics, UI labeling, evaluation gate, performance
baseline, privacy checks, production-score regression, Windows package smoke,
and the P28 rebuilt installer. It authorizes only the field-specific states
listed below. It does not authorize Level 3 user-assisted suggestions, Level 4
production scoring, or hard-gate integration.

## 43-Point Report

1. [PASS] The NLP roadmap is maintained separately from the long-term product roadmap.
2. [PASS] NLP remains an additive shadow plane and does not become a production authority.
3. [PASS] Deterministic eligibility, location, clearance, schedule, physical, and lifecycle gates remain authoritative.
4. [PASS] Production score, recommendation, eligibility, ranking, filtering, and removal fields are not written by NLP.
5. [PASS] Manual removal/archive behavior remains user-controlled.
6. [PASS] Requirement category and requirement strength remain independent axes.
7. [PASS] The contract is independently versioned as `job-nlp-v1`.
8. [PASS] Material extracted facts retain source field, segment index, character span, method, version, and confidence.
9. [PASS] Confidence is documented as method/evidence reliability, not probability or qualification certainty.
10. [PASS] Position-preserving segmentation retains traceable source spans.
11. [PASS] Category classification is deterministic, explainable, and multi-label.
12. [PASS] Strength classification is deterministic, clause-local, and single-valued per statement.
13. [PASS] Education extraction preserves degree level, field, equivalency, and substitution distinctions.
14. [PASS] Experience extraction preserves ranges, modifiers, months, domains, and alternatives without fabricated years.
15. [PASS] Certification extraction uses a reviewed catalog and blocks known false positives such as grade `A+`.
16. [PASS] Clearance and citizenship extraction separates applicant requirements from employer/team context.
17. [PASS] Location, remote, hybrid, travel, and arrangement extraction does not override deterministic gates.
18. [PASS] Skill and technology extraction preserves raw mentions and conservative context.
19. [PASS] Boilerplate and non-requirement filtering has adversarial coverage.
20. [PASS] Deterministic/NLP reconciliation exposes agreement, conflict, and missing-side states.
21. [PASS] Shadow enrichment persistence uses a separate `job_nlp_enrichments` table.
22. [PASS] Version/hash invalidation and bounded reprocessing are idempotent and failure-tolerant.
23. [PASS] Inspector output is read-only, deterministically ordered, hash-based, and redacted.
24. [PASS] The base synthetic corpus contains 42 explicitly labeled local cases.
25. [PASS] The representative evaluation corpus contains 54 labeled local cases.
26. [PASS] The Stage 18 acceptance gate passes category, strength, entity, arrangement, disagreement, and critical-failure thresholds with explicit safety evidence.
27. [PASS] Semantic design remains design-first with no embedding runtime, model artifact, or silent download.
28. [SHADOW] Role matching is a deterministic fallback with threshold/margin abstention, not embedding semantics.
29. [SHADOW] Skill normalization uses only exact, alias, and reviewed relationships; unknown phrases remain unknown.
30. [SHADOW] Resume evidence consumes parsed evidence only and never claims candidate possession.
31. [SHADOW] Requirement coverage preserves direct/related/missing/unknown distinctions and has `productionEffect: 'none'`.
32. [PASS] The offline performance harness measures segmentation, classification, extraction, resume comparison, reprocessing, memory deltas, and cold import.
33. [PASS] Performance/cache identity uses a stable SHA-256 fingerprint over versioned inputs and corpus content.
34. [PASS] Temporary SQLite growth and serialized shadow payload size are recorded with limitations.
35. [PASS] Source/dependency/privacy audit finds no hosted AI, network, telemetry, secret, developer-path, or unlicensed-model artifact.
36. [SHADOW] The Job Intelligence drawer preview shows traceable job text and interpreted-as wording while all disconnected resume coverage remains unknown.
37. [PASS] Promotion Levels 0-4 and field-specific promotion states are documented.
38. [PASS] Promotion requires representative labels, FP/FN consequences, abstention, corroboration, production-vs-shadow diffs, rollback, and explicit authorization.
39. [PASS] Deterministic production scoring is byte-for-byte unchanged before and after representative shadow operations.
40. [PASS] `npm run verify` passes: 136 files and 1344 tests.
41. [PASS] `npm run privacy:check` passes: 3 files and 11 tests.
42. [PASS] Current Windows package validation passes packaged, installed, and packaged-upgrade smoke; installer SHA-256 is `7E57A444A100F34BF5D481846CAA6A7BEE7FB13A162099E81FB790F97C9CA251` and `app.asar` SHA-256 is `04315DEB302F784D8EED0901D729F0B2564BB07D1925EB4E7A1A1913EBF09563`.
43. [PASS] Roadmap, Project Memory, README, changelog, architecture, session handoff, audit documents, and release boundary are reconciled.

## Production Promotion Update — 2026-09-11

This section supersedes the historical corpus counts and artifact hashes in the original 43-point shadow baseline above.

| Capability                                      | Final P27 state | Default                | Authority                     |
| ----------------------------------------------- | --------------- | ---------------------- | ----------------------------- |
| Job Intelligence facts and resume coverage      | EXPLANATION (1) | Off                    | Display only                  |
| Reconciled role-family suggestion               | EXPLANATION (1) | Off                    | Deterministic catalog wins    |
| Search-profile vocabulary feedback              | EXPLANATION (1) | Off                    | Read-only                     |
| Target-role supporting evidence                 | EXPLANATION (1) | Current valid evidence | Deterministic membership wins |
| Search relevance tie-break                      | ENRICHMENT (2)  | Off                    | Exact deterministic ties only |
| Persisted comparison                            | SHADOW (0)      | Background             | No production decision        |
| Recommendation score and every eligibility gate | No promotion    | Unreachable            | Deterministic only            |

The expanded 66-case gate passes with 95.8% category precision, 93.2% category recall, 98.5% strength accuracy, 92.7% entity precision, 97.4% entity recall, and zero critical failures across 11 adversarial cases. P23 processed 500 real local jobs in a disposable copy with zero failures and no jobs-table drift. P24 passed verify 157/1,445, privacy 11/11, security 3/3, direct smoke, current unpacked-package smoke, and packaged-upgrade smoke.

P28 rebuilt the 1.1.0 installer after explicit user approval. The validated installer is `release\Job-Browser-Setup-1.1.0.exe`, 253,595,714 bytes, SHA-256 09328F21F77469BFBA6FB9A80627FC284C7695A7B087D86CABA197472917BE1C. Packaged smoke, installed smoke after silent install, seeded packaged-upgrade smoke, privacy, and NLP security audit passed. The packaged and installed app.asar are identical: 74,029,786 bytes, SHA-256 1984327AFA57400A8E9CBCC457CC3DFF4B2FF4E480511A837DBE3849B1023268. No capability reached SCORING or HARD_GATE, and productionEffect: 'none' remains the score/gate boundary.

## P29 Final Promotion Report

The promoted capabilities are bounded to explanation and exact-tie enrichment. Job Intelligence facts and resume coverage, role-family suggestions, search-profile feedback, and target-role supporting evidence are visible interpretation aids only. Search relevance may participate only as an off-by-default exact deterministic tie-break. Persisted deterministic-vs-NLP comparison remains SHADOW for audit. Recommendation score, eligibility, lifecycle, status, active/manual removal, and every hard gate remain deterministic-only.

## P30 Compensation Module Update

P30 adds local deterministic compensation extraction to the NLP document pipeline. It captures USD pay ranges, hourly/annual/monthly/one-time cadence, compact thousands, and bonus/commission/equity/sign-on/OTE signals with exact evidence spans and optional metadata. Compensation facts remain informational and shadow-only; they do not change score, eligibility, ranking, filters, lifecycle, or hard gates.

The final P30 installer is `release\Job-Browser-Setup-1.1.0.exe`, 253,596,385 bytes, SHA-256 7E57A444A100F34BF5D481846CAA6A7BEE7FB13A162099E81FB790F97C9CA251. Packaged and installed app.asar are identical: 74,036,910 bytes, SHA-256 04315DEB302F784D8EED0901D729F0B2564BB07D1925EB4E7A1A1913EBF09563. Focused NLP tests, packaged smoke, installed smoke, seeded upgrade smoke, privacy, and NLP security audit passed.

## Handoff Rule

Any future production promotion must begin with a new authorization that names
the field, evidence cohort, threshold, owner, rollout, rollback trigger, and
release. Until then, keep the shadow modules, UI, and persistence additive and
retain `productionEffect: 'none'`.
