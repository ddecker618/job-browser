import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import { EmployerDiscoveryService } from '../src/discovery/employerDiscoveryService.js';
import { ProviderRegistry } from '../src/providers/providerRegistry.js';
import { EmployerRepository } from '../src/repositories/employerRepository.js';
import { SourceRepository } from '../src/repositories/source-repository.js';
import { createTestDatabase } from './helpers/test-database.js';

const databases: JobDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function setup(url: string) {
  const database = createTestDatabase();
  databases.push(database);
  const employers = new EmployerRepository(database);
  const sources = new SourceRepository(database);
  const employer = employers.createEmployer({ name: 'Acme', websiteUrl: null });
  const site = employers.createCareerSite(employer.id, { url });
  return { database, employers, sources, site };
}

describe('EmployerDiscoveryService', () => {
  it('verifies, fingerprints, creates a Source, and reuses it without duplication', async () => {
    const { employers, sources, site } = setup(
      'https://boards.greenhouse.io/acme',
    );
    const coordinator = { runSource: vi.fn().mockResolvedValue({}) };
    const provider = {
      id: 'greenhouse',
      capabilities: { requiresCredentials: false },
      validateConfiguration: vi.fn().mockResolvedValue({ valid: true }),
    };
    const service = new EmployerDiscoveryService(
      employers,
      sources,
      {
        loadProviders: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockReturnValue(provider),
      } as never,
      coordinator as never,
    );

    const first = await service.runSite(site.id, true);
    expect(first.counter).toBe('sourceCreated');
    expect(first.site.fingerprint?.atsDetectedProvider).toBe('greenhouse');
    expect(first.site.discovery.sourceId).not.toBeNull();
    expect(sources.list()).toHaveLength(1);
    expect(coordinator.runSource).toHaveBeenCalledWith(
      first.site.discovery.sourceId,
      'manual-source',
    );

    const second = await service.runSite(site.id, true);
    expect(second.counter).toBe('sourceReused');
    expect(second.site.discovery.sourceId).toBe(first.site.discovery.sourceId);
    expect(sources.list()).toHaveLength(1);
  });

  it('keeps unknown ATS explicit and creates no Source', async () => {
    const { employers, sources, site } = setup(
      'https://careers.example.com/jobs',
    );
    const service = new EmployerDiscoveryService(
      employers,
      sources,
      new ProviderRegistry(),
    );

    const outcome = await service.runSite(site.id);
    expect(outcome.counter).toBe('unsupported');
    expect(outcome.site.discovery).toMatchObject({
      state: 'unsupported',
      sourceId: null,
      attemptCount: 1,
      provenance: 'employer-registry',
    });
    expect(sources.list()).toHaveLength(0);
  });

  it('persists failure backoff and excludes the site until eligible', async () => {
    const { employers, sources, site } = setup(
      'https://boards.greenhouse.io/acme',
    );
    const provider = {
      id: 'greenhouse',
      name: 'Greenhouse',
      type: 'ats',
      capabilities: {
        requiresCredentials: false,
        keywordSearch: false,
        locationSearch: false,
        remoteFilter: false,
        pagination: false,
        compensation: false,
        structuredPreview: false,
      },
      validateConfiguration: vi.fn().mockRejectedValue(new Error('offline')),
      healthCheck: vi.fn(),
      search: vi.fn(),
      fetch: vi.fn(),
      normalize: vi.fn(),
      validate: vi.fn(),
      save: vi.fn(),
    };
    const service = new EmployerDiscoveryService(employers, sources, {
      loadProviders: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockReturnValue(provider),
    } as never);

    const outcome = await service.runSite(site.id);
    expect(outcome.counter).toBe('failed');
    expect(outcome.site.discovery.state).toBe('backoff');
    expect(outcome.site.discovery.nextAttemptAt).not.toBeNull();
    expect(employers.listDiscoveryEligible()).toHaveLength(0);
  });

  it('shares one bounded run when automatic and manual triggers overlap', async () => {
    const { employers, sources } = setup('https://careers.example.com/jobs');
    const service = new EmployerDiscoveryService(
      employers,
      sources,
      new ProviderRegistry(),
    );
    const first = service.runEligible(1);
    const second = service.runEligible(1);
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({
      attempted: 1,
      unsupported: 1,
    });
  });

  it('uses intelligence ordering while preserving its single-flight bound', async () => {
    const { employers, sources, site } = setup(
      'https://careers.example.com/jobs',
    );
    const intelligence = {
      eligibleSiteIds: vi.fn().mockReturnValue([site.id]),
      decision: vi.fn().mockReturnValue({ executable: true }),
    };
    const service = new EmployerDiscoveryService(
      employers,
      sources,
      new ProviderRegistry(),
      undefined,
      undefined,
      intelligence as never,
      () => new Date('2026-08-12T23:59:59.999Z'),
    );
    const first = service.runEligible(1);
    const second = service.runEligible(1);
    expect(second).toBe(first);
    await first;
    expect(intelligence.eligibleSiteIds).toHaveBeenCalledWith(
      1,
      new Date('2026-08-12T23:59:59.999Z'),
    );
  });

  it('bootstraps an unverified supported site through the intelligence policy', async () => {
    const { database, employers, sources, site } = setup(
      'https://boards.greenhouse.io/acme',
    );
    const provider = {
      id: 'greenhouse',
      capabilities: { requiresCredentials: false },
      validateConfiguration: vi.fn().mockResolvedValue({ valid: true }),
    };
    const intelligence = new (
      await import('../src/discovery/employerDiscoveryIntelligenceService.js')
    ).EmployerDiscoveryIntelligenceService(
      database,
      () => new Date('2026-08-14T23:59:59.999Z'),
    );
    const service = new EmployerDiscoveryService(
      employers,
      sources,
      {
        loadProviders: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockReturnValue(provider),
      } as never,
      undefined,
      undefined,
      intelligence,
      () => new Date('2026-08-14T23:59:59.999Z'),
    );

    await expect(service.runEligible(1)).resolves.toMatchObject({
      attempted: 1,
      sourceCreated: 1,
    });
    expect(employers.getCareerSite(site.id)?.verificationState).toBe(
      'verified',
    );
  });

  it('rechecks intelligence safety immediately before Source execution', async () => {
    const { employers, sources, site } = setup(
      'https://boards.greenhouse.io/acme',
    );
    const provider = {
      id: 'greenhouse',
      capabilities: { requiresCredentials: false },
      validateConfiguration: vi.fn().mockResolvedValue({ valid: true }),
    };
    const coordinator = { runSource: vi.fn() };
    const intelligence = {
      decision: vi
        .fn()
        .mockReturnValueOnce({ executable: true })
        .mockReturnValueOnce({ executable: false }),
    };
    const service = new EmployerDiscoveryService(
      employers,
      sources,
      {
        loadProviders: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockReturnValue(provider),
      } as never,
      coordinator as never,
      undefined,
      intelligence as never,
    );

    await expect(service.runSite(site.id, true, true)).resolves.toMatchObject({
      counter: 'skipped',
    });
    expect(coordinator.runSource).not.toHaveBeenCalled();
  });

  it('registers credential-required Sources without treating them as executable success', async () => {
    const { employers, sources, site } = setup(
      'https://boards.greenhouse.io/acme',
    );
    const provider = {
      id: 'greenhouse',
      capabilities: { requiresCredentials: true },
      validateConfiguration: vi.fn().mockResolvedValue({ valid: true }),
    };
    const coordinator = { runSource: vi.fn() };
    const service = new EmployerDiscoveryService(
      employers,
      sources,
      {
        loadProviders: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockReturnValue(provider),
      } as never,
      coordinator as never,
      { status: vi.fn().mockResolvedValue({ configured: false }) } as never,
    );

    const result = await service.runEligible(1);
    expect(result).toMatchObject({
      attempted: 1,
      succeeded: 0,
      credentialRequired: 1,
    });
    expect(result.sites[0]?.discovery.lastResult).toMatch(
      /credentials are required/i,
    );
    expect(result.sites[0]?.id).toBe(site.id);
    expect(coordinator.runSource).not.toHaveBeenCalled();
  });
});
