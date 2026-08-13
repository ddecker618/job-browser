# Job Browser Intelligence Roadmap

> **Historical concept roadmap:** This document is retained for long-term product
> context and does not define current phase numbering or implementation sequence.
> Use `IMPLEMENTATION_ROADMAP.md` and `FEATURE_SPEC_AI_ASSISTANT.md` for current
> boundaries.

## Purpose

This document describes the long-term roadmap for adding intelligence and analytics to Job Browser.

The objective is not to become another job board. The objective is to learn from real application outcomes to improve future job recommendations.

---

# Phase 1 - Persistent Application History

## Goal

Persist application history whenever a user marks a job as applied.

Record:

- Application ID
- Job ID
- Company
- Job Title
- Source
- Original Job URL
- Date Discovered
- Date Applied
- Current Status

Status values:

- Applied
- Interview
- Rejected
- Ghosted
- Offer
- Withdrawn
- Pending

---

# Phase 2 - Outcome Tracking

Allow users to update applications over time.

Possible events:

- Phone Screen
- Technical Interview
- Final Interview
- Offer
- Rejection
- Ghosted

Record timestamps for every transition.

---

# Phase 3 - Resume Snapshots

Instead of storing only the current resume, preserve a snapshot of the applicant's qualifications at the time they applied.

Potential fields:

- Skills
- Certifications
- Education
- Years of Experience
- Projects
- Military Experience
- Security Clearance
- Portfolio
- GitHub

This prevents historical applications from changing as resumes evolve.

---

# Phase 4 - Job Normalization

Normalize job requirements into structured fields.

Examples:

- Required Skills
- Preferred Skills
- Certifications
- Experience
- Education
- Salary
- Remote Status
- Employment Type

---

# Phase 5 - Anonymous Analytics

Generate anonymous aggregate statistics.

Examples:

- Company response rate
- Average interview rate
- Average offer rate
- Average response time
- Common required skills

No individual applicant data should ever be exposed.

---

# Phase 6 - Correlation Engine

Identify meaningful relationships.

Examples:

- Certification -> Interview Rate
- Skill -> Interview Rate
- Experience -> Offer Rate
- Military Experience -> Response Rate

Correlations should always include sample size.

---

# Phase 7 - Recommendation Engine

Begin making recommendations such as:

- High probability opportunities
- Skills worth learning
- Resume improvements
- Better companies
- Better role matches

Recommendations must always explain why.

---

# Phase 8 - Predictive Intelligence

Only after sufficient historical data exists.

Possible future capabilities:

- Interview probability
- Offer probability
- Estimated recruiter response
- Personalized application ranking

Predictions should always include confidence scores and sample size.
