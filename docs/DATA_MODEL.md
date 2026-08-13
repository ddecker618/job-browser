# Application Outcome Data Model

> **Historical concept model:** This document is retained for product history and
> does not define the current schema or runtime ownership model. Use
> `DATABASE_V2.md` for the authoritative data contract.

## Applicant Profile

Each user should eventually have a normalized profile.

Possible fields:

user_id
skills[]
certifications[]
education[]
years_experience
job_titles[]
industries[]
location
remote_preference
military_experience
security_clearance
github_available
portfolio_available

Sensitive personal information should not be collected unless explicitly necessary.

## Job Record

job_id
company
title
location
remote_status
employment_type
salary_min
salary_max
source
source_job_id
job_url
date_discovered
date_posted
required_skills[]
preferred_skills[]
required_experience
required_education

## Application Record

application_id
user_id
job_id
date_applied

status:

- applied
- interview
- rejected
- ghosted
- offer
- withdrawn
- pending

interview_date
offer_date
rejection_date
last_status_update

## Future Derived Metrics

Do NOT implement these yet.

Possible future calculations:

company_interview_rate
role_interview_rate
skill_interview_correlation
certification_interview_correlation
user_job_similarity
estimated_interview_probability
reposting_frequency
posting_age
company_response_rate
