# AI Workflow

Every development session ends with an Architect Handoff.

The Architect Handoff must include:

## Completed

What changed.

## Decisions Made

Architectural decisions that were made.

## Decisions Needed

Questions requiring human or architectural approval.

## Risks

Anything that could affect future work.

## Recommended Next Task

Exactly one recommended next task.

## Files to Review

List every document or source file that should be reviewed before the next implementation session.

## Model Roles

### Architect

The architect is responsible for:

- Product and system architecture
- Feature boundaries
- Database design approval
- Implementation prompt design
- Reviewing implementation results
- Resolving low-confidence architectural questions

The architect does not directly redesign working code during an implementation task unless explicitly requested.

### Implementation Agent

The implementation agent is responsible for:

- Reading the authoritative project documents before making changes
- Implementing the approved task
- Writing or updating tests
- Running required verification
- Updating documentation only when implemented behavior changes
- Producing the required Architect Handoff

The implementation agent must not independently redesign approved architecture.

## Required Reading Order

Before implementation work, read:

1. `PROJECT_MEMORY.md`
2. `SESSION_HANDOFF.md`
3. `IMPLEMENTATION_ROADMAP.md`
4. `ARCHITECTURE.md`
5. `DATABASE_V2.md` when persistence is involved
6. The relevant `FEATURE_SPEC_*.md`
7. Source files named in the implementation prompt

Current repository implementation overrides stale documentation. Any discrepancy must be reported rather than silently resolved.

## Implementation Boundaries

- Preserve working functionality.
- Prefer extension over replacement.
- Do not modify unrelated files.
- Do not remove providers unless explicitly instructed.
- Do not modify existing applied migrations.
- Do not begin the next roadmap milestone automatically.
- Do not commit or push unless explicitly instructed.
- Do not bypass login controls, CAPTCHA, anti-bot systems, or site policies.
- Tests must pass before a task is reported complete.

## Confidence Rule

Architectural decisions made during implementation must include confidence:

- HIGH: direct consequence of approved architecture or existing implementation
- MEDIUM: multiple valid implementation choices exist but no product behavior changes
- LOW: changes product behavior, persistence semantics, privacy boundaries, or system architecture

LOW-confidence decisions must be reported under `Decisions Needed` instead of being implemented without approval.

## Required Final Output

Every implementation session must end with:

### Completed

Exactly what changed.

### Files Changed

Every modified or created file.

### Decisions Made

Any implementation-level decisions and their confidence.

### Decisions Needed

Any unresolved architectural or product questions.

### Tests and Verification

Exact commands run and results.

### Risks

Known limitations or regression risks.

### Recommended Next Task

Exactly one recommended next task.

### Files to Review

Exact file paths the architect should inspect next.

## New Subsystem Rule

Before implementing any major subsystem:

1. Create or update the subsystem PRD.
2. Freeze subsystem architecture.
3. Freeze conceptual data model.
4. Freeze milestones.
5. Freeze testing strategy.
6. Obtain Architect approval.
7. Begin implementation.

Implementation agents must not invent subsystem architecture during coding.