# NLP Real-Data Validation — P23

Run date: 2026-09-11  
Harness: `nlp-real-data-validation-v1`  
Input: a consistent SQLite backup of the user's local Job Browser database  
Privacy: no descriptions, URLs, company names, titles, or job identifiers are retained in this report

## Result

**PASS.** The worker processed 500 of 3,662 jobs in the disposable database copy. It produced 500 current enrichments, 500 search-relevance indexes, and 500 persisted comparison reports with zero failures.

The SHA-256 fingerprint of every column in every `jobs` row was `5fccee8f877aa7579900025beb8fb96653e8cbab1cb6f7c2c5f90c9f164f07f2` both before and after processing. NLP therefore caused no score, eligibility, ranking, lifecycle, or other source-job drift.

## Measurements

| Measure                       |    Observed |
| ----------------------------- | ----------: |
| Jobs processed                |         500 |
| Worker batch size             |          50 |
| Extracted / skipped / failed  | 500 / 0 / 0 |
| Total worker time             | 4,575.04 ms |
| Event-loop heartbeat ticks    |       2,079 |
| Main-thread yielding observed |         Yes |
| Network requests              |           0 |
| Writes to original database   |           0 |

The 500 reports contained 1,500 capability comparisons: 98 agreement, 81 conflict, 291 deterministic-only, 435 NLP-only, and 595 unknown. The aggregate agreement rate was 6.53% and the conflict rate was 5.40%. These rates are descriptive rather than quality scores because many structured fields are absent and because the comparison covers three fixed capabilities for every job.

## Decision

Deterministic values remain authoritative. The observed conflicts and one-sided interpretations support retaining shadow mode and the off-by-default capability flags. A feature can be enabled only at its own decision boundary; disabling it restores the deterministic behavior without changing stored job rows.

The disposable validation copy and its SQLite sidecars were deleted after the run. The original local database was opened only long enough for SQLite's read-only backup operation and was not migrated or modified.
