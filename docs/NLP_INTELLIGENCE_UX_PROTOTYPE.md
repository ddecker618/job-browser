# NLP Intelligence UX Prototype

Status: complete as a read-only shadow-mode prototype.

## Placement

The prototype appears in the existing Job detail drawer immediately before the
production Match breakdown section. It does not add a route, change the Jobs
page, add a network request, or alter the existing score/recommendation model.

Implementation:

- `src/client/components/JobIntelligencePreview.tsx`
- `src/client/components/JobDetailPanel.tsx`
- `src/client/styles.css`
- `tests/job-intelligence-ui.test.tsx`

## User-Facing Contract

- The section is labeled `Local shadow mode` and `Preview`.
- Required, preferred, and mentioned job statements are summarized separately.
- Each row shows the raw job-detail phrase, its source field, and an explicit
  `Interpreted as:` description.
- Every row is `Unknown` for coverage because the current client does not have a
  resume-evidence read endpoint.
- The section states that it does not change score, eligibility, ranking,
  filtering, lifecycle, or saved job data.
- Empty descriptions render a neutral empty state instead of inferred facts.

## Deliberate Non-Goals

- No claim that the candidate possesses a skill, certification, or requirement.
- No probabilistic language presented as fact.
- No replacement of the existing production Match breakdown.
- No wholesale UI redesign or new persistence/API surface.
