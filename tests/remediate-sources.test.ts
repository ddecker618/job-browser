import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  applyRemediationActions,
  createVerifiedBackup,
  planRemediation,
  PROTECTED_PROVIDER_IDS,
} from '../src/discovery/cli/remediate-sources.js';
import { openDatabase, type JobDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { nowUtc } from '../src/utilities/timestamps.js';

describe('source remediation planning', () => {
  it('plans a chronic categorically-unreachable source for disable', () => {
    const database = createDatabase();
    try {
      seedSource(database, {
        id: 'src-etsy',
        employer: 'Etsy',
        providerId: 'bamboohr',
        healthStatus: 'failed',
        healthMessage:
          'Provider unavailable: BambooHR subdomain is unreachable or inactive',
        configuration: { companyDomain: 'etsy', company: 'Etsy' },
      });
      seedRuns(database, 'src-etsy', [
        'succeeded',
        'failed',
        'failed',
        'failed',
      ]);

      const plan = planRemediation(database);

      expect(plan.actions).toHaveLength(1);
      const action = plan.actions[0];
      expect(action?.sourceId).toBe('src-etsy');
      expect(action?.rules).toContain('chronic-categorical-failure');
      expect(action?.reason).toContain('chronic-categorical-failure');
    } finally {
      database.close();
    }
  });

  it('does not plan a disable for fewer than three consecutive failures', () => {
    const database = createDatabase();
    try {
      seedSource(database, {
        id: 'src-flaky',
        employer: 'Flaky Board',
        providerId: 'bamboohr',
        healthStatus: 'failed',
        healthMessage:
          'Provider unavailable: BambooHR subdomain is unreachable or inactive',
        configuration: { companyDomain: 'flaky' },
      });
      seedRuns(database, 'src-flaky', ['succeeded', 'failed', 'failed']);

      const plan = planRemediation(database);

      expect(plan.actions).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it('does not plan a disable for transient DNS-style failures', () => {
    const database = createDatabase();
    try {
      seedSource(database, {
        id: 'src-dns',
        employer: 'Dns Flap',
        providerId: 'icims',
        healthStatus: 'failed',
        healthMessage: 'Provider unavailable: DNS resolution failed for host',
        configuration: { portalUrl: 'https://careers.example.com' },
      });
      seedRuns(database, 'src-dns', ['failed', 'failed', 'failed', 'failed']);

      const plan = planRemediation(database);

      expect(plan.actions).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it('keeps protected browser and credential sources report-only even when they fail chronically', () => {
    const database = createDatabase();
    try {
      for (const [index, providerId] of [
        'wellfound',
        'ziprecruiter',
        'usajobs',
      ].entries()) {
        seedSource(database, {
          id: `src-protected-${String(index)}`,
          employer: `Protected ${providerId}`,
          providerId,
          healthStatus: 'failed',
          healthMessage:
            'Provider unavailable: target is unreachable or inactive',
          configuration: {},
        });
        seedRuns(database, `src-protected-${String(index)}`, [
          'failed',
          'failed',
          'failed',
          'failed',
        ]);
      }

      const plan = planRemediation(database);

      expect(plan.actions).toHaveLength(0);
      const protectedSubjects = plan.reportOnly.filter(
        (item) => item.kind === 'protected-source',
      );
      expect(protectedSubjects).toHaveLength(3);
      for (const item of protectedSubjects) {
        expect(item.recommendation).toContain('Remains enabled');
      }
    } finally {
      database.close();
    }
  });

  it('consolidates duplicate workday tenants preferring the career-site-linked source', () => {
    const database = createDatabase();
    try {
      seedEmployer(database, 'emp-cs', 'CrowdStrike');
      seedSource(database, {
        id: 'src-cs-workday',
        employer: 'CrowdStrike',
        providerId: 'workday',
        configuration: {
          origin: 'https://crowdstrike.wd5.myworkdayjobs.com',
          tenant: 'crowdstrike',
          site: 'crowdstrikecareers',
        },
      });
      seedSource(database, {
        id: 'src-cs-hardcoded',
        employer: 'crowdstrike',
        providerId: 'crowdstrike',
        configuration: {},
      });
      seedCareerSite(database, {
        id: 'site-cs',
        employerId: 'emp-cs',
        url: 'https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers',
        sourceId: 'src-cs-workday',
      });

      const plan = planRemediation(database);

      expect(plan.actions).toHaveLength(1);
      const action = plan.actions[0];
      expect(action?.sourceId).toBe('src-cs-hardcoded');
      expect(action?.rules).toContain('duplicate-ats-tenant');
      expect(action?.reason).toContain('src-cs-workday');
    } finally {
      database.close();
    }
  });

  it('consolidates duplicate hardcoded cisco sources sharing one tenant', () => {
    const database = createDatabase();
    try {
      seedSource(database, {
        id: 'src-cisco-a',
        employer: 'Cisco',
        providerId: 'cisco',
        configuration: { company: 'cisco' },
      });
      seedSource(database, {
        id: 'src-cisco-b',
        employer: 'cisco',
        providerId: 'cisco',
        configuration: { company: 'cisco' },
      });
      seedCareerSiteForSourceOnly(database, 'src-cisco-a');

      const plan = planRemediation(database);

      expect(plan.actions).toHaveLength(1);
      expect(plan.actions[0]?.sourceId).toBe('src-cisco-b');
      expect(plan.actions[0]?.reason).toContain('src-cisco-a');
    } finally {
      database.close();
    }
  });

  it('consolidates duplicate icims portals by normalized URL when tenant identity differs', () => {
    const database = createDatabase();
    try {
      seedSource(database, {
        id: 'src-costco-canonical',
        employer: 'Costco',
        providerId: 'icims',
        configuration: {
          portalUrl: 'https://careers.costco.com',
          company: 'Costco',
        },
      });
      seedSource(database, {
        id: 'src-costco-demo',
        employer: 'icims',
        providerId: 'icims',
        configuration: {
          portalUrl: 'https://careers.costco.com/',
          company: 'icims',
        },
      });
      for (let index = 0; index < 3; index += 1) {
        seedJobLink(database, 'job-costco-a', 'src-costco-canonical', index);
      }
      seedJobLink(database, 'job-costco-b', 'src-costco-demo', 0);

      const plan = planRemediation(database);

      expect(plan.actions).toHaveLength(1);
      expect(plan.actions[0]?.sourceId).toBe('src-costco-demo');
    } finally {
      database.close();
    }
  });

  it('disables enabled sources linked to retired career sites', () => {
    const database = createDatabase();
    try {
      seedEmployer(database, 'emp-hooli', 'Hooli');
      seedSource(database, {
        id: 'src-hooli',
        employer: 'Hooli',
        providerId: 'smartrecruiters',
        configuration: { companyIdentifier: 'hooli' },
      });
      seedCareerSite(database, {
        id: 'site-hooli',
        employerId: 'emp-hooli',
        url: 'https://careers.smartrecruiters.com/hooli',
        sourceId: 'src-hooli',
        healthStatus: 'retired',
        healthMessage: 'Retired legacy fictional starter fixture',
      });

      const plan = planRemediation(database);

      expect(plan.actions).toHaveLength(1);
      const action = plan.actions[0];
      expect(action?.sourceId).toBe('src-hooli');
      expect(action?.rules).toContain('retired-career-site');
      expect(action?.reason).toContain('retired');
    } finally {
      database.close();
    }
  });

  it('reports broken career sites without enabled sources as notes', () => {
    const database = createDatabase();
    try {
      seedEmployer(database, 'emp-mongo', 'MongoDB');
      seedCareerSite(database, {
        id: 'site-mongo',
        employerId: 'emp-mongo',
        url: 'https://www.mongodb.com/company/careers/jobs',
        sourceId: null,
        healthStatus: 'broken',
        healthMessage: 'No supported ATS signals were found.',
      });

      const plan = planRemediation(database);

      expect(plan.actions).toHaveLength(0);
      const notes = plan.reportOnly.filter(
        (item) => item.kind === 'career-site-note',
      );
      expect(notes).toHaveLength(1);
      expect(notes[0]?.subject).toContain('mongodb.com');
    } finally {
      database.close();
    }
  });
});

describe('source remediation application', () => {
  it('disables planned sources without deleting any records', () => {
    const database = createDatabase();
    try {
      seedSource(database, {
        id: 'src-etsy',
        employer: 'Etsy',
        providerId: 'bamboohr',
        healthStatus: 'failed',
        healthMessage:
          'Provider unavailable: BambooHR subdomain is unreachable or inactive',
        configuration: { companyDomain: 'etsy' },
      });
      seedRuns(database, 'src-etsy', [
        'succeeded',
        'failed',
        'failed',
        'failed',
      ]);
      seedJobWithApplication(database, 'job-applied-1', 'src-etsy');

      const before = snapshotCounts(database);
      const plan = planRemediation(database);
      const result = applyRemediationActions(database, plan.actions);

      expect(result.applied).toHaveLength(1);
      expect(result.alreadyDisabled).toHaveLength(0);

      const row = database
        .prepare<
          [string],
          { enabled: number; health_message: string | null }
        >('SELECT enabled, health_message FROM sources WHERE id = ?')
        .get('src-etsy');
      expect(row?.enabled).toBe(0);
      expect(row?.health_message ?? '').toContain(
        'controlled discovery cleanup',
      );

      const after = snapshotCounts(database);
      expect(after).toEqual(before);
      expect(countApplications(database)).toBe(1);
    } finally {
      database.close();
    }
  });

  it('is idempotent: re-planning after apply produces no actions for disabled sources', () => {
    const database = createDatabase();
    try {
      seedSource(database, {
        id: 'src-encyclis',
        employer: 'encyclis',
        providerId: 'icims',
        healthStatus: 'failed',
        healthMessage:
          'Provider unavailable: iCIMS careers site is unreachable or inactive',
        configuration: {
          portalUrl: 'https://careers-encyclis.icims.com',
          variant: 'icims_hosted_v1',
        },
      });
      seedRuns(database, 'src-encyclis', [
        'succeeded',
        'failed',
        'failed',
        'failed',
      ]);
      const firstPlan = planRemediation(database);
      applyRemediationActions(database, firstPlan.actions);

      const secondPlan = planRemediation(database);

      expect(secondPlan.actions).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it('refuses to apply an action against a protected source', () => {
    const database = createDatabase();
    try {
      seedSource(database, {
        id: 'src-usajobs-guard',
        employer: 'USAJOBS',
        providerId: 'usajobs',
        configuration: {},
      });

      expect(() =>
        applyRemediationActions(database, [
          {
            sourceId: 'src-usajobs-guard',
            employer: 'USAJOBS',
            providerId: 'usajobs',
            rules: ['chronic-categorical-failure'],
            reason: 'test',
          },
        ]),
      ).toThrow(/protected/i);

      const row = database
        .prepare<
          [string],
          { enabled: number }
        >('SELECT enabled FROM sources WHERE id = ?')
        .get('src-usajobs-guard');
      expect(row?.enabled).toBe(1);
    } finally {
      database.close();
    }
  });

  it('exposes the user-mandated protected providers', () => {
    expect(PROTECTED_PROVIDER_IDS).toContain('wellfound');
    expect(PROTECTED_PROVIDER_IDS).toContain('ziprecruiter');
    expect(PROTECTED_PROVIDER_IDS).toContain('usajobs');
  });
});

describe('verified backup', () => {
  const temporaryDirectories: string[] = [];

  function fileDatabase(): { database: JobDatabase; directory: string } {
    const directory = mkdtempSync(join(tmpdir(), 'jb-remediate-'));
    temporaryDirectories.push(directory);
    const database = openDatabase(join(directory, 'live.sqlite'));
    runMigrations(database);
    return { database, directory };
  }

  afterAll(() => {
    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('creates a verified backup whose counts match the live database', async () => {
    const { database, directory } = fileDatabase();
    try {
      seedSource(database, {
        id: 'src-backup',
        employer: 'Backup Source',
        providerId: 'bamboohr',
        configuration: { companyDomain: 'backup' },
      });

      const backupPath = await createVerifiedBackup(
        database,
        join(directory, 'live.sqlite'),
      );

      expect(backupPath).toContain('backups');
      expect(backupPath).toContain('pre-source-remediation-');
    } finally {
      database.close();
    }
  });
});

function createDatabase(): JobDatabase {
  const database = openDatabase(':memory:');
  runMigrations(database);
  return database;
}

interface SeedSourceOptions {
  id: string;
  employer: string;
  providerId: string;
  configuration: Record<string, unknown>;
  healthStatus?: string;
  healthMessage?: string;
}

function seedSource(database: JobDatabase, options: SeedSourceOptions): void {
  const timestamp = nowUtc();
  database
    .prepare(
      `INSERT INTO sources (
        id, employer, source_type, careers_url, enabled, connector,
        last_successful_run, last_failure, failure_count, created_at, updated_at,
        display_name, provider_id, configuration_json, search_criteria_json,
        configuration_status, health_status, health_message
      ) VALUES (?, ?, 'provider', NULL, 1, ?, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, 'valid', ?, ?)`,
    )
    .run(
      options.id,
      options.employer,
      options.providerId,
      timestamp,
      timestamp,
      options.employer,
      options.providerId,
      JSON.stringify(options.configuration),
      JSON.stringify({ query: 'systems administrator', limit: 50 }),
      options.healthStatus ?? 'never-run',
      options.healthMessage ?? null,
    );
}

function seedRuns(
  database: JobDatabase,
  sourceId: string,
  statuses: string[],
): void {
  const base = Date.parse('2026-08-01T00:00:00.000Z');
  let index = 0;
  for (const status of statuses) {
    database
      .prepare(
        `INSERT INTO runs (id, source_id, status, started_at, completed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `run-${sourceId}-${String(index)}`,
        sourceId,
        status,
        new Date(base + index * 60_000).toISOString(),
        new Date(base + index * 60_000 + 30_000).toISOString(),
        nowUtc(),
      );
    index += 1;
  }
}

function seedEmployer(database: JobDatabase, id: string, name: string): void {
  const timestamp = nowUtc();
  database
    .prepare(
      `INSERT INTO employers (id, name, normalized_name, website_url, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    )
    .run(id, name, name.toLowerCase(), timestamp, timestamp);
}

interface SeedCareerSiteOptions {
  id: string;
  employerId: string;
  url: string;
  sourceId: string | null;
  healthStatus?: string;
  healthMessage?: string;
}

function seedCareerSite(
  database: JobDatabase,
  options: SeedCareerSiteOptions,
): void {
  const timestamp = nowUtc();
  database
    .prepare(
      `INSERT INTO career_sites (
        id, employer_id, url, normalized_url, verification_state,
        created_at, updated_at, source_id, discovery_state,
        discovery_provenance, health_status, health_message
      ) VALUES (?, ?, ?, ?, 'unverified', ?, ?, ?, 'ready', 'employer-registry', ?, ?)`,
    )
    .run(
      options.id,
      options.employerId,
      options.url,
      options.url.toLowerCase(),
      timestamp,
      timestamp,
      options.sourceId,
      options.healthStatus ?? 'unknown',
      options.healthMessage ?? null,
    );
}

function seedCareerSiteForSourceOnly(
  database: JobDatabase,
  sourceId: string,
): void {
  seedEmployer(database, `emp-${sourceId}`, `Employer ${sourceId}`);
  seedCareerSite(database, {
    id: `site-${sourceId}`,
    employerId: `emp-${sourceId}`,
    url: `https://example.com/${sourceId}`,
    sourceId,
    healthStatus: 'healthy',
  });
}

function seedJobLink(
  database: JobDatabase,
  jobPrefix: string,
  sourceId: string,
  index: number,
): void {
  const jobId = `${jobPrefix}-${String(index)}`;
  const timestamp = nowUtc();
  database
    .prepare(
      `INSERT INTO jobs (
        id, title, normalized_title, company, normalized_company,
        remote_type, employment_type, source_name, source_type,
        first_seen_at, last_seen_at, active, seniority_level, status,
        created_at, updated_at
      ) VALUES (
        ?, 'Engineer', 'engineer', 'Example', 'example',
        'unknown', 'full-time', 'Fixture', 'fixture',
        ?, ?, 1, 'mid', 'new',
        ?, ?
      )`,
    )
    .run(jobId, timestamp, timestamp, timestamp, timestamp);
  database
    .prepare(
      `INSERT INTO job_sources (id, job_id, source_id, external_id, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(`js-${jobId}`, jobId, sourceId, `ext-${jobId}`, timestamp, timestamp);
}

function seedJobWithApplication(
  database: JobDatabase,
  jobId: string,
  sourceId: string,
): void {
  const timestamp = nowUtc();
  database
    .prepare(
      `INSERT INTO jobs (
        id, title, normalized_title, company, normalized_company,
        remote_type, employment_type, source_name, source_type,
        first_seen_at, last_seen_at, active, seniority_level, status,
        created_at, updated_at
      ) VALUES (
        ?, 'Engineer', 'engineer', 'Example', 'example',
        'unknown', 'full-time', 'Fixture', 'fixture',
        ?, ?, 1, 'mid', 'new',
        ?, ?
      )`,
    )
    .run(jobId, timestamp, timestamp, timestamp, timestamp);
  database
    .prepare(
      `INSERT INTO job_sources (id, job_id, source_id, external_id, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(`js-${jobId}`, jobId, sourceId, `ext-${jobId}`, timestamp, timestamp);
  database
    .prepare(
      `INSERT INTO applications (id, job_id, status, applied_at, created_at, updated_at)
       VALUES (?, ?, 'applied', ?, ?, ?)`,
    )
    .run(`app-${jobId}`, jobId, timestamp, timestamp, timestamp);
}

function snapshotCounts(database: JobDatabase): Record<string, number> {
  const tables = [
    'sources',
    'runs',
    'jobs',
    'job_sources',
    'applications',
    'application_history',
    'career_sites',
    'employers',
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    counts[table] =
      database
        .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
        .get()?.n ?? -1;
  }
  return counts;
}

function countApplications(database: JobDatabase): number {
  return (
    database
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM applications')
      .get()?.n ?? 0
  );
}
