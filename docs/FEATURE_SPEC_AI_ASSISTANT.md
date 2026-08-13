# Feature Spec: Future Intelligence Engine

> **Document responsibility:** Define the future system for recommendations,
> analytics, correlations, predictions, confidence, and explanations. This is
> not a chatbot specification and does not prescribe a conversational user
> interface or an implementation technique.

## Purpose

> **Section purpose:** Explain the decisions the intelligence engine may support
> and the boundary between evidence and guidance.

The future intelligence engine is intended to help users evaluate jobs and
application choices using transparent evidence. The earlier conversational
assistant concept is retired; its useful questions are retained below as
recommendation and explanation requirements rather than chatbot prompts.

## Current Behavior

Job Browser already provides deterministic Job/CandidateProfile scoring,
current recommendation rows, changed-score history, persisted run-scoped
job-market analytics, and live dashboard queries. These outputs use explicit
rules and current profile inputs. They are calculated results, not learned
application-outcome recommendations or predictions.

Phase 8 preserves the existing `recommendations`, `score_history`, Job score
projections, and `analytics` semantics. It does not add generalized
recommendation history or prediction persistence.

## Recommendation Philosophy

> **Section purpose:** Define how recommendations should be grounded, bounded,
> and presented. Detailed rules remain for a later approved specification.

Recommendations should use observed facts and clearly identified calculated
metrics whenever possible. Existing planning requirements include matching
resumes against jobs, identifying missing keywords, recommending the most
appropriate resume, and comparing jobs. A recommendation must not be presented
as an observed outcome or a guaranteed result.

## Analytics Philosophy

> **Section purpose:** Define which aggregate questions may be answered and the
> evidence standard required. Persistence and anonymization design belong in
> `DATABASE_V2.md`.

Analytics should summarize reliable observed data and make sample size and
scope visible. The product's longer-term outcome questions remain in
`JOB_BROWSER_PRD.md`; this document will eventually define how those questions
are answered without overstating correlations.

The approved Phase 8 boundary is installation-local application-outcome
analytics calculated on demand. Every result identifies its event definition,
time window, numerator, denominator, sample size, unknown-data treatment, and
definition version. AnalyticsCache and cross-install aggregation are not Phase 8
capabilities.

## Observed Facts

> **Section purpose:** Define values directly supplied by a source or explicitly
> recorded by the user, together with their provenance and time context.

Examples include source listing values, exact ResumeSnapshot bytes, user-entered
application activity, and recorded outcomes. Parsed resume text, normalized
payloads, and extracted qualifications are versioned derived interpretations,
not observed facts. Missing or conflicting observations must remain visible.

## Calculated Metrics

> **Section purpose:** Define deterministic values computed from observed facts
> and make their inputs and interpretation visible.

Match scores, comparisons, and aggregate rates belong in this category when
they are calculations rather than forecasts. Existing deterministic job
ranking must not be relabeled as a prediction merely because it produces a
score.

## Phase 8 Outcome Metric Definitions

Phase 8 uses deterministic definition `application-outcomes-v1`. Every metric is
installation-local and evaluated at an explicit `as of` generation boundary.
Version 1 calculates current results only; it does not accept an arbitrary
historical `as of` value or reconstruct a historical projection.

### Cohort and Denominator

- The base cohort contains Applications whose earliest effective Applied event
  has a normalized occurrence value inside the selected half-open applied-time
  window `[start, end)` and no later than the `as of` time.
- Each qualifying Application contributes once to the base denominator even if
  an event type occurs repeatedly.
- Effective outcome events after the applied-time window count through the `as
of` time. The result therefore identifies both the cohort window and the
  observation cutoff.
- A legacy Application without a supportable effective Applied event is excluded
  from rates and reported separately as `unknown applied baseline`; it is never
  silently added to or removed from a denominator.

### Event Sets

| Metric event set | Effective events that qualify                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Response         | Recruiter Contact, Phone Screen, Technical Interview, Manager Interview, Final Interview, Interview (stage unknown or retained legacy generic), Offer, Accepted, or Rejected |
| Interview        | Phone Screen, Technical Interview, Manager Interview, Final Interview, or Interview (stage unknown or retained legacy generic)                                               |
| Offer            | Offer or Accepted                                                                                                                                                            |
| Acceptance       | Accepted                                                                                                                                                                     |
| Rejection        | Rejected                                                                                                                                                                     |
| Ghosting         | Ghosted                                                                                                                                                                      |
| Withdrawal       | Withdrawn                                                                                                                                                                    |

Rejected counts as a response because its approved status meaning requires an
employer-communicated rejection. Ghosted and Withdrawn do not count as responses.

For each event-set rate, the numerator is the number of base-cohort Applications
with at least one qualifying effective event whose normalized occurrence is at
or after that Application's effective Applied time and no later than the `as of`
boundary. An outcome with unknown occurrence time or a time before Applied is
excluded from every numerator and reported in a data-quality count. The
denominator is the full base cohort.

A current-outcome count uses the event-derived current projection at the current
generation boundary and counts it only when its supporting event satisfies the
same occurrence-time rule. An `ever reached` count uses qualifying effective
events and can include an Application whose state later changed.

### Timing and Corrections

Time to first response is the difference between the earliest effective Response
event at or after the earliest effective Applied event and that Applied event.
Both values must have supportable normalized occurrence times. A response dated
before Applied, an unknown time, or an unparseable time is excluded from duration
statistics and reported in a data-quality count; it is never clamped to zero.

Replacement and void events affect metrics through the effective event set.
An effective replacement is classified by its canonical semantic event type;
Void has no metric effect. Superseded events remain auditable but do not count.
Ties use occurrence time, record time, and stable Event ID in the Database V2
order.

### Dimensions and Result Metadata

Company metrics use the Application's Phase 8 Company assignment; unresolved
Applications remain in an explicit unknown Company bucket. Skill and
Certification metrics use the capture-time ResumeSnapshotInterpretation. Their
rate denominator is the base-cohort subset with a usable capture-time
interpretation; missing or failed snapshots are reported as an unknown
qualification count.

Every returned result includes the definition name and version, cohort window,
`as of` time, included event set, numerator, denominator, sample size, excluded
and unknown counts, source-data watermark or deterministic input hash, and
generation time. Sample size communicates evidence volume; it is not a numeric
confidence score.

## Predictions

> **Section purpose:** Define any future estimate of an unknown outcome and keep
> it visibly separate from facts and calculated metrics.

No prediction capability is established by this document. Prediction targets,
minimum evidence, exclusions, evaluation, and user-facing limitations require
separate approval before implementation.

## Confidence Scores

> **Section purpose:** Define how evidence sufficiency and uncertainty are
> communicated for calculated or predictive outputs. A numeric confidence
> value must not be introduced until its meaning and validation are documented.

## Explainability

> **Section purpose:** Define the evidence and reasoning a user can inspect for
> every recommendation, metric, or prediction.

The historical requests "Why is this job an 82% match?", "What skills am I
missing?", "Which resume should I use?", and "Compare these jobs" are retained
as explanation use cases. Explanations must distinguish source facts from
calculations and must disclose missing information.

## Future Expansion

> **Section purpose:** Preserve earlier intelligence ideas without presenting
> them as approved or implemented features.

Generating a tailored resume draft or drafting a cover letter remains a future
possibility. Either capability requires separate product approval, privacy
review, validation rules, and a clear user-review boundary.
