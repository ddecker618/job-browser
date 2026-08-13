# Development Roadmap

> **Historical concept roadmap:** This document is retained for product history
> and does not define current phase numbering or implementation sequence. Use
> `IMPLEMENTATION_ROADMAP.md` for current work.

## Phase 1: Application Tracking

Add the ability to mark a job as:

Applied

And record:

application date
job ID
company
title
source

No machine learning.

## Phase 2: Outcome Tracking

Allow the user to update an application:

Interview
Rejected
Ghosted
Offer
Still Waiting

## Phase 3: Applicant Profile Normalization

Convert resume/profile information into structured attributes:

skills
certifications
experience
education
projects

## Phase 4: Job Normalization

Normalize requirements from job descriptions.

Extract:

skills
certifications
experience
education
location
remote requirements

## Phase 5: Basic Statistics

Calculate simple statistics such as:

applications
interviews
rejections
offers
response rates

No AI predictions yet.

## Phase 6: Cross-User Aggregation

Build anonymous aggregate statistics across users.

Require sufficient sample sizes before reporting company-specific conclusions.

## Phase 7: Intelligence Layer

Begin testing correlations such as:

Skill -> interview rate
Certification -> interview rate
Experience -> interview rate
Company -> response rate

## Phase 8: Prediction

Only after sufficient data exists.

Estimate:

likelihood of interview
likelihood of response
job priority

Predictions must include confidence and sample size.
