import { randomUUID } from 'node:crypto';

import type { NormalizedJob } from '../../src/schemas/normalized-job.js';
import { generateJobFingerprint } from '../../src/utils/fingerprint.js';

export function createJobFixture(
  overrides: Partial<NormalizedJob> = {},
): NormalizedJob {
  const job = {
    id: randomUUID(),
    title: 'Security Analyst',
    company: 'Example Employer',
    location: 'Example City, EX',
    postingUrl: 'https://jobs.example.com/security-analyst/123',
    ...overrides,
  };

  return {
    id: job.id,
    fingerprint:
      overrides.fingerprint ??
      generateJobFingerprint({
        company: job.company,
        title: job.title,
        location: job.location,
        postingUrl: job.postingUrl,
      }),
    externalId: 'external-123',
    title: job.title,
    normalizedTitle: 'security analyst',
    company: job.company,
    normalizedCompany: 'example employer',
    location: job.location,
    city: 'Example City',
    state: 'EX',
    remoteType: 'hybrid',
    employmentType: 'full-time',
    salaryMinimum: 60_000,
    salaryMaximum: 80_000,
    salaryText: '$60,000-$80,000',
    description: 'Monitor security events.',
    requirements: 'Security+ certification',
    preferredQualifications: 'SIEM experience',
    postingUrl: job.postingUrl,
    sourceName: 'Example Employer careers',
    sourceType: 'fixture',
    datePosted: '2026-07-17T12:00:00.000Z',
    agency: null,
    department: null,
    gradeLow: null,
    gradeHigh: null,
    payPlan: null,
    appointmentType: null,
    workSchedule: null,
    teleworkEligible: null,
    openingDate: null,
    closingDate: null,
    applicationUrls: [],
    firstSeenAt: '2026-07-18T12:00:00.000Z',
    lastSeenAt: '2026-07-18T12:00:00.000Z',
    active: true,
    clearanceRequirement: null,
    sponsorshipAvailable: null,
    estimatedExperienceYears: 2,
    seniorityLevel: 'entry',
    score: 82,
    recommendation: 'recommended',
    scoreExplanation: 'Strong certification and skills match.',
    status: 'new',
    ...overrides,
  };
}
