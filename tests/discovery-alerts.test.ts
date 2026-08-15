import { afterEach, describe, expect, it } from 'vitest';
import type { JobDatabase } from '../src/db/database.js';
import { createTestDatabase, insertTestSource } from './helpers/test-database.js';
import { DiscoveryAlertService } from '../src/discovery/discoveryAlertService.js';
import { DiscoveryAnalyticsService } from '../src/discovery/discoveryAnalyticsService.js';
import { EmployerRepository } from '../src/repositories/employerRepository.js';

const databases: JobDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});

function setupDb(): { db: JobDatabase; alertService: DiscoveryAlertService; analyticsService: DiscoveryAnalyticsService; employerRepository: EmployerRepository } {
  const db = createTestDatabase();
  databases.push(db);
  const alertService = new DiscoveryAlertService(db, () => new Date('2026-08-12T12:00:00Z'));
  const analyticsService = new DiscoveryAnalyticsService(db, () => new Date('2026-08-12T12:00:00Z'));
  const employerRepository = new EmployerRepository(db);
  return { db, alertService, analyticsService, employerRepository };
}

describe('Discovery Alerts & Analytics Sprint', () => {
  it('correctly creates source-failure-streak warnings and critical alerts', () => {
    const { db, alertService } = setupDb();
    const sourceId = insertTestSource(db, { id: 'test-source' });

    // 1 failure (no alert)
    db.prepare("UPDATE sources SET failure_count = 1 WHERE id = ?").run(sourceId);
    alertService.evaluateRules();
    expect(alertService.listAlerts()).toHaveLength(0);

    // 2 failures (Warning alert)
    db.prepare("UPDATE sources SET failure_count = 2 WHERE id = ?").run(sourceId);
    alertService.evaluateRules();
    let list = alertService.listAlerts();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      ruleId: 'source-failure-streak',
      severity: 'WARNING',
      entityId: sourceId,
      state: 'active',
    });

    // 3 failures (Critical alert update)
    db.prepare("UPDATE sources SET failure_count = 3 WHERE id = ?").run(sourceId);
    alertService.evaluateRules();
    list = alertService.listAlerts();
    expect(list).toHaveLength(1);
    expect(list[0]!).toMatchObject({
      ruleId: 'source-failure-streak',
      severity: 'CRITICAL',
    });

    // Acknowledge alert
    alertService.acknowledgeAlert(list[0]!.id);
    list = alertService.listAlerts();
    expect(list[0]!.state).toBe('acknowledged');

    // Reset failure count to 0 resolves the alert
    db.prepare("UPDATE sources SET failure_count = 0 WHERE id = ?").run(sourceId);
    alertService.evaluateRules();
    list = alertService.listAlerts();
    expect(list).toHaveLength(0); // active/acknowledged alerts list is empty

    // Check that it's in the resolved state in DB
    const allAlerts = alertService.listAlerts({ state: 'resolved' });
    expect(allAlerts).toHaveLength(1);
    expect(allAlerts[0]!.state).toBe('resolved');
  });

  it('detects source-overdue when next_run_at is past', () => {
    const { db, alertService } = setupDb();
    const sourceId = insertTestSource(db, { id: 'test-source' });

    // Enable source scheduling and set next_run_at to 2 hours ago (overdue)
    db.prepare("INSERT INTO source_schedules (source_id, enabled, cadence, next_run_at, created_at, updated_at) VALUES (?, 1, 'every-24-hours', '2026-08-12T10:00:00Z', '2026-08-12T10:00:00Z', '2026-08-12T10:00:00Z')").run(sourceId);
    db.prepare("UPDATE discovery_settings SET scheduler_enabled = 1 WHERE id = 'default'").run();

    alertService.evaluateRules();
    const list = alertService.listAlerts();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      ruleId: 'source-overdue',
      severity: 'WARNING',
      entityId: sourceId,
    });
  });

  it('triggers career-site-broken alert when health status is broken', () => {
    const { db, alertService, employerRepository } = setupDb();
    const employer = employerRepository.createEmployer({ name: 'Acme', websiteUrl: null });
    const site = employerRepository.createCareerSite(employer.id, { url: 'https://acme.com/jobs' });

    db.prepare("UPDATE career_sites SET health_status = 'broken', health_message = 'Failed to fetch ATS' WHERE id = ?").run(site.id);

    alertService.evaluateRules();
    const list = alertService.listAlerts();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      ruleId: 'career-site-broken',
      severity: 'CRITICAL',
      entityId: site.id,
      message: 'Career site health check for Acme is broken: Failed to fetch ATS.',
    });
  });

  it('handles provider-degraded and suppresses individual source failure streak alerts', () => {
    const { db, alertService } = setupDb();
    
    // Create 3 enabled sources for the same provider
    insertTestSource(db, { id: 'src-1' });
    insertTestSource(db, { id: 'src-2' });
    insertTestSource(db, { id: 'src-3' });

    db.prepare("UPDATE sources SET provider_id = 'indeed' WHERE id IN ('src-1', 'src-2', 'src-3')").run();
    db.prepare("INSERT INTO provider_metadata (id, provider_id, provider_name, enabled, created_at, updated_at) VALUES ('meta:indeed', 'indeed', 'Indeed', 1, '2026-08-12T10:00:00Z', '2026-08-12T10:00:00Z')").run();

    // Seed runs in the last 24h: 3 runs, all failed (100% failure rate)
    db.prepare(`
      INSERT INTO runs (id, source_id, provider_id, status, started_at, completed_at, jobs_discovered, jobs_inserted, jobs_updated, rediscoveries, created_at)
      VALUES 
        ('r1', 'src-1', 'indeed', 'failed', '2026-08-12T11:00:00Z', '2026-08-12T11:01:00Z', 0, 0, 0, 0, '2026-08-12T11:00:00Z'),
        ('r2', 'src-2', 'indeed', 'failed', '2026-08-12T11:10:00Z', '2026-08-12T11:11:00Z', 0, 0, 0, 0, '2026-08-12T11:00:00Z'),
        ('r3', 'src-3', 'indeed', 'failed', '2026-08-12T11:20:00Z', '2026-08-12T11:21:00Z', 0, 0, 0, 0, '2026-08-12T11:00:00Z')
    `).run();

    // Set individual failure counts to 2 (normally triggers source-failure-streak)
    db.prepare("UPDATE sources SET failure_count = 2 WHERE provider_id = 'indeed'").run();

    alertService.evaluateRules();

    const list = alertService.listAlerts();
    // Only provider-degraded should trigger, individual source alerts must be suppressed!
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      ruleId: 'provider-degraded',
      severity: 'WARNING',
      entityId: 'indeed',
    });
  });

  it('computes discovery analytics Global Summary correctly', () => {
    const { db, analyticsService, employerRepository } = setupDb();
    
    insertTestSource(db, { id: 'src-active' });
    const disabled = insertTestSource(db, { id: 'src-disabled' });
    db.prepare("UPDATE sources SET enabled = 0 WHERE id = ?").run(disabled);

    const emp = employerRepository.createEmployer({ name: 'Acme', websiteUrl: null });
    const site1 = employerRepository.createCareerSite(emp.id, { url: 'https://acme.com/jobs1' });
    const site2 = employerRepository.createCareerSite(emp.id, { url: 'https://acme.com/jobs2' });

    db.prepare("UPDATE career_sites SET health_status = 'healthy' WHERE id = ?").run(site1.id);
    db.prepare("UPDATE career_sites SET health_status = 'broken' WHERE id = ?").run(site2.id);

    const summary = analyticsService.getGlobalSummary();
    expect(summary).toEqual({
      enabledSources: 1,
      disabledSources: 1,
      totalCareerSites: 2,
      activeCareerSites: 2,
      retiredCareerSites: 0,
      healthyCareerSites: 1,
      warningCareerSites: 0,
      brokenCareerSites: 1,
      unknownCareerSites: 0,
    });
  });
});
