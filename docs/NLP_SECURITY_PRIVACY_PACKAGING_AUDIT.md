# NLP Security, Privacy, And Packaging Audit

Status: complete for the current deterministic explanation/enrichment implementation.

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

## P26 Promotion-Surface Re-Audit — 2026-09-11

The audit scope now includes every file under src/intelligence/nlp, the NLP schema, the enrichment/relevance/comparison repositories, and migrations 031-034. Fresh migrations create all three shadow tables empty. The scan found no hosted AI/model dependency, network call, telemetry, developer absolute path, secret marker, or model artifact.

npm run nlp:security-audit passed 3/3. npm run privacy:check passed 11/11 after rebuilding the current unpacked application. The current app.asar is 74,029,786 bytes with SHA-256 1984327AFA57400A8E9CBCC457CC3DFF4B2FF4E480511A837DBE3849B1023268. Fresh packaged and seeded-upgrade smoke passed. The NSIS installer was intentionally not rebuilt; its final content/hash/install audit is the P28 approval-gated release step.

## P28 Installer Release Audit — 2026-09-11

After explicit user approval, `npm run desktop:package` rebuilt the 1.1.0 NSIS installer from current source. The rebuilt installer is `release\Job-Browser-Setup-1.1.0.exe`, 253,595,714 bytes, SHA-256 `09328F21F77469BFBA6FB9A80627FC284C7695A7B087D86CABA197472917BE1C`. The packaged `app.asar` and installed `app.asar` are identical at 74,029,786 bytes, SHA-256 `1984327AFA57400A8E9CBCC457CC3DFF4B2FF4E480511A837DBE3849B1023268`.

The release artifact passed packaged smoke, silent install, installed smoke, seeded packaged-upgrade smoke, privacy (11/11), and NLP security audit (3/3). No hosted AI, model artifact, telemetry, external NLP call, personal content, secret, or developer path was introduced. No Job Browser/Electron/Playwright process or port 6783 listener remained after validation.

## P30 Compensation Release Audit — 2026-09-11

P30 added deterministic local compensation extraction without introducing a model runtime, network call, telemetry path, external NLP service, or model artifact. `npm run nlp:security-audit` passed 3/3 and `npm run privacy:check` passed 11/11 after the installer rebuild.

The final P30 installer is `release\Job-Browser-Setup-1.1.0.exe`, 253,596,385 bytes, SHA-256 `7E57A444A100F34BF5D481846CAA6A7BEE7FB13A162099E81FB790F97C9CA251`. The packaged `app.asar` and installed `app.asar` are identical at 74,036,910 bytes, SHA-256 `04315DEB302F784D8EED0901D729F0B2564BB07D1925EB4E7A1A1913EBF09563`.
