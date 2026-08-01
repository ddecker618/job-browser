import { randomUUID } from 'node:crypto';

import type { JobDatabase } from '../db/database.js';
import type { JobProvider } from '../providers/baseProvider.js';
import type {
  ConfiguredSource,
  DiscoveryRunView,
  SourceControlSummary,
  SourceInput,
  SourceSchedule,
} from '../models/source-management.js';
import { searchRequestSchema } from '../schemas/source-management.js';
import { nowUtc } from '../utilities/timestamps.js';
import type { SearchProfile } from '../config/search-profile.js';
import { loadUnifiedLegacyPreferences } from '../preferences/profilePreferencesRuntime.js';

interface SourceRow extends Record<string, unknown> {
  id: string;
  display_name: string | null;
  employer: string;
  provider_id: string | null;
  source_type: string;
  careers_url: string | null;
  enabled: number;
  configuration_json: string;
  search_criteria_json: string;
  configuration_status: ConfiguredSource['configurationStatus'];
  health_status: ConfiguredSource['healthStatus'];
  health_message: string | null;
  last_health_check_at: string | null;
  last_successful_run: string | null;
  last_failure: string | null;
  failure_count: number;
  archived_at: string | null;
  last_complete_snapshot_at: string | null;
  schedule_enabled: number | null;
  cadence: SourceSchedule['cadence'] | null;
  daily_local_time: string | null;
  next_run_at: string | null;
  last_due_at: string | null;
}

export class SourceRepository {
  public constructor(
    private readonly database: JobDatabase,
    private readonly profilePreferencesPath?: string,
  ) {}

  public reconcileProviders(providers: readonly JobProvider[]): void {
    const timestamp = nowUtc();
    this.database.transaction(() => {
      for (const provider of providers) {
        this.database
          .prepare(
            `INSERT INTO provider_metadata (
              id, provider_id, provider_name, enabled, configuration_json,
              last_successful_run, last_failure, failure_count, created_at, updated_at,
              provider_type, capabilities_json, credential_requirement
            ) VALUES (?, ?, ?, 1, NULL, NULL, NULL, 0, ?, ?, ?, ?, ?)
            ON CONFLICT(provider_id) DO UPDATE SET
              provider_name = excluded.provider_name,
              provider_type = excluded.provider_type,
              capabilities_json = excluded.capabilities_json,
              credential_requirement = excluded.credential_requirement,
              updated_at = excluded.updated_at`,
          )
          .run(
            `metadata:${provider.id}`,
            provider.id,
            provider.name,
            timestamp,
            timestamp,
            provider.type,
            JSON.stringify(provider.capabilities),
            provider.capabilities.requiresCredentials
              ? 'desktop-safe-storage'
              : null,
          );
      }
    })();
  }

  public ensureDefaultSources(): void {
    const titles = this.loadTargetRoles();
    if (titles.length === 0) return;
    const queries = queriesFromRoles(titles);
    this.ensureSources(
      DEFAULT_SOURCES.map((source) => ({
        ...source,
        configuration: withQueryConfiguration(
          source.configuration,
          queries,
          titles[0] ?? source.searchCriteria.query,
        ),
        searchCriteria: {
          ...source.searchCriteria,
          query: titles[0] ?? source.searchCriteria.query,
          queries: [...titles],
        },
      })) as unknown as readonly DefaultSource[],
    );
  }

  public cascadeTargetRoles(roles: string[]): void {
    this.cascadeQueries(roles);
  }

  public cascadeSearchProfile(profile: SearchProfile): void {
    void profile;
    this.cascadeQueries(this.loadTargetRoles());
  }

  private cascadeQueries(roles: string[]): void {
    if (roles.length === 0) return;
    const queries = queriesFromRoles(roles);
    const row = this.database
      .prepare<
        [],
        { id: string; configuration_json: string; search_criteria_json: string }
      >(`SELECT id, configuration_json, search_criteria_json FROM sources WHERE provider_id IS NOT NULL`)
      .all();
    const update = this.database.prepare(
      `UPDATE sources SET configuration_json = ?, search_criteria_json = ?, updated_at = ? WHERE id = ?`,
    );
    const timestamp = nowUtc();
    this.database.transaction(() => {
      for (const source of row) {
        const config = parseObject(source.configuration_json);
        const criteria = searchRequestSchema.parse(
          JSON.parse(source.search_criteria_json) as unknown,
        );
        const nextCriteria = {
          ...criteria,
          query: roles[0] ?? criteria.query,
          queries: [...roles],
        };
        update.run(
          JSON.stringify(
            withQueryConfiguration(config, queries, roles[0] ?? ''),
          ),
          JSON.stringify(nextCriteria),
          timestamp,
          source.id,
        );
      }
    })();
  }

  private loadTargetRoles(): string[] {
    const unified = loadUnifiedLegacyPreferences(this.profilePreferencesPath);
    if (unified !== null) return [...unified.sourceQueryRoles];
    const row = this.database
      .prepare<
        [],
        { setting_value_json: string } | undefined
      >(`SELECT setting_value_json FROM app_settings WHERE setting_key = 'targetRoles'`)
      .get();
    if (row === undefined) {
      return [
        'Systems Administrator',
        'Network Administrator',
        'SOC Analyst',
        'Technical Support Engineer',
      ];
    }
    try {
      const parsed: unknown = JSON.parse(row.setting_value_json);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((r: unknown): r is string => typeof r === 'string')
      ) {
        return parsed;
      }
    } catch {
      // fall through to default
    }
    return [
      'Systems Administrator',
      'Network Administrator',
      'SOC Analyst',
      'Technical Support Engineer',
    ];
  }

  private ensureSources(sources: readonly DefaultSource[]): void {
    const timestamp = nowUtc();
    const upsert = this.database.prepare(
      `INSERT INTO sources (
        id, employer, source_type, careers_url, enabled, connector,
        last_successful_run, last_failure, failure_count, created_at, updated_at,
        display_name, provider_id, configuration_json, search_criteria_json,
        configuration_status, health_status
      ) VALUES (?, ?, 'job-board', ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, 'valid', 'never-run')
      ON CONFLICT(id) DO UPDATE SET
        employer = excluded.employer,
        display_name = excluded.display_name,
        provider_id = excluded.provider_id,
        careers_url = excluded.careers_url,
        configuration_json = excluded.configuration_json,
        search_criteria_json = excluded.search_criteria_json,
        configuration_status = excluded.configuration_status,
        updated_at = excluded.updated_at`,
    );
    const updateExistingByProvider = this.database.prepare(
      `UPDATE sources SET
        employer = ?, display_name = ?, careers_url = ?,
        configuration_json = ?, search_criteria_json = ?,
        configuration_status = 'valid', updated_at = ?
       WHERE provider_id = ? AND id != ?`,
    );
    const checkProviderExists = this.database.prepare<[string], { id: string }>(
      `SELECT id FROM sources WHERE provider_id = ? LIMIT 1`,
    );
    this.database.transaction(() => {
      for (const source of sources) {
        const existing = checkProviderExists.get(source.providerId);
        if (existing !== undefined && existing.id !== source.id) {
          updateExistingByProvider.run(
            source.employer,
            source.displayName,
            source.careersUrl,
            JSON.stringify(source.configuration),
            JSON.stringify(source.searchCriteria),
            timestamp,
            source.providerId,
            existing.id,
          );
          this.ensureSchedule(existing.id, false, 'manual', null);
        } else {
          upsert.run(
            source.id,
            source.employer,
            source.careersUrl,
            Number(source.enabled),
            source.providerId,
            timestamp,
            timestamp,
            source.displayName,
            source.providerId,
            JSON.stringify(source.configuration),
            JSON.stringify(source.searchCriteria),
          );
          this.ensureSchedule(source.id, false, 'manual', null);
        }
      }
    })();
  }

  public list(): ConfiguredSource[] {
    return this.database
      .prepare<[], SourceRow>(SOURCE_SELECT)
      .all()
      .map(mapSource);
  }

  public get(id: string): ConfiguredSource | null {
    const row = this.database
      .prepare<[string], SourceRow>(`${SOURCE_SELECT} WHERE sources.id = ?`)
      .get(id);
    return row === undefined ? null : mapSource(row);
  }

  public create(
    input: SourceInput,
    configurationStatus: ConfiguredSource['configurationStatus'],
  ): ConfiguredSource {
    const id = randomUUID();
    const timestamp = nowUtc();
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO sources (
            id, employer, source_type, careers_url, enabled, connector,
            last_successful_run, last_failure, failure_count, created_at, updated_at,
            display_name, provider_id, configuration_json, search_criteria_json,
            configuration_status, health_status
          ) VALUES (?, ?, 'provider', ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, ?, 'never-run')`,
        )
        .run(
          id,
          input.employer,
          input.careersUrl,
          Number(input.enabled && configurationStatus === 'valid'),
          input.providerId,
          timestamp,
          timestamp,
          input.displayName,
          input.providerId,
          JSON.stringify(input.configuration),
          JSON.stringify(input.searchCriteria),
          configurationStatus,
        );
      this.ensureSchedule(
        id,
        input.schedule.enabled,
        input.schedule.cadence,
        input.schedule.dailyLocalTime,
      );
    })();
    const source = this.get(id);
    if (source === null) throw new Error('Created source could not be loaded');
    return source;
  }

  public update(
    id: string,
    input: SourceInput,
    configurationStatus: ConfiguredSource['configurationStatus'],
  ): ConfiguredSource {
    const result = this.database
      .prepare(
        `UPDATE sources SET
          employer = ?, careers_url = ?, enabled = ?, connector = ?, updated_at = ?,
          display_name = ?, provider_id = ?, configuration_json = ?, search_criteria_json = ?,
          configuration_status = ?
         WHERE id = ?`,
      )
      .run(
        input.employer,
        input.careersUrl,
        Number(input.enabled && configurationStatus === 'valid'),
        input.providerId,
        nowUtc(),
        input.displayName,
        input.providerId,
        JSON.stringify(input.configuration),
        JSON.stringify(input.searchCriteria),
        configurationStatus,
        id,
      );
    if (result.changes === 0) throw new Error(`Source does not exist: ${id}`);
    this.ensureSchedule(
      id,
      input.schedule.enabled,
      input.schedule.cadence,
      input.schedule.dailyLocalTime,
    );
    const source = this.get(id);
    if (source === null) throw new Error('Updated source could not be loaded');
    return source;
  }

  public setEnabled(id: string, enabled: boolean): void {
    const source = this.get(id);
    if (source === null) throw new Error(`Source does not exist: ${id}`);
    if (enabled && source.configurationStatus !== 'valid') {
      throw new Error(
        'Source must have valid configuration before it can be enabled',
      );
    }
    this.database
      .prepare('UPDATE sources SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(Number(enabled), nowUtc(), id);
  }

  public delete(id: string): void {
    this.database.transaction(() => {
      this.database
        .prepare(
          'DELETE FROM identity_conflict_diagnostics WHERE source_id = ?',
        )
        .run(id);

      this.database
        .prepare('DELETE FROM job_observations WHERE source_id = ?')
        .run(id);

      const associatedJobs = this.database
        .prepare('SELECT DISTINCT job_id FROM job_sources WHERE source_id = ?')
        .all(id) as { job_id: string }[];

      this.database
        .prepare('DELETE FROM job_sources WHERE source_id = ?')
        .run(id);

      for (const { job_id } of associatedJobs) {
        const sourceCount =
          (
            this.database
              .prepare(
                'SELECT COUNT(*) AS count FROM job_sources WHERE job_id = ?',
              )
              .get(job_id) as { count: number } | undefined
          )?.count ?? 0;

        if (sourceCount === 0) {
          const appCount =
            (
              this.database
                .prepare(
                  'SELECT COUNT(*) AS count FROM applications WHERE job_id = ?',
                )
                .get(job_id) as { count: number } | undefined
            )?.count ?? 0;

          const historyCount =
            (
              this.database
                .prepare(
                  'SELECT COUNT(*) AS count FROM application_history WHERE job_id = ?',
                )
                .get(job_id) as { count: number } | undefined
            )?.count ?? 0;

          if (appCount === 0 && historyCount === 0) {
            this.database.prepare('DELETE FROM jobs WHERE id = ?').run(job_id);
          }
        }
      }

      this.database
        .prepare('DELETE FROM source_schedules WHERE source_id = ?')
        .run(id);

      this.database.prepare('DELETE FROM sources WHERE id = ?').run(id);
    })();
  }

  public setHealth(
    id: string,
    status: ConfiguredSource['healthStatus'],
    message: string,
  ): void {
    this.database
      .prepare(
        `UPDATE sources SET health_status = ?, health_message = ?,
          last_health_check_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, message.slice(0, 1000), nowUtc(), nowUtc(), id);
  }

  public listEnabled(): ConfiguredSource[] {
    return this.list().filter((source) => source.enabled);
  }

  public listDue(now: string): ConfiguredSource[] {
    return this.list().filter(
      (source) =>
        source.enabled &&
        source.schedule.enabled &&
        source.schedule.nextRunAt !== null &&
        source.schedule.nextRunAt <= now,
    );
  }

  public updateScheduleAfterRun(
    sourceId: string,
    completedAt = new Date(),
  ): void {
    const source = this.get(sourceId);
    if (source === null) return;
    const next = calculateNextRun(source.schedule, completedAt);
    this.database
      .prepare(
        `UPDATE source_schedules SET last_due_at = ?, next_run_at = ?, updated_at = ?
         WHERE source_id = ?`,
      )
      .run(completedAt.toISOString(), next, nowUtc(), sourceId);
  }

  public getSchedulerEnabled(): boolean {
    const row = this.database
      .prepare<
        [],
        { scheduler_enabled: number }
      >(`SELECT scheduler_enabled FROM discovery_settings WHERE id = 'default'`)
      .get();
    return Boolean(row?.scheduler_enabled);
  }

  public setSchedulerEnabled(enabled: boolean): void {
    this.database
      .prepare(
        `UPDATE discovery_settings SET scheduler_enabled = ?, updated_at = ? WHERE id = 'default'`,
      )
      .run(Number(enabled), nowUtc());
  }

  public summary(): SourceControlSummary {
    const sources = this.list();
    const row = this.database
      .prepare<[], Record<string, unknown>>(
        `SELECT MAX(completed_at) AS last_run,
          COALESCE(SUM(CASE WHEN date(started_at, 'localtime') = date('now', 'localtime') THEN jobs_discovered ELSE 0 END), 0) AS found_today,
           COALESCE(SUM(CASE WHEN date(started_at, 'localtime') = date('now', 'localtime') THEN jobs_inserted ELSE 0 END), 0) AS inserted_today,
           COALESCE(SUM(CASE WHEN date(started_at, 'localtime') = date('now', 'localtime') THEN cross_source_merges ELSE 0 END), 0) AS merged_today,
           COALESCE(SUM(CASE WHEN date(started_at, 'localtime') = date('now', 'localtime') THEN records_rejected ELSE 0 END), 0) AS rejected_today,
           COALESCE(SUM(CASE WHEN date(started_at, 'localtime') = date('now', 'localtime') THEN rediscoveries ELSE 0 END), 0) AS rediscoveries_today,
           COALESCE(SUM(CASE WHEN date(started_at, 'localtime') = date('now', 'localtime') THEN material_updates ELSE 0 END), 0) AS updates_today,
           COALESCE(SUM(CASE WHEN date(started_at, 'localtime') = date('now', 'localtime') THEN identity_conflicts ELSE 0 END), 0) AS conflicts_today
         FROM runs`,
      )
      .get();
    const nextRuns = sources
      .map((source) => source.schedule.nextRunAt)
      .filter((value): value is string => value !== null)
      .sort();
    return {
      healthySources: sources.filter(
        (source) => source.healthStatus === 'healthy',
      ).length,
      enabledSources: sources.filter((source) => source.enabled).length,
      disabledSources: sources.filter((source) => !source.enabled).length,
      failedSources: sources.filter(
        (source) => source.healthStatus === 'failed',
      ).length,
      lastDiscoveryRun: nullableString(row?.['last_run']),
      nextScheduledRun: nextRuns[0] ?? null,
      jobsFoundToday: Number(row?.['found_today'] ?? 0),
      newUniqueJobs: Number(row?.['inserted_today'] ?? 0),
      duplicatesMerged: Number(row?.['merged_today'] ?? 0),
      recordsRejected: Number(row?.['rejected_today'] ?? 0),
      rediscoveries: Number(row?.['rediscoveries_today'] ?? 0),
      materialUpdates: Number(row?.['updates_today'] ?? 0),
      identityConflicts: Number(row?.['conflicts_today'] ?? 0),
    };
  }

  public recentRuns(sourceId?: string, limit = 20): DiscoveryRunView[] {
    const rows =
      sourceId === undefined
        ? this.database
            .prepare<
              [number],
              Record<string, unknown>
            >(`SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`)
            .all(limit)
        : this.database
            .prepare<
              [string, number],
              Record<string, unknown>
            >(`SELECT * FROM runs WHERE source_id = ? ORDER BY started_at DESC LIMIT ?`)
            .all(sourceId, limit);
    return rows.map((row) => ({
      id: String(row['id']),
      sourceId: nullableString(row['source_id']),
      providerId: nullableString(row['provider_id']),
      trigger: String(row['trigger']),
      status: String(row['status']),
      startedAt: String(row['started_at']),
      completedAt: nullableString(row['completed_at']),
      jobsFound: Number(row['jobs_discovered']),
      jobsInserted: Number(row['jobs_inserted']),
      jobsUpdated: Number(row['jobs_updated']),
      duplicatesMerged: Number(row['duplicate_merges']),
      jobsFailed: Number(row['jobs_failed']),
      recordsRejected: Number(row['records_rejected']),
      rediscoveries: Number(row['rediscoveries']),
      crossSourceMerges: Number(row['cross_source_merges']),
      materialUpdates: Number(row['material_updates']),
      identityConflicts: Number(row['identity_conflicts']),
      fetchTruncated: Boolean(row['fetch_truncated']),
      completeSnapshot: Boolean(row['complete_snapshot']),
      retryCount: Number(row['retry_count']),
      error: nullableString(row['error_message']),
    }));
  }

  public recoverInterruptedRuns(): number {
    const timestamp = nowUtc();
    return this.database
      .prepare(
        `UPDATE runs SET status = 'interrupted', completed_at = ?,
          error_message = 'Discovery was interrupted when Job Browser stopped'
         WHERE status IN ('pending', 'running')`,
      )
      .run(timestamp).changes;
  }

  private ensureSchedule(
    sourceId: string,
    enabled: boolean,
    cadence: SourceSchedule['cadence'],
    dailyLocalTime: string | null,
  ): void {
    const timestamp = nowUtc();
    const schedule: SourceSchedule = {
      enabled,
      cadence,
      dailyLocalTime,
      nextRunAt: null,
      lastDueAt: null,
    };
    const nextRunAt = calculateNextRun(schedule, new Date());
    this.database
      .prepare(
        `INSERT INTO source_schedules (
          id, source_id, enabled, cadence, daily_local_time, next_run_at,
          last_due_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET
          enabled = excluded.enabled, cadence = excluded.cadence,
          daily_local_time = excluded.daily_local_time,
          next_run_at = excluded.next_run_at, updated_at = excluded.updated_at`,
      )
      .run(
        randomUUID(),
        sourceId,
        Number(enabled && cadence !== 'manual'),
        cadence,
        dailyLocalTime,
        nextRunAt,
        timestamp,
        timestamp,
      );
  }
}

const SOURCE_SELECT = `SELECT sources.*,
  source_schedules.enabled AS schedule_enabled,
  source_schedules.cadence, source_schedules.daily_local_time,
  source_schedules.next_run_at, source_schedules.last_due_at
 FROM sources LEFT JOIN source_schedules ON source_schedules.source_id = sources.id`;

const DEFAULT_SOURCES = [
  {
    id: 'provider:builtin',
    employer: 'Built In',
    displayName: 'Built In',
    providerId: 'builtin',
    careersUrl: 'https://builtin.com/jobs',
    enabled: true,
    configuration: {
      searchKeywords: 'systems administrator',
      location: '',
      remoteFilter: '',
      datePosted: 'month',
      maxResults: 50,
      fetchDetails: true,
      queries: [
        { keywords: 'systems administrator', location: '' },
        { keywords: 'network administrator', location: '' },
        { keywords: 'network analyst', location: '' },
        { keywords: 'SOC analyst', location: '' },
      ],
    },
    searchCriteria: {
      query: 'systems administrator',
      location: null,
      remoteOnly: false,
      limit: 50,
      maxAgeDays: 30,
    },
  },
  {
    id: 'provider:wellfound',
    employer: 'Wellfound',
    displayName: 'Wellfound (browser)',
    providerId: 'wellfound',
    careersUrl: 'https://wellfound.com/jobs',
    enabled: false,
    configuration: {
      searchKeywords: 'systems administrator',
      location: '',
      remoteFilter: '',
      datePosted: 'month',
      maxResults: 50,
      keepBrowserOpen: true,
      queries: [
        { keywords: 'systems administrator', location: '' },
        { keywords: 'network administrator', location: '' },
        { keywords: 'network analyst', location: '' },
        { keywords: 'SOC analyst', location: '' },
      ],
    },
    searchCriteria: {
      query: 'systems administrator',
      location: null,
      remoteOnly: false,
      limit: 50,
      maxAgeDays: 30,
    },
  },
  {
    id: 'provider:ziprecruiter',
    employer: 'ZipRecruiter',
    displayName: 'ZipRecruiter (browser)',
    providerId: 'ziprecruiter',
    careersUrl: 'https://www.ziprecruiter.com/jobs-search',
    enabled: false,
    configuration: {
      searchKeywords: 'systems administrator',
      location: '',
      remoteFilter: '',
      datePosted: 'month',
      maxResults: 50,
      keepBrowserOpen: true,
      queries: [
        { keywords: 'systems administrator', location: '' },
        { keywords: 'network administrator', location: '' },
        { keywords: 'network analyst', location: '' },
        { keywords: 'SOC analyst', location: '' },
      ],
    },
    searchCriteria: {
      query: 'systems administrator',
      location: null,
      remoteOnly: false,
      limit: 50,
      maxAgeDays: 30,
    },
  },
  {
    id: 'provider:dice',
    employer: 'Dice',
    displayName: 'Dice',
    providerId: 'dice',
    careersUrl: 'https://www.dice.com',
    enabled: false,
    configuration: {
      searchKeywords: 'systems administrator',
      location: '',
      remoteFilter: '',
      datePosted: 'month',
      maxResults: 50,
      queries: [
        { keywords: 'systems administrator', location: '' },
        { keywords: 'network administrator', location: '' },
        { keywords: 'network analyst', location: '' },
        { keywords: 'SOC analyst', location: '' },
      ],
    },
    searchCriteria: {
      query: 'systems administrator',
      location: null,
      remoteOnly: false,
      limit: 50,
      maxAgeDays: 30,
    },
  },
  {
    id: 'provider:indeed',
    employer: 'Indeed',
    displayName: 'Indeed (browser)',
    providerId: 'indeed',
    careersUrl: 'https://www.indeed.com',
    enabled: false,
    configuration: {
      searchKeywords: 'systems administrator',
      location: '',
      remoteFilter: '',
      datePosted: 'month',
      maxResults: 50,
      keepBrowserOpen: true,
      queries: [
        { keywords: 'systems administrator', location: '' },
        { keywords: 'network administrator', location: '' },
        { keywords: 'network analyst', location: '' },
        { keywords: 'SOC analyst', location: '' },
      ],
    },
    searchCriteria: {
      query: 'systems administrator',
      location: null,
      remoteOnly: false,
      limit: 50,
      maxAgeDays: 30,
    },
  },
  {
    id: 'provider:usajobs',
    employer: 'USAJOBS',
    displayName: 'USAJOBS (browser)',
    providerId: 'usajobs',
    careersUrl: 'https://www.usajobs.gov/',
    enabled: false,
    configuration: {
      searchKeywords: 'systems administrator',
      location: '',
      remoteFilter: '',
      datePosted: 'any',
      maxResults: 50,
      keepBrowserOpen: true,
      queries: [
        { keywords: 'systems administrator', location: '' },
        { keywords: 'network administrator', location: '' },
        { keywords: 'network analyst', location: '' },
        { keywords: 'SOC analyst', location: '' },
      ],
    },
    searchCriteria: {
      query: 'systems administrator',
      location: null,
      remoteOnly: false,
      limit: 50,
      maxAgeDays: 30,
    },
  },
] as const;

type DefaultSource = (typeof DEFAULT_SOURCES)[number];

function queriesFromRoles(
  roles: string[],
): { keywords: string; location: string }[] {
  return roles.map((role) => ({ keywords: role, location: '' }));
}

export function calculateNextRun(
  schedule: SourceSchedule,
  after: Date,
): string | null {
  if (!schedule.enabled || schedule.cadence === 'manual') return null;
  if (schedule.cadence === 'daily') {
    const [hoursText, minutesText] = (schedule.dailyLocalTime ?? '09:00').split(
      ':',
    );
    const candidate = new Date(after);
    candidate.setHours(Number(hoursText), Number(minutesText), 0, 0);
    if (candidate <= after) candidate.setDate(candidate.getDate() + 1);
    return candidate.toISOString();
  }
  const hours =
    schedule.cadence === 'every-6-hours'
      ? 6
      : schedule.cadence === 'every-12-hours'
        ? 12
        : 24;
  return new Date(after.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function mapSource(row: SourceRow): ConfiguredSource {
  return {
    id: row.id,
    displayName: row.display_name ?? row.employer,
    employer: row.employer,
    providerId: row.provider_id,
    sourceType: row.source_type,
    careersUrl: row.careers_url,
    enabled: Boolean(row.enabled),
    configuration: parseObject(row.configuration_json),
    searchCriteria: JSON.parse(
      row.search_criteria_json,
    ) as ConfiguredSource['searchCriteria'],
    configurationStatus: row.configuration_status,
    healthStatus: row.health_status,
    healthMessage: row.health_message,
    lastHealthCheckAt: row.last_health_check_at,
    lastSuccessfulRun: row.last_successful_run,
    lastFailure: row.last_failure,
    failureCount: row.failure_count,
    archivedAt: row.archived_at,
    lastCompleteSnapshotAt: row.last_complete_snapshot_at,
    schedule: {
      enabled: Boolean(row.schedule_enabled),
      cadence: row.cadence ?? 'manual',
      dailyLocalTime: row.daily_local_time,
      nextRunAt: row.next_run_at,
      lastDueAt: row.last_due_at,
    },
  };
}

function parseObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function withQueryConfiguration(
  configuration: Record<string, unknown>,
  queries: { keywords: string; location: string }[],
  primaryQuery: string,
): Record<string, unknown> {
  const next = { ...configuration };
  if (Array.isArray(next['queries'])) next['queries'] = queries;
  if (typeof next['searchKeywords'] === 'string')
    next['searchKeywords'] = primaryQuery;
  if (typeof next['query'] === 'string') next['query'] = primaryQuery;
  return next;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
