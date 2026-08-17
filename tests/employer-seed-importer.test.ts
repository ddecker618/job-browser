import { afterEach, describe, expect, it } from 'vitest';

import { createTestDatabase } from './helpers/test-database.js';
import { seedEmployerRegistry } from '../src/db/seeds/employerRegistry.js';
import { EmployerSeedImporter } from '../src/discovery/employerSeedImporter.js';
import type { EmployerManifestRow } from '../src/models/employer-manifest.js';
import { EMPLOYER_MANIFEST_VERSION } from '../src/models/employer-manifest.js';
import { EmployerRepository } from '../src/repositories/employerRepository.js';
import { SourceRepository } from '../src/repositories/source-repository.js';
import { validateEmployerManifest } from '../src/schemas/employer-manifest.js';
import type { JobDatabase } from '../src/db/database.js';

const databases: JobDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function testDatabase(): JobDatabase {
  const database = createTestDatabase();
  databases.push(database);
  return database;
}

function row(
  overrides: Partial<EmployerManifestRow> = {},
): EmployerManifestRow {
  return {
    provenance: 'test-manifest',
    enabled: false,
    ...overrides,
  };
}

function importRows(
  database: JobDatabase,
  rows: EmployerManifestRow[],
  options: { dryRun?: boolean } = {},
) {
  const employers = new EmployerRepository(database);
  const sources = new SourceRepository(database);
  const importer = new EmployerSeedImporter(
    database,
    employers,
    sources,
    () => new Date('2026-08-16T12:00:00.000Z'),
    25,
  );
  const parsed = validateEmployerManifest({
    version: EMPLOYER_MANIFEST_VERSION,
    imports: rows,
  });
  return importer.importManifest(parsed, options);
}

describe('EmployerSeedImporter', () => {
  it('creates an employer, career site, source, and evidence', () => {
    const database = testDatabase();
    const employers = new EmployerRepository(database);
    const result = importRows(database, [
      row({
        employerName: 'Acme',
        careersUrl: 'https://boards.greenhouse.io/acme',
        enabled: true,
      }),
    ]);

    expect(result).toMatchObject({
      inputRows: 1,
      invalid: 0,
      employersCreated: 1,
      employersReused: 0,
      careerSitesCreated: 1,
      sourcesCreated: 1,
      aliasesAdded: 0,
      evidenceAdded: 2,
      enabled: 1,
      batches: 1,
      batchErrors: 0,
    });
    expect(result.rows[0]).toMatchObject({ status: 'created', index: 0 });

    const all = employers.listEmployersWithSites();
    expect(all).toHaveLength(1);
    expect(all[0]!.employer.name).toBe('Acme');
    expect(all[0]!.careerSites).toHaveLength(1);
    const site = all[0]!.careerSites[0]!;
    expect(site.url).toBe('https://boards.greenhouse.io/acme');
    expect(site.discovery.provenance).toBe('test-manifest');
    expect(site.discovery.state).toBe('source-created');
    expect(site.discovery.sourceId).not.toBeNull();
    expect(site.atsDetectedProvider).toBe('greenhouse');
    expect(site.supportState).toBe('supported');

    const sources = new SourceRepository(database).list();
    expect(sources).toHaveLength(1);
    expect(sources[0]!.providerId).toBe('greenhouse');
    expect(sources[0]!.enabled).toBe(true);

    const evidence = employers.listCareerSiteEvidence(site.id);
    expect(evidence.some((entry) => entry.kind === 'manifest-provenance')).toBe(
      true,
    );
    expect(
      evidence.some((entry) => entry.kind === 'manifest-submitted-url'),
    ).toBe(true);
  });

  it('is idempotent across repeated imports', () => {
    const database = testDatabase();
    const employers = new EmployerRepository(database);
    const manifest = [
      row({
        employerName: 'Acme',
        careersUrl: 'https://boards.greenhouse.io/acme',
        enabled: true,
      }),
    ];
    importRows(database, manifest);
    const second = importRows(database, manifest);

    expect(second).toMatchObject({
      inputRows: 1,
      employersCreated: 0,
      employersReused: 1,
      careerSitesCreated: 0,
      careerSitesReused: 1,
      sourcesCreated: 0,
      sourcesReused: 1,
      evidenceAdded: 0,
      enabled: 1,
      batchErrors: 0,
    });
    expect(second.rows[0]!.status).toBe('reused');

    const all = employers.listEmployersWithSites();
    expect(all).toHaveLength(1);
    expect(all[0]!.careerSites).toHaveLength(1);
    const site = all[0]!.careerSites[0]!;
    const evidence = employers.listCareerSiteEvidence(site.id);
    expect(evidence).toHaveLength(4);
    expect(evidence.some((entry) => entry.kind === 'manifest-provenance')).toBe(
      true,
    );
    expect(
      evidence.some((entry) => entry.kind === 'manifest-submitted-url'),
    ).toBe(true);
  });

  it('does not write anything in dry-run mode', () => {
    const database = testDatabase();
    const employers = new EmployerRepository(database);
    const result = importRows(
      database,
      [
        row({
          employerName: 'Acme',
          careersUrl: 'https://boards.greenhouse.io/acme',
          enabled: true,
        }),
      ],
      { dryRun: true },
    );

    expect(result.dryRun).toBe(true);
    expect(result).toMatchObject({
      employersCreated: 1,
      careerSitesCreated: 1,
      sourcesCreated: 1,
      enabled: 1,
      batchErrors: 0,
    });

    expect(employers.listEmployersWithSites()).toHaveLength(0);
    expect(new SourceRepository(database).list()).toHaveLength(0);
  });

  it('coerces a scheme-less careersUrl before storage and detection', () => {
    const database = testDatabase();
    const employers = new EmployerRepository(database);
    const result = importRows(database, [
      row({
        employerName: 'Acme',
        careersUrl: 'boards.greenhouse.io/acme',
      }),
    ]);

    expect(result).toMatchObject({ sourcesCreated: 1, batchErrors: 0 });
    const site = employers.listAllCareerSites()[0]!;
    expect(site.url).toBe('https://boards.greenhouse.io/acme');
    expect(new SourceRepository(database).list()[0]!.careersUrl).toBe(
      'https://boards.greenhouse.io/acme',
    );
  });

  it('flags an ambiguous employer when a domain maps to multiple employers', () => {
    const database = testDatabase();
    const employers = new EmployerRepository(database);
    employers.createEmployer({ name: 'Acme', websiteUrl: 'https://acme.com' });
    employers.createEmployer({
      name: 'Acme Technologies',
      websiteUrl: 'https://acme.com',
    });

    const result = importRows(database, [
      row({
        rootDomain: 'acme.com',
        careersUrl: 'https://boards.greenhouse.io/acme',
      }),
    ]);

    expect(result.ambiguousConflicts).toBe(1);
    expect(result.rows[0]!.status).toBe('ambiguous');
    expect(employers.listEmployers()).toHaveLength(2);
    expect(employers.listAllCareerSites()).toHaveLength(0);
  });

  it('reuses a career site across equivalent ATS board URLs', () => {
    const database = testDatabase();
    importRows(database, [
      row({
        employerName: 'Acme',
        careersUrl: 'https://boards.greenhouse.io/acme',
      }),
    ]);

    const second = importRows(database, [
      row({
        employerName: 'Acme',
        careersUrl: 'https://job-boards.greenhouse.io/acme',
      }),
    ]);

    expect(second).toMatchObject({
      employersCreated: 0,
      employersReused: 1,
      careerSitesCreated: 0,
      careerSitesReused: 1,
      sourcesCreated: 0,
      sourcesReused: 1,
      evidenceAdded: 1,
    });
    const employers = new EmployerRepository(database);
    expect(employers.listAllCareerSites()).toHaveLength(1);
    expect(new SourceRepository(database).list()).toHaveLength(1);
  });

  it('flags duplicate careersUrls within the same manifest', () => {
    const database = testDatabase();
    const result = importRows(database, [
      row({
        employerName: 'Acme',
        careersUrl: 'https://boards.greenhouse.io/acme',
      }),
      row({
        employerName: 'Acme',
        careersUrl: 'https://boards.greenhouse.io/acme',
      }),
    ]);

    expect(result.inBatchDuplicates).toBe(1);
    expect(result.employersCreated).toBe(1);
    expect(result.careerSitesCreated).toBe(1);
    expect(result.rows.map((entry) => entry.status)).toEqual([
      'created',
      'in-batch-duplicate',
    ]);
    expect(result.rows[1]!.reason).toMatch(/Duplicate careersUrl/);
  });

  it('creates an employer without a career site for an employer-only row', () => {
    const database = testDatabase();
    const employers = new EmployerRepository(database);
    const result = importRows(database, [
      row({ employerName: 'Acme', rootDomain: 'acme.com' }),
    ]);

    expect(result.employersCreated).toBe(1);
    expect(result.careerSitesCreated).toBe(0);
    expect(result.sourcesCreated).toBe(0);
    expect(result.rows[0]!.status).toBe('employer-only');
    const all = employers.listEmployersWithSites();
    expect(all[0]!.employer.websiteUrl).toBe('https://acme.com');
    expect(all[0]!.careerSites).toHaveLength(0);
  });

  it('creates a career site but no source for an unsupported ATS URL', () => {
    const database = testDatabase();
    const employers = new EmployerRepository(database);
    const result = importRows(database, [
      row({
        employerName: 'Umbrella',
        careersUrl: 'https://www.umbrellacorp.com/careers',
      }),
    ]);

    expect(result).toMatchObject({
      careerSitesCreated: 1,
      sourcesCreated: 0,
      unsupportedCandidates: 1,
    });
    expect(result.rows[0]!.status).toBe('unsupported');
    const site = employers.listAllCareerSites()[0]!;
    expect(site.discovery.state).toBe('unsupported');
    expect(site.discovery.sourceId).toBeNull();
  });

  it('rolls back an entire batch when a database error occurs', () => {
    const database = testDatabase();
    database.exec(`
      CREATE TRIGGER fail_on_marker
      BEFORE INSERT ON career_sites
      WHEN NEW.url LIKE '%failme%'
      BEGIN
        SELECT RAISE(ABORT, 'injected failure');
      END;
    `);
    const employers = new EmployerRepository(database);
    const result = importRows(database, [
      row({
        employerName: 'Alpha',
        careersUrl: 'https://boards.greenhouse.io/alpha',
      }),
      row({ employerName: 'Beta', careersUrl: 'https://jobs.lever.co/failme' }),
    ]);

    expect(result.batchErrors).toBe(1);
    expect(result.employersCreated).toBe(0);
    expect(result.careerSitesCreated).toBe(0);
    expect(result.sourcesCreated).toBe(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((entry) => entry.status === 'rejected')).toBe(
      true,
    );
    expect(result.rows[0]!.reason).toMatch(/rolled back/);
    expect(employers.listEmployers()).toHaveLength(0);
    expect(employers.listAllCareerSites()).toHaveLength(0);
    expect(new SourceRepository(database).list()).toHaveLength(0);

    const followUp = importRows(database, [
      row({
        employerName: 'Alpha',
        careersUrl: 'https://boards.greenhouse.io/alpha',
      }),
    ]);
    expect(followUp).toMatchObject({ employersCreated: 1, batchErrors: 0 });
    expect(employers.listEmployers()).toHaveLength(1);
  });

  it('resolves employers through domains and aliases', () => {
    const database = testDatabase();
    const employers = new EmployerRepository(database);
    const first = importRows(database, [
      row({
        employerName: 'Acme Inc',
        rootDomain: 'acme.com',
        careersUrl: 'https://boards.greenhouse.io/acme',
      }),
    ]);
    expect(first.aliasesAdded).toBe(0);

    const second = importRows(database, [
      row({
        employerName: 'Acme Corporation',
        rootDomain: 'acme.com',
        careersUrl: 'https://jobs.lever.co/acme',
      }),
    ]);
    expect(second).toMatchObject({
      employersCreated: 0,
      employersReused: 1,
      aliasesAdded: 1,
      careerSitesCreated: 1,
      sourcesCreated: 1,
    });

    const third = importRows(database, [
      row({
        employerName: 'Acme Corporation',
        careersUrl: 'https://boards.greenhouse.io/acme',
      }),
    ]);
    expect(third).toMatchObject({
      employersCreated: 0,
      employersReused: 1,
      aliasesAdded: 0,
      careerSitesCreated: 0,
      careerSitesReused: 1,
      sourcesReused: 1,
    });

    expect(
      employers
        .listAliases()
        .some((alias) => alias.employerId === employers.listEmployers()[0]!.id),
    ).toBe(true);
  });

  it('reuses a retired career site as-is without creating a source', () => {
    const database = testDatabase();
    const employers = new EmployerRepository(database);
    const employer = employers.createEmployer({
      name: 'Acme',
      websiteUrl: null,
    });
    const site = employers.createCareerSite(employer.id, {
      url: 'https://boards.greenhouse.io/acme',
    });
    employers.retireCareerSite(site.id, 'Retired for test');

    const result = importRows(database, [
      row({
        employerName: 'Acme',
        careersUrl: 'https://boards.greenhouse.io/acme',
      }),
    ]);

    expect(result).toMatchObject({
      employersReused: 1,
      careerSitesReused: 1,
      sourcesCreated: 0,
      skipped: 1,
    });
    expect(result.rows[0]!.status).toBe('reused');
    expect(employers.listAllCareerSites()[0]!.health.status).toBe('retired');
  });

  it('never enables an existing disabled source', () => {
    const database = testDatabase();
    const manifest = [
      row({
        employerName: 'Acme',
        careersUrl: 'https://boards.greenhouse.io/acme',
        enabled: false,
      }),
    ];
    const created = importRows(database, manifest);
    expect(created).toMatchObject({
      sourcesCreated: 1,
      enabled: 0,
      leftDisabled: 0,
    });

    const again = importRows(database, manifest);
    expect(again).toMatchObject({
      sourcesReused: 1,
      leftDisabled: 1,
      enabled: 0,
    });

    const reEnabled = importRows(database, [
      row({
        employerName: 'Acme',
        careersUrl: 'https://boards.greenhouse.io/acme',
        enabled: true,
      }),
    ]);
    expect(reEnabled).toMatchObject({
      sourcesReused: 1,
      leftDisabled: 1,
      enabled: 0,
    });
    expect(new SourceRepository(database).list()[0]!.enabled).toBe(false);
  });

  it('reuses curated starter career sites without duplicating them', () => {
    const database = testDatabase();
    seedEmployerRegistry(database);
    const employers = new EmployerRepository(database);
    const before = employers.listAllCareerSites().length;
    expect(before).toBeGreaterThan(0);

    const target = employers.listEmployersWithSites()[0]!;
    const result = importRows(database, [
      row({
        employerName: target.employer.name,
        careersUrl: target.careerSites[0]!.url,
      }),
    ]);

    expect(result).toMatchObject({
      employersCreated: 0,
      employersReused: 1,
      careerSitesCreated: 0,
      careerSitesReused: 1,
      batchErrors: 0,
    });
    expect(employers.listAllCareerSites()).toHaveLength(before);
  });
});
