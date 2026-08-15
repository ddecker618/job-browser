import { randomUUID } from 'node:crypto';
import type { JobDatabase } from '../db/database.js';

export interface DiscoveryAlert {
  id: string;
  ruleId: string;
  entityType: 'source' | 'career_site' | 'provider';
  entityId: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  state: 'active' | 'acknowledged' | 'resolved';
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
  message: string;
  evidenceJson: string;
  ruleVersion: string;
}

const RULE_VERSION = 'discovery-alert-rules-v1';

export class DiscoveryAlertService {
  public constructor(
    private readonly database: JobDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public listAlerts(options: { state?: 'active' | 'acknowledged' | 'resolved' } = {}): DiscoveryAlert[] {
    const db = this.database;
    let query = `
      SELECT id, rule_id, entity_type, entity_id, severity, state,
             first_detected_at, last_detected_at, resolved_at, acknowledged_at,
             message, evidence_json, rule_version
        FROM discovery_alerts
    `;
    const params: string[] = [];
    if (options.state) {
      query += ' WHERE state = ?';
      params.push(options.state);
    } else {
      query += " WHERE state IN ('active', 'acknowledged')";
    }
    query += ' ORDER BY severity = \'CRITICAL\' DESC, severity = \'WARNING\' DESC, last_detected_at DESC';

    const rows = db.prepare(query).all(...params) as unknown as DiscoveryAlertRow[];
    return rows.map(mapRow);
  }

  public getAlert(id: string): DiscoveryAlert | null {
    const row = this.database
      .prepare(`
        SELECT id, rule_id, entity_type, entity_id, severity, state,
               first_detected_at, last_detected_at, resolved_at, acknowledged_at,
               message, evidence_json, rule_version
          FROM discovery_alerts
         WHERE id = ?
      `)
      .get(id) as unknown as DiscoveryAlertRow | undefined;

    return row ? mapRow(row) : null;
  }

  public acknowledgeAlert(id: string): DiscoveryAlert | null {
    const timestamp = this.now().toISOString();
    this.database
      .prepare(`
        UPDATE discovery_alerts
           SET state = 'acknowledged', acknowledged_at = ?
         WHERE id = ? AND state = 'active'
      `)
      .run(timestamp, id);

    return this.getAlert(id);
  }

  public evaluateRules(): void {
    const db = this.database;
    const evaluatedAt = this.now().toISOString();

    db.transaction(() => {
      // 1. Fetch current active/acknowledged alerts to track resolution
      const activeAlerts = db.prepare(`
        SELECT id, rule_id, entity_type, entity_id
          FROM discovery_alerts
         WHERE state IN ('active', 'acknowledged')
      `).all() as { id: string; rule_id: string; entity_type: string; entity_id: string }[];

      // Keep track of which alerts were triggered in this evaluation pass
      const triggeredAlertIds = new Set<string>();

      // Rule evaluation logic helper
      const processAlert = (
        ruleId: string,
        entityType: 'source' | 'career_site' | 'provider',
        entityId: string,
        severity: 'INFO' | 'WARNING' | 'CRITICAL',
        message: string,
        evidence: Record<string, unknown>,
      ) => {
        const existing = activeAlerts.find(
          (a) =>
            a.rule_id === ruleId &&
            a.entity_type === entityType &&
            a.entity_id === entityId,
        );

        if (existing) {
          triggeredAlertIds.add(existing.id);
          db.prepare(`
            UPDATE discovery_alerts
               SET last_detected_at = ?, severity = ?, message = ?, evidence_json = ?
             WHERE id = ?
          `).run(evaluatedAt, severity, message, JSON.stringify(evidence), existing.id);
        } else {
          const newId = randomUUID();
          db.prepare(`
            INSERT INTO discovery_alerts (
              id, rule_id, entity_type, entity_id, severity, state,
              first_detected_at, last_detected_at, resolved_at, acknowledged_at,
              message, evidence_json, rule_version
            ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL, ?, ?, ?)
          `).run(
            newId,
            ruleId,
            entityType,
            entityId,
            severity,
            evaluatedAt,
            evaluatedAt,
            message,
            JSON.stringify(evidence),
            RULE_VERSION,
          );
        }
      };

      // --- EVALUATE RULES ---

      // 1. PROVIDER DEGRADATION (evaluated first so we can suppress source failure alerts)
      // Check last 24h of runs grouped by provider
      const last24hIso = new Date(Date.parse(evaluatedAt) - 24 * 60 * 60 * 1000).toISOString();
      const providerStats = db.prepare(`
        SELECT provider_id,
               COUNT(*) AS total,
               SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
          FROM runs
         WHERE provider_id IS NOT NULL 
           AND started_at >= ?
         GROUP BY provider_id
      `).all(last24hIso) as { provider_id: string; total: number; succeeded: number; failed: number }[];

      const degradedProviders = new Set<string>();

      for (const p of providerStats) {
        // Count enabled sources for provider
        const enabledSources = db.prepare(`
          SELECT COUNT(*) AS count FROM sources WHERE provider_id = ? AND enabled = 1
        `).get(p.provider_id) as { count: number };

        if (enabledSources.count >= 3 && p.total >= 3) {
          const failureRate = p.failed / (p.succeeded + p.failed || 1);
          // Find distinct sources that had at least one failed run in last 24 hours
          const failedSources = db.prepare(`
            SELECT COUNT(DISTINCT source_id) AS count
              FROM runs
             WHERE provider_id = ? AND status = 'failed' AND started_at >= ?
          `).get(p.provider_id, last24hIso) as { count: number };

          if (failureRate >= 0.5 && failedSources.count >= 3) {
            degradedProviders.add(p.provider_id);
            processAlert(
              'provider-degraded',
              'provider',
              p.provider_id,
              'WARNING',
              `Provider ${p.provider_id} is degraded: ${String(p.failed)}/${String(p.total)} runs failed in the last 24 hours across ${String(failedSources.count)} sources.`,
              { totalRuns: p.total, failedRuns: p.failed, failureRate, failedSources: failedSources.count },
            );
          }
        }
      }

      // 2. SOURCE FAILURE STREAK
      // Trigger when enabled source failure_count >= 2
      const sources = db.prepare(`
        SELECT id, display_name, provider_id, failure_count FROM sources WHERE enabled = 1
      `).all() as { id: string; display_name: string | null; provider_id: string | null; failure_count: number }[];

      for (const src of sources) {
        // If provider is degraded, we suppress individual source failure alert
        if (src.provider_id && degradedProviders.has(src.provider_id)) {
          continue;
        }

        if (src.failure_count >= 2) {
          const severity = src.failure_count >= 3 ? 'CRITICAL' : 'WARNING';
          processAlert(
            'source-failure-streak',
            'source',
            src.id,
            severity,
            `Source "${src.display_name ?? src.id}" has failed ${String(src.failure_count)} consecutive times.`,
            { consecutiveFailures: src.failure_count },
          );
        }
      }

      // 3. SOURCE OVERDUE
      // Scheduled source is overdue by >= 1 hour relative to next_run_at
      const schedulerEnabledRow = db.prepare(`
        SELECT scheduler_enabled FROM discovery_settings WHERE id = 'default'
      `).get() as { scheduler_enabled: number } | undefined;
      const schedulerEnabled = Boolean(schedulerEnabledRow?.scheduler_enabled);

      if (schedulerEnabled) {
        const scheduledSources = db.prepare(`
          SELECT s.id, s.display_name, ss.next_run_at, cs.discovery_state, cs.health_status
            FROM sources s
            JOIN source_schedules ss ON ss.source_id = s.id
            LEFT JOIN career_sites cs ON cs.source_id = s.id
           WHERE s.enabled = 1 AND ss.enabled = 1 AND ss.next_run_at IS NOT NULL
        `).all() as { id: string; display_name: string | null; next_run_at: string; discovery_state: string | null; health_status: string | null }[];

        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        for (const ss of scheduledSources) {
          if (
            ss.next_run_at <= oneHourAgo &&
            ss.discovery_state !== 'backoff' &&
            ss.discovery_state !== 'retired' &&
            ss.health_status !== 'retired'
          ) {
            processAlert(
              'source-overdue',
              'source',
              ss.id,
              'WARNING',
              `Source "${ss.display_name ?? ss.id}" run is overdue (scheduled next run was ${ss.next_run_at}).`,
              { nextRunAt: ss.next_run_at },
            );
          }
        }
      }

      // 4. CAREERSITE BROKEN
      const careerSites = db.prepare(`
        SELECT cs.id, cs.url, e.name AS employer_name, cs.health_status, cs.health_message
          FROM career_sites cs
          JOIN employers e ON e.id = cs.employer_id
         WHERE cs.health_status IN ('broken', 'warning')
      `).all() as { id: string; url: string; employer_name: string; health_status: string; health_message: string | null }[];

      for (const cs of careerSites) {
        const severity = cs.health_status === 'broken' ? 'CRITICAL' : 'WARNING';
        processAlert(
          'career-site-broken',
          'career_site',
          cs.id,
          severity,
          `Career site health check for ${cs.employer_name} is ${cs.health_status}: ${cs.health_message ?? 'unhealthy'}.`,
          { healthStatus: cs.health_status, url: cs.url, message: cs.health_message },
        );
      }

      // 5. ZERO-YIELD STREAK
      // 3 successful completed runs return 0 jobs, and previously yielded jobs
      for (const src of sources) {
        // Get last 3 completed successful runs for this source
        const lastRuns = db.prepare(`
          SELECT id, jobs_discovered
            FROM runs
           WHERE source_id = ? AND status = 'succeeded'
           ORDER BY started_at DESC
           LIMIT 3
        `).all(src.id) as { id: string; jobs_discovered: number }[];

        if (lastRuns.length >= 3 && lastRuns.every((r) => r.jobs_discovered === 0)) {
          // Check if there's any older successful run with yield > 0
          const hasHistoricalYield = db.prepare(`
            SELECT COUNT(*) AS count
              FROM runs
             WHERE source_id = ? AND status = 'succeeded' AND jobs_discovered > 0
          `).get(src.id) as { count: number };

          if (hasHistoricalYield.count > 0) {
            processAlert(
              'zero-yield-streak',
              'source',
              src.id,
              'WARNING',
              `Source "${src.display_name ?? src.id}" has successfully completed 3 runs but yielded 0 new jobs.`,
              { runIds: lastRuns.map((r) => r.id) },
            );
          }
        }
      }

      // 6. DISCOVERY STALE
      // Source stale
      const scheduledCadences = db.prepare(`
        SELECT s.id, s.display_name, ss.cadence
          FROM sources s
          JOIN source_schedules ss ON ss.source_id = s.id
         WHERE s.enabled = 1 AND ss.enabled = 1
      `).all() as { id: string; display_name: string | null; cadence: string }[];

      for (const sc of scheduledCadences) {
        let cadenceHours = 24;
        if (sc.cadence === 'every-6-hours') cadenceHours = 6;
        else if (sc.cadence === 'every-12-hours') cadenceHours = 12;

        const lastSuccess = db.prepare(`
          SELECT completed_at
            FROM runs
           WHERE source_id = ? AND status = 'succeeded'
           ORDER BY started_at DESC
           LIMIT 1
        `).get(sc.id) as { completed_at: string } | undefined;

        if (lastSuccess) {
          const staleHours = (Date.now() - Date.parse(lastSuccess.completed_at)) / 3600000;
          if (staleHours > 3 * cadenceHours) {
            processAlert(
              'discovery-stale',
              'source',
              sc.id,
              'WARNING',
              `Source "${sc.display_name ?? sc.id}" is stale (last successful run was ${String(Math.round(staleHours))} hours ago, expected cadence is ${String(cadenceHours)} hours).`,
              { lastSuccessfulRunAt: lastSuccess.completed_at, staleHours },
            );
          }
        }
      }

      // CareerSite stale
      const activeSites = db.prepare(`
        SELECT cs.id, cs.url, e.name AS employer_name, cs.discovery_state, cs.source_id
          FROM career_sites cs
          JOIN employers e ON e.id = cs.employer_id
         WHERE cs.health_status != 'retired' AND cs.discovery_state != 'retired'
      `).all() as { id: string; url: string; employer_name: string; discovery_state: string; source_id: string | null }[];

      // To evaluate career sites, we check their scheduling class
      const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const windowEnd = new Date().toISOString();

      for (const cs of activeSites) {
        // Query site rows format for classifying
        const row = db.prepare(`
          SELECT cs.id AS career_site_id, cs.employer_id, e.name AS employer_name,
                  cs.url, cs.source_id, cs.ats_detected_provider AS detected_provider,
                  cs.ats_confidence, cs.ats_support_state AS support_state,
                  cs.discovery_state, cs.next_discovery_attempt_at,
                  cs.health_status, cs.health_failure_count, cs.health_checked_at,
                  s.enabled AS source_enabled, s.configuration_status,
                  s.health_status AS source_health_status,
                  s.provider_id AS source_provider_id, cs.created_at
             FROM career_sites cs
             JOIN employers e ON e.id = cs.employer_id
             LEFT JOIN sources s ON s.id = cs.source_id
            WHERE cs.id = ?
        `).get(cs.id) as CareerSiteDetailRow | undefined;

        if (!row) continue;

        // Classify scheduling class
        const runsForSite = cs.source_id === null ? [] : (db.prepare(`
          SELECT source_id, provider_id, status, started_at, completed_at, jobs_discovered
            FROM runs
           WHERE source_id = ? AND started_at >= ? AND started_at < ?
           ORDER BY started_at DESC
        `).all(cs.source_id, windowStart, windowEnd) as RunRow[]);

        const successes = runsForSite.filter((run) => run.status === 'succeeded');
        const lastSuccessAt = successes.map((run) => run.completed_at ?? run.started_at).sort().at(-1) ?? null;

        const activityRow = cs.source_id === null ? undefined : (db.prepare(`
          SELECT source_id,
                  COUNT(DISTINCT CASE WHEN active = 1 THEN job_id END) AS active_jobs,
                  COUNT(DISTINCT CASE WHEN active = 1 AND first_seen_at >= ? AND first_seen_at < ? THEN job_id END) AS jobs_first_seen,
                  MAX(CASE WHEN active = 1 AND first_seen_at >= ? AND first_seen_at < ? THEN first_seen_at END) AS last_new_job_at
             FROM job_sources
            WHERE source_id = ? AND job_id NOT IN (SELECT id FROM jobs WHERE user_removed = 1)
            GROUP BY source_id
        `).get(windowStart, windowEnd, windowStart, windowEnd, cs.source_id) as ActivityRow | undefined);

        const activityKnown = cs.source_id !== null && successes.length > 0;
        const activity: SiteActivity = {
          known: activityKnown,
          activeJobs: activityKnown ? (activityRow?.active_jobs ?? 0) : null,
          jobsFirstSeen: activityKnown ? (activityRow?.jobs_first_seen ?? 0) : null,
          lastNewJobAt: activityKnown ? (activityRow?.last_new_job_at ?? null) : null,
          lastSuccessfulDiscoveryAt: lastSuccessAt,
          successfulRuns: successes.length,
          failedRuns: runsForSite.filter((run) => run.status === 'failed').length,
          zeroResultSuccessfulRuns: successes.filter((run) => run.jobs_discovered === 0).length,
        };

        const schedulingClass = classifySchedulingClass(row, activity);
        const cadenceHours = cadenceForClass(schedulingClass);

        if (cadenceHours !== null && cs.discovery_state !== 'backoff') {
          const anchor = activity.lastSuccessfulDiscoveryAt ?? row.created_at;
          const staleHours = (Date.now() - Date.parse(anchor)) / 3600000;
          if (staleHours > 3 * cadenceHours) {
            processAlert(
              'discovery-stale',
              'career_site',
              cs.id,
              'WARNING',
              `Career site for ${cs.employer_name} is stale (last successful discovery was ${String(Math.round(staleHours))} hours ago, expected cadence is ${String(cadenceHours)} hours).`,
              { lastDiscoveryAt: anchor, staleHours },
            );
          }
        }
      }

      // --- RESOLVE ALERTS ---
      // Resolve any active alerts that were not triggered in this evaluation pass
      for (const active of activeAlerts) {
        if (!triggeredAlertIds.has(active.id)) {
          db.prepare(`
            UPDATE discovery_alerts
               SET state = 'resolved', resolved_at = ?
             WHERE id = ?
          `).run(evaluatedAt, active.id);
        }
      }
    })();
  }
}

interface DiscoveryAlertRow {
  id: string;
  rule_id: string;
  entity_type: string;
  entity_id: string;
  severity: string;
  state: string;
  first_detected_at: string;
  last_detected_at: string;
  resolved_at: string | null;
  acknowledged_at: string | null;
  message: string;
  evidence_json: string;
  rule_version: string;
}

function mapRow(row: DiscoveryAlertRow): DiscoveryAlert {
  return {
    id: row.id,
    ruleId: row.rule_id,
    entityType: row.entity_type as DiscoveryAlert['entityType'],
    entityId: row.entity_id,
    severity: row.severity as DiscoveryAlert['severity'],
    state: row.state as DiscoveryAlert['state'],
    firstDetectedAt: row.first_detected_at,
    lastDetectedAt: row.last_detected_at,
    resolvedAt: row.resolved_at,
    acknowledgedAt: row.acknowledged_at,
    message: row.message,
    evidenceJson: row.evidence_json,
    ruleVersion: row.rule_version,
  };
}

function classifySchedulingClass(
  row: {
    health_status: string;
    discovery_state: string;
    configuration_status: string | null;
    support_state: string | null;
    detected_provider: string | null;
    health_failure_count: number;
  },
  activity: SiteActivity,
): string {
  if (row.health_status === 'retired' || row.discovery_state === 'retired')
    return 'retired';
  if (row.configuration_status === 'credentials-required')
    return 'credential-required';
  if (
    row.support_state !== null &&
    (row.support_state === 'unsupported' || row.detected_provider === null)
  )
    return 'unsupported';
  if (
    row.health_status === 'warning' ||
    row.health_status === 'broken' ||
    row.discovery_state === 'backoff' ||
    row.health_failure_count > 0
  )
    return 'degraded';
  if (activity.known && (activity.jobsFirstSeen ?? 0) > 0)
    return 'high-priority';
  if (
    activity.known &&
    activity.activeJobs === 0 &&
    activity.jobsFirstSeen === 0
  )
    return 'stable';
  return 'normal';
}

function cadenceForClass(value: string): number | null {
  switch (value) {
    case 'high-priority':
      return 6;
    case 'normal':
      return 24;
    case 'stable':
      return 72;
    case 'degraded':
      return 24;
    default:
      return null;
  }
}

interface CareerSiteDetailRow {
  career_site_id: string;
  employer_id: string;
  employer_name: string;
  url: string;
  source_id: string | null;
  detected_provider: string | null;
  ats_confidence: number | null;
  support_state: string | null;
  discovery_state: string;
  next_discovery_attempt_at: string | null;
  health_status: string;
  health_failure_count: number;
  health_checked_at: string | null;
  source_enabled: number | null;
  configuration_status: string | null;
  source_health_status: string | null;
  source_provider_id: string | null;
  created_at: string;
}

interface RunRow {
  source_id: string;
  provider_id: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  jobs_discovered: number;
}

interface ActivityRow {
  source_id: string;
  active_jobs: number;
  jobs_first_seen: number;
  last_new_job_at: string | null;
}

interface SiteActivity {
  known: boolean;
  activeJobs: number | null;
  jobsFirstSeen: number | null;
  lastNewJobAt: string | null;
  lastSuccessfulDiscoveryAt: string | null;
  successfulRuns: number;
  failedRuns: number;
  zeroResultSuccessfulRuns: number;
}
