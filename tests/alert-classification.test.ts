import { afterEach, describe, expect, it } from 'vitest';
import type { JobDatabase } from '../src/db/database.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';
import {
  classifyCareerSiteHealth,
  classifySourceFailure,
} from '../src/discovery/alertClassification.js';
import { DiscoveryAlertService } from '../src/discovery/discoveryAlertService.js';
import { EmployerRepository } from '../src/repositories/employerRepository.js';

const databases: JobDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});

function setup(now = '2026-08-12T12:00:00Z'): {
  db: JobDatabase;
  alertService: DiscoveryAlertService;
} {
  const db = createTestDatabase();
  databases.push(db);
  const alertService = new DiscoveryAlertService(db, () => new Date(now));
  return { db, alertService };
}

function seedFailedRun(
  db: JobDatabase,
  sourceId: string,
  startedAt: string,
  errorMessage: string | null,
): void {
  db.prepare(
    `INSERT INTO runs (id, source_id, status, started_at, completed_at, error_message, created_at)
     VALUES (?, ?, 'failed', ?, ?, ?, ?)`,
  ).run(
    `run-${sourceId}-${startedAt}`,
    sourceId,
    startedAt,
    startedAt,
    errorMessage,
    startedAt,
  );
}

function setProvider(
  db: JobDatabase,
  sourceId: string,
  providerId: string,
  configurationStatus?: string,
): void {
  if (configurationStatus === undefined) {
    db.prepare('UPDATE sources SET provider_id = ? WHERE id = ?').run(
      providerId,
      sourceId,
    );
    return;
  }
  db.prepare(
    'UPDATE sources SET provider_id = ?, configuration_status = ? WHERE id = ?',
  ).run(providerId, configurationStatus, sourceId);
}

describe('source failure classification', () => {
  it('classifies browser-session failures as WARNING with manual-login action', () => {
    const { db, alertService } = setup();
    const sourceId = insertTestSource(db, { id: 'li-src' });
    setProvider(db, sourceId, 'linkedin');
    db.prepare('UPDATE sources SET failure_count = 5 WHERE id = ?').run(
      sourceId,
    );
    seedFailedRun(
      db,
      sourceId,
      '2026-08-12T11:00:00Z',
      'Login session expired',
    );

    alertService.evaluateRules();

    const list = alertService.listAlerts();
    expect(list).toHaveLength(1);
    expect(list[0]?.severity).toBe('WARNING');
    const evidence = JSON.parse(list[0]?.evidenceJson ?? '{}') as {
      classification: string;
    };
    expect(evidence.classification).toBe('browser-session');
    expect(list[0]?.message).toContain('Classification: browser-session');
    expect(list[0]?.message).toContain('manual login');
  });

  it('never classifies USAJOBS as broken or unsupported', () => {
    const { db, alertService } = setup();
    const sourceId = insertTestSource(db, { id: 'usajobs-src' });
    setProvider(db, sourceId, 'usajobs');
    db.prepare('UPDATE sources SET failure_count = 4 WHERE id = ?').run(
      sourceId,
    );
    seedFailedRun(
      db,
      sourceId,
      '2026-08-12T11:00:00Z',
      'Login.gov session required',
    );

    alertService.evaluateRules();

    const list = alertService.listAlerts();
    expect(list).toHaveLength(1);
    const evidence = JSON.parse(list[0]?.evidenceJson ?? '{}') as {
      classification: string;
    };
    expect(evidence.classification).toBe('browser-session');
    expect(evidence.classification).not.toBe('broken');
    expect(evidence.classification).not.toBe('unsupported-platform');
  });

  it('classifies credential-required sources as pending-credentials', () => {
    const { db, alertService } = setup();
    const sourceId = insertTestSource(db, { id: 'cred-src' });
    setProvider(db, sourceId, 'workday', 'credentials-required');
    db.prepare('UPDATE sources SET failure_count = 2 WHERE id = ?').run(
      sourceId,
    );

    alertService.evaluateRules();

    const list = alertService.listAlerts();
    expect(list).toHaveLength(1);
    expect(list[0]?.severity).toBe('WARNING');
    const evidence = JSON.parse(list[0]?.evidenceJson ?? '{}') as {
      classification: string;
    };
    expect(evidence.classification).toBe('pending-credentials');
    expect(list[0]?.message).toContain('Configure the required credentials');
  });

  it('classifies HTTP 403 blocks as anti-bot rather than broken', () => {
    const { db, alertService } = setup();
    const sourceId = insertTestSource(db, { id: 'bot-src' });
    setProvider(db, sourceId, 'greenhouse');
    db.prepare('UPDATE sources SET failure_count = 4 WHERE id = ?').run(
      sourceId,
    );
    seedFailedRun(
      db,
      sourceId,
      '2026-08-12T11:00:00Z',
      'Access to the site was blocked (HTTP 403).',
    );

    alertService.evaluateRules();

    const list = alertService.listAlerts();
    expect(list).toHaveLength(1);
    expect(list[0]?.severity).toBe('WARNING');
    const evidence = JSON.parse(list[0]?.evidenceJson ?? '{}') as {
      classification: string;
    };
    expect(evidence.classification).toBe('anti-bot');
  });

  it('keeps transient DNS failures distinct from broken sources', () => {
    const { db, alertService } = setup();
    const dnsId = insertTestSource(db, { id: 'dns-src' });
    setProvider(db, dnsId, 'icims');
    db.prepare('UPDATE sources SET failure_count = 3 WHERE id = ?').run(dnsId);
    seedFailedRun(
      db,
      dnsId,
      '2026-08-12T11:00:00Z',
      'Public host could not be resolved',
    );
    const brokenId = insertTestSource(db, { id: 'broken-src' });
    setProvider(db, brokenId, 'greenhouse');
    db.prepare('UPDATE sources SET failure_count = 3 WHERE id = ?').run(
      brokenId,
    );
    seedFailedRun(
      db,
      brokenId,
      '2026-08-12T11:05:00Z',
      'Provider request failed: unexpected response',
    );

    alertService.evaluateRules();

    const list = alertService.listAlerts();
    expect(list).toHaveLength(2);
    const byEntity = new Map(list.map((alert) => [alert.entityId, alert]));
    const dnsAlert = byEntity.get(dnsId);
    const brokenAlert = byEntity.get(brokenId);
    const dnsEvidence = JSON.parse(dnsAlert?.evidenceJson ?? '{}') as {
      classification: string;
    };
    const brokenEvidence = JSON.parse(brokenAlert?.evidenceJson ?? '{}') as {
      classification: string;
    };
    expect(dnsEvidence.classification).toBe('transient-network');
    expect(dnsAlert?.severity).toBe('WARNING');
    expect(brokenEvidence.classification).toBe('broken');
    expect(brokenAlert?.severity).toBe('CRITICAL');
  });

  it('classifies categorical unreachable failures as chronic-provider-failure', () => {
    const { db, alertService } = setup();
    const sourceId = insertTestSource(db, { id: 'chronic-src' });
    setProvider(db, sourceId, 'bamboohr');
    db.prepare('UPDATE sources SET failure_count = 3 WHERE id = ?').run(
      sourceId,
    );
    seedFailedRun(
      db,
      sourceId,
      '2026-08-12T11:00:00Z',
      'Provider unavailable: BambooHR subdomain is unreachable or inactive',
    );

    alertService.evaluateRules();

    const list = alertService.listAlerts();
    expect(list).toHaveLength(1);
    expect(list[0]?.severity).toBe('CRITICAL');
    const evidence = JSON.parse(list[0]?.evidenceJson ?? '{}') as {
      classification: string;
    };
    expect(evidence.classification).toBe('chronic-provider-failure');
  });

  it('exposes pure classifiers deterministically', () => {
    const browser = classifySourceFailure('wellfound', null, null);
    expect(browser.classification).toBe('browser-session');

    const chronic = classifySourceFailure(
      'bamboohr',
      'valid',
      'iCIMS careers site is unreachable or inactive',
    );
    expect(chronic.classification).toBe('chronic-provider-failure');

    const site = classifyCareerSiteHealth('broken', 'Failed to fetch ATS');
    expect(site.classification).toBe('broken');
    expect(site.severityCap).toBe('CRITICAL');
  });
});

describe('zero-yield and healthy-source behavior', () => {
  it('never alerts for healthy sources with legitimate zero openings', () => {
    const { db, alertService } = setup();
    const sourceId = insertTestSource(db, { id: 'healthy-src' });
    db.prepare("UPDATE sources SET health_status = 'healthy' WHERE id = ?").run(
      sourceId,
    );
    for (let index = 0; index < 4; index += 1) {
      db.prepare(
        `INSERT INTO runs (id, source_id, status, started_at, completed_at, jobs_discovered, complete_snapshot, fetch_truncated, created_at)
         VALUES (?, ?, 'succeeded', ?, ?, 0, 1, 0, ?)`,
      ).run(
        `run-h-${String(index)}`,
        sourceId,
        `2026-08-12T0${String(index)}:00:00Z`,
        `2026-08-12T0${String(index)}:00:00Z`,
        `2026-08-12T0${String(index)}:00:00Z`,
      );
    }

    alertService.evaluateRules();

    expect(alertService.listAlerts()).toHaveLength(0);
  });

  it('skips zero-yield regression alerts for browser-session sources', () => {
    const { db, alertService } = setup();
    const sourceId = insertTestSource(db, { id: 'li-zero' });
    setProvider(db, sourceId, 'linkedin');
    db.prepare("UPDATE sources SET health_status = 'failed' WHERE id = ?").run(
      sourceId,
    );
    db.prepare(
      `INSERT INTO runs (id, source_id, status, started_at, completed_at, jobs_discovered, complete_snapshot, fetch_truncated, created_at)
       VALUES ('historic', ?, 'succeeded', '2026-07-01T00:00:00Z', '2026-07-01T00:01:00Z', 7, 1, 0, '2026-07-01T00:00:00Z')`,
    ).run(sourceId);
    for (let index = 0; index < 3; index += 1) {
      db.prepare(
        `INSERT INTO runs (id, source_id, status, started_at, completed_at, jobs_discovered, complete_snapshot, fetch_truncated, created_at)
         VALUES (?, ?, 'succeeded', ?, ?, 0, 1, 0, ?)`,
      ).run(
        `run-z-${String(index)}`,
        sourceId,
        `2026-08-12T0${String(index)}:00:00Z`,
        `2026-08-12T0${String(index)}:00:00Z`,
        `2026-08-12T0${String(index)}:00:00Z`,
      );
    }

    alertService.evaluateRules();

    const zeroYield = alertService
      .listAlerts()
      .filter((alert) => alert.ruleId === 'zero-yield-streak');
    expect(zeroYield).toHaveLength(0);
  });
});

describe('scheduler-aware overdue and stale behavior', () => {
  it('suppresses per-source overdue during scheduler downtime and emits one aggregate notice', () => {
    const { db, alertService } = setup();
    const sourceId = insertTestSource(db, { id: 'down-src' });
    db.prepare(
      "INSERT INTO source_schedules (source_id, enabled, cadence, next_run_at, created_at, updated_at) VALUES (?, 1, 'every-24-hours', '2026-08-12T10:00:00Z', '2026-08-12T10:00:00Z', '2026-08-12T10:00:00Z')",
    ).run(sourceId);
    db.prepare(
      "UPDATE discovery_settings SET scheduler_enabled = 1 WHERE id = 'default'",
    ).run();
    db.prepare(
      `INSERT INTO runs (id, source_id, status, started_at, completed_at, created_at)
       VALUES ('old-run', ?, 'succeeded', '2026-08-08T00:00:00Z', '2026-08-08T00:01:00Z', '2026-08-08T00:00:00Z')`,
    ).run(sourceId);

    alertService.evaluateRules();

    const list = alertService.listAlerts();
    expect(
      list.filter((alert) => alert.ruleId === 'source-overdue'),
    ).toHaveLength(0);
    expect(
      list.filter((alert) => alert.ruleId === 'discovery-stale'),
    ).toHaveLength(0);
    const inactive = list.filter(
      (alert) => alert.ruleId === 'scheduler-inactive',
    );
    expect(inactive).toHaveLength(1);
    expect(inactive[0]?.severity).toBe('INFO');
    const evidence = JSON.parse(inactive[0]?.evidenceJson ?? '{}') as {
      classification: string;
    };
    expect(evidence.classification).toBe('scheduler-downtime');
  });

  it('still reports genuine overdue when the application has recent activity', () => {
    const { db, alertService } = setup();
    const sourceId = insertTestSource(db, { id: 'active-src' });
    db.prepare(
      "INSERT INTO source_schedules (source_id, enabled, cadence, next_run_at, created_at, updated_at) VALUES (?, 1, 'every-24-hours', '2026-08-12T10:00:00Z', '2026-08-12T10:00:00Z', '2026-08-12T10:00:00Z')",
    ).run(sourceId);
    db.prepare(
      "UPDATE discovery_settings SET scheduler_enabled = 1 WHERE id = 'default'",
    ).run();
    db.prepare(
      `INSERT INTO runs (id, source_id, status, started_at, completed_at, created_at)
       VALUES ('recent-run', ?, 'succeeded', '2026-08-12T11:30:00Z', '2026-08-12T11:31:00Z', '2026-08-12T11:30:00Z')`,
    ).run(sourceId);

    alertService.evaluateRules();

    const list = alertService.listAlerts();
    expect(
      list.filter((alert) => alert.ruleId === 'source-overdue'),
    ).toHaveLength(1);
    expect(
      list.filter((alert) => alert.ruleId === 'scheduler-inactive'),
    ).toHaveLength(0);
  });
});

describe('career-site health classification', () => {
  function seedSite(
    db: JobDatabase,
    employerName: string,
    healthStatus: string,
    healthMessage: string,
    failureCount: number,
  ): string {
    const employerRepository = new EmployerRepository(db);
    const employer = employerRepository.createEmployer({
      name: employerName,
      websiteUrl: null,
    });
    const site = employerRepository.createCareerSite(employer.id, {
      url: `https://${employerName.toLowerCase()}.example.com/jobs`,
    });
    db.prepare(
      'UPDATE career_sites SET health_status = ?, health_message = ?, health_failure_count = ? WHERE id = ?',
    ).run(healthStatus, healthMessage, failureCount, site.id);
    return site.id;
  }

  it('downgrades unsupported-platform sites to WARNING with repair guidance', () => {
    const { db, alertService } = setup();
    const siteId = seedSite(
      db,
      'CustomBoard',
      'broken',
      'The site was reachable, but no supported ATS signals were found.',
      1,
    );

    alertService.evaluateRules();

    const list = alertService.listAlerts();
    expect(list).toHaveLength(1);
    expect(list[0]?.severity).toBe('WARNING');
    const evidence = JSON.parse(list[0]?.evidenceJson ?? '{}') as {
      classification: string;
    };
    expect(evidence.classification).toBe('unsupported-platform');
    expect(list[0]?.entityId).toBe(siteId);
  });

  it('classifies invalid or not-allowed URLs separately from broken ATS', () => {
    const { db, alertService } = setup();
    const siteId = seedSite(
      db,
      'DeadDomain',
      'broken',
      'The careers site URL is invalid or not allowed.',
      2,
    );

    alertService.evaluateRules();

    const list = alertService.listAlerts();
    expect(list).toHaveLength(1);
    expect(list[0]?.severity).toBe('WARNING');
    const evidence = JSON.parse(list[0]?.evidenceJson ?? '{}') as {
      classification: string;
    };
    expect(evidence.classification).toBe('invalid-url');
    expect(list[0]?.entityId).toBe(siteId);
  });

  it('keeps anti-bot sites visible as WARNING without calling them broken', () => {
    const { db, alertService } = setup();
    seedSite(
      db,
      'Guarded',
      'warning',
      'Access to the site was blocked (HTTP 403).',
      1,
    );

    alertService.evaluateRules();

    const list = alertService.listAlerts();
    expect(list).toHaveLength(1);
    expect(list[0]?.severity).toBe('WARNING');
    const evidence = JSON.parse(list[0]?.evidenceJson ?? '{}') as {
      classification: string;
    };
    expect(evidence.classification).toBe('anti-bot');
    expect(evidence.classification).not.toBe('broken');
  });

  it('preserves CRITICAL for genuinely broken sites', () => {
    const { db, alertService } = setup();
    seedSite(db, 'ReallyBroken', 'broken', 'TLS certificate revoked', 3);

    alertService.evaluateRules();

    const list = alertService.listAlerts();
    expect(list).toHaveLength(1);
    expect(list[0]?.severity).toBe('CRITICAL');
    const evidence = JSON.parse(list[0]?.evidenceJson ?? '{}') as {
      classification: string;
    };
    expect(evidence.classification).toBe('broken');
  });
});
