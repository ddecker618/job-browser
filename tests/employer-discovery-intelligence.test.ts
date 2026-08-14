import { afterEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import { EmployerDiscoveryIntelligenceService } from '../src/discovery/employerDiscoveryIntelligenceService.js';
import { EmployerRepository } from '../src/repositories/employerRepository.js';
import { createTestDatabase } from './helpers/test-database.js';

const AS_OF = new Date('2026-08-12T12:00:00.000Z');
const databases: JobDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('EmployerDiscoveryIntelligenceService', () => {
  it('produces identical explainable decisions from identical evidence and time', () => {
    const fixture = setupSite({ confidence: 0.99 });
    seedRun(fixture.database, fixture.sourceId, 'succeeded', 3);
    seedJob(fixture.database, fixture.sourceId, '2026-08-12T00:00:00.000Z');
    const service = new EmployerDiscoveryIntelligenceService(
      fixture.database,
      () => AS_OF,
    );

    expect(service.summary()).toEqual(service.summary());
    expect(service.decision(fixture.siteId)).toMatchObject({
      policyVersion: 'employer-discovery-intelligence-v1',
      schedulingClass: 'high-priority',
      cadenceHours: 6,
      activity: { known: true, jobsFirstSeen: 1, activeJobs: 1 },
    });
  });

  it('uses supported confidence as an explicit priority component', () => {
    const high = setupSite({ confidence: 0.95 });
    const lowEmployer = high.repository.createEmployer({
      name: 'Beta',
      websiteUrl: null,
    });
    const low = high.repository.createCareerSite(lowEmployer.id, {
      url: 'https://boards.greenhouse.io/beta',
    });
    high.repository.verifyCareerSite(low.id);
    high.database
      .prepare('UPDATE career_sites SET ats_confidence = ? WHERE id = ?')
      .run(0.4, low.id);

    const decisions = new EmployerDiscoveryIntelligenceService(
      high.database,
      () => AS_OF,
    ).summary().sites;
    expect(
      decisions.find((site) => site.careerSiteId === high.siteId)!.priority,
    ).toBeGreaterThan(
      decisions.find((site) => site.careerSiteId === low.id)!.priority,
    );
  });

  it('lets health, backoff, retirement, and credentials override high confidence', () => {
    const fixture = setupSite({ confidence: 1 });
    fixture.database
      .prepare(
        `UPDATE career_sites SET health_status = 'broken',
           next_discovery_attempt_at = '2026-08-13T12:00:00.000Z'
         WHERE id = ?`,
      )
      .run(fixture.siteId);
    expect(decisionFor(fixture)).toMatchObject({
      eligible: false,
      executable: false,
    });

    fixture.repository.retireCareerSite(fixture.siteId);
    expect(decisionFor(fixture)).toMatchObject({
      schedulingClass: 'retired',
      eligible: false,
    });

    const credentials = setupSite({ confidence: 1, credentialsRequired: true });
    expect(decisionFor(credentials)).toMatchObject({
      schedulingClass: 'credential-required',
      executable: false,
    });
  });

  it('gives active sites a six-hour cadence and stable inactive sites 72 hours', () => {
    const fixture = setupSite({ confidence: 0.95 });
    seedRun(fixture.database, fixture.sourceId, 'succeeded', 2);
    seedJob(fixture.database, fixture.sourceId, '2026-08-12T01:00:00.000Z');
    expect(decisionFor(fixture)).toMatchObject({
      schedulingClass: 'high-priority',
      cadenceHours: 6,
    });

    fixture.database.prepare('DELETE FROM job_sources').run();
    fixture.database.prepare('DELETE FROM jobs').run();
    expect(decisionFor(fixture)).toMatchObject({
      schedulingClass: 'stable',
      cadenceHours: 72,
      activity: { known: true, activeJobs: 0, jobsFirstSeen: 0 },
    });
  });

  it('does not count inactive memberships as active or new employer activity', () => {
    const fixture = setupSite({ confidence: 0.95 });
    seedRun(fixture.database, fixture.sourceId, 'succeeded', 1);
    seedJob(fixture.database, fixture.sourceId, '2026-08-12T01:00:00.000Z');
    fixture.database
      .prepare(
        `UPDATE job_sources SET active = 0,
           lifecycle_reason = 'closing-date-expired' WHERE source_id = ?`,
      )
      .run(fixture.sourceId);
    expect(decisionFor(fixture).activity).toMatchObject({
      known: true,
      activeJobs: 0,
      jobsFirstSeen: 0,
    });
  });

  it('does not count user-removed jobs as active or new employer activity', () => {
    const fixture = setupSite({ confidence: 0.95 });
    seedRun(fixture.database, fixture.sourceId, 'succeeded', 1);
    seedJob(fixture.database, fixture.sourceId, '2026-08-12T01:00:00.000Z');
    fixture.database
      .prepare('UPDATE jobs SET user_removed = 1, active = 0 WHERE source_name = ?')
      .run('Greenhouse');
    expect(decisionFor(fixture).activity).toMatchObject({
      known: true,
      activeJobs: 0,
      jobsFirstSeen: 0,
    });
  });

  it('changes scheduling deterministically after transient recovery', () => {
    const fixture = setupSite({ confidence: 0.95 });
    fixture.database
      .prepare(
        `UPDATE career_sites SET health_status = 'warning', health_failure_count = 2
         WHERE id = ?`,
      )
      .run(fixture.siteId);
    expect(decisionFor(fixture)).toMatchObject({ schedulingClass: 'degraded' });
    fixture.database
      .prepare(
        `UPDATE career_sites SET health_status = 'healthy', health_failure_count = 0
         WHERE id = ?`,
      )
      .run(fixture.siteId);
    expect(decisionFor(fixture)).toMatchObject({ schedulingClass: 'normal' });
  });

  it('distinguishes valid zero-result success, failure, interruption, and unknown activity', () => {
    const fixture = setupSite({ confidence: 0.95 });
    seedRun(fixture.database, fixture.sourceId, 'succeeded', 0);
    seedRun(
      fixture.database,
      fixture.sourceId,
      'failed',
      0,
      '2026-08-11T00:00:00.000Z',
    );
    seedRun(
      fixture.database,
      fixture.sourceId,
      'interrupted',
      0,
      '2026-08-10T00:00:00.000Z',
    );
    const summary = new EmployerDiscoveryIntelligenceService(
      fixture.database,
      () => AS_OF,
    ).summary();
    expect(summary.providers[0]).toMatchObject({
      discoverySuccesses: 1,
      discoveryFailures: 1,
      interruptedRuns: 1,
      zeroResultSuccessfulRuns: 1,
      recentSuccessRate: 0.5,
    });
    expect(summary.sites[0]!.activity).toMatchObject({
      known: true,
      zeroResultSuccessfulRuns: 1,
    });

    const unknown = setupSite({ confidence: 0.95, linkSource: false });
    expect(decisionFor(unknown).activity).toMatchObject({
      known: false,
      activeJobs: null,
      jobsFirstSeen: null,
    });
  });

  it('uses a half-open activity window and bounds eligible batches', () => {
    const fixture = setupSite({ confidence: 0.95 });
    seedRun(fixture.database, fixture.sourceId, 'succeeded', 1);
    seedJob(
      fixture.database,
      fixture.sourceId,
      '2026-07-13T12:00:00.000Z',
      'start',
    );
    seedJob(
      fixture.database,
      fixture.sourceId,
      '2026-08-12T12:00:00.000Z',
      'end',
    );
    expect(decisionFor(fixture).activity.jobsFirstSeen).toBe(1);
    expect(
      new EmployerDiscoveryIntelligenceService(
        fixture.database,
        () => AS_OF,
      ).eligibleSiteIds(25).length,
    ).toBeLessThanOrEqual(25);
    expect(() =>
      new EmployerDiscoveryIntelligenceService(
        fixture.database,
      ).eligibleSiteIds(26),
    ).toThrow(RangeError);
  });

  it('reports unsupported, credential-required, and successful mapping outcomes', () => {
    const fixture = setupSite({ confidence: 0.95 });
    fixture.database
      .prepare(
        `INSERT INTO career_site_discovery_attempts
         (id, career_site_id, provenance, result, provider_id, source_id, detail,
          attempted_at, next_eligible_at)
         VALUES
         ('mapped', ?, 'fixture', 'source-created', 'greenhouse', ?, 'mapped', ?, NULL),
         ('credentials', ?, 'fixture', 'skipped', 'greenhouse', ?, 'credentials', ?, NULL),
         ('unsupported', ?, 'fixture', 'unsupported', NULL, NULL, 'unsupported', ?, NULL)`,
      )
      .run(
        fixture.siteId,
        fixture.sourceId,
        '2026-08-12T00:00:00.000Z',
        fixture.siteId,
        fixture.sourceId,
        '2026-08-12T01:00:00.000Z',
        fixture.siteId,
        '2026-08-12T02:00:00.000Z',
      );
    const providers = new EmployerDiscoveryIntelligenceService(
      fixture.database,
      () => AS_OF,
    ).summary().providers;
    expect(
      providers.find((provider) => provider.providerId === 'greenhouse'),
    ).toMatchObject({
      successfulValidations: 2,
      successfulSourceMappings: 1,
      credentialRequiredOutcomes: 1,
    });
    expect(
      providers.find((provider) => provider.providerId === 'unknown'),
    ).toMatchObject({
      unsupportedOutcomes: 1,
    });
  });

  it('keeps full-registry totals while bounding presentation arrays', () => {
    const fixture = setupSite({ confidence: 0.95, linkSource: false });
    const employer = fixture.repository.getEmployer(
      fixture.repository.getCareerSite(fixture.siteId)!.employerId,
    )!;
    for (let index = 0; index < 105; index += 1) {
      const site = fixture.repository.createCareerSite(employer.id, {
        url: `https://boards.greenhouse.io/acme-${String(index)}`,
      });
      fixture.repository.verifyCareerSite(site.id);
    }
    const summary = new EmployerDiscoveryIntelligenceService(
      fixture.database,
      () => AS_OF,
    ).summary();
    expect(summary.totals.careerSites).toBe(106);
    expect(summary.sites).toHaveLength(100);
    expect(
      Object.values(summary.sitesBySchedulingClass).reduce(
        (sum, value) => sum + value,
        0,
      ),
    ).toBe(106);
  });

  it('does not let unrelated run volume change a site decision', () => {
    const fixture = setupSite({ confidence: 0.95 });
    seedRun(fixture.database, fixture.sourceId, 'succeeded', 0);
    const service = new EmployerDiscoveryIntelligenceService(
      fixture.database,
      () => AS_OF,
    );
    const before = service.decision(fixture.siteId);
    for (let index = 0; index < 2_005; index += 1) {
      fixture.database
        .prepare(
          `INSERT INTO runs (id, source_id, status, started_at, completed_at,
           jobs_discovered, jobs_inserted, jobs_updated, duplicates_found,
           created_at, provider_id)
           VALUES (?, NULL, 'succeeded', ?, ?, 0, 0, 0, 0, ?, 'other')`,
        )
        .run(
          `unrelated-${String(index)}`,
          '2026-08-12T01:00:00.000Z',
          '2026-08-12T01:00:00.000Z',
          '2026-08-12T01:00:00.000Z',
        );
    }
    const after = service.decision(fixture.siteId);
    expect(after).toMatchObject({
      schedulingClass: before?.schedulingClass,
      cadenceHours: before?.cadenceHours,
      activity: { known: true, zeroResultSuccessfulRuns: 1 },
    });
  });
});

function setupSite(options: {
  confidence: number;
  credentialsRequired?: boolean;
  linkSource?: boolean;
}) {
  const database = createTestDatabase();
  databases.push(database);
  const repository = new EmployerRepository(database);
  const employer = repository.createEmployer({
    name: 'Acme',
    websiteUrl: null,
  });
  const site = repository.createCareerSite(employer.id, {
    url: 'https://boards.greenhouse.io/acme',
  });
  repository.verifyCareerSite(site.id);
  const sourceId = `source-${String(databases.length)}`;
  database
    .prepare(
      `INSERT INTO sources (id, employer, source_type, careers_url, enabled, connector,
        failure_count, created_at, updated_at, display_name, provider_id,
        configuration_json, search_criteria_json, configuration_status, health_status)
       VALUES (?, 'Acme', 'provider', ?, 1, 'greenhouse', 0, ?, ?, 'Acme',
        'greenhouse', '{}', '{}', ?, 'healthy')`,
    )
    .run(
      sourceId,
      site.url,
      '2026-07-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
      options.credentialsRequired ? 'credentials-required' : 'valid',
    );
  database
    .prepare(
      `INSERT OR REPLACE INTO provider_metadata
       (id, provider_id, provider_name, enabled, configuration_json,
        last_successful_run, last_failure, failure_count, created_at, updated_at,
        provider_type, capabilities_json, credential_requirement)
       VALUES ('metadata:greenhouse', 'greenhouse', 'Greenhouse', 1, NULL, NULL,
        NULL, 0, ?, ?, 'ats', '{}', NULL)`,
    )
    .run('2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
  database
    .prepare(
      `UPDATE career_sites SET ats_confidence = ?, health_status = 'healthy',
       source_id = ? WHERE id = ?`,
    )
    .run(
      options.confidence,
      options.linkSource === false ? null : sourceId,
      site.id,
    );
  return { database, repository, siteId: site.id, sourceId };
}

function decisionFor(fixture: ReturnType<typeof setupSite>) {
  return new EmployerDiscoveryIntelligenceService(
    fixture.database,
    () => AS_OF,
  ).decision(fixture.siteId)!;
}

function seedRun(
  database: JobDatabase,
  sourceId: string,
  status: 'succeeded' | 'failed' | 'interrupted',
  jobsDiscovered: number,
  startedAt = '2026-08-12T00:00:00.000Z',
) {
  database
    .prepare(
      `INSERT INTO runs (id, source_id, status, started_at, completed_at,
       jobs_discovered, jobs_inserted, jobs_updated, duplicates_found, created_at,
       provider_id) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 'greenhouse')`,
    )
    .run(
      `${status}-${startedAt}`,
      sourceId,
      status,
      startedAt,
      startedAt,
      jobsDiscovered,
      startedAt,
    );
}

function seedJob(
  database: JobDatabase,
  sourceId: string,
  firstSeenAt: string,
  suffix = 'job',
) {
  const id = `job-${suffix}`;
  database
    .prepare(
      `INSERT INTO jobs (id, title, normalized_title, company, normalized_company,
       remote_type, employment_type, source_name, source_type, first_seen_at,
       last_seen_at, active, seniority_level, status, created_at, updated_at)
       VALUES (?, 'Engineer', 'engineer', 'Acme', 'acme', 'unknown', 'unknown',
       'Greenhouse', 'ats', ?, ?, 1, 'unknown', 'new', ?, ?)`,
    )
    .run(id, firstSeenAt, firstSeenAt, firstSeenAt, firstSeenAt);
  database
    .prepare(
      `INSERT INTO job_sources (id, job_id, source_id, first_seen_at, last_seen_at,
       provider_id, active) VALUES (?, ?, ?, ?, ?, 'greenhouse', 1)`,
    )
    .run(`js-${suffix}`, id, sourceId, firstSeenAt, firstSeenAt);
}
