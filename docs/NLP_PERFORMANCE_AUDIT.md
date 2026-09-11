# NLP Performance Audit

Status: complete for the current deterministic shadow implementation.

This audit is an offline benchmark only. It does not add an embedding runtime,
download a model, change production scoring, or write a production job field.
Run it with:

```powershell
npm run nlp:benchmark
```

The command builds the current application first, then runs the benchmark over
the 54-case local corpus. The report includes a stable input fingerprint so a
future cached result can be invalidated when source text, labels, catalogs,
classifier versions, or the harness changes.

## Measurement Run

- Date: 2026-09-10
- Node: `v24.19.0`
- Platform: `win32 x64`
- Corpus: 54 cases
- Corpus/cache fingerprint: `91012293a99b8b9593c006db01eaed61665a1f2795b4b4b677cc79023b0339b7`
- Iterations: 20, with 3 warmup iterations
- Unit: one complete corpus run unless noted
- Network requests: 0
- Runtime cache: 0 bytes; fingerprint-only invalidation descriptor
- Embedding runtime/model: not installed

## Results

| Operation         |      p50 |      p95 | Peak heap delta | Notes                                                                                    |
| ----------------- | -------: | -------: | --------------: | ---------------------------------------------------------------------------------------- |
| Segmentation      | 0.189 ms | 0.486 ms |     1,010,200 B | 54 local cases                                                                           |
| Classification    | 0.970 ms | 1.167 ms |       217,992 B | 54 local cases                                                                           |
| Extraction        | 6.692 ms | 8.330 ms |     3,935,264 B | categories, strength, skills, experience, education, certifications, clearance, location |
| Resume comparison | 0.094 ms | 0.331 ms |       262,768 B | 3 parsed evidence requirements                                                           |
| Reprocessing      | 0.048 ms | 0.138 ms |       888,768 B | 100 in-memory candidates per batch                                                       |

Cold import of the compiled evaluation module was 215.238 ms. This is module
startup, not first model inference; there is no model inference to measure.

## Storage And Packaging

The temporary SQLite benchmark inserted 100 valid shadow rows after migrations:

- Allocated SQLite pages before rows: 798,720 B
- Allocated SQLite pages after rows: 897,024 B
- Incremental allocation: 98,304 B
- Serialized enrichment payload: 17,090 B
- Approximate incremental allocation: 983 B per row for this minimal valid payload

The benchmark payload intentionally uses an empty valid fact list. It is a
storage floor, not a claim about a fully populated production enrichment row.
The NLP program has no model artifact or semantic runtime dependency, so its
incremental model/runtime package impact is 0 B. Full installer size and smoke
validation remain part of the final release validation stage.

## Decisions

- No fixed latency, memory, or package budget is invented from one Windows run.
- Future model/runtime experiments must report cold/warm latency, p50/p95,
  peak memory, disk/cache growth, network activity, accuracy, redaction, and
  package impact against this fingerprinted baseline.
- The only approved cache key inputs are versioned implementation inputs and
  corpus/source fingerprints; stale results must not be reused silently.
- Performance work must not remove evidence, weaken abstention, bypass
  deterministic gates, or move shadow output into production scoring.

## P16 Real-Corpus Load Run

- Date: 2026-09-11
- Platform: ordinary Windows win32 x64
- Source handling: 500 jobs copied to a temporary local database, then copied into
  memory; the temporary database was deleted after the run
- Source characters: 2,939,812
- Report fingerprint: 8f749332ae444f9def0437f4631c8156db29d9a5e3eadb02ca4616b95a82e03d
- Batch size/count: 50 / 10
- Batch p50/p95: 607.918 ms / 666.770 ms
- Total extraction time: 5,889.964 ms
- Extracted/failed: 500 / 0
- Event-loop heartbeat ticks: 2,609 (main-thread yielding observed)
- Heap delta: 72,112,512 B
- Immediate current-cache retry: 500 skipped, 0 rebuilt
- Network requests: 0
- Source database writes: 0

The reusable command is npm run nlp:production-audit -- <database-copy> [limit].
It opens the supplied copy read-only and never includes description text in its JSON
report. The measurement is a reproducible local baseline, not a fixed performance
budget; correctness and evidence checks remain unchanged.

## P25 Desktop Real-Copy Validation — 2026-09-11

A 253,034,496-byte consistent backup of the user's local database was passed to the direct current-source desktop build in existing-data smoke mode. The app migrated through version 034, loaded the dashboard and all smoke routes, kept the backend healthy, produced 205 rows in each shadow table before exit, and left no Job Browser or Electron process. The database set grew by 13,619,200 bytes during migrations, smoke-fixture writes, and shadow processing. The copy was deleted.

This end-to-end number is not a per-row storage estimate. The separate P23 worker run processed 500 jobs with zero failures and 2,079 event-loop heartbeats, while the P25 run validates startup, UI navigation, background coexistence, and shutdown against the real database shape.
