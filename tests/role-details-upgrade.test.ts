import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import { backfillRoleDetails } from '../src/db/backfill-role-details.js';
import type { JobDatabase } from '../src/db/database.js';
import { IntelligenceEngine } from '../src/intelligence/intelligenceEngine.js';
import { createScoreVersion } from '../src/intelligence/scoreIdentity.js';
import {
  ROLE_DETAILS_VERSION,
  roleDetailsSchema,
} from '../src/schemas/role-details.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { createJobFixture } from './helpers/job-fixture.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';

const PROFILE = loadCandidateProfile();
const CONFIG = loadScoringConfig();

const STALE_V1_DOCUMENT = JSON.stringify({
  version: 'role-details-v1',
  generatedAt: '2026-08-13T00:00:00.000Z',
  sourceTextHash: 'stale-v1-upgrade-fixture',
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

interface JobStateRow {
  id: string;
  role_details_json: string | null;
  score: number | null;
  recommendation: string | null;
  score_version: string | null;
  active: number;
  user_removed: number;
  remote_type: string;
  city: string | null;
  state: string | null;
}

function stateOf(database: JobDatabase, jobId: string): JobStateRow | undefined {
  return database
    .prepare<[string], JobStateRow>(
      `SELECT id, role_details_json, score, recommendation, score_version,
              active, user_removed, remote_type, city, state
         FROM jobs WHERE id = ?`,
    )
    .get(jobId);
}

describe('1.0.15 -> 1.0.16 upgrade reconciliation', () => {
  let database: JobDatabase;
  let repository: JobRepository;
  let sourceId: string;

  beforeEach(() => {
    database = createTestDatabase();
    repository = new JobRepository(database);
    sourceId = insertTestSource(database);
  });

  afterEach(() => database.close());

  let jobCounter = 0;

  function uniqueFingerprint(seed: number): string {
    return seed.toString(16).padStart(64, '0');
  }

  function insertStaleV1Fixture(): string {
    jobCounter += 1;
    const job = createJobFixture({
      fingerprint: uniqueFingerprint(jobCounter),
      externalId: `stale-v1-regression-fixture-${String(jobCounter)}`,
      postingUrl: `https://jobs.example.com/upgrade/stale/${String(jobCounter)}`,
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
      preferredQualifications: null,
    });
    repository.upsertObservation({
      job,
      sourceId,
      rawData: job,
    });
    database
      .prepare(
        `UPDATE jobs SET
           role_details_json = ?, score = 88, recommendation = 'Verified Match',
           score_explanation = 'Remote work matches the preference.',
           score_version = 'stale-1.0.15-score-version', remote_type = 'remote'
         WHERE id = ?`,
      )
      .run(STALE_V1_DOCUMENT, job.id);
    return job.id;
  }

  function insertCurrentV2Job(): string {
    jobCounter += 1;
    const job = createJobFixture({
      fingerprint: uniqueFingerprint(jobCounter),
      externalId: `current-v2-upgrade-fixture-${String(jobCounter)}`,
      postingUrl: `https://jobs.example.com/upgrade/current/${String(jobCounter)}`,
      description: 'Current interpretation retained.',
    });
    repository.upsertObservation({
      job,
      sourceId,
      rawData: job,
    });
    backfillRoleDetails(database, CONFIG);
    return job.id;
  }

  function insertUserRemovedV1Job(): string {
    jobCounter += 1;
    const job = createJobFixture({
      fingerprint: uniqueFingerprint(jobCounter),
      externalId: `user-removed-upgrade-fixture-${String(jobCounter)}`,
      postingUrl: `https://jobs.example.com/upgrade/removed/${String(jobCounter)}`,
      description: 'User removed this job before upgrading.',
    });
    repository.upsertObservation({
      job,
      sourceId,
      rawData: job,
    });
    database
      .prepare(
        `UPDATE jobs SET active = 0, user_removed = 1,
           role_details_json = ?, score = 70, recommendation = 'Strong Match',
           score_version = 'stale-1.0.15-score-version', remote_type = 'remote'
         WHERE id = ?`,
      )
      .run(STALE_V1_DOCUMENT, job.id);
    return job.id;
  }

  it('re-extracts stale v1 interpretations, invalidates old scores, and reruns scoring', () => {
    const currentJobId = insertCurrentV2Job();
    const staleJobId = insertStaleV1Fixture();
    const removedJobId = insertUserRemovedV1Job();

    const result = new IntelligenceEngine(database).reconcileStaleData(
      PROFILE,
      CONFIG,
    );

    // 1. Stale RoleDetails detected and re-extracted in a bounded pass; the
    //    already-current v2 row is skipped.
    expect(result.roleDetailsProcessed).toBeGreaterThanOrEqual(1);
    expect(result.roleDetailsUpdated).toBe(result.roleDetailsProcessed);

    // 2. Re-extracted to role-details-v2.
    const stale = stateOf(database, staleJobId);
    const staleParsed = roleDetailsSchema.parse(
      JSON.parse(stale!.role_details_json!) as unknown,
    );
    expect(staleParsed.version).toBe(ROLE_DETAILS_VERSION);
    expect(staleParsed.version).toBe('role-details-v2');

    // 3. Work arrangement is no longer remote.
    expect(staleParsed.workplace.arrangement).toBe('onsite');
    expect(staleParsed.workplace.source).toBe('description');

    // 4. State/location normalized from a full state name.
    expect(staleParsed.locations.primaryCity).toBe('Annapolis Junction');
    expect(staleParsed.locations.primaryState).toBe('MD');

    // 5. Active clearance recognized.
    expect(staleParsed.clearance.mode).toBe('active');
    expect(staleParsed.clearance.level).toMatch(/ts\/sci/i);

    // 6. Old persisted score/recommendation invalidated and replaced by a
    //    rerun of the normal scoring pipeline.
    expect(result.analysis).not.toBeNull();
    expect(result.analysis!.jobsAnalyzed).toBeGreaterThanOrEqual(1);
    expect(stale!.score).not.toBe(88);
    expect(stale!.recommendation).not.toBe('Verified Match');
    expect(stale!.score_version).toBe(createScoreVersion(PROFILE, CONFIG));

    // 8. The false-positive recommendation cannot survive: the active
    //    clearance requirement hard-blocks the default profile.
    expect(stale!.recommendation).toBe('Hard No');
    expect(stale!.score).toBe(0);

    // Current v2 rows are skipped by the bounded role-details pass.
    expect(result.roleDetailsProcessed).toBe(1);
    const current = stateOf(database, currentJobId);
    expect(
      roleDetailsSchema.parse(JSON.parse(current!.role_details_json!) as unknown)
        .version,
    ).toBe(ROLE_DETAILS_VERSION);

    // user_removed jobs are not resurrected or touched.
    const removed = stateOf(database, removedJobId);
    expect(removed?.active).toBe(0);
    expect(removed?.user_removed).toBe(1);
    expect(removed?.role_details_json).toContain('role-details-v1');
  });

  it('rerunning the reconciliation is idempotent', () => {
    const staleJobId = insertStaleV1Fixture();
    const first = new IntelligenceEngine(database).reconcileStaleData(
      PROFILE,
      CONFIG,
    );
    const second = new IntelligenceEngine(database).reconcileStaleData(
      PROFILE,
      CONFIG,
    );
    const final = stateOf(database, staleJobId);
    expect(first.analysis).not.toBeNull();
    expect(second.roleDetailsProcessed).toBe(0);
    expect(second.roleDetailsUpdated).toBe(0);
    expect(second.scoresInvalidated).toBe(0);
    expect(second.analysis).toBeNull();
    expect(final!.score_version).toBe(createScoreVersion(PROFILE, CONFIG));
  });

  it('bounds the role-details pass per startup and invalidates scores of still-stale rows', () => {
    const firstId = insertStaleV1Fixture();
    const secondId = insertStaleV1Fixture();
    const result = new IntelligenceEngine(database).reconcileStaleData(
      PROFILE,
      CONFIG,
      1,
    );

    expect(result.roleDetailsProcessed).toBe(1);
    expect(result.scoresInvalidated).toBe(1);

    const first = stateOf(database, firstId);
    const second = stateOf(database, secondId);
    expect(
      roleDetailsSchema.parse(JSON.parse(first!.role_details_json!) as unknown)
        .version,
    ).toBe('role-details-v2');
    expect(
      roleDetailsSchema.parse(JSON.parse(second!.role_details_json!) as unknown)
        .version,
    ).toBe('role-details-v2');
    expect(first!.score_version).toBe(createScoreVersion(PROFILE, CONFIG));
    expect(second!.score_version).toBe(createScoreVersion(PROFILE, CONFIG));
  });
});
