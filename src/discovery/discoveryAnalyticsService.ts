import type { JobDatabase } from '../db/database.js';

export interface GlobalDiscoverySummary {
  enabledSources: number;
  disabledSources: number;
  totalCareerSites: number;
  activeCareerSites: number;
  retiredCareerSites: number;
  healthyCareerSites: number;
  warningCareerSites: number;
  brokenCareerSites: number;
  unknownCareerSites: number;
}

export interface DiscoveryAnalyticsWindow {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  interruptedRuns: number;
  zeroResultSuccessfulRuns: number;
  successRate: number;
  failureRate: number;
  averageDurationMs: number | null;
  medianDurationMs: number | null;
  lastSuccessfulRun: string | null;
  lastFailedRun: string | null;
}

export interface DiscoveryJobYield {
  jobsDiscovered: number;
  newCanonicalJobs: number;
  rediscoveredJobs: number;
  jobsUpdated: number;
  jobsClosed: number;
  currentlyActiveJobs: number;
  userRemovedJobsExcluded: number;
  newJobYieldPerSuccessfulRun: number;
  zeroYieldRunCount: number;
}

export interface DiscoveryAnalyticsReport {
  summary: GlobalDiscoverySummary;
  activity: DiscoveryAnalyticsWindow;
  yield: DiscoveryJobYield;
}

export interface SourceAnalyticsRow {
  sourceId: string;
  displayName: string;
  provider: string;
  enabled: boolean;
  lastRun: string | null;
  lastSuccessfulRun: string | null;
  lastFailure: string | null;
  consecutiveFailures: number;
  successRate: number;
  runCount: number;
  newJobs: number;
  activeJobs: number;
  jobsPerSuccessfulRun: number;
  zeroResultStreak: number;
  staleDurationHours: number | null;
  nextScheduledRun: string | null;
  healthStatus: string;
}

export interface ProviderAnalyticsRow {
  providerId: string;
  providerName: string;
  sourcesCount: number;
  successfulRuns: number;
  failedRuns: number;
  successRate: number;
  averageYield: number;
  recentFailureTrend: 'stable' | 'degrading';
  recentZeroYieldTrend: 'stable' | 'high-zero-yield';
}

export class DiscoveryAnalyticsService {
  public constructor(
    private readonly database: JobDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public getReport(windowHours = 24): DiscoveryAnalyticsReport {
    const end = this.now();
    const start = new Date(end.getTime() - windowHours * 60 * 60 * 1000);
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const summary = this.getGlobalSummary();
    const activity = this.getActivityWindow(startIso, endIso);
    const yieldMetrics = this.getJobYield(startIso, endIso);

    return {
      summary,
      activity,
      yield: yieldMetrics,
    };
  }

  public getGlobalSummary(): GlobalDiscoverySummary {
    const db = this.database;

    const enabledSources = db.prepare('SELECT COUNT(*) AS count FROM sources WHERE enabled = 1').get() as { count: number };
    const disabledSources = db.prepare('SELECT COUNT(*) AS count FROM sources WHERE enabled = 0').get() as { count: number };
    const totalCareerSites = db.prepare('SELECT COUNT(*) AS count FROM career_sites').get() as { count: number };
    const activeCareerSites = db.prepare("SELECT COUNT(*) AS count FROM career_sites WHERE discovery_state != 'retired'").get() as { count: number };
    const retiredCareerSites = db.prepare("SELECT COUNT(*) AS count FROM career_sites WHERE discovery_state = 'retired'").get() as { count: number };
    const healthyCareerSites = db.prepare("SELECT COUNT(*) AS count FROM career_sites WHERE health_status = 'healthy'").get() as { count: number };
    const warningCareerSites = db.prepare("SELECT COUNT(*) AS count FROM career_sites WHERE health_status = 'warning'").get() as { count: number };
    const brokenCareerSites = db.prepare("SELECT COUNT(*) AS count FROM career_sites WHERE health_status = 'broken'").get() as { count: number };
    const unknownCareerSites = db.prepare("SELECT COUNT(*) AS count FROM career_sites WHERE health_status = 'unknown'").get() as { count: number };

    return {
      enabledSources: enabledSources.count,
      disabledSources: disabledSources.count,
      totalCareerSites: totalCareerSites.count,
      activeCareerSites: activeCareerSites.count,
      retiredCareerSites: retiredCareerSites.count,
      healthyCareerSites: healthyCareerSites.count,
      warningCareerSites: warningCareerSites.count,
      brokenCareerSites: brokenCareerSites.count,
      unknownCareerSites: unknownCareerSites.count,
    };
  }

  public getActivityWindow(start: string, end: string): DiscoveryAnalyticsWindow {
    const db = this.database;

    const stats = db.prepare(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'interrupted' THEN 1 ELSE 0 END) AS interrupted,
        SUM(CASE WHEN status = 'succeeded' AND jobs_discovered = 0 THEN 1 ELSE 0 END) AS zero_result,
        MAX(CASE WHEN status = 'succeeded' THEN completed_at END) AS last_success,
        MAX(CASE WHEN status = 'failed' THEN completed_at END) AS last_failed,
        AVG(execution_time_ms) AS avg_duration
      FROM runs
      WHERE started_at >= ? AND started_at < ?
    `).get(start, end) as {
      total: number;
      succeeded: number;
      failed: number;
      interrupted: number;
      zero_result: number;
      last_success: string | null;
      last_failed: string | null;
      avg_duration: number | null;
    };

    const durationRows = db.prepare(`
      SELECT execution_time_ms
      FROM runs
      WHERE started_at >= ? AND started_at < ? AND execution_time_ms IS NOT NULL
      ORDER BY execution_time_ms ASC
    `).all(start, end) as { execution_time_ms: number }[];

    let medianDurationMs: number | null = null;
    if (durationRows.length > 0) {
      const mid = Math.floor(durationRows.length / 2);
      if (durationRows.length % 2 === 0) {
        medianDurationMs = ((durationRows[mid - 1]?.execution_time_ms ?? 0) + (durationRows[mid]?.execution_time_ms ?? 0)) / 2;
      } else {
        medianDurationMs = durationRows[mid]?.execution_time_ms ?? null;
      }
    }

    const total = stats.total || 0;
    const succeeded = stats.succeeded || 0;
    const failed = stats.failed || 0;
    const completed = succeeded + failed;

    return {
      totalRuns: total,
      successfulRuns: succeeded,
      failedRuns: failed,
      interruptedRuns: stats.interrupted || 0,
      zeroResultSuccessfulRuns: stats.zero_result || 0,
      successRate: completed === 0 ? 0 : succeeded / completed,
      failureRate: completed === 0 ? 0 : failed / completed,
      averageDurationMs: stats.avg_duration === null ? null : Math.round(stats.avg_duration),
      medianDurationMs: medianDurationMs === null ? null : Math.round(medianDurationMs),
      lastSuccessfulRun: stats.last_success,
      lastFailedRun: stats.last_failed,
    };
  }

  public getJobYield(start: string, end: string): DiscoveryJobYield {
    const db = this.database;

    const runMetrics = db.prepare(`
      SELECT 
        SUM(jobs_discovered) AS discovered,
        SUM(rediscoveries) AS rediscovered,
        SUM(jobs_updated) AS updated,
        SUM(CASE WHEN status = 'succeeded' AND jobs_inserted = 0 THEN 1 ELSE 0 END) AS zero_yield_runs
      FROM runs
      WHERE started_at >= ? AND started_at < ?
    `).get(start, end) as {
      discovered: number | null;
      rediscovered: number | null;
      updated: number | null;
      zero_yield_runs: number | null;
    };

    const newCanonical = db.prepare(`
      SELECT COUNT(*) AS count
      FROM jobs
      WHERE first_seen_at >= ? AND first_seen_at < ? AND user_removed = 0
    `).get(start, end) as { count: number };

    const closed = db.prepare(`
      SELECT COUNT(*) AS count
      FROM jobs
      WHERE active = 0 AND updated_at >= ? AND updated_at < ?
    `).get(start, end) as { count: number };

    const activeCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM jobs
      WHERE active = 1 AND user_removed = 0
    `).get() as { count: number };

    const userRemoved = db.prepare(`
      SELECT COUNT(*) AS count
      FROM jobs
      WHERE user_removed = 1
    `).get() as { count: number };

    const successfulRunsResult = db.prepare(`
      SELECT COUNT(*) AS count FROM runs WHERE started_at >= ? AND started_at < ? AND status = 'succeeded'
    `).get(start, end) as { count: number };

    const successfulRuns = successfulRunsResult.count;
    const newCanonicalCount = newCanonical.count;

    return {
      jobsDiscovered: runMetrics.discovered ?? 0,
      newCanonicalJobs: newCanonicalCount,
      rediscoveredJobs: runMetrics.rediscovered ?? 0,
      jobsUpdated: runMetrics.updated ?? 0,
      jobsClosed: closed.count,
      currentlyActiveJobs: activeCount.count,
      userRemovedJobsExcluded: userRemoved.count,
      newJobYieldPerSuccessfulRun: successfulRuns === 0 ? 0 : newCanonicalCount / successfulRuns,
      zeroYieldRunCount: runMetrics.zero_yield_runs ?? 0,
    };
  }

  public getSourceAnalytics(): SourceAnalyticsRow[] {
    const db = this.database;
    const now = this.now();

    const sources = db.prepare(`
      SELECT s.id, s.display_name, s.provider_id, s.enabled, s.failure_count, s.health_status,
             ss.next_run_at
        FROM sources s
        LEFT JOIN source_schedules ss ON ss.source_id = s.id
       ORDER BY s.display_name COLLATE NOCASE
    `).all() as {
      id: string;
      display_name: string | null;
      provider_id: string | null;
      enabled: number;
      failure_count: number;
      health_status: string;
      next_run_at: string | null;
    }[];

    return sources.map((source) => {
      const runStats = db.prepare(`
        SELECT 
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          MAX(started_at) AS last_run,
          MAX(CASE WHEN status = 'succeeded' THEN completed_at END) AS last_success,
          MAX(CASE WHEN status = 'failed' THEN completed_at END) AS last_failed,
          AVG(CASE WHEN status = 'succeeded' THEN jobs_discovered ELSE 0 END) AS avg_discovered
        FROM runs
        WHERE source_id = ?
      `).get(source.id) as {
        total: number;
        succeeded: number;
        failed: number;
        last_run: string | null;
        last_success: string | null;
        last_failed: string | null;
        avg_discovered: number | null;
      };

      const activeJobs = db.prepare(`
        SELECT COUNT(DISTINCT js.job_id) AS count
          FROM job_sources js
          JOIN jobs j ON j.id = js.job_id
         WHERE js.source_id = ? AND js.active = 1 AND j.user_removed = 0
      `).get(source.id) as { count: number };

      const allTimeNewJobs = db.prepare(`
        SELECT COUNT(DISTINCT js.job_id) AS count
          FROM job_sources js
          JOIN jobs j ON j.id = js.job_id
         WHERE js.source_id = ? AND j.user_removed = 0
      `).get(source.id) as { count: number };

      // Calculate zero result streak
      const recentRuns = db.prepare(`
        SELECT status, jobs_discovered
          FROM runs
         WHERE source_id = ? AND status = 'succeeded'
         ORDER BY started_at DESC
      `).all(source.id) as { status: string; jobs_discovered: number }[];

      let zeroResultStreak = 0;
      for (const run of recentRuns) {
        if (run.jobs_discovered === 0) {
          zeroResultStreak++;
        } else {
          break;
        }
      }

      const completed = (runStats.succeeded || 0) + (runStats.failed || 0);
      const staleDurationHours = runStats.last_success
        ? Math.max(0, now.getTime() - Date.parse(runStats.last_success)) / 3600000
        : null;

      return {
        sourceId: source.id,
        displayName: source.display_name ?? source.id,
        provider: source.provider_id ?? 'unknown',
        enabled: Boolean(source.enabled),
        lastRun: runStats.last_run,
        lastSuccessfulRun: runStats.last_success,
        lastFailure: runStats.last_failed,
        consecutiveFailures: source.failure_count,
        successRate: completed === 0 ? 0 : (runStats.succeeded || 0) / completed,
        runCount: runStats.total || 0,
        newJobs: allTimeNewJobs.count,
        activeJobs: activeJobs.count,
        jobsPerSuccessfulRun: runStats.avg_discovered === null ? 0 : Math.round(runStats.avg_discovered * 10) / 10,
        zeroResultStreak,
        staleDurationHours: staleDurationHours === null ? null : Math.round(staleDurationHours * 10) / 10,
        nextScheduledRun: source.next_run_at,
        healthStatus: source.health_status,
      };
    });
  }

  public getProviderAnalytics(): ProviderAnalyticsRow[] {
    const db = this.database;
    const end = this.now();
    const start24h = new Date(end.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const providers = db.prepare(`
      SELECT DISTINCT provider_id, provider_name
        FROM provider_metadata
       WHERE provider_id IS NOT NULL
    `).all() as { provider_id: string; provider_name: string }[];

    return providers.map((provider) => {
      const sourcesCount = db.prepare(`
        SELECT COUNT(*) AS count FROM sources WHERE provider_id = ? AND enabled = 1
      `).get(provider.provider_id) as { count: number };

      const runStats = db.prepare(`
        SELECT 
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          AVG(CASE WHEN status = 'succeeded' THEN jobs_discovered ELSE 0 END) AS avg_yield
        FROM runs
        WHERE provider_id = ? AND started_at >= ?
      `).get(provider.provider_id, start24h) as {
        total: number;
        succeeded: number;
        failed: number;
        avg_yield: number | null;
      };

      const succeeded = runStats.succeeded;
      const failed = runStats.failed;
      const completed = succeeded + failed;

      // recentFailureTrend: "degrading" if failure rate >= 50% and failed runs >= 3, else "stable"
      const recentFailureTrend = (completed >= 3 && (failed / completed) >= 0.5) ? 'degrading' : 'stable';

      // zero yield trend: count zero-yield succeeded runs in the last 24 hours
      const zeroYieldRunsResult = db.prepare(`
        SELECT COUNT(*) AS count FROM runs
         WHERE provider_id = ? AND started_at >= ? AND status = 'succeeded' AND jobs_discovered = 0
      `).get(provider.provider_id, start24h) as { count: number };

      const zeroYieldRuns = zeroYieldRunsResult.count;
      const recentZeroYieldTrend = (succeeded >= 3 && (zeroYieldRuns / succeeded) >= 0.75) ? 'high-zero-yield' : 'stable';

      return {
        providerId: provider.provider_id,
        providerName: provider.provider_name,
        sourcesCount: sourcesCount.count,
        successfulRuns: succeeded,
        failedRuns: failed,
        successRate: completed === 0 ? 1 : succeeded / completed,
        averageYield: runStats.avg_yield === null ? 0 : Math.round(runStats.avg_yield * 10) / 10,
        recentFailureTrend,
        recentZeroYieldTrend,
      };
    });
  }
}
