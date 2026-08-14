import type { JobDatabase } from '../db/database.js';
import {
  EMPLOYER_DISCOVERY_INTELLIGENCE_VERSION,
  type CareerSiteActivityMetrics,
  type CareerSiteIntelligenceDecision,
  type DiscoveryIntelligenceSummary,
  type DiscoveryPriorityComponent,
  type DiscoverySchedulingClass,
  type EmployerActivityMetrics,
  type ProviderSuccessMetrics,
} from '../models/employer-discovery-intelligence.js';

const ACTIVITY_WINDOW_DAYS = 30;
const MAX_SITE_RESULTS = 100;
const MAX_PROVIDER_RESULTS = 50;
const MAX_EMPLOYER_RESULTS = 100;
const DUE_SOON_MS = 24 * 60 * 60 * 1000;

interface IntelligenceRow {
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

interface ActivityRow {
  source_id: string;
  active_jobs: number;
  jobs_first_seen: number;
  last_new_job_at: string | null;
}

interface RunRow {
  source_id: string | null;
  provider_id: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  jobs_discovered: number;
}

interface AttemptRow {
  career_site_id: string;
  provider_id: string | null;
  source_id: string | null;
  result: string;
}

interface ProviderRow {
  provider_id: string;
  provider_name: string;
}

interface EmployerActivityRow {
  employer_id: string;
  active_jobs: number;
  jobs_first_seen: number;
  last_new_job_at: string | null;
  last_successful_discovery_at: string | null;
  successful_runs: number;
}

export class EmployerDiscoveryIntelligenceService {
  public constructor(
    private readonly database: JobDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public summary(evaluatedAt = this.now()): DiscoveryIntelligenceSummary {
    return this.buildSummary(evaluatedAt);
  }

  private buildSummary(
    evaluatedAt: Date,
    careerSiteId?: string,
  ): DiscoveryIntelligenceSummary {
    const windowEnd = evaluatedAt.toISOString();
    const windowStart = new Date(
      evaluatedAt.getTime() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const allRows = this.siteRows();
    const rows =
      careerSiteId === undefined
        ? allRows
        : allRows.filter((row) => row.career_site_id === careerSiteId);
    const activities = new Map(
      this.activityRows(windowStart, windowEnd).map((row) => [
        row.source_id,
        row,
      ]),
    );
    const runs = this.runRows(windowStart, windowEnd);
    const attempts = this.attemptRows(windowStart, windowEnd);
    const providers = this.providerMetrics(runs, attempts);
    const providersById = new Map(
      providers.map((provider) => [provider.providerId, provider]),
    );
    const runsBySource = groupRunsBySource(runs);
    const allDecisions = rows
      .map((row) =>
        decision(
          row,
          evaluatedAt,
          windowStart,
          windowEnd,
          row.source_id === null ? undefined : activities.get(row.source_id),
          row.source_id === null ? [] : (runsBySource.get(row.source_id) ?? []),
          providersById.get(
            row.source_provider_id ?? row.detected_provider ?? '',
          ),
        ),
      )
      .sort(compareDecisions);
    const sites = allDecisions.slice(0, MAX_SITE_RESULTS);
    const allEmployers = employerMetrics(
      rows,
      this.employerActivityRows(windowStart, windowEnd),
    );
    const employers = allEmployers.slice(0, MAX_EMPLOYER_RESULTS);
    const schedulingClasses = emptySchedulingClasses();
    for (const site of allDecisions)
      schedulingClasses[site.schedulingClass] += 1;
    const dueSoonBoundary = evaluatedAt.getTime() + DUE_SOON_MS;
    const lastRun =
      runs
        .map((run) => run.completed_at ?? run.started_at)
        .sort()
        .at(-1) ?? null;
    const settings = this.database
      .prepare<[], { employer_discovery_last_evaluated_at: string | null }>(
        `SELECT employer_discovery_last_evaluated_at
           FROM discovery_settings WHERE id = 'default'`,
      )
      .get();
    return {
      policyVersion: EMPLOYER_DISCOVERY_INTELLIGENCE_VERSION,
      evaluatedAt: windowEnd,
      activityWindow: {
        start: windowStart,
        end: windowEnd,
        semantics: '[start,end)',
      },
      totals: {
        employers: new Set(rows.map((row) => row.employer_id)).size,
        careerSites: rows.length,
        eligibleSites: allDecisions.filter((site) => site.eligible).length,
        executableSites: allDecisions.filter((site) => site.executable).length,
        dueSoon: allDecisions.filter(
          (site) =>
            site.executable &&
            site.nextEligibleAt !== null &&
            Date.parse(site.nextEligibleAt) > evaluatedAt.getTime() &&
            Date.parse(site.nextEligibleAt) <= dueSoonBoundary,
        ).length,
        supportedSites: rows.filter((row) => isSupported(row.support_state))
          .length,
        unsupportedSites: rows.filter((row) => !isSupported(row.support_state))
          .length,
        credentialRequiredSites: allDecisions.filter(
          (site) => site.schedulingClass === 'credential-required',
        ).length,
        healthySites: countHealth(rows, 'healthy'),
        warningSites: countHealth(rows, 'warning'),
        brokenSites: countHealth(rows, 'broken'),
        retiredSites: countHealth(rows, 'retired'),
        discoverySuccesses: runs.filter((run) => run.status === 'succeeded')
          .length,
        discoveryFailures: runs.filter((run) => run.status === 'failed').length,
      },
      sitesBySchedulingClass: schedulingClasses,
      sites,
      providers: providers.slice(0, MAX_PROVIDER_RESULTS),
      employers,
      employersTruncated: allEmployers.length > employers.length,
      lastEvaluationAt: settings?.employer_discovery_last_evaluated_at ?? null,
      lastDiscoveryRunAt: lastRun,
    };
  }

  public decision(
    careerSiteId: string,
    evaluatedAt = this.now(),
  ): CareerSiteIntelligenceDecision | null {
    return this.buildSummary(evaluatedAt, careerSiteId).sites[0] ?? null;
  }

  public eligibleSiteIds(limit = 25, evaluatedAt = this.now()): string[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      throw new RangeError('Employer discovery limit must be between 1 and 25');
    }
    return this.summary(evaluatedAt)
      .sites.filter((site) => site.eligible)
      .slice(0, limit)
      .map((site) => site.careerSiteId);
  }

  private siteRows(): IntelligenceRow[] {
    return this.database
      .prepare<[], IntelligenceRow>(
        `SELECT cs.id AS career_site_id, cs.employer_id, e.name AS employer_name,
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
          ORDER BY e.name COLLATE NOCASE, cs.id`,
      )
      .all();
  }

  private activityRows(start: string, end: string): ActivityRow[] {
    return this.database
      .prepare<[string, string, string, string], ActivityRow>(
        `SELECT source_id,
                COUNT(DISTINCT CASE WHEN active = 1 THEN job_id END) AS active_jobs,
                 COUNT(DISTINCT CASE WHEN active = 1 AND first_seen_at >= ? AND first_seen_at < ? THEN job_id END) AS jobs_first_seen,
                 MAX(CASE WHEN active = 1 AND first_seen_at >= ? AND first_seen_at < ? THEN first_seen_at END) AS last_new_job_at
           FROM job_sources
          WHERE job_id NOT IN (SELECT id FROM jobs WHERE user_removed = 1)
          GROUP BY source_id`,
      )
      .all(start, end, start, end);
  }

  private runRows(start: string, end: string): RunRow[] {
    return this.database
      .prepare<[string, string], RunRow>(
        `SELECT source_id, provider_id, status, started_at, completed_at, jobs_discovered
           FROM runs
          WHERE started_at >= ? AND started_at < ?
          ORDER BY started_at DESC, id DESC`,
      )
      .all(start, end);
  }

  private employerActivityRows(
    start: string,
    end: string,
  ): EmployerActivityRow[] {
    return this.database
      .prepare<
        [string, string, string, string, string, string],
        EmployerActivityRow
      >(
        `WITH job_activity AS (
           SELECT cs.employer_id,
                  COUNT(DISTINCT CASE WHEN js.active = 1 THEN js.job_id END) AS active_jobs,
                   COUNT(DISTINCT CASE WHEN js.active = 1 AND js.first_seen_at >= ? AND js.first_seen_at < ? THEN js.job_id END) AS jobs_first_seen,
                   MAX(CASE WHEN js.active = 1 AND js.first_seen_at >= ? AND js.first_seen_at < ? THEN js.first_seen_at END) AS last_new_job_at
             FROM career_sites cs
             LEFT JOIN job_sources js ON js.source_id = cs.source_id
            WHERE js.job_id IS NULL OR js.job_id NOT IN (SELECT id FROM jobs WHERE user_removed = 1)
            GROUP BY cs.employer_id
         ), run_activity AS (
           SELECT cs.employer_id,
                  MAX(COALESCE(r.completed_at, r.started_at)) AS last_successful_discovery_at,
                  COUNT(DISTINCT r.id) AS successful_runs
             FROM career_sites cs
             JOIN runs r ON r.source_id = cs.source_id
            WHERE r.status = 'succeeded' AND r.started_at >= ? AND r.started_at < ?
            GROUP BY cs.employer_id
         )
         SELECT e.id AS employer_id,
                COALESCE(j.active_jobs, 0) AS active_jobs,
                COALESCE(j.jobs_first_seen, 0) AS jobs_first_seen,
                j.last_new_job_at, r.last_successful_discovery_at,
                COALESCE(r.successful_runs, 0) AS successful_runs
           FROM employers e
           LEFT JOIN job_activity j ON j.employer_id = e.id
           LEFT JOIN run_activity r ON r.employer_id = e.id`,
      )
      .all(start, end, start, end, start, end);
  }

  private attemptRows(start: string, end: string): AttemptRow[] {
    return this.database
      .prepare<[string, string], AttemptRow>(
        `SELECT career_site_id, provider_id, source_id, result
           FROM career_site_discovery_attempts
          WHERE attempted_at >= ? AND attempted_at < ?
          ORDER BY attempted_at DESC, id DESC`,
      )
      .all(start, end);
  }

  private providerMetrics(
    runs: RunRow[],
    attempts: AttemptRow[],
  ): ProviderSuccessMetrics[] {
    const metadata = this.database
      .prepare<
        [],
        ProviderRow
      >('SELECT provider_id, provider_name FROM provider_metadata ORDER BY provider_id')
      .all();
    const ids = new Set<string>(metadata.map((row) => row.provider_id));
    for (const run of runs)
      if (run.provider_id !== null) ids.add(run.provider_id);
    for (const attempt of attempts) ids.add(attempt.provider_id ?? 'unknown');
    const names = new Map(
      metadata.map((row) => [row.provider_id, row.provider_name]),
    );
    return [...ids]
      .sort()
      .map((providerId) => {
        const providerRuns = runs.filter(
          (run) => run.provider_id === providerId,
        );
        const providerAttempts = attempts.filter(
          (attempt) => (attempt.provider_id ?? 'unknown') === providerId,
        );
        const successes = providerRuns.filter(
          (run) => run.status === 'succeeded',
        );
        const failures = providerRuns.filter((run) => run.status === 'failed');
        const completed = successes.length + failures.length;
        return {
          providerId,
          providerName:
            names.get(providerId) ??
            (providerId === 'unknown' ? 'Unknown / Unsupported' : providerId),
          attemptedCareerSites: new Set(
            providerAttempts.map((attempt) => attempt.career_site_id),
          ).size,
          successfulValidations: providerAttempts.filter((attempt) =>
            ['source-created', 'source-reused', 'skipped'].includes(
              attempt.result,
            ),
          ).length,
          successfulSourceMappings: providerAttempts.filter((attempt) =>
            ['source-created', 'source-reused'].includes(attempt.result),
          ).length,
          unsupportedOutcomes: providerAttempts.filter(
            (attempt) => attempt.result === 'unsupported',
          ).length,
          credentialRequiredOutcomes: providerAttempts.filter(
            (attempt) => attempt.result === 'skipped',
          ).length,
          discoverySuccesses: successes.length,
          discoveryFailures: failures.length,
          interruptedRuns: providerRuns.filter(
            (run) => run.status === 'interrupted',
          ).length,
          zeroResultSuccessfulRuns: successes.filter(
            (run) => run.jobs_discovered === 0,
          ).length,
          recentSuccessRate:
            completed === 0 ? null : successes.length / completed,
          lastSuccessAt: latestTime(successes),
          lastFailureAt: latestTime(failures),
        };
      })
      .sort(
        (left, right) =>
          right.discoverySuccesses +
            right.discoveryFailures -
            (left.discoverySuccesses + left.discoveryFailures) ||
          compareText(left.providerId, right.providerId),
      );
  }
}

function decision(
  row: IntelligenceRow,
  evaluatedAt: Date,
  windowStart: string,
  windowEnd: string,
  activityRow: ActivityRow | undefined,
  runs: RunRow[],
  provider: ProviderSuccessMetrics | undefined,
): CareerSiteIntelligenceDecision {
  const successes = runs.filter((run) => run.status === 'succeeded');
  const failures = runs.filter((run) => run.status === 'failed');
  const lastSuccessAt = latestTime(successes);
  const activityKnown = row.source_id !== null && successes.length > 0;
  const activity: CareerSiteActivityMetrics = {
    windowStart,
    windowEnd,
    known: activityKnown,
    activeJobs: activityKnown ? (activityRow?.active_jobs ?? 0) : null,
    jobsFirstSeen: activityKnown ? (activityRow?.jobs_first_seen ?? 0) : null,
    lastNewJobAt: activityKnown ? (activityRow?.last_new_job_at ?? null) : null,
    lastSuccessfulDiscoveryAt: lastSuccessAt,
    successfulRuns: successes.length,
    failedRuns: failures.length,
    zeroResultSuccessfulRuns: successes.filter(
      (run) => run.jobs_discovered === 0,
    ).length,
  };
  const schedulingClass = classify(row, activity);
  const cadenceHours = cadenceFor(schedulingClass);
  const components = priorityComponents(row, activity, provider, evaluatedAt);
  const priority = Math.max(
    0,
    Math.min(
      100,
      components.reduce((sum, component) => sum + component.points, 0),
    ),
  );
  const safety = safetyDecision(row, evaluatedAt);
  const cadenceAnchor =
    lastSuccessAt ?? row.health_checked_at ?? row.created_at;
  const cadenceEligibleAt =
    cadenceHours === null
      ? null
      : row.source_id === null
        ? row.created_at
        : new Date(
            Date.parse(cadenceAnchor) + cadenceHours * 60 * 60 * 1000,
          ).toISOString();
  const nextEligibleAt = latestIso(
    cadenceEligibleAt,
    row.next_discovery_attempt_at,
  );
  const eligible =
    safety.executable &&
    nextEligibleAt !== null &&
    Date.parse(nextEligibleAt) <= evaluatedAt.getTime();
  return {
    policyVersion: EMPLOYER_DISCOVERY_INTELLIGENCE_VERSION,
    evaluatedAt: evaluatedAt.toISOString(),
    careerSiteId: row.career_site_id,
    employerId: row.employer_id,
    employerName: row.employer_name,
    url: row.url,
    providerId: row.source_provider_id ?? row.detected_provider,
    schedulingClass,
    priority,
    eligible,
    executable: safety.executable,
    cadenceHours,
    nextEligibleAt,
    healthStatus:
      row.health_status as CareerSiteIntelligenceDecision['healthStatus'],
    atsConfidence: row.ats_confidence ?? 0,
    providerSuccessRate: provider?.recentSuccessRate ?? null,
    activity,
    components,
    reasons: [
      ...safety.reasons,
      ...components.map((item) => item.explanation),
    ].slice(0, 8),
  };
}

function classify(
  row: IntelligenceRow,
  activity: CareerSiteActivityMetrics,
): DiscoverySchedulingClass {
  if (row.health_status === 'retired' || row.discovery_state === 'retired')
    return 'retired';
  if (row.configuration_status === 'credentials-required')
    return 'credential-required';
  if (
    row.support_state !== null &&
    (!isSupported(row.support_state) || row.detected_provider === null)
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

function cadenceFor(value: DiscoverySchedulingClass): number | null {
  switch (value) {
    case 'high-priority':
      return 6;
    case 'normal':
      return 24;
    case 'stable':
      return 72;
    case 'degraded':
      return 24;
    case 'unsupported':
    case 'credential-required':
    case 'retired':
      return null;
  }
}

function priorityComponents(
  row: IntelligenceRow,
  activity: CareerSiteActivityMetrics,
  provider: ProviderSuccessMetrics | undefined,
  evaluatedAt: Date,
): DiscoveryPriorityComponent[] {
  const base =
    activity.known && (activity.jobsFirstSeen ?? 0) > 0
      ? 40
      : activity.known && activity.activeJobs === 0
        ? 10
        : 25;
  const confidence = Math.round((row.ats_confidence ?? 0) * 20);
  const reliability =
    provider?.recentSuccessRate === null ||
    provider?.recentSuccessRate === undefined
      ? 0
      : Math.round(provider.recentSuccessRate * 20);
  const anchor = activity.lastSuccessfulDiscoveryAt ?? row.created_at;
  const staleHours =
    Math.max(0, evaluatedAt.getTime() - Date.parse(anchor)) / 3_600_000;
  const staleness = Math.min(20, Math.floor(staleHours / 6));
  const failurePenalty =
    row.health_status === 'broken'
      ? -40
      : row.health_status === 'warning'
        ? -20
        : -Math.min(20, row.health_failure_count * 5);
  return [
    {
      code: 'activity',
      points: base,
      explanation: activity.known
        ? `Recent activity: ${String(activity.jobsFirstSeen)} new and ${String(activity.activeJobs)} active jobs`
        : 'Employer activity is unknown until a linked Source succeeds',
    },
    {
      code: 'ats-confidence',
      points: confidence,
      explanation: `ATS confidence ${String(Math.round((row.ats_confidence ?? 0) * 100))}%`,
    },
    {
      code: 'provider-reliability',
      points: reliability,
      explanation:
        provider?.recentSuccessRate == null
          ? 'Provider reliability has no completed-run sample'
          : `Provider succeeded on ${String(provider.discoverySuccesses)} of ${String(provider.discoverySuccesses + provider.discoveryFailures)} completed recent runs`,
    },
    {
      code: 'staleness',
      points: staleness,
      explanation: `Last successful discovery is ${String(Math.floor(staleHours))} hours old`,
    },
    {
      code: 'health-penalty',
      points: failurePenalty,
      explanation:
        failurePenalty === 0
          ? 'No health failure penalty'
          : `Health/failure penalty ${String(failurePenalty)}`,
    },
  ];
}

function safetyDecision(
  row: IntelligenceRow,
  evaluatedAt: Date,
): { executable: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (row.health_status === 'retired' || row.discovery_state === 'retired')
    reasons.push('Retired CareerSite is never automatic');
  if (row.health_status === 'broken')
    reasons.push('Broken health blocks execution');
  if (
    row.next_discovery_attempt_at !== null &&
    Date.parse(row.next_discovery_attempt_at) > evaluatedAt.getTime()
  )
    reasons.push(
      `Existing backoff applies until ${row.next_discovery_attempt_at}`,
    );
  if (
    row.support_state !== null &&
    (!isSupported(row.support_state) || row.detected_provider === null)
  )
    reasons.push('No supported verified provider path');
  if (row.configuration_status === 'credentials-required')
    reasons.push('Credentials are required; automatic execution is disabled');
  if (row.configuration_status !== null && row.configuration_status !== 'valid')
    reasons.push('Linked Source configuration is not valid');
  if (row.source_id !== null && row.source_enabled !== 1)
    reasons.push('Linked Source is disabled');
  if (row.source_health_status === 'failed')
    reasons.push('Linked Source health is failed');
  return { executable: reasons.length === 0, reasons };
}

function groupRunsBySource(runs: RunRow[]): Map<string, RunRow[]> {
  const grouped = new Map<string, RunRow[]>();
  for (const run of runs) {
    if (run.source_id === null) continue;
    const sourceRuns = grouped.get(run.source_id) ?? [];
    sourceRuns.push(run);
    grouped.set(run.source_id, sourceRuns);
  }
  return grouped;
}

function employerMetrics(
  rows: IntelligenceRow[],
  activityRows: EmployerActivityRow[],
): EmployerActivityMetrics[] {
  const activity = new Map(activityRows.map((row) => [row.employer_id, row]));
  const employers = new Map<string, EmployerActivityMetrics>();
  for (const row of rows) {
    const evidence = activity.get(row.employer_id);
    employers.set(row.employer_id, {
      employerId: row.employer_id,
      employerName: row.employer_name,
      known: (evidence?.successful_runs ?? 0) > 0,
      activeJobs:
        (evidence?.successful_runs ?? 0) > 0
          ? (evidence?.active_jobs ?? 0)
          : null,
      jobsFirstSeen:
        (evidence?.successful_runs ?? 0) > 0
          ? (evidence?.jobs_first_seen ?? 0)
          : null,
      lastNewJobAt: evidence?.last_new_job_at ?? null,
      lastSuccessfulDiscoveryAt: evidence?.last_successful_discovery_at ?? null,
    });
  }
  return [...employers.values()].sort(
    (left, right) =>
      compareText(left.employerName, right.employerName) ||
      compareText(left.employerId, right.employerId),
  );
}

function compareDecisions(
  left: CareerSiteIntelligenceDecision,
  right: CareerSiteIntelligenceDecision,
): number {
  return (
    Number(right.eligible) - Number(left.eligible) ||
    right.priority - left.priority ||
    compareText(
      left.nextEligibleAt ?? '9999',
      right.nextEligibleAt ?? '9999',
    ) ||
    compareText(left.employerName, right.employerName) ||
    compareText(left.careerSiteId, right.careerSiteId)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function latestTime(rows: RunRow[]): string | null {
  return (
    rows
      .map((row) => row.completed_at ?? row.started_at)
      .sort()
      .at(-1) ?? null
  );
}

function latestIso(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left > right ? left : right;
}

function isSupported(value: string | null): boolean {
  return (
    value === 'supported' ||
    value === 'supported-with-configuration' ||
    value === 'structured-data-fallback-available'
  );
}

function countHealth(rows: IntelligenceRow[], status: string): number {
  return rows.filter((row) => row.health_status === status).length;
}

function emptySchedulingClasses(): Record<DiscoverySchedulingClass, number> {
  return {
    'high-priority': 0,
    normal: 0,
    stable: 0,
    degraded: 0,
    unsupported: 0,
    'credential-required': 0,
    retired: 0,
  };
}
