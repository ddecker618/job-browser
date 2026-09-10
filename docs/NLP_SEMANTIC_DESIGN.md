# NLP Semantic Normalization Design

Status: design only. No embedding runtime, model artifact, network fetch, or
semantic production path is approved by this document.

## Scope

The semantic layer is a later shadow projection over the deterministic NLP
contract. It may suggest canonical concepts and explain similarity, but it
must not change production score, eligibility, ranking, filtering, lifecycle,
removal/archive behavior, or deterministic hard gates.

The current application has no semantic-model dependency. The current
baseline is the deterministic segment, category, strength, entity, skill-alias,
and reconciliation pipeline already recorded in `docs/Intelligence_Roadmap.md`.

## Decisions

1. Deterministic extraction remains the first pass and the authoritative source
   for hard-gate dimensions.
2. Semantic matching is opt-in, shadow-only, versioned, explainable, and
   abstention-capable. A low-confidence semantic suggestion is preferable to a
   guessed canonical value.
3. The base application must not download models at runtime. Network access is
   not a model distribution mechanism.
4. A model, tokenizer, runtime, and license must be explicitly packaged or
   explicitly installed by an operator. A dependency is not approved merely
   because it can download a model on first use.
5. Raw evidence spans remain separate from canonical concepts. Semantic
   normalization never replaces raw text or deterministic output.

## Canonical Records

The future semantic projection should use records equivalent to these shapes.
They are design contracts, not persisted schemas yet.

```text
SemanticInput
  sourceKind: job-fact | skill-mention | resume-evidence | role-title
  sourceId: stable local identifier
  rawText: exact source evidence, retained under existing privacy rules
  normalizedText: deterministic whitespace/case normalization
  category: NLP category or null
  strength: NLP strength or null
  evidence: source field, segment index, char start/end
  inputVersion: NLP extraction version

CanonicalConcept
  namespace: skill | role | certification | education | clearance | other
  key: stable namespace-local key
  label: display label
  ontologyVersion: catalog/ontology version
  aliases: deterministic aliases only

SemanticMatch
  sourceId: SemanticInput.sourceId
  conceptKey: CanonicalConcept.key
  method: alias | embedding | hybrid
  score: 0..1 similarity/reliability score
  threshold: threshold used for this namespace/model
  margin: top-1 minus top-2 when applicable
  decision: accepted | abstained | rejected
  modelVersion: model fingerprint or deterministic version
  runtimeVersion: semantic runtime version or deterministic
  explanation: evidence span, matched concept, score, threshold, and reason
```

`sourceId`, `conceptKey`, versions, and evidence coordinates are required for
diagnostics. Raw vectors are ephemeral by default. If a later feature requires
vector persistence, it must use a separate additive cache with explicit
retention, source-hash invalidation, and no production-field updates.

## Runtime Options

| Option                                                  | Benefits                                                                | Risks / decision                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Deterministic alias/catalog baseline                    | Zero binary/model size, explainable, offline, already available         | Cannot cover unseen paraphrases; remains the required fallback                      | Keep enabled everywhere                                |
| Optional local ONNX Runtime with a pinned small encoder | Offline operation, explicit model artifact, measurable CPU/RAM behavior | Native/WASM packaging, tokenizer parity, model license, artifact size, cold start   | Candidate only after benchmark and packaging review    |
| Optional Transformers.js/WASM with a pinned model       | Portable JavaScript integration and local execution                     | Weight/cache size, WASM startup, model license, tokenizer/runtime drift             | Candidate only for a separately measured optional path |
| Hosted embedding API                                    | Easy model upgrades                                                     | Privacy, network availability, cost, reproducibility, secret handling, vendor drift | Rejected for the base product and current roadmap      |

The preferred future experiment is a small, explicitly packaged local runtime
behind an adapter. The adapter must be unavailable when the artifact is absent;
absence means deterministic fallback, not a download attempt. No package is
added in Stage 19 because runtime and packaging measurements do not yet exist.

## Model Selection Checklist

Before selecting a model, record all of the following in a local benchmark
report:

- Model name, publisher, exact revision, SHA-256 artifact hash, tokenizer hash,
  embedding dimension, pooling rule, normalization rule, and supported input
  length.
- License text, commercial-use status, redistribution rights, attribution
  requirements, training-data restrictions, and whether the tokenizer/model
  files may ship inside the desktop package.
- Runtime package, native binaries or WASM files, Node/Electron ABI support,
  platform coverage, and transitive dependency licenses.
- Cold initialization time, warm inference p50/p95 latency, throughput, peak
  RSS, CPU time, disk size, packaged installer/asar delta, and cache growth.
- Behavior on the Stage 16/17 corpus, including category-specific precision,
  recall, abstention rate, critical false positives, and evidence fidelity.

No model is accepted with only a semantic-quality score. Operational cost,
privacy, license, reproducibility, and explainability are acceptance inputs.

## Versioning and Cache

Every semantic result is stale when any of these changes:

- semantic contract version;
- deterministic NLP extraction version or source text hash;
- canonical catalog/ontology version;
- model artifact or tokenizer hash;
- runtime version, pooling rule, dimension, metric, or threshold profile.

The proposed cache key is:

```text
sha256(namespace | normalizedText | inputVersion | sourceTextHash |
       ontologyVersion | modelHash | tokenizerHash | runtimeVersion |
       pooling | dimensions | thresholdProfile)
```

Cache entries are disposable derived data. A cache miss or stale entry must be
safe and bounded. Reprocessing follows the Stage 14 cursor/idempotence rules;
it never archives a job or updates production `jobs` fields.

## Similarity and Thresholds

Cosine similarity is the initial candidate metric for normalized vectors, but
the metric is not a decision by itself. Each namespace needs a calibrated
threshold profile containing:

- minimum top-1 score;
- minimum top-1/top-2 margin;
- maximum candidate count;
- abstention behavior when no candidate clears both gates;
- category/namespace-specific overrides and their evaluation evidence.

Thresholds must be calibrated against labeled local cases and adversarial
negatives. There is no universal semantic threshold. Semantic output can
provide a shadow suggestion or disagreement, but it cannot override a
deterministic clearance, citizenship, location, schedule, commute, or lifecycle
decision.

## Explainability and Privacy

Every accepted or abstained result must be inspectable through the Stage 15
projection or its successor:

- exact redacted evidence span and source field;
- raw alias or normalized input used for matching;
- canonical concept and ontology version;
- score, threshold, margin, method, model/runtime hashes, and abstention reason;
- deterministic value, semantic value, and reconciliation state when both
  exist.

PII and secrets follow the existing inspector redaction boundary. Do not expose
raw embeddings, model prompts, hidden vectors, access tokens, email addresses,
phone numbers, or personal profile URLs in diagnostics. Semantic matching is
not an authorization to retain more source text.

## Measurement Gate

The first semantic benchmark must run offline against synthetic/local data and
report at minimum:

| Measurement               | Required comparison                                                            |
| ------------------------- | ------------------------------------------------------------------------------ |
| Artifact and package size | Base build vs explicitly packaged model/runtime                                |
| Disk/cache growth         | Empty cache, warm cache, and repeated invalidation                             |
| Cold startup              | Process start and first inference separately                                   |
| Warm latency              | p50 and p95 per input length and batch size                                    |
| CPU and memory            | Peak RSS and CPU time during cold/warm runs                                    |
| Network                   | Must remain zero for model acquisition and inference                           |
| Accuracy/safety           | Category precision/recall, entity precision/recall, abstention, critical FP/FN |
| Explainability            | Span/version/hash completeness and redaction checks                            |

No fixed model-size or latency budget is invented before this baseline. The
promotion decision must explicitly record budgets, package impact, platforms,
and rollback behavior. A result that requires silent downloads, unbounded cache
growth, or an unexplained critical false positive fails the gate.

## Rollout Sequence

1. Stage 19: keep this design and benchmark plan; add no runtime dependency.
2. Stage 20: build role matching as an offline shadow adapter with deterministic
   fallback and no score/eligibility integration.
3. Stage 21: build skill normalization against the existing catalog and
   adversarial negatives before considering unseen concepts.
4. Stage 22: match resume evidence with exact source spans and privacy limits.
5. Stage 23: aggregate requirement coverage without changing production gates.
6. Stages 24-25: measure performance, security, privacy, packaging, and model
   licensing before any optional runtime is shipped.

## Explicit Non-Goals

- No LLM or hosted API integration.
- No automatic model download, model upgrade, or network dependency.
- No semantic value written to production score, eligibility, ranking, or
  lifecycle fields.
- No replacement of deterministic evidence with an opaque vector match.
- No generic ontology or employer-specific catalog mutation from observed text.
