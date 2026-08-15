import { randomUUID } from 'node:crypto';

import { openDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import type { NormalizedJob } from '../src/schemas/normalized-job.js';
import { nowUtc } from '../src/utilities/timestamps.js';

export const UPGRADE_SMOKE_STALE_FINGERPRINT = 'd'.repeat(64);
export const UPGRADE_SMOKE_REMOVED_FINGERPRINT = 'e'.repeat(64);

const STALE_V1_DOCUMENT = JSON.stringify({
  version: 'role-details-v1',
  generatedAt: '2026-08-13T00:00:00.000Z',
  sourceTextHash: 'stale-v1-upgrade-smoke',
  workplace: {
    arrangement: 'remote',
    source: 'description',
    evidence: ['Remote work available.'],
  },
  employment: { type: 'full-time', source: 'provider', evidence: [] },
  locations: {
    primaryCity: 'Annapolis Junction',
    primaryState: 'MD',
    remoteCapable: true,
    multiple: false,
    evidence: [],
  },
  clearance: { mode: 'obtainable', level: null, sponsorable: true, evidence: [] },
  education: {
    degreeRequired: 'none',
    degreeInProgressOk: false,
    field: null,
    evidence: [],
  },
  experience: {
    requiredYears: null,
    preferredYears: null,
    substitution: [],
    evidence: [],
  },
  skills: { required: [], preferred: [] },
  technologies: [],
  certifications: { required: [], preferred: [] },
  occupationalSeries: [],
  citizenship: { usCitizenRequired: false, evidence: [] },
  travel: { required: false, percent: null, evidence: [] },
  schedule: { classification: 'unknown', flags: [], evidence: [] },
  contingentConditions: {
    commissionBased: false,
    physicalRequirements: false,
    fieldInstallation: false,
    developmentFocused: false,
    professionalEngineering: false,
    contingentOnAward: false,
    evidence: [],
  },
});

export function seedUpgradeDatabase(databasePath: string): void {
  const database = openDatabase(databasePath);
  try {
    runMigrations(database);
    const sourceId = randomUUID();
    const timestamp = nowUtc();
    database
      .prepare(
        `INSERT INTO sources (
          id, employer, source_type, careers_url, enabled, connector,
          last_successful_run, last_failure, failure_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sourceId,
        'Upgrade Smoke Employer',
        'fixture',
        null,
        1,
        null,
        null,
        null,
        0,
        timestamp,
        timestamp,
      );
    const repository = new JobRepository(database);
    const staleJob = upgradeSmokeJob({
      fingerprint: UPGRADE_SMOKE_STALE_FINGERPRINT,
      externalId: 'stale-v1-upgrade-smoke-fixture',
      title: 'Systems Administrator',
      normalizedTitle: 'systems administrator',
      location: 'Annapolis Junction, Maryland',
      city: 'Annapolis Junction',
      state: 'MD',
      remoteType: 'remote',
      teleworkEligible: false,
      description:
        'Systems Administrator supporting a cleared government program.\n' +
        'Telework/Remote work currently not authorized for this position.\n' +
        'Active TS/SCI clearance with an active CI polygraph is required.',
      requirements: 'Active TS/SCI clearance with an active CI polygraph.',
    });
    repository.upsertObservation({
      job: staleJob,
      sourceId,
      rawData: { fixture: 'stale-v1-upgrade-smoke' },
    });
    database
      .prepare(
        `UPDATE jobs SET role_details_json = ?, score = 88, recommendation = 'Verified Match',
           score_explanation = 'Remote work matches the preference.',
           score_version = 'stale-1.0.15-score-version', remote_type = 'remote'
         WHERE id = ?`,
      )
      .run(STALE_V1_DOCUMENT, staleJob.id);
    const removedJob = upgradeSmokeJob({
      fingerprint: UPGRADE_SMOKE_REMOVED_FINGERPRINT,
      externalId: 'user-removed-upgrade-smoke-fixture',
      description: 'User removed this job before upgrading.',
    });
    repository.upsertObservation({
      job: removedJob,
      sourceId,
      rawData: { fixture: 'user-removed-upgrade-smoke' },
    });
    database
      .prepare(
        `UPDATE jobs SET active = 0, user_removed = 1,
           role_details_json = ?, score = 70, recommendation = 'Strong Match',
           score_explanation = 'Strong match before the upgrade.',
           score_version = 'stale-1.0.15-score-version', remote_type = 'remote'
         WHERE id = ?`,
      )
      .run(STALE_V1_DOCUMENT, removedJob.id);
  } finally {
    database.close();
  }
}

function upgradeSmokeJob(overrides: Partial<NormalizedJob>): NormalizedJob {
  const fallback = randomUUID().replace(/-/g, '');
  const timestamp = '2020-01-01T12:00:00.000Z';
  return {
    id: randomUUID(),
    fingerprint: fallback,
    externalId: null,
    title: 'Systems Administrator',
    normalizedTitle: 'systems administrator',
    company: 'Upgrade Smoke Company',
    normalizedCompany: 'upgrade smoke company',
    location: 'Annapolis Junction, Maryland',
    city: 'Annapolis Junction',
    state: 'MD',
    remoteType: 'unknown',
    employmentType: 'full-time',
    salaryMinimum: null,
    salaryMaximum: null,
    salaryText: null,
    description:
      'Systems Administrator supporting a cleared government program.',
    requirements: null,
    preferredQualifications: null,
    postingUrl: `https://jobs.example.com/upgrade-smoke/${fallback}`,
    sourceName: 'Upgrade smoke fixture',
    sourceType: 'desktop-smoke-upgrade',
    datePosted: timestamp,
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
    closingDatePrecision: null,
    providerLifecycleStatus: 'unknown',
    applicationUrls: [],
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    active: true,
    clearanceRequirement: null,
    sponsorshipAvailable: null,
    estimatedExperienceYears: null,
    seniorityLevel: 'unknown',
    score: null,
    recommendation: null,
    scoreExplanation: null,
    status: 'new',
    ...overrides,
  };
}

const databasePath = process.argv[2];
if (databasePath === undefined) {
  throw new Error('Seed upgrade database path argument is required');
}
seedUpgradeDatabase(databasePath);
