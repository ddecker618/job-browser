import { describe, expect, it } from 'vitest';

import {
  applyRepairs,
  planRepairs,
} from '../src/discovery/cli/repair-sources.js';
import { openDatabase, type JobDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { nowUtc } from '../src/utilities/timestamps.js';

describe('source repair planning', () => {
  it('plans an Intel workday site-slug correction', () => {
    const database = createDatabase();
    try {
      seedSource(database, {
        id: 'src-intel',
        employer: 'Intel',
        displayName: 'Intel (Workday)',
        providerId: 'workday',
        careersUrl: 'https://intel.wd1.myworkdayjobs.com/Intel_External',
        enabled: 1,
        healthStatus: 'failed',
        healthMessage: 'HTTP 404: Board not found or inactive',
        configuration: {
          origin: 'https://intel.wd1.myworkdayjobs.com',
          tenant: 'intel',
          site: 'Intel_External',
        },
      });

      const plan = planRepairs(database);

      const intel = plan.repairs.find(
        (repair) => repair.kind === 'workday-site-correction',
      );
      expect(intel?.sourceId).toBe('src-intel');
      expect(intel?.applies.configuration).toEqual({
        origin: 'https://intel.wd1.myworkdayjobs.com',
        tenant: 'intel',
        site: 'External',
      });
      expect(intel?.applies.careersUrl).toBe(
        'https://intel.wd1.myworkdayjobs.com/External',
      );
    } finally {
      database.close();
    }
  });

  it('plans an Etsy BambooHR to Workday migration', () => {
    const database = createDatabase();
    try {
      seedSource(database, {
        id: 'src-etsy',
        employer: 'Etsy',
        displayName: 'Etsy',
        providerId: 'bamboohr',
        careersUrl: 'https://etsy.bamboohr.com/careers',
        enabled: 0,
        healthStatus: 'failed',
        healthMessage:
          'Provider unavailable: BambooHR subdomain is unreachable or inactive',
        configuration: { companyDomain: 'etsy', company: 'Etsy' },
      });

      const plan = planRepairs(database);

      const etsy = plan.repairs.find(
        (repair) => repair.kind === 'ats-migration',
      );
      expect(etsy?.sourceId).toBe('src-etsy');
      expect(etsy?.applies.providerId).toBe('workday');
      expect(etsy?.applies.enabled).toBe(1);
      expect(etsy?.applies.configuration).toEqual({
        origin: 'https://etsy.wd5.myworkdayjobs.com',
        tenant: 'etsy',
        site: 'etsy_careers',
      });
    } finally {
      database.close();
    }
  });

  it('plans an Encyclis re-enable for a reachable iCIMS portal', () => {
    const database = createDatabase();
    try {
      seedSource(database, {
        id: 'src-encyclis',
        employer: 'encyclis',
        displayName: 'encyclis',
        providerId: 'icims',
        careersUrl: 'https://careers-encyclis.icims.com/jobs/intro',
        enabled: 0,
        healthStatus: 'failed',
        healthMessage:
          'Provider unavailable: iCIMS careers site is unreachable or inactive',
        configuration: {
          portalUrl: 'https://careers-encyclis.icims.com',
          company: 'encyclis',
          variant: 'icims_hosted_v1',
        },
      });

      const plan = planRepairs(database);

      const encyclis = plan.repairs.find(
        (repair) => repair.kind === 're-enable-healthy',
      );
      expect(encyclis?.sourceId).toBe('src-encyclis');
      expect(encyclis?.applies.enabled).toBe(1);
      expect(encyclis?.applies.healthStatus).toBe('never-run');
    } finally {
      database.close();
    }
  });
});

describe('applying source repairs', () => {
  it('applies all three repairs and records append-only career-site evidence', () => {
    const database = createDatabase();
    try {
      seedSource(database, {
        id: 'src-intel',
        employer: 'Intel',
        displayName: 'Intel (Workday)',
        providerId: 'workday',
        careersUrl: 'https://intel.wd1.myworkdayjobs.com/Intel_External',
        enabled: 1,
        healthStatus: 'failed',
        healthMessage: 'HTTP 404: Board not found or inactive',
        configuration: {
          origin: 'https://intel.wd1.myworkdayjobs.com',
          tenant: 'intel',
          site: 'Intel_External',
        },
      });
      seedSource(database, {
        id: 'src-etsy',
        employer: 'Etsy',
        displayName: 'Etsy',
        providerId: 'bamboohr',
        careersUrl: 'https://etsy.bamboohr.com/careers',
        enabled: 0,
        healthStatus: 'failed',
        healthMessage:
          'Provider unavailable: BambooHR subdomain is unreachable or inactive',
        configuration: { companyDomain: 'etsy', company: 'Etsy' },
      });
      seedSource(database, {
        id: 'src-encyclis',
        employer: 'encyclis',
        displayName: 'encyclis',
        providerId: 'icims',
        careersUrl: 'https://careers-encyclis.icims.com/jobs/intro',
        enabled: 0,
        healthStatus: 'failed',
        healthMessage:
          'Provider unavailable: iCIMS careers site is unreachable or inactive',
        configuration: {
          portalUrl: 'https://careers-encyclis.icims.com',
          company: 'encyclis',
          variant: 'icims_hosted_v1',
        },
      });
      seedEmployer(database, 'emp-intel', 'Intel');
      seedCareerSite(database, {
        id: 'site-intel-workday',
        employerId: 'emp-intel',
        url: 'https://intel.wd1.myworkdayjobs.com/Intel_External',
        sourceId: 'src-intel',
        healthStatus: 'unknown',
      });
      seedCareerSite(database, {
        id: 'site-intel-legacy',
        employerId: 'emp-intel',
        url: 'https://jobs.intel.com/',
        sourceId: null,
        healthStatus: 'warning',
      });

      const intelRepair = planRepairs(database).repairs.find(
        (repair) => repair.sourceId === 'src-intel',
      );
      expect(intelRepair).toBeDefined();
      const result = applyRepairs(database, [intelRepair!]);

      expect(result.applied.sort()).toEqual(['src-intel']);

      const intel = getSource(database, 'src-intel');
      expect(intel?.configuration_json).toBe(
        JSON.stringify({
          origin: 'https://intel.wd1.myworkdayjobs.com',
          tenant: 'intel',
          site: 'External',
        }),
      );
      expect(intel?.careers_url).toBe(
        'https://intel.wd1.myworkdayjobs.com/External',
      );
      expect(intel?.health_status).toBe('never-run');
      expect(intel?.failure_count).toBe(0);

      const corrected = database
        .prepare<
          [],
          { url: string; health_status: string }
        >("SELECT url, health_status FROM career_sites WHERE id = 'site-intel-workday'")
        .get();
      expect(corrected?.url).toBe(
        'https://intel.wd1.myworkdayjobs.com/External',
      );
      expect(corrected?.health_status).toBe('unknown');

      const legacy = database
        .prepare<
          [],
          { health_status: string }
        >("SELECT health_status FROM career_sites WHERE id = 'site-intel-legacy'")
        .get();
      expect(legacy?.health_status).toBe('retired');

      const history = database
        .prepare<
          [],
          { result_classification: string; requested_url: string }
        >('SELECT result_classification, requested_url FROM career_site_verification_history ORDER BY observed_at')
        .all();
      expect(history.length).toBe(2);
      expect(history[0]?.result_classification).toBe('ats-changed');
      expect(history[1]?.result_classification).toBe('ats-changed');

      expect(() =>
        database
          .prepare(
            `UPDATE career_site_verification_history SET reason = 'tampered' WHERE requested_url = ?`,
          )
          .run('https://intel.wd1.myworkdayjobs.com/Intel_External'),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it('does not re-plan repairs that are already in the desired state', () => {
    const database = createDatabase();
    try {
      seedSource(database, {
        id: 'src-intel',
        employer: 'Intel',
        displayName: 'Intel (Workday)',
        providerId: 'workday',
        careersUrl: 'https://intel.wd1.myworkdayjobs.com/External',
        enabled: 1,
        healthStatus: 'never-run',
        configuration: {
          origin: 'https://intel.wd1.myworkdayjobs.com',
          tenant: 'intel',
          site: 'External',
        },
      });
      seedSource(database, {
        id: 'src-etsy',
        employer: 'Etsy',
        displayName: 'Etsy',
        providerId: 'workday',
        careersUrl: 'https://etsy.wd5.myworkdayjobs.com/etsy_careers',
        enabled: 1,
        healthStatus: 'never-run',
        configuration: {
          origin: 'https://etsy.wd5.myworkdayjobs.com',
          tenant: 'etsy',
          site: 'etsy_careers',
        },
      });
      seedSource(database, {
        id: 'src-encyclis',
        employer: 'encyclis',
        displayName: 'encyclis',
        providerId: 'icims',
        careersUrl: 'https://careers-encyclis.icims.com/jobs/intro',
        enabled: 1,
        healthStatus: 'never-run',
        configuration: {
          portalUrl: 'https://careers-encyclis.icims.com',
          company: 'encyclis',
          variant: 'icims_hosted_v1',
        },
      });

      const plan = planRepairs(database);

      expect(plan.repairs).toHaveLength(0);
      expect(plan.skipped.length).toBe(2);
    } finally {
      database.close();
    }
  });
});

interface SeedSourceOptions {
  id: string;
  employer: string;
  displayName: string;
  providerId: string;
  careersUrl: string;
  enabled: 0 | 1;
  healthStatus: string;
  healthMessage?: string;
  configuration: Record<string, unknown>;
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
      ) VALUES (?, ?, 'provider', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?,
                 'valid', ?, ?)`,
    )
    .run(
      options.id,
      options.employer,
      options.careersUrl,
      options.enabled,
      options.providerId,
      options.healthStatus === 'failed' ? 3 : 0,
      timestamp,
      timestamp,
      options.displayName,
      options.providerId,
      JSON.stringify(options.configuration),
      JSON.stringify({ query: 'systems administrator', limit: 50 }),
      options.healthStatus,
      options.healthMessage ?? null,
    );
}

interface SeedCareerSiteOptions {
  id: string;
  employerId: string;
  url: string;
  sourceId: string | null;
  healthStatus: string;
  healthMessage?: string;
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
      ) VALUES (?, ?, ?, ?, 'verified', ?, ?, ?, 'source-created', 'employer-registry', ?, ?)`,
    )
    .run(
      options.id,
      options.employerId,
      options.url,
      options.url.toLowerCase(),
      timestamp,
      timestamp,
      options.sourceId,
      options.healthStatus,
      options.healthMessage ?? null,
    );
}

function getSource(
  database: JobDatabase,
  id: string,
): {
  configuration_json: string;
  careers_url: string;
  health_status: string;
  failure_count: number;
} | null {
  return (
    database
      .prepare<
        [string],
        {
          configuration_json: string;
          careers_url: string;
          health_status: string;
          failure_count: number;
        }
      >(
        'SELECT configuration_json, careers_url, health_status, failure_count FROM sources WHERE id = ?',
      )
      .get(id) ?? null
  );
}

function createDatabase(): JobDatabase {
  const database = openDatabase(':memory:');
  runMigrations(database);
  return database;
}
