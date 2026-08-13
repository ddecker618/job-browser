import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type JobDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migration-runner.js';
import { seedEmployerRegistry } from '../src/db/seeds/employerRegistry.js';
import { EmployerRepository } from '../src/repositories/employerRepository.js';

const databases: JobDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createRepository(): EmployerRepository {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database);
  return new EmployerRepository(database);
}

describe('employer repository', () => {
  it('imports bounded provenance-bearing seeds idempotently without fuzzy merging', () => {
    const repository = createRepository();
    const seeds = [
      {
        name: 'Acme, Inc.',
        websiteUrl: null,
        careerSiteUrls: [
          'https://boards.greenhouse.io/acme',
          'https://boards.greenhouse.io/acme',
        ],
        provenance: 'approved-fixture',
      },
      {
        name: 'Acme Inc',
        websiteUrl: null,
        careerSiteUrls: ['https://jobs.lever.co/acme'],
        provenance: 'approved-fixture',
      },
      {
        name: 'Malformed',
        websiteUrl: null,
        careerSiteUrls: ['file:///private/jobs'],
        provenance: 'approved-fixture',
      },
    ];

    expect(repository.importSeeds(seeds)).toMatchObject({
      considered: 3,
      employersCreated: 2,
      careerSitesCreated: 2,
      rejected: 1,
      truncated: false,
    });
    expect(repository.importSeeds(seeds)).toMatchObject({
      employersCreated: 0,
      employersReused: 2,
      careerSitesCreated: 0,
      careerSitesReused: 2,
      rejected: 1,
    });
    expect(repository.listEmployers()).toHaveLength(2);
    const sites = repository
      .listEmployersWithSites()
      .flatMap((entry) => entry.careerSites);
    expect(sites).toHaveLength(2);
    expect(
      sites.every((site) => site.discovery.provenance === 'approved-fixture'),
    ).toBe(true);
  });

  it('enforces the hard seed and eligibility bounds', () => {
    const repository = createRepository();
    const seeds = Array.from({ length: 30 }, (_, index) => ({
      name: `Employer ${String(index)}`,
      websiteUrl: null,
      careerSiteUrls: [`https://careers.example.com/${String(index)}`],
      provenance: 'bounded-import',
    }));
    expect(repository.importSeeds(seeds)).toMatchObject({
      considered: 25,
      employersCreated: 25,
      truncated: true,
    });
    expect(
      repository.listDiscoveryEligible('9999-12-31T23:59:59.999Z', 10),
    ).toHaveLength(10);
    expect(() => repository.listDiscoveryEligible(undefined, 26)).toThrow(
      RangeError,
    );
  });
  it('creates and lists employers ordered by name', () => {
    const repository = createRepository();

    repository.createEmployer({ name: '  Zebra Inc  ', websiteUrl: null });
    repository.createEmployer({
      name: 'Acme Corporation',
      websiteUrl: 'https://acme.com',
    });

    const employers = repository.listEmployers();
    expect(employers.map((employer) => employer.name)).toEqual([
      'Acme Corporation',
      'Zebra Inc',
    ]);
    expect(employers[0]).toMatchObject({
      normalizedName: 'acme corporation',
      websiteUrl: 'https://acme.com',
    });
  });

  it('rejects duplicate normalized employer names', () => {
    const repository = createRepository();
    repository.createEmployer({ name: 'Acme Corporation', websiteUrl: null });

    expect(() =>
      repository.createEmployer({
        name: '  ACME CORPORATION ',
        websiteUrl: null,
      }),
    ).toThrow();
  });

  it('fetches a single employer by id', () => {
    const repository = createRepository();
    const employer = repository.createEmployer({
      name: 'Hooli',
      websiteUrl: null,
    });

    expect(repository.getEmployer(employer.id)).toMatchObject({
      name: 'Hooli',
    });
    expect(repository.getEmployer(randomUUID())).toBeNull();
  });

  it('creates career sites for an employer', () => {
    const repository = createRepository();
    const employer = repository.createEmployer({
      name: 'Acme',
      websiteUrl: null,
    });

    const site = repository.createCareerSite(employer.id, {
      url: 'https://boards.greenhouse.io/acme',
    });

    expect(site.employerId).toBe(employer.id);
    expect(site.normalizedUrl).toBe('https://boards.greenhouse.io/acme');
    expect(site.verificationState).toBe('unverified');
    expect(site.fingerprint).toBeNull();
    expect(repository.listCareerSites(employer.id)).toHaveLength(1);
  });

  it('rejects career sites for missing employers', () => {
    const repository = createRepository();

    expect(() =>
      repository.createCareerSite(randomUUID(), {
        url: 'https://acme.com/careers',
      }),
    ).toThrow();
  });

  it('verifies a career site and stores its fingerprint and evidence', () => {
    const repository = createRepository();
    const employer = repository.createEmployer({
      name: 'Acme',
      websiteUrl: null,
    });
    const site = repository.createCareerSite(employer.id, {
      url: 'https://boards.greenhouse.io/acme',
    });

    const verified = repository.verifyCareerSite(site.id);

    expect(verified.verificationState).toBe('verified');
    expect(verified.lastVerifiedAt).not.toBeNull();
    expect(verified.fingerprint).toMatchObject({
      atsPlatform: 'Greenhouse',
      atsDetectedProvider: 'greenhouse',
      confidenceLabel: 'high',
    });
    const evidence = repository.listCareerSiteEvidence(site.id);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0]!.kind).toBe('hostname');
  });

  it('keeps unsupported sites as detected-but-unsupported after verify', () => {
    const repository = createRepository();
    const employer = repository.createEmployer({
      name: 'Umbrella',
      websiteUrl: null,
    });
    const site = repository.createCareerSite(employer.id, {
      url: 'https://www.umbrellacorp.com/careers',
    });

    const verified = repository.verifyCareerSite(site.id);

    expect(verified.fingerprint).toMatchObject({
      atsPlatform: null,
      supportState: 'unsupported',
      confidenceLabel: 'low',
    });
    expect(verified.verificationState).toBe('verified');
  });

  it('lists employers with nested career site summaries', () => {
    const repository = createRepository();
    const employer = repository.createEmployer({
      name: 'Acme',
      websiteUrl: null,
    });
    repository.createCareerSite(employer.id, {
      url: 'https://boards.greenhouse.io/acme',
    });

    const withSites = repository.listEmployersWithSites();

    expect(withSites).toHaveLength(1);
    expect(withSites[0]!.employer.name).toBe('Acme');
    expect(withSites[0]!.careerSites[0]).toMatchObject({
      employerName: 'Acme',
      atsPlatform: null,
      verificationState: 'unverified',
      evidenceCount: 0,
    });
  });

  it('recomputes a fingerprint when a site is re-verified', () => {
    const repository = createRepository();
    const employer = repository.createEmployer({
      name: 'Acme',
      websiteUrl: null,
    });
    const site = repository.createCareerSite(employer.id, {
      url: 'https://boards.greenhouse.io/acme',
    });

    repository.verifyCareerSite(site.id);
    const verified = repository.verifyCareerSite(site.id);

    expect(verified.fingerprint?.atsPlatform).toBe('Greenhouse');
    expect(repository.listCareerSiteEvidence(site.id)).toHaveLength(2);
  });

  it('deleting an employer cascades to its career sites and evidence', () => {
    const repository = createRepository();
    const employer = repository.createEmployer({
      name: 'Acme',
      websiteUrl: null,
    });
    const site = repository.createCareerSite(employer.id, {
      url: 'https://boards.greenhouse.io/acme',
    });
    repository.verifyCareerSite(site.id);

    repository.deleteEmployer(employer.id);

    expect(repository.getEmployer(employer.id)).toBeNull();
    expect(repository.getCareerSite(site.id)).toBeNull();
    expect(repository.listEmployers()).toHaveLength(0);
  });

  it('seed registry imports 25 curated employers idempotently', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database);
    const repository = new EmployerRepository(database);

    seedEmployerRegistry(database);
    seedEmployerRegistry(database);

    expect(repository.listEmployers()).toHaveLength(25);
    const withSites = repository.listEmployersWithSites();
    expect(withSites.every((entry) => entry.careerSites.length === 1)).toBe(
      true,
    );
    expect(
      withSites.every(
        (entry) =>
          entry.careerSites[0]!.discovery.provenance === 'curated-starter-v1',
      ),
    ).toBe(true);
    expect(
      withSites.every((entry) => {
        const site = entry.careerSites[0];
        return (
          site !== undefined &&
          repository.getCareerSite(site.id)?.fingerprint === null
        );
      }),
    ).toBe(true);
  });

  it('retires exact legacy fixtures without deleting retained state or Sources', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database);
    const repository = new EmployerRepository(database);
    const legacyEmployer = repository.createEmployer({
      name: 'Hooli',
      websiteUrl: 'https://www.hooli.com',
    });
    const legacySite = repository.createCareerSite(legacyEmployer.id, {
      url: 'https://careers.smartrecruiters.com/hooli',
    });
    database
      .prepare(
        `INSERT INTO sources (
           id, employer, source_type, careers_url, enabled, connector,
           created_at, updated_at
         ) VALUES ('legacy-source', 'Hooli', 'smartrecruiters',
           'https://careers.smartrecruiters.com/hooli', 1, NULL,
           '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z')`,
      )
      .run();
    database
      .prepare(
        `UPDATE career_sites SET discovery_attempt_count = 2,
           last_discovery_result = 'retained evidence', source_id = 'legacy-source'
         WHERE id = ?`,
      )
      .run(legacySite.id);
    database
      .prepare(
        `INSERT INTO career_site_evidence (
           id, career_site_id, kind, detail, confidence, observed_at, created_at
         ) VALUES ('legacy-evidence', ?, 'url', 'retained', 0.8,
           '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z')`,
      )
      .run(legacySite.id);

    seedEmployerRegistry(database);
    seedEmployerRegistry(database);

    const retired = repository.getCareerSite(legacySite.id);
    expect(retired?.health.status).toBe('retired');
    expect(retired?.discovery.attemptCount).toBe(2);
    expect(retired?.discovery.lastResult).toBe('retained evidence');
    expect(retired?.discovery.sourceId).toBe('legacy-source');
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sources WHERE id = 'legacy-source'",
        )
        .get() as { count: number },
    ).toEqual({ count: 1 });
    expect(repository.listCareerSiteEvidence(legacySite.id)).toHaveLength(1);
    expect(repository.listEmployers()).toHaveLength(26);
  });

  it('does not retire user-created rows that only share a legacy name', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database);
    const repository = new EmployerRepository(database);
    const employer = repository.createEmployer({
      name: 'Hooli',
      websiteUrl: null,
    });
    const site = repository.createCareerSite(employer.id, {
      url: 'https://example.com/careers',
    });

    seedEmployerRegistry(database);

    expect(repository.getCareerSite(site.id)?.health.status).toBe('unknown');
  });
});
