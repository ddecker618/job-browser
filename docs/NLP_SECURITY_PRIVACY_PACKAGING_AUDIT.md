# NLP Security, Privacy, And Packaging Audit

Status: complete for the current deterministic shadow implementation.

## Scope

The audit covers the NLP modules, the versioned NLP schema, shadow repository,
migration `031_nlp_enrichments.sql`, package dependencies, fresh migration state,
and the read-only inspector boundary. The focused audit is:

```powershell
npx vitest run tests/job-nlp-security-packaging.test.ts
```

The existing distribution gate remains applicable:

```powershell
npm run privacy:check
```

## Findings

- No hosted AI, embedding, model, tokenizer, or semantic-runtime dependency is
  present.
- No NLP source file contains a network call, external model URL, telemetry
  path, developer absolute path, or credential marker.
- No model artifact (`.onnx`, `.bin`, `.safetensors`, `.gguf`, `.pt`, or `.pth`)
  exists in the audited production NLP scope.
- Fresh migrations create the separate `job_nlp_enrichments` table with zero
  rows. NLP does not add columns to `jobs` and does not alter score,
  recommendation, active, or status fields.
- The inspector is read-only, retains only a source hash, and redacts email and
  phone values before diagnostic projection.
- No model license or redistribution review is required for this checkpoint
  because no model/runtime artifact is packaged.

## Packaging Decision

The NLP work remains additive and local. The only new benchmark script is a
development command and is not an application runtime dependency. If a future
model/runtime is proposed, Stage 25 must be repeated with artifact inventory,
license terms, package diff, fresh-install scan, cache ownership, and an
explicit no-network test before promotion.
