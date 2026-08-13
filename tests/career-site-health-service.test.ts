import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import { CareerSiteHealthService } from '../src/discovery/careerSiteHealthService.js';
import type { AtsDetectionResult } from '../src/models/source-management.js';
import { EmployerRepository } from '../src/repositories/employerRepository.js';
import { createTestDatabase } from './helpers/test-database.js';

const databases: JobDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function setup(url = 'https://boards.greenhouse.io/acme') {
  const database = createTestDatabase();
  databases.push(database);
  const repository = new EmployerRepository(database);
  const employer = repository.createEmployer({
    name: 'Acme',
    websiteUrl: null,
  });
  const site = repository.createCareerSite(employer.id, { url });
  return { database, repository, site };
}

describe('CareerSiteHealthService', () => {
  it('records repeatable healthy verification history', async () => {
    const { repository, site } = setup();
    const detector = vi.fn().mockResolvedValue(detection());
    const service = new CareerSiteHealthService(
      repository,
      undefined,
      detector,
    );

    expect((await service.checkSite(site.id)).health.status).toBe('healthy');
    expect((await service.checkSite(site.id)).health.status).toBe('healthy');
    const history = repository.listVerificationHistory(site.id);
    expect(history).toHaveLength(2);
    expect(
      history.every((item) => item.resultingHealthStatus === 'healthy'),
    ).toBe(true);
  });

  it('escalates transient failures deterministically and resets on success', async () => {
    const { repository, site } = setup();
    const detector = vi
      .fn()
      .mockResolvedValueOnce(
        detection({ failureCategory: 'timeout', httpStatus: null }),
      )
      .mockResolvedValueOnce(
        detection({ failureCategory: 'unreachable', httpStatus: null }),
      )
      .mockResolvedValueOnce(
        detection({ failureCategory: 'blocked', httpStatus: 503 }),
      )
      .mockResolvedValueOnce(detection());
    const service = new CareerSiteHealthService(
      repository,
      undefined,
      detector,
    );

    expect((await service.checkSite(site.id)).health.status).toBe('warning');
    expect((await service.checkSite(site.id)).health.status).toBe('warning');
    expect((await service.checkSite(site.id)).health.status).toBe('broken');
    expect((await service.checkSite(site.id)).health).toMatchObject({
      status: 'healthy',
      failureCount: 0,
    });
  });

  it('classifies deterministic broken and unsafe targets immediately', async () => {
    const { repository, site } = setup('file:///private/jobs');
    const detector = vi.fn().mockResolvedValue(
      detection({
        finalUrl: 'file:///private/jobs',
        failureCategory: 'invalid_url',
        httpStatus: null,
        suggestedProvider: null,
      }),
    );
    const checked = await new CareerSiteHealthService(
      repository,
      undefined,
      detector,
    ).checkSite(site.id);
    expect(checked.health.status).toBe('broken');
  });

  it.each([
    ['greenhouse', null],
    [null, 'greenhouse'],
    ['greenhouse', 'lever'],
  ] as const)('retains ATS transition %s -> %s', async (before, after) => {
    const { repository, site } = setup();
    if (before !== null) repository.verifyCareerSite(site.id);
    const detector = vi.fn().mockResolvedValue(
      detection({
        suggestedProvider: after,
        detectedPlatform:
          after === 'lever' ? 'Lever' : after === null ? null : 'Greenhouse',
        supportState: after === null ? 'unsupported' : 'supported',
      }),
    );
    const checked = await new CareerSiteHealthService(
      repository,
      undefined,
      detector,
    ).checkSite(site.id);
    expect(['healthy', 'warning']).toContain(checked.health.status);
    const history = repository.listVerificationHistory(site.id)[0];
    expect(history).toMatchObject({
      previousAtsProvider: before,
      detectedProvider: after,
    });
  });

  it('records bounded redirects and refuses unsafe automatic repair', async () => {
    const { repository, site } = setup();
    const detector = vi.fn().mockResolvedValue(
      detection({
        finalUrl: 'https://jobs.lever.co/acme',
        suggestedProvider: 'lever',
      }),
    );
    const discovery = { runSite: vi.fn() };
    const service = new CareerSiteHealthService(
      repository,
      discovery as never,
      detector,
    );
    const repair = await service.repairSite(site.id);
    expect(repair).toMatchObject({ repaired: false });
    expect(discovery.runSite).not.toHaveBeenCalled();
    expect(repository.listVerificationHistory(site.id)[0]?.effectiveUrl).toBe(
      'https://jobs.lever.co/acme',
    );
  });

  it('preserves the linked old Source when the supported ATS changes', async () => {
    const { database, repository, site } = setup();
    repository.verifyCareerSite(site.id);
    database.exec(`
      INSERT INTO sources (id, employer, source_type, careers_url, enabled, connector,
        failure_count, created_at, updated_at, display_name, provider_id,
        configuration_json, search_criteria_json, configuration_status, health_status)
      VALUES ('old-source', 'Acme', 'provider', 'https://boards.greenhouse.io/acme',
        0, 'greenhouse', 0, '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z', 'Acme Greenhouse', 'greenhouse', '{}', '{}',
        'valid', 'never-run');
      UPDATE career_sites SET source_id = 'old-source' WHERE id = '${site.id}';
    `);
    const service = new CareerSiteHealthService(
      repository,
      undefined,
      vi.fn().mockResolvedValue(
        detection({
          detectedPlatform: 'Lever',
          suggestedProvider: 'lever',
          finalUrl: 'https://jobs.lever.co/acme',
        }),
      ),
    );

    expect((await service.checkSite(site.id)).health.status).toBe('warning');
    expect(
      database
        .prepare<
          [string],
          { id: string; provider_id: string; enabled: number }
        >('SELECT id, provider_id, enabled FROM sources WHERE id = ?')
        .get('old-source'),
    ).toEqual({ id: 'old-source', provider_id: 'greenhouse', enabled: 0 });
    expect(repository.getCareerSite(site.id)?.discovery.sourceId).toBe(
      'old-source',
    );
  });

  it('excludes retired sites and shares overlapping bounded batches', async () => {
    const { repository, site } = setup();
    repository.retireCareerSite(site.id);
    const detector = vi.fn().mockResolvedValue(detection());
    const service = new CareerSiteHealthService(
      repository,
      undefined,
      detector,
    );
    expect(repository.listHealthEligible()).toHaveLength(0);
    const first = service.runEligible();
    const second = service.runEligible();
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ checked: 0 });
    expect(detector).not.toHaveBeenCalled();
  });

  it('repairs stable sites without duplicating or deleting Sources', async () => {
    const { repository, site } = setup();
    repository.verifyCareerSite(site.id);
    const discovery = {
      runSite: vi.fn().mockResolvedValue({
        site: {
          ...site,
          fingerprint: repository.getCareerSite(site.id)?.fingerprint,
          discovery: { ...site.discovery, sourceId: 'source-1' },
          health: { ...site.health, status: 'healthy' },
        },
      }),
    };
    const service = new CareerSiteHealthService(
      repository,
      discovery as never,
      vi.fn().mockResolvedValue(detection()),
    );
    await expect(service.repairSite(site.id)).resolves.toMatchObject({
      repaired: true,
    });
    expect(discovery.runSite).toHaveBeenCalledWith(site.id, false);
  });
});

function detection(
  overrides: Partial<AtsDetectionResult> = {},
): AtsDetectionResult {
  return {
    detectedPlatform: 'Greenhouse',
    confidence: 1,
    supportState: 'supported',
    suggestedProvider: 'greenhouse',
    extractedConfiguration: { boardToken: 'acme' },
    structuredFallback: false,
    explanation: 'Supported Greenhouse careers site',
    resolvedUrl: 'https://boards.greenhouse.io/acme',
    requestedUrl: 'https://boards.greenhouse.io/acme',
    normalizedUrl: 'https://boards.greenhouse.io/acme',
    finalUrl: 'https://boards.greenhouse.io/acme',
    httpStatus: 200,
    providersChecked: ['greenhouse'],
    positiveSignals: ['hostname'],
    negativeProbes: [],
    failureCategory: null,
    ...overrides,
  };
}
