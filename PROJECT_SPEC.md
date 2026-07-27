# Job Search Browser Project Specification

## Purpose

Build a local job-discovery and ranking application for Dustin Decker, an IT and cybersecurity job seeker located in Highland, Illinois.

The application must search approved employer career sites, collect relevant jobs, remove duplicates, rank realistic opportunities, remember prior decisions, and display the results in a local dashboard.

The system must never submit job applications automatically.

## Candidate profile

Location:

- Highland, Illinois

Search preferences:

- Primary radius: 45 miles
- Secondary radius: 60 miles for unusually strong opportunities
- Remote roles are acceptable
- Hybrid roles are acceptable when commuting is realistic

Target roles:

- Cybersecurity Analyst
- SOC Analyst
- Security Operations Analyst
- Vulnerability Analyst
- Risk Analyst
- NOC Engineer
- Network Operations Center Analyst
- Network Administrator
- Systems Administrator
- Junior Systems Administrator
- IT Support Analyst
- Infrastructure Support Analyst
- Technical Support Specialist

Education:

- Bachelor of Science in Cybersecurity and Information Assurance in progress
- Western Governors University
- Expected completion August 2027

Certifications:

- CompTIA Security+
- CompTIA Network+
- CompTIA A+
- ITIL 4 Foundation

Relevant experience and skills:

- United States Army veteran
- Decker Tech Services
- BitsIO security analytics training
- Splunk
- Cribl
- SIEM monitoring
- Alert investigation
- Windows administration
- Linux
- Hyper-V
- Active Directory fundamentals
- Networking
- TCP/IP
- DNS
- DHCP
- VLANs
- Wireshark
- Nmap
- Vulnerability analysis
- Security documentation
- Technical support
- Incident documentation
- Network troubleshooting

## Technology requirements

Use:

- Node.js
- TypeScript
- Playwright
- Chromium
- SQLite
- Express
- Server-rendered HTML or a lightweight frontend
- Zod
- Vitest
- ESLint
- Prettier

Avoid unnecessary framework complexity.

## Core entities

### Job

Every normalized job record must contain:

- id
- externalId
- title
- normalizedTitle
- company
- normalizedCompany
- location
- city
- state
- remoteType
- employmentType
- salaryMinimum
- salaryMaximum
- salaryText
- description
- requirements
- preferredQualifications
- postingUrl
- sourceName
- sourceType
- datePosted
- firstSeenAt
- lastSeenAt
- active
- clearanceRequirement
- sponsorshipAvailable
- estimatedExperienceYears
- seniorityLevel
- score
- recommendation
- scoreExplanation
- status

### Job statuses

Use these values:

- new
- review
- recommended
- applied
- ignored
- rejected
- interview
- offer
- expired

### Source

Each source must contain:

- id
- employer
- sourceType
- careersUrl
- enabled
- connector
- lastSuccessfulRun
- lastFailure
- failureCount

## Duplicate detection

Jobs must be treated as potential duplicates using:

1. Canonical posting URL.
2. External job ID.
3. Normalized company, title, and location.
4. Similarity comparison when the same staffing position appears on multiple boards.

Do not delete duplicate records without preserving the source URLs.

## Deterministic filters

Run rule-based checks before AI-assisted analysis.

Flag or reduce scores for:

- Director roles
- Senior manager roles
- Principal roles
- Architect roles
- Software-development-heavy positions
- Mandatory active TS/SCI when sponsorship is not stated
- Mandatory specialized experience exceeding five years
- Physical-security guard positions
- Commission-only positions
- Very low-paid unrelated contract work
- Positions outside the approved distance unless remote

Do not automatically reject based only on the word “senior.” Review the actual requirements.

## Ranking

Create separate scoring dimensions:

- skills match
- certification match
- experience realism
- education match
- location and remote fit
- clearance feasibility
- veteran relevance
- schedule fit
- salary quality
- overall interview likelihood

Each recommendation must explain:

- strongest matches
- missing requirements
- preferred qualifications not met
- potential dealbreakers
- why the role is or is not realistic
- recommended resume version

The score must never be presented without an explanation.

## Initial employers

Start with:

- Touchette Regional Hospital
- Southern Illinois Healthcare Foundation
- BJC HealthCare
- HSHS
- Anderson Healthcare
- Mercy
- SSM Health
- Leidos
- Peraton
- Booz Allen Hamilton
- Applied Research Solutions
- Newberry Group
- Scott Air Force Base contractors

## Dashboard requirements

The local dashboard must provide:

- jobs found today
- new jobs
- recommended jobs
- jobs requiring review
- applied jobs
- ignored jobs
- expired jobs
- source failures
- search by title or company
- filtering by score
- filtering by distance
- filtering by remote status
- filtering by clearance requirement
- sorting by first-seen date
- sorting by score
- original job link
- full match explanation
- status-change controls
- notes field

The dashboard must clearly mark jobs already applied to.

## Known application history

Seed this known application:

- Company: Touchette Regional Hospital
- Position: Cybersecurity and Network Admin I
- Status: applied

The browser must not recommend this job as a new opportunity.

## Safety requirements

- Never submit an application.
- Never log into a job board during initial development.
- Never bypass CAPTCHAs.
- Never bypass access controls.
- Respect reasonable request rates.
- Do not scrape sites that expressly block the method being used.
- Prefer public employer career pages and public ATS endpoints.
- Do not store passwords.
- Do not collect protected demographic data.
- Do not make disability disclosure decisions.
- Do not answer clearance, sponsorship, criminal history, veteran status, or disability questions.

## Engineering requirements

- Keep connectors isolated.
- Use interfaces for connector implementations.
- Store raw source data for debugging.
- Validate normalized records with Zod.
- Add structured logging.
- Add screenshots and HTML snapshots when a connector fails.
- Make every run idempotent.
- Include database migrations.
- Include unit tests.
- Include connector fixture tests.
- Include a README.
- Include a troubleshooting guide.
- Include a SESSION_HANDOFF.md file updated at the end of every phase.

## Development process

Work in controlled phases.

For every phase:

1. Inspect the existing repository.
2. State the implementation plan.
3. Make only the approved phase changes.
4. Run formatting, linting, tests, and type checking.
5. Show git status.
6. Show a concise diff summary.
7. Update SESSION_HANDOFF.md.
8. Stop and wait for approval.

Do not commit or push unless explicitly instructed.
Do not begin the next phase automatically.
