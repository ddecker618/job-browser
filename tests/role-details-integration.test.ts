import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import { backfillRoleDetails } from '../src/db/backfill-role-details.js';
import type { JobDatabase } from '../src/db/database.js';
import { openDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { IntelligenceEngine } from '../src/intelligence/intelligenceEngine.js';
import { scoreJob } from '../src/intelligence/scoringEngine.js';
import { verifyPosting } from '../src/intelligence/verificationService.js';
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

const CONFIG = loadScoringConfig();

interface DetailsRow {
  role_details_json: string | null;
  description: string | null;
  requirements: string | null;
  preferred_qualifications: string | null;
}

describe('role details integration', () => {
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

  function insertJob(overrides: Partial<Parameters<typeof createJobFixture>[0]> = {}) {
    jobCounter += 1;
    const job = createJobFixture({
      externalId: `integration-${String(jobCounter)}`,
      postingUrl: `https://jobs.example.com/integration/${String(jobCounter)}`,
      ...overrides,
    });
    repository.upsertObservation({
      job,
      sourceId,
      rawData: job,
    });
    return job;
  }

  function detailsFor(jobId: string): DetailsRow | undefined {
    return database
      .prepare<[string], DetailsRow>(
        `SELECT role_details_json, description, requirements, preferred_qualifications
           FROM jobs WHERE id = ?`,
      )
      .get(jobId);
  }

  describe('ingestion persistence', () => {
    it('persists Role Details for a new Job through the analysis engine', () => {
      const job = insertJob({
        description: 'Monitor Splunk SIEM alerts. Active Top Secret clearance required.',
      });
      new IntelligenceEngine(database).analyze(
        loadCandidateProfile(),
        CONFIG,
      );
      const stored = detailsFor(job.id);
      expect(stored?.role_details_json).not.toBeNull();
      const parsed = roleDetailsSchema.parse(
        JSON.parse(stored!.role_details_json!) as unknown,
      );
      expect(parsed.version).toBe(ROLE_DETAILS_VERSION);
      expect(parsed.clearance.mode).toBe('active');
      expect(parsed.skills.required).toContain('Splunk');
      expect(parsed.education.degreeRequired).toBe('none');
    });

    it('persists evidence alongside derived facts', () => {
      const job = insertJob({
        description: 'Requires at least 5 years of experience and a bachelor degree.',
      });
      new IntelligenceEngine(database).analyze(
        loadCandidateProfile(),
        CONFIG,
      );
      const parsed = roleDetailsSchema.parse(
        JSON.parse(detailsFor(job.id)!.role_details_json!) as unknown,
      );
      expect(parsed.experience.requiredYears).toBe(5);
      expect(parsed.experience.evidence).toContain('Required experience: 5 years');
      expect(parsed.education.degreeRequired).toBe('bachelor');
    });

    it('leaves the original description unchanged by persistence', () => {
      const job = insertJob({ description: 'Original retained prose stays intact.' });
      new IntelligenceEngine(database).analyze(
        loadCandidateProfile(),
        CONFIG,
      );
      const stored = detailsFor(job.id);
      expect(stored?.description).toBe('Original retained prose stays intact.');
    });

    it('preserves Job identity through persistence', () => {
      const job = insertJob({ externalId: 'identity-check', title: 'Identity Analyst' });
      const before = database
        .prepare<[string], { id: string; external_id: string }>(
          `SELECT id, external_id FROM jobs WHERE id = ?`,
        )
        .get(job.id);
      new IntelligenceEngine(database).analyze(loadCandidateProfile(), CONFIG);
      const after = database
        .prepare<[string], { id: string; external_id: string }>(
          `SELECT id, external_id FROM jobs WHERE id = ?`,
        )
        .get(job.id);
      expect(after).toEqual(before);
    });

    it('routes USAJOBS-style retained requirements into Role Details', () => {
      const job = insertJob({
        description: 'Helpdesk role monitoring Windows Server.',
        requirements: 'CompTIA Security+ required. Linux administration required.',
      });
      new IntelligenceEngine(database).analyze(loadCandidateProfile(), CONFIG);
      const parsed = roleDetailsSchema.parse(
        JSON.parse(detailsFor(job.id)!.role_details_json!) as unknown,
      );
      expect(parsed.certifications.required).toContain('CompTIA Security+');
      expect(parsed.skills.required).toContain('Linux');
    });

    it('maps provider structured metadata into Role Details', () => {
      const job = insertJob({
        remoteType: 'hybrid',
        teleworkEligible: null,
        city: 'Chicago',
        state: 'IL',
        description: 'Join a growing team.',
      });
      new IntelligenceEngine(database).analyze(loadCandidateProfile(), CONFIG);
      const parsed = roleDetailsSchema.parse(
        JSON.parse(detailsFor(job.id)!.role_details_json!) as unknown,
      );
      expect(parsed.workplace.arrangement).toBe('hybrid');
      expect(parsed.workplace.source).toBe('provider');
      expect(parsed.locations.primaryCity).toBe('Chicago');
      expect(parsed.locations.primaryState).toBe('IL');
    });

    it('extracts the complete synthetic Systems Administrator fixture', () => {
      const job = insertJob({
        externalId: 'sysadmin-fixture',
        title: 'Systems Administrator',
        normalizedTitle: 'systems administrator',
        location: 'Annapolis Junction, MD',
        city: 'Annapolis Junction',
        state: 'MD',
        remoteType: 'onsite',
        teleworkEligible: false,
        description: `Systems Administrator supporting an intelligence community program.
Remote work is not authorized for this position.

REQUIRED QUALIFICATIONS:
- Active TS/SCI clearance with a CI polygraph is required.
- 8 years of systems administration experience.
- Bachelor's degree may be substituted for 4 years of experience.
- Master's degree may be substituted for 6 years of experience.
- Windows Server and Linux administration.
- Network administration and security administration.

PREFERRED QUALIFICATIONS:
- PowerShell, Bash, Python scripting.
- Virtualization and cloud administration.
- ITIL certification is preferred.
- CompTIA Security+ preferred.

This position is contingent upon program award.`,
        requirements:
          'Active TS/SCI clearance with CI polygraph required. 8 years systems administration. Windows Server, Linux, networking, security administration.',
        preferredQualifications:
          'PowerShell, Bash, Python, virtualization, cloud, ITIL, CompTIA Security+.',
      });
      new IntelligenceEngine(database).analyze(loadCandidateProfile(), CONFIG);
      const parsed = roleDetailsSchema.parse(
        JSON.parse(detailsFor(job.id)!.role_details_json!) as unknown,
      );

      expect(parsed.workplace.arrangement).toBe('onsite');
      expect(parsed.workplace.evidence.length).toBeGreaterThan(0);
      expect(parsed.locations.primaryCity).toBe('Annapolis Junction');
      expect(parsed.locations.primaryState).toBe('MD');

      expect(parsed.clearance.mode).toBe('active');
      expect(parsed.clearance.level).toMatch(/ts\/sci/i);
      expect(parsed.clearance.evidence.length).toBeGreaterThan(0);

      expect(parsed.experience.requiredYears).toBe(8);
      expect(parsed.experience.substitution.length).toBeGreaterThan(0);

      expect(parsed.skills.required).toContain('Windows Server');
      expect(parsed.skills.required).toContain('Linux');
      expect(parsed.skills.required).toContain('Networking');
      expect(parsed.skills.preferred).toContain('PowerShell');
      expect(parsed.skills.preferred).toContain('Python');
      expect(parsed.certifications.preferred).toContain('CompTIA Security+');

      expect(parsed.contingentConditions.contingentOnAward).toBe(true);
      expect(parsed.contingentConditions.evidence.length).toBeGreaterThan(0);
    });

    it('keeps the raw description intact alongside the derived projection', () => {
      const description =
        'Systems Administrator. Active TS/SCI with polygraph. On-site in Annapolis Junction, MD.';
      const job = insertJob({
        externalId: 'fixture-raw',
        description,
        requirements: null,
        preferredQualifications: null,
      });
      new IntelligenceEngine(database).analyze(loadCandidateProfile(), CONFIG);
      const stored = detailsFor(job.id);
      expect(stored?.description).toBe(description);
      expect(stored?.role_details_json).not.toBeNull();
    });
  });

  describe('backfill', () => {
    it('processes only uninterpreted active jobs', () => {
      const job = insertJob({ description: 'Monitor security events.' });
      const result = backfillRoleDetails(database, CONFIG);
      expect(result.processed).toBeGreaterThanOrEqual(1);
      expect(detailsFor(job.id)?.role_details_json).not.toBeNull();
    });

    it('skips rows already carrying the current version', () => {
      const job = insertJob({ description: 'Monitor security events.' });
      const first = backfillRoleDetails(database, CONFIG);
      const stored = detailsFor(job.id)!.role_details_json!;
      const second = backfillRoleDetails(database, CONFIG);
      expect(second.processed).toBe(0);
      expect(second.updated).toBe(0);
      expect(detailsFor(job.id)?.role_details_json).toBe(stored);
      expect(first.skippedCurrentVersion).toBeGreaterThanOrEqual(1);
    });

    it('reprocesses only stale-version rows on a second pass', () => {
      const currentJob = insertJob({ externalId: 'current-v', description: 'Monitor.' });
      backfillRoleDetails(database, CONFIG);
      const staleJob = insertJob({
        externalId: 'stale-v',
        description: 'Different prose for a stale row.',
      });
      database
        .prepare(
          `UPDATE jobs SET role_details_json = ? WHERE id = ?`,
        )
        .run(
          JSON.stringify({
            version: 'role-details-v0',
            generatedAt: '2026-01-01T00:00:00.000Z',
          }),
          staleJob.id,
        );
      const result = backfillRoleDetails(database, CONFIG);
      expect(result.processed).toBeGreaterThanOrEqual(1);
      const parsed = roleDetailsSchema.parse(
        JSON.parse(detailsFor(staleJob.id)!.role_details_json!) as unknown,
      );
      expect(parsed.version).toBe(ROLE_DETAILS_VERSION);
      expect(detailsFor(currentJob.id)?.role_details_json).toContain(
        ROLE_DETAILS_VERSION,
      );
    });

    it('respects a bounded batch size', () => {
      for (let index = 0; index < 5; index += 1) {
        insertJob({ externalId: `batch-${String(index)}`, description: 'Monitor.' });
      }
      const result = backfillRoleDetails(database, CONFIG, 3);
      expect(result.processed).toBeLessThanOrEqual(3);
    });

    it('never selects or resurrects user_removed jobs during backfill', () => {
      const job = insertJob({
        externalId: 'user-removed-job',
        description: 'User removed role description.',
      });
      database
        .prepare(`UPDATE jobs SET active = 0, user_removed = 1 WHERE id = ?`)
        .run(job.id);
      
      const result = backfillRoleDetails(database, CONFIG);
      expect(result.processed).toBe(0);
      expect(detailsFor(job.id)?.role_details_json).toBeNull();
      
      const activeState = database
        .prepare<[string], { active: number; user_removed: number }>(
          `SELECT active, user_removed FROM jobs WHERE id = ?`,
        )
        .get(job.id);
      expect(activeState?.active).toBe(0);
      expect(activeState?.user_removed).toBe(1);
    });

    it('preserves canonical job identity and original description across backfill', () => {
      const job = insertJob({
        externalId: 'identity-preserve',
        description: 'Original immutable job prose description.',
      });
      const before = database
        .prepare<[string], { id: string; external_id: string; description: string }>(
          `SELECT id, external_id, description FROM jobs WHERE id = ?`,
        )
        .get(job.id);

      backfillRoleDetails(database, CONFIG);

      const after = database
        .prepare<[string], { id: string; external_id: string; description: string }>(
          `SELECT id, external_id, description FROM jobs WHERE id = ?`,
        )
        .get(job.id);

      expect(after).toEqual(before);
    });

    it('is restart-safe: rows not yet processed remain pending', () => {
      for (let index = 0; index < 4; index += 1) {
        insertJob({ externalId: `restart-${String(index)}`, description: 'Monitor.' });
      }
      backfillRoleDetails(database, CONFIG, 2);
      const remaining = database
        .prepare<[], { count: number }>(
          `SELECT COUNT(*) AS count FROM jobs
            WHERE active = 1 AND status <> 'expired' AND role_details_json IS NULL`,
        )
        .get()!.count;
      expect(remaining).toBeGreaterThan(0);
      backfillRoleDetails(database, CONFIG, 2);
      expect(
        database
          .prepare<[], { count: number }>(
            `SELECT COUNT(*) AS count FROM jobs
              WHERE active = 1 AND status <> 'expired' AND role_details_json IS NULL`,
          )
          .get()!.count,
      ).toBe(0);
    });
  });

  describe('migration 028', () => {
    it('supports fresh databases with role_details_json', () => {
      insertJob({ description: 'Monitor security events.' });
      const row = database
        .prepare<[], { name: string }>(
          `SELECT name FROM pragma_table_info('jobs') WHERE name = 'role_details_json'`,
        )
        .get();
      expect(row?.name).toBe('role_details_json');
    });

    it('upgrades a populated database through the migration chain without data loss', () => {
      const migrated = openDatabase(':memory:');
      try {
        runMigrations(migrated);
        const source = insertTestSource(migrated);
        const job = createJobFixture({
          description: 'Upgrade keeps the description.',
          externalId: 'upgrade-job',
        });
        new JobRepository(migrated).upsertObservation({
          job,
          sourceId: source,
          rawData: job,
        });
        const row = migrated
          .prepare<[string], DetailsRow>(
            `SELECT role_details_json, description FROM jobs WHERE id = ?`,
          )
          .get(job.id);
        expect(row?.description).toBe('Upgrade keeps the description.');
      } finally {
        migrated.close();
      }
    });

    it('is idempotent when running migration runner repeatedly', () => {
      const firstRun = runMigrations(database);
      expect(firstRun.applied).toHaveLength(0);
      const secondRun = runMigrations(database);
      expect(secondRun.applied).toHaveLength(0);
    });
  });

  describe('eligibility regression', () => {
    const analyzedAt = '2026-07-18T12:00:00.000Z';

    function verifyAndScore(job: ReturnType<typeof createJobFixture>) {
      const text = [
        `${job.title} at ${job.company}`,
        job.location ? `Location: ${job.location}` : '',
        job.description ?? '',
        job.requirements ?? '',
        job.preferredQualifications ?? '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const verification = verifyPosting(text, null, null);
      return scoreJob(job, loadCandidateProfile(), CONFIG, analyzedAt, verification);
    }

    it('still hard-rejects a far onsite out-of-state role', () => {
      const job = createJobFixture({
        remoteType: 'onsite',
        city: 'San Francisco',
        state: 'CA',
        location: 'San Francisco, CA',
        description: 'Must work from the San Francisco office daily.',
      });
      const result = verifyAndScore(job);
      expect(result.eligibilityPassed).toBe(false);
      expect(result.recommendationStatus).toBe('Hard No');
    });

    it('still lets a confirmed remote role bypass distance', () => {
      const job = createJobFixture({
        remoteType: 'remote',
        location: 'Remote – United States',
        description: 'Fully remote role anywhere in the US.',
      });
      const result = verifyAndScore(job);
      expect(result.eligibilityPassed).toBe(true);
      expect(result.recommendationStatus).not.toBe('Hard No');
    });

    it('still blocks on an active clearance requirement when the profile lacks it', () => {
      const job = createJobFixture({
        description: 'Must hold an active Top Secret clearance.',
      });
      const result = verifyAndScore(job);
      expect(result.eligibilityPassed).toBe(false);
      expect(result.recommendationStatus).toBe('Hard No');
    });

    it('keeps ability-to-obtain clearance non-blocking', () => {
      const job = createJobFixture({
        description: 'Must be able to obtain a Secret clearance.',
      });
      const result = verifyAndScore(job);
      expect(result.eligibilityPassed).toBe(true);
    });

    it('keeps the 0854 professional requirement blocking', () => {
      const job = createJobFixture({
        description: 'Occupational series 0854. Professional engineering curriculum required.',
      });
      const result = verifyAndScore(job);
      expect(result.eligibilityPassed).toBe(false);
      expect(result.recommendationStatus).toBe('Hard No');
    });

    it('does not false-reject a generic software engineer wording', () => {
      const job = createJobFixture({
        title: 'Software Engineer',
        description: 'Build applications for our platform.',
      });
      const result = verifyAndScore(job);
      expect(result.eligibilityPassed).toBe(true);
    });

    it('ambiguous work arrangement with far-away location does not bypass commute eligibility', () => {
      const job = createJobFixture({
        remoteType: 'unknown',
        city: 'San Francisco',
        state: 'CA',
        location: 'San Francisco, CA',
        description: 'Role based in San Francisco office.',
      });
      const result = verifyAndScore(job);
      expect(result.eligibilityPassed).toBe(false);
      expect(result.recommendationStatus).toBe('Hard No');
    });

    it('eligible clearance mode stays non-blocking', () => {
      const job = createJobFixture({
        description: 'Candidate must be eligible for a Secret security clearance.',
      });
      const result = verifyAndScore(job);
      expect(result.eligibilityPassed).toBe(true);
    });

    it('user_removed jobs remain excluded from current eligibility and scoring output', () => {
      const job = createJobFixture({
        description: 'Standard role.',
      });
      database
        .prepare(`UPDATE jobs SET active = 0, user_removed = 1 WHERE id = ?`)
        .run(job.id);
      const rowCount = database
        .prepare<[], { count: number }>(
          `SELECT COUNT(*) AS count FROM jobs WHERE active = 1 AND user_removed = 0`,
        )
        .get()!.count;
      expect(rowCount).toBe(0);
    });
  });
});
