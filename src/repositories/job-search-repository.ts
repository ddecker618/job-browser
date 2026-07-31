import type { JobDatabase } from '../db/database.js';
import type { JobStatus } from '../domain/job-status.js';
import type {
  JobSearchFacet,
  JobSearchFacets,
  JobSearchItem,
  JobSearchMode,
  JobSearchQuery,
  JobSearchResponse,
  JobSearchSource,
} from '../models/job-search.js';

interface JobRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remote_type: string;
  salary_minimum: number | null;
  salary_maximum: number | null;
  score: number | null;
  recommendation: string | null;
  matched_families: string | null;
  status: JobStatus;
  first_seen_at: string;
  last_verified_at: string | null;
  materially_updated_at: string | null;
  closing_date: string | null;
  favorite: number;
  active: number;
  verification_status: string | null;
  eligibility_passed: number | null;
  eligibility_rejection: string | null;
  work_arrangement: string | null;
  score_version: string | null;
}

interface SourceRow {
  job_id: string;
  source_id: string;
  source_name: string;
  provider_id: string | null;
}

interface CountRow {
  value: number;
}

interface FacetRow {
  value: string;
  label: string;
  count: number;
}

export interface JobSearchRepositoryOptions {
  forceFallback?: boolean;
  getScoreVersion?: (() => string) | undefined;
}

const SORT_COLUMNS = {
  score: 'jobs.score',
  firstSeenAt: 'jobs.first_seen_at',
  lastVerifiedAt: 'jobs.last_verified_at',
  closingDate: 'jobs.closing_date',
  company: 'jobs.company COLLATE NOCASE',
  title: 'jobs.title COLLATE NOCASE',
  materiallyUpdatedAt: 'jobs.materially_updated_at',
} as const;

export class JobSearchRepository {
  public readonly searchMode: JobSearchMode;

  public constructor(
    private readonly database: JobDatabase,
    options: JobSearchRepositoryOptions = {},
  ) {
    this.getScoreVersion = options.getScoreVersion;
    this.searchMode =
      options.forceFallback === true || !this.provisionFts()
        ? 'indexed'
        : 'fts5';
  }

  private readonly getScoreVersion: (() => string) | undefined;

  public search(query: JobSearchQuery): JobSearchResponse {
    const { sql: filterSql, parameters } = this.filters(query);
    const filtered = `WITH filtered_jobs AS (SELECT jobs.id FROM jobs${filterSql})`;
    const total =
      this.database
        .prepare<
          unknown[],
          CountRow
        >(`${filtered} SELECT COUNT(*) AS value FROM filtered_jobs`)
        .get(...parameters)?.value ?? 0;
    const sortColumn = SORT_COLUMNS[query.sort];
    const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
    const rows = this.database
      .prepare<unknown[], JobRow>(
        `${filtered}
         SELECT jobs.id, jobs.title, jobs.company, jobs.location, jobs.remote_type,
           jobs.salary_minimum, jobs.salary_maximum, jobs.score, jobs.recommendation,
           jobs.matched_families, jobs.status, jobs.first_seen_at, jobs.last_verified_at,
           jobs.materially_updated_at, jobs.closing_date, jobs.favorite, jobs.active,
           jobs.verification_status, jobs.eligibility_passed,
           jobs.eligibility_rejection, jobs.work_arrangement, jobs.score_version
          FROM filtered_jobs JOIN jobs ON jobs.id = filtered_jobs.id
         ORDER BY ${sortColumn} IS NULL ASC, ${sortColumn} ${direction}, jobs.id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...parameters, query.pageSize, (query.page - 1) * query.pageSize);
    const sources = this.sourcesFor(rows.map((row) => row.id));

    return {
      items: rows.map((row) => mapJob(row, sources.get(row.id) ?? [])),
      page: query.page,
      pageSize: query.pageSize,
      total,
      pages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      facets: this.facets(filtered, parameters),
      searchMode: this.searchMode,
    };
  }

  private filters(query: JobSearchQuery): {
    sql: string;
    parameters: unknown[];
  } {
    const clauses: string[] = [];
    const parameters: unknown[] = [];
    const scoreVersion = this.getScoreVersion?.();
    if (scoreVersion !== undefined) {
      clauses.push('jobs.score_version = ?');
      parameters.push(scoreVersion);
    }
    if (query.includeIneligible !== true) {
      clauses.push('COALESCE(jobs.eligibility_passed, 1) = 1');
    }
    if (query.q !== undefined) {
      const tokens = tokenize(query.q);
      if (this.searchMode === 'fts5' && tokens.length > 0) {
        clauses.push(
          'jobs.id IN (SELECT job_id FROM job_search_fts WHERE job_search_fts MATCH ?)',
        );
        parameters.push(tokens.map((token) => `"${token}"`).join(' AND '));
      } else {
        for (const term of tokens.length === 0 ? [query.q] : tokens) {
          clauses.push(`instr(lower(jobs.title || ' ' || jobs.company || ' ' ||
            COALESCE(jobs.location, '') || ' ' || COALESCE(jobs.description, '') || ' ' ||
            COALESCE(jobs.requirements, '') || ' ' || COALESCE(jobs.preferred_qualifications, '')),
            lower(?)) > 0`);
          parameters.push(term);
        }
      }
    }
    if (query.title !== undefined) {
      const tokens = tokenize(query.title);
      for (const term of tokens.length === 0 ? [query.title] : tokens) {
        clauses.push('instr(lower(jobs.title), lower(?)) > 0');
        parameters.push(term);
      }
    }
    addEqual(clauses, parameters, 'jobs.company COLLATE NOCASE', query.company);
    addEqual(
      clauses,
      parameters,
      'jobs.location COLLATE NOCASE',
      query.location,
    );
    addEqual(clauses, parameters, 'jobs.remote_type', query.remoteType);
    addEqual(
      clauses,
      parameters,
      'jobs.verification_status',
      query.verificationStatus,
    );
    addComparison(clauses, parameters, 'jobs.score', '>=', query.minScore);
    addComparison(clauses, parameters, 'jobs.score', '<=', query.maxScore);
    if (query.minSalary !== undefined) {
      clauses.push(
        'COALESCE(jobs.salary_maximum, jobs.salary_minimum, 0) >= ?',
      );
      parameters.push(query.minSalary);
    }
    addEqual(clauses, parameters, 'jobs.recommendation', query.recommendation);
    if (query.status !== undefined) {
      addEqual(clauses, parameters, 'jobs.status', query.status);
    } else {
      clauses.push("jobs.status != 'ignored'");
    }
    addComparison(
      clauses,
      parameters,
      'jobs.first_seen_at',
      '>=',
      startOfDate(query.firstDiscoveredFrom),
    );
    addComparison(
      clauses,
      parameters,
      'jobs.first_seen_at',
      '<=',
      endOfDate(query.firstDiscoveredTo),
    );
    addComparison(
      clauses,
      parameters,
      'jobs.last_verified_at',
      '>=',
      startOfDate(query.lastVerifiedFrom),
    );
    addComparison(
      clauses,
      parameters,
      'jobs.last_verified_at',
      '<=',
      endOfDate(query.lastVerifiedTo),
    );
    if (query.provider !== undefined) {
      clauses.push(
        `EXISTS (
          SELECT 1 FROM job_sources provider_membership
          JOIN sources provider_source ON provider_source.id = provider_membership.source_id
          WHERE provider_membership.job_id = jobs.id
            AND COALESCE(provider_membership.provider_id, provider_source.provider_id) = ?
        )`,
      );
      parameters.push(query.provider);
    }
    if (query.sourceId !== undefined) {
      clauses.push(
        'EXISTS (SELECT 1 FROM job_sources source_membership WHERE source_membership.job_id = jobs.id AND source_membership.source_id = ?)',
      );
      parameters.push(query.sourceId);
    }
    if (query.newlyDiscovered !== undefined) {
      clauses.push(
        `jobs.first_seen_at ${query.newlyDiscovered ? '>=' : '<'} strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')`,
      );
    }
    if (query.materiallyUpdated !== undefined) {
      clauses.push(
        `jobs.materially_updated_at IS ${query.materiallyUpdated ? 'NOT ' : ''}NULL`,
      );
    }
    if (query.closingSoon !== undefined) {
      const closing =
        "jobs.closing_date IS NOT NULL AND jobs.closing_date >= date('now') AND jobs.closing_date < date('now', '+14 days')";
      clauses.push(query.closingSoon ? `(${closing})` : `NOT (${closing})`);
    }
    if (query.active !== undefined) {
      clauses.push('jobs.active = ?');
      parameters.push(query.active === 'active' ? 1 : 0);
    }
    if (query.multipleSource !== undefined) {
      const multiple = `EXISTS (
        SELECT 1 FROM job_sources first_membership
        JOIN job_sources other_membership
          ON other_membership.job_id = first_membership.job_id
         AND other_membership.source_id <> first_membership.source_id
        WHERE first_membership.job_id = jobs.id
      )`;
      clauses.push(query.multipleSource ? multiple : `NOT ${multiple}`);
    }
    if (
      query.matchedFamilies !== undefined &&
      query.matchedFamilies.length > 0
    ) {
      const families = query.matchedFamilies
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
      if (families.length > 0) {
        const orClauses = families.map(() => 'jobs.matched_families LIKE ?');
        clauses.push(`(${orClauses.join(' OR ')})`);
        for (const family of families) {
          parameters.push(`%${family}%`);
        }
      }
    }
    return {
      sql: clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`,
      parameters,
    };
  }

  private sourcesFor(jobIds: string[]): Map<string, JobSearchSource[]> {
    const result = new Map<string, JobSearchSource[]>();
    if (jobIds.length === 0) return result;
    const placeholders = jobIds.map(() => '?').join(', ');
    const rows = this.database
      .prepare<string[], SourceRow>(
        `SELECT job_sources.job_id, job_sources.source_id,
          COALESCE(sources.display_name, sources.employer) AS source_name,
          COALESCE(job_sources.provider_id, sources.provider_id) AS provider_id
         FROM job_sources JOIN sources ON sources.id = job_sources.source_id
         WHERE job_sources.job_id IN (${placeholders})
         ORDER BY source_name COLLATE NOCASE, job_sources.source_id`,
      )
      .all(...jobIds);
    for (const row of rows) {
      const membership = {
        sourceId: row.source_id,
        sourceName: row.source_name,
        providerId: row.provider_id,
      };
      const existing = result.get(row.job_id);
      if (existing === undefined) result.set(row.job_id, [membership]);
      else existing.push(membership);
    }
    return result;
  }

  private facets(filtered: string, parameters: unknown[]): JobSearchFacets {
    const jobFacet = (value: string, label = value): JobSearchFacet[] =>
      this.database
        .prepare<unknown[], FacetRow>(
          `${filtered} SELECT ${value} AS value, ${label} AS label, COUNT(*) AS count
           FROM filtered_jobs JOIN jobs ON jobs.id = filtered_jobs.id
           WHERE ${value} IS NOT NULL AND ${value} <> ''
           GROUP BY ${value} ORDER BY count DESC, label COLLATE NOCASE LIMIT 100`,
        )
        .all(...parameters);
    const membershipFacet = (
      value: string,
      label: string,
      joins: string,
    ): JobSearchFacet[] =>
      this.database
        .prepare<unknown[], FacetRow>(
          `${filtered} SELECT ${value} AS value, ${label} AS label,
             COUNT(DISTINCT filtered_jobs.id) AS count
           FROM filtered_jobs ${joins}
           WHERE ${value} IS NOT NULL AND ${value} <> ''
           GROUP BY ${value} ORDER BY count DESC, label COLLATE NOCASE LIMIT 100`,
        )
        .all(...parameters);
    return {
      companies: jobFacet('jobs.company'),
      locations: jobFacet('jobs.location'),
      remoteTypes: jobFacet('jobs.remote_type'),
      providers: membershipFacet(
        'COALESCE(job_sources.provider_id, provider_source.provider_id)',
        'COALESCE(job_sources.provider_id, provider_source.provider_id)',
        `JOIN job_sources ON job_sources.job_id = filtered_jobs.id
         JOIN sources provider_source ON provider_source.id = job_sources.source_id`,
      ),
      sources: membershipFacet(
        'sources.id',
        'COALESCE(sources.display_name, sources.employer)',
        'JOIN job_sources ON job_sources.job_id = filtered_jobs.id JOIN sources ON sources.id = job_sources.source_id',
      ),
      recommendations: jobFacet('jobs.recommendation'),
      statuses: jobFacet('jobs.status'),
      activeStates: this.database
        .prepare<unknown[], FacetRow>(
          `${filtered} SELECT CASE jobs.active WHEN 1 THEN 'active' ELSE 'removed' END AS value,
             CASE jobs.active WHEN 1 THEN 'Active' ELSE 'Removed' END AS label,
             COUNT(*) AS count
           FROM filtered_jobs JOIN jobs ON jobs.id = filtered_jobs.id
           GROUP BY jobs.active ORDER BY jobs.active DESC`,
        )
        .all(...parameters),
    };
  }

  private provisionFts(): boolean {
    let transactionStarted = false;
    let alreadyProvisioned = false;
    try {
      alreadyProvisioned =
        this.database
          .prepare<
            [],
            CountRow
          >("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'job_search_fts'")
          .get()?.value === 1;
      this.database.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      this.database.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS job_search_fts USING fts5(
          job_id UNINDEXED, title, company, location, content
        );
        CREATE TRIGGER IF NOT EXISTS job_search_fts_insert AFTER INSERT ON jobs BEGIN
          INSERT INTO job_search_fts(job_id, title, company, location, content)
          VALUES (new.id, new.title, new.company, COALESCE(new.location, ''),
            COALESCE(new.description, '') || ' ' || COALESCE(new.requirements, '') || ' ' ||
            COALESCE(new.preferred_qualifications, ''));
        END;
        CREATE TRIGGER IF NOT EXISTS job_search_fts_update AFTER UPDATE OF
          title, company, location, description, requirements, preferred_qualifications ON jobs BEGIN
          DELETE FROM job_search_fts WHERE job_id = old.id;
          INSERT INTO job_search_fts(job_id, title, company, location, content)
          VALUES (new.id, new.title, new.company, COALESCE(new.location, ''),
            COALESCE(new.description, '') || ' ' || COALESCE(new.requirements, '') || ' ' ||
            COALESCE(new.preferred_qualifications, ''));
        END;
        CREATE TRIGGER IF NOT EXISTS job_search_fts_delete AFTER DELETE ON jobs BEGIN
          DELETE FROM job_search_fts WHERE job_id = old.id;
        END;
      `);
      if (alreadyProvisioned) {
        this.database.exec(`
          DELETE FROM job_search_fts WHERE job_id NOT IN (SELECT id FROM jobs);
          INSERT INTO job_search_fts(job_id, title, company, location, content)
          SELECT jobs.id, jobs.title, jobs.company, COALESCE(jobs.location, ''),
            COALESCE(jobs.description, '') || ' ' || COALESCE(jobs.requirements, '') || ' ' ||
            COALESCE(jobs.preferred_qualifications, '')
          FROM jobs
          WHERE NOT EXISTS (
            SELECT 1 FROM job_search_fts WHERE job_search_fts.job_id = jobs.id
          );
        `);
      } else {
        this.database.exec(`
          INSERT INTO job_search_fts(job_id, title, company, location, content)
          SELECT id, title, company, COALESCE(location, ''),
            COALESCE(description, '') || ' ' || COALESCE(requirements, '') || ' ' ||
            COALESCE(preferred_qualifications, '') FROM jobs;
        `);
      }
      this.database.exec('COMMIT');
      return true;
    } catch {
      if (transactionStarted) {
        try {
          this.database.exec('ROLLBACK');
        } catch {
          // Continue with indexed search even if rollback is unavailable.
        }
      }
      for (const statement of alreadyProvisioned
        ? []
        : [
            'DROP TRIGGER IF EXISTS job_search_fts_insert',
            'DROP TRIGGER IF EXISTS job_search_fts_update',
            'DROP TRIGGER IF EXISTS job_search_fts_delete',
            'DROP TABLE IF EXISTS job_search_fts',
          ]) {
        try {
          this.database.exec(statement);
        } catch {
          // Search remains available through the indexed fallback.
        }
      }
      return false;
    }
  }
}

function tokenize(value: string): string[] {
  return (value.match(/[\p{L}\p{N}]+/gu) ?? [])
    .slice(0, 12)
    .map((term) => term.slice(0, 64).replaceAll('"', '""'));
}

function startOfDate(value: string | undefined): string | undefined {
  return value?.length === 10 ? `${value}T00:00:00.000Z` : value;
}

function endOfDate(value: string | undefined): string | undefined {
  return value?.length === 10 ? `${value}T23:59:59.999Z` : value;
}

function addEqual(
  clauses: string[],
  parameters: unknown[],
  column: string,
  value: unknown,
): void {
  if (value === undefined) return;
  clauses.push(`${column} = ?`);
  parameters.push(value);
}

function addComparison(
  clauses: string[],
  parameters: unknown[],
  column: string,
  operator: '>=' | '<=',
  value: unknown,
): void {
  if (value === undefined) return;
  clauses.push(`${column} ${operator} ?`);
  parameters.push(value);
}

function mapJob(row: JobRow, sources: JobSearchSource[]): JobSearchItem {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    remoteType: row.remote_type,
    salaryMinimum: row.salary_minimum,
    salaryMaximum: row.salary_maximum,
    score: row.score,
    recommendation: row.recommendation,
    matchedFamilies: row.matched_families,
    status: row.status,
    firstSeenAt: row.first_seen_at,
    lastVerifiedAt: row.last_verified_at,
    materiallyUpdatedAt: row.materially_updated_at,
    closingDate: row.closing_date,
    favorite: Boolean(row.favorite),
    active: Boolean(row.active),
    sources,
    verificationStatus: row.verification_status,
    eligibilityPassed:
      row.eligibility_passed === null ? null : Boolean(row.eligibility_passed),
    eligibilityRejection: row.eligibility_rejection,
    workArrangement: row.work_arrangement,
    scoreVersion: row.score_version,
  };
}
