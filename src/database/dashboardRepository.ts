import { randomUUID } from 'node:crypto';

import type { JobDatabase } from '../db/database.js';
import type { JobStatus } from '../domain/job-status.js';
import type {
  ActivityItem,
  AnalyticsView,
  AppSettings,
  DashboardSummary,
  JobDetail,
  JobListItem,
  JobSourceView,
  MetricItem,
  ResumeProposalView,
  ResumeView,
  SavedFilterView,
  SourceView,
} from '../models/dashboard.js';
import type {
  CategoryScores,
  RecommendationStatus,
} from '../models/intelligence.js';
import { nowUtc } from '../utilities/timestamps.js';

interface CountRow {
  value: number;
}

interface TextRow {
  value: string | null;
}

interface ActivityRow {
  id: string;
  type: ActivityItem['type'];
  label: string;
  timestamp: string;
}

interface JobListRow {
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
  last_seen_at: string;
  provider: string;
  favorite: number;
  active: number;
  verification_status: string | null;
  eligibility_passed: number | null;
  eligibility_rejection: string | null;
  work_arrangement: string | null;
  score_version: string | null;
}

interface JobDetailRow extends JobListRow {
  city: string | null;
  state: string | null;
  employment_type: string;
  salary_text: string | null;
  description: string | null;
  requirements: string | null;
  preferred_qualifications: string | null;
  posting_url: string | null;
  date_posted: string | null;
  clearance_requirement: string | null;
  category_scores_json: string | null;
  explanations_json: string | null;
  missing_qualifications_json: string | null;
  recommendation_status: RecommendationStatus | null;
  notes: string | null;
  agency: string | null;
  department: string | null;
  grade_low: string | null;
  grade_high: string | null;
  pay_plan: string | null;
  appointment_type: string | null;
  work_schedule: string | null;
  telework_eligible: number | null;
  opening_date: string | null;
  closing_date: string | null;
  application_urls_json: string;
}

interface JobSourceRow {
  source_id: string;
  provider_id: string | null;
  posting_url: string | null;
  external_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface NameRow {
  name: string;
}

interface ResumeRow {
  id: string;
  display_name: string;
  original_filename: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  is_default: number;
  parsing_status: ResumeView['parsingStatus'];
  parsing_error: string | null;
  extracted_skills_json: string;
  extracted_certifications_json: string;
  created_at: string;
  updated_at: string;
}

interface ProposalRow {
  id: string;
  field_name: ResumeProposalView['fieldName'];
  proposed_value: string;
  reason: string;
  status: ResumeProposalView['status'];
}

interface SourceRow {
  id: string;
  provider_name: string;
  failure_count: number;
  jobs_imported: number;
  last_run: string | null;
  duration_ms: number | null;
  error: string | null;
  last_successful_import: string | null;
}

interface MetricRow {
  label: string;
  value: number;
}

interface SettingRow {
  setting_key: string;
  setting_value_json: string;
}

export interface DashboardRepositoryOptions {
  getScoreVersion?: (() => string) | undefined;
}

interface SavedFilterRow {
  id: string;
  name: string;
  filters_json: string;
}

export interface ResumeInput {
  displayName: string;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  parsingStatus: ResumeView['parsingStatus'];
  parsingError: string | null;
  extractedSkills: string[];
  extractedCertifications: string[];
}

export class DashboardRepository {
  public constructor(
    private readonly database: JobDatabase,
    private readonly options: DashboardRepositoryOptions = {},
  ) {}

  public getSummary(): DashboardSummary {
    const today = nowUtc().slice(0, 10);
    return {
      totalJobs: this.scalar('SELECT COUNT(*) AS value FROM jobs'),
      newJobsToday: this.scalar(
        'SELECT COUNT(*) AS value FROM jobs WHERE substr(first_seen_at, 1, 10) = ?',
        today,
      ),
      strongMatches: this.scalar(
        `SELECT COUNT(*) AS value FROM jobs
         WHERE recommendation IN ('Apply Immediately', 'Strong Match')`,
      ),
      appliedJobs: this.scalar(
        `SELECT COUNT(*) AS value FROM jobs
         WHERE status IN ('applied', 'interview', 'offer', 'rejected')`,
      ),
      hiddenJobs: this.scalar(
        "SELECT COUNT(*) AS value FROM jobs WHERE recommendation = 'Hidden' OR status = 'ignored'",
      ),
      expiredJobs: this.scalar(
        "SELECT COUNT(*) AS value FROM jobs WHERE status = 'expired' OR active = 0",
      ),
      verifiedMatches: this.scalar(
        "SELECT COUNT(*) AS value FROM jobs WHERE verification_status = 'verified' AND eligibility_passed = 1",
      ),
      averageMatchScore: this.scalar('SELECT AVG(score) AS value FROM jobs'),
      topEmployer: this.text(
        `SELECT company AS value FROM jobs GROUP BY normalized_company
         ORDER BY COUNT(*) DESC, company LIMIT 1`,
      ),
      topSkill: this.text(
        `SELECT skills.name AS value FROM job_skills
         JOIN skills ON skills.id = job_skills.skill_id
         GROUP BY skills.id ORDER BY SUM(job_skills.frequency) DESC, skills.name LIMIT 1`,
      ),
      recentActivity: this.getRecentActivity(),
    };
  }

  public listJobs(): JobListItem[] {
    const scoreVersion = this.options.getScoreVersion?.();
    const currentScoreFilter =
      scoreVersion === undefined
        ? ''
        : 'WHERE jobs.score_version = ? AND COALESCE(jobs.eligibility_passed, 1) = 1';
    return this.database
      .prepare<unknown[], JobListRow>(
        `SELECT jobs.id, jobs.title, jobs.company, jobs.location, jobs.remote_type,
          jobs.salary_minimum, jobs.salary_maximum, jobs.score, jobs.recommendation,
          jobs.matched_families, jobs.status, jobs.first_seen_at, jobs.last_seen_at,
           jobs.favorite, jobs.active, jobs.verification_status,
           jobs.eligibility_passed, jobs.eligibility_rejection,
           jobs.work_arrangement, jobs.score_version,
          COALESCE(MIN(job_sources.provider_id), jobs.source_type) AS provider
          FROM jobs LEFT JOIN job_sources ON job_sources.job_id = jobs.id
          ${currentScoreFilter}
          GROUP BY jobs.id ORDER BY jobs.first_seen_at DESC`,
      )
      .all(...(scoreVersion === undefined ? [] : [scoreVersion]))
      .map(mapJobListItem);
  }

  public getJob(jobId: string): JobDetail | null {
    const row = this.database
      .prepare<[string], JobDetailRow>(
        `SELECT jobs.id, jobs.title, jobs.company, jobs.location, jobs.city, jobs.state,
          jobs.remote_type, jobs.employment_type, jobs.salary_minimum, jobs.salary_maximum,
          jobs.salary_text, jobs.score, jobs.recommendation, jobs.matched_families, jobs.status,
           jobs.first_seen_at, jobs.last_seen_at, jobs.favorite, jobs.active,
           jobs.verification_status, jobs.eligibility_passed,
           jobs.eligibility_rejection, jobs.work_arrangement, jobs.score_version,
          jobs.description, jobs.requirements, jobs.preferred_qualifications,
           jobs.posting_url, jobs.date_posted, jobs.clearance_requirement, jobs.notes,
           jobs.agency, jobs.department, jobs.grade_low, jobs.grade_high, jobs.pay_plan,
           jobs.appointment_type, jobs.work_schedule, jobs.telework_eligible,
           jobs.opening_date, jobs.closing_date, jobs.application_urls_json,
          jobs.source_type AS provider, recommendations.category_scores_json,
          recommendations.explanations_json, recommendations.missing_qualifications_json,
          recommendations.recommendation_status
         FROM jobs
         LEFT JOIN recommendations ON recommendations.job_id = jobs.id
         WHERE jobs.id = ? ORDER BY recommendations.analyzed_at DESC LIMIT 1`,
      )
      .get(jobId);
    if (row === undefined) return null;

    const sources = this.database
      .prepare<[string], JobSourceRow>(
        `SELECT source_id, provider_id, posting_url, external_id, first_seen_at, last_seen_at
         FROM job_sources WHERE job_id = ? ORDER BY first_seen_at`,
      )
      .all(jobId)
      .map<JobSourceView>((source) => ({
        sourceId: source.source_id,
        providerId: source.provider_id,
        postingUrl: source.posting_url,
        externalId: source.external_id,
        firstSeenAt: source.first_seen_at,
        lastSeenAt: source.last_seen_at,
      }));
    const skills = this.database
      .prepare<[string], NameRow>(
        `SELECT skills.name FROM job_skills JOIN skills ON skills.id = job_skills.skill_id
         WHERE job_skills.job_id = ? ORDER BY skills.name`,
      )
      .all(jobId)
      .map((item) => item.name);
    const certifications = this.database
      .prepare<[string], NameRow>(
        `SELECT certifications.name FROM job_certifications
         JOIN certifications ON certifications.id = job_certifications.certification_id
         WHERE job_certifications.job_id = ? ORDER BY certifications.name`,
      )
      .all(jobId)
      .map((item) => item.name);

    return {
      ...mapJobListItem(row),
      city: row.city,
      state: row.state,
      employmentType: row.employment_type,
      salaryText: row.salary_text,
      description: row.description,
      requirements: row.requirements,
      preferredQualifications: row.preferred_qualifications,
      postingUrl: row.posting_url,
      datePosted: row.date_posted,
      clearanceRequirement: row.clearance_requirement,
      agency: row.agency,
      department: row.department,
      gradeLow: row.grade_low,
      gradeHigh: row.grade_high,
      payPlan: row.pay_plan,
      appointmentType: row.appointment_type,
      workSchedule: row.work_schedule,
      teleworkEligible:
        row.telework_eligible === null ? null : Boolean(row.telework_eligible),
      openingDate: row.opening_date,
      closingDate: row.closing_date,
      applicationUrls: parseJson<string[]>(row.application_urls_json, []),
      categoryScores: parseJson<CategoryScores | null>(
        row.category_scores_json,
        null,
      ),
      explanations: parseJson<string[]>(row.explanations_json, []),
      missingQualifications: parseJson<string[]>(
        row.missing_qualifications_json,
        [],
      ),
      skills,
      certifications,
      sources,
      notes: row.notes,
      recommendationStatus: row.recommendation_status,
    };
  }

  public updateJobMetadata(
    jobId: string,
    favorite: boolean | undefined,
    notes: string | null | undefined,
  ): void {
    const existing = this.database
      .prepare<
        [string],
        { favorite: number; notes: string | null }
      >('SELECT favorite, notes FROM jobs WHERE id = ?')
      .get(jobId);
    if (existing === undefined) throw new Error(`Job not found: ${jobId}`);
    this.database
      .prepare(
        'UPDATE jobs SET favorite = ?, notes = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        favorite === undefined ? existing.favorite : Number(favorite),
        notes === undefined ? existing.notes : notes,
        nowUtc(),
        jobId,
      );
  }

  public listResumes(): ResumeView[] {
    return this.database
      .prepare<[], ResumeRow>(
        'SELECT * FROM resumes ORDER BY is_default DESC, updated_at DESC',
      )
      .all()
      .map((row) => this.mapResume(row));
  }

  public addResume(input: ResumeInput): ResumeView {
    const id = randomUUID();
    const timestamp = nowUtc();
    const shouldDefault =
      this.scalar('SELECT COUNT(*) AS value FROM resumes') === 0;
    this.database.transaction(() => {
      if (shouldDefault)
        this.database.prepare('UPDATE resumes SET is_default = 0').run();
      this.database
        .prepare(
          `INSERT INTO resumes (
            id, display_name, original_filename, storage_path, mime_type, size_bytes,
            is_default, parsing_status, extracted_skills_json,
            extracted_certifications_json, parsing_error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.displayName,
          input.originalFilename,
          input.storagePath,
          input.mimeType,
          input.sizeBytes,
          Number(shouldDefault),
          input.parsingStatus,
          JSON.stringify(input.extractedSkills),
          JSON.stringify(input.extractedCertifications),
          input.parsingError,
          timestamp,
          timestamp,
        );
    })();
    const resume = this.getResume(id);
    if (resume === null) throw new Error('Resume was not created');
    return resume;
  }

  public getResume(resumeId: string): ResumeView | null {
    const row = this.database
      .prepare<[string], ResumeRow>('SELECT * FROM resumes WHERE id = ?')
      .get(resumeId);
    return row === undefined ? null : this.mapResume(row);
  }

  public getResumeStoragePath(resumeId: string): string | null {
    return (
      this.database
        .prepare<
          [string],
          { storage_path: string }
        >('SELECT storage_path FROM resumes WHERE id = ?')
        .get(resumeId)?.storage_path ?? null
    );
  }

  public renameResume(resumeId: string, displayName: string): void {
    this.assertChanged(
      this.database
        .prepare(
          'UPDATE resumes SET display_name = ?, updated_at = ? WHERE id = ?',
        )
        .run(displayName, nowUtc(), resumeId).changes,
      `Resume not found: ${resumeId}`,
    );
  }

  public setDefaultResume(resumeId: string): void {
    this.database.transaction(() => {
      const exists = this.scalar(
        'SELECT COUNT(*) AS value FROM resumes WHERE id = ?',
        resumeId,
      );
      if (exists === 0) throw new Error(`Resume not found: ${resumeId}`);
      this.database.prepare('UPDATE resumes SET is_default = 0').run();
      this.database
        .prepare(
          'UPDATE resumes SET is_default = 1, updated_at = ? WHERE id = ?',
        )
        .run(nowUtc(), resumeId);
    })();
  }

  public deleteResume(resumeId: string): void {
    this.assertChanged(
      this.database.prepare('DELETE FROM resumes WHERE id = ?').run(resumeId)
        .changes,
      `Resume not found: ${resumeId}`,
    );
  }

  public addResumeProposals(
    resumeId: string,
    skills: readonly string[],
    certifications: readonly string[],
  ): void {
    const timestamp = nowUtc();
    const insert = this.database.prepare(
      `INSERT INTO resume_profile_proposals
        (id, resume_id, field_name, proposed_value, reason, status, created_at, reviewed_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)`,
    );
    for (const skill of skills) {
      insert.run(
        randomUUID(),
        resumeId,
        'skills',
        skill,
        'Extracted from uploaded resume',
        timestamp,
      );
    }
    for (const certification of certifications) {
      insert.run(
        randomUUID(),
        resumeId,
        'certifications',
        certification,
        'Extracted from uploaded resume',
        timestamp,
      );
    }
  }

  public reviewProposal(
    proposalId: string,
    status: 'approved' | 'rejected',
  ): ResumeProposalView {
    this.assertChanged(
      this.database
        .prepare(
          `UPDATE resume_profile_proposals SET status = ?, reviewed_at = ? WHERE id = ?`,
        )
        .run(status, nowUtc(), proposalId).changes,
      `Proposal not found: ${proposalId}`,
    );
    const row = this.database
      .prepare<[string], ProposalRow>(
        `SELECT id, field_name, proposed_value, reason, status
         FROM resume_profile_proposals WHERE id = ?`,
      )
      .get(proposalId);
    if (row === undefined) throw new Error(`Proposal not found: ${proposalId}`);
    return mapProposal(row);
  }

  public reviewAllProposals(
    resumeId: string,
    status: 'approved' | 'rejected',
  ): ResumeProposalView[] {
    this.database
      .prepare(
        `UPDATE resume_profile_proposals SET status = ?, reviewed_at = ?
         WHERE resume_id = ? AND status = 'pending'`,
      )
      .run(status, nowUtc(), resumeId);
    return this.getProposals(resumeId);
  }

  public listSources(): SourceView[] {
    return this.database
      .prepare<[], SourceRow>(
        `SELECT provider_metadata.provider_id AS id,
          provider_metadata.provider_name, provider_metadata.failure_count,
          COUNT(DISTINCT job_sources.job_id) AS jobs_imported,
          latest.started_at AS last_run, latest.execution_time_ms AS duration_ms,
          latest.error_message AS error,
          provider_metadata.last_successful_run AS last_successful_import
         FROM provider_metadata
         LEFT JOIN job_sources ON job_sources.provider_id = provider_metadata.provider_id
         LEFT JOIN runs AS latest ON latest.id = (
           SELECT id FROM runs WHERE provider_id = provider_metadata.provider_id
           ORDER BY started_at DESC LIMIT 1
         )
         GROUP BY provider_metadata.provider_id ORDER BY provider_metadata.provider_name`,
      )
      .all()
      .map((row) => ({
        id: row.id,
        providerName: row.provider_name,
        status:
          row.last_run === null
            ? 'never-run'
            : row.failure_count > 0
              ? 'failed'
              : 'healthy',
        jobsImported: row.jobs_imported,
        lastRun: row.last_run,
        durationMs: row.duration_ms,
        error: row.error,
        lastSuccessfulImport: row.last_successful_import,
      }));
  }

  public getAnalytics(): AnalyticsView {
    return {
      topSkills: this.metrics(
        `SELECT skills.name AS label, SUM(job_skills.frequency) AS value
         FROM job_skills JOIN skills ON skills.id = job_skills.skill_id
         GROUP BY skills.id ORDER BY value DESC LIMIT 10`,
      ),
      topCertifications: this.metrics(
        `SELECT certifications.name AS label, COUNT(*) AS value
         FROM job_certifications
         JOIN certifications ON certifications.id = job_certifications.certification_id
         GROUP BY certifications.id ORDER BY value DESC LIMIT 10`,
      ),
      topEmployers: this.metrics(
        `SELECT company AS label, COUNT(*) AS value FROM jobs
         GROUP BY normalized_company ORDER BY value DESC LIMIT 10`,
      ),
      jobsByLocation: this.metrics(
        `SELECT COALESCE(location, 'Unknown') AS label, COUNT(*) AS value
         FROM jobs GROUP BY location ORDER BY value DESC LIMIT 10`,
      ),
      jobsByScore: this.metrics(
        `SELECT CASE
           WHEN score >= 80 THEN '80-100'
           WHEN score >= 60 THEN '60-79'
           WHEN score >= 40 THEN '40-59'
           WHEN score IS NULL THEN 'Unscored'
           ELSE '0-39' END AS label, COUNT(*) AS value
         FROM jobs GROUP BY label ORDER BY label`,
      ),
      recommendationDistribution: this.metrics(
        `SELECT COALESCE(recommendation, 'Unscored') AS label, COUNT(*) AS value
         FROM jobs GROUP BY recommendation ORDER BY value DESC`,
      ),
      jobsOverTime: this.metrics(
        `SELECT substr(first_seen_at, 1, 10) AS label, COUNT(*) AS value
         FROM jobs GROUP BY label ORDER BY label`,
      ),
      averageSalary: this.scalar(
        `SELECT AVG(CASE
           WHEN salary_minimum IS NOT NULL AND salary_maximum IS NOT NULL
             THEN (salary_minimum + salary_maximum) / 2
           ELSE COALESCE(salary_maximum, salary_minimum) END) AS value FROM jobs`,
      ),
    };
  }

  public getSettings(defaults: AppSettings): AppSettings {
    const settings = { ...defaults };
    const rows = this.database
      .prepare<
        [],
        SettingRow
      >('SELECT setting_key, setting_value_json FROM app_settings')
      .all();
    for (const row of rows) {
      if (row.setting_key in settings) {
        Object.assign(settings, {
          [row.setting_key]: parseJson(row.setting_value_json, null),
        });
      }
    }
    return settings;
  }

  public getSetting(key: string): string | null {
    const row = this.database
      .prepare<
        [string],
        { setting_value_json: string } | undefined
      >('SELECT setting_value_json FROM app_settings WHERE setting_key = ?')
      .get(key);
    return row?.setting_value_json ?? null;
  }

  public saveSetting(key: string, valueJson: string): void {
    this.database
      .prepare(
        `INSERT INTO app_settings (setting_key, setting_value_json, updated_at)
         VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET
         setting_value_json = excluded.setting_value_json, updated_at = excluded.updated_at`,
      )
      .run(key, valueJson, nowUtc());
  }

  public saveSettings(settings: AppSettings): void {
    const statement = this.database.prepare(
      `INSERT INTO app_settings (setting_key, setting_value_json, updated_at)
       VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET
       setting_value_json = excluded.setting_value_json, updated_at = excluded.updated_at`,
    );
    const timestamp = nowUtc();
    this.database.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        statement.run(key, JSON.stringify(value), timestamp);
      }
    })();
  }

  public listSavedFilters(): SavedFilterView[] {
    return this.database
      .prepare<[], SavedFilterRow>(
        'SELECT id, name, filters_json FROM saved_filters ORDER BY name',
      )
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        filters: parseJson<Record<string, string | number | boolean>>(
          row.filters_json,
          {},
        ),
      }));
  }

  public saveFilter(
    name: string,
    filters: Record<string, string | number | boolean>,
  ): SavedFilterView {
    const id = randomUUID();
    const timestamp = nowUtc();
    this.database
      .prepare(
        `INSERT INTO saved_filters (id, name, filters_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, name, JSON.stringify(filters), timestamp, timestamp);
    return { id, name, filters };
  }

  public deleteFilter(filterId: string): void {
    this.database
      .prepare('DELETE FROM saved_filters WHERE id = ?')
      .run(filterId);
  }

  private getRecentActivity(): ActivityItem[] {
    return this.database
      .prepare<[], ActivityRow>(
        `SELECT * FROM (
          SELECT job_status_history.id, 'status' AS type,
            jobs.title || ' changed to ' || job_status_history.new_status AS label,
            job_status_history.changed_at AS timestamp
          FROM job_status_history JOIN jobs ON jobs.id = job_status_history.job_id
          UNION ALL
          SELECT runs.id, 'discovery' AS type,
            COALESCE(runs.provider_id, 'Discovery') || ' imported ' || runs.jobs_inserted || ' jobs' AS label,
            runs.started_at AS timestamp FROM runs
          UNION ALL
          SELECT analysis_runs.id, 'analysis' AS type,
            'Analyzed ' || analysis_runs.jobs_analyzed || ' jobs' AS label,
            analysis_runs.started_at AS timestamp FROM analysis_runs
        ) ORDER BY timestamp DESC LIMIT 8`,
      )
      .all();
  }

  private getProposals(resumeId: string): ResumeProposalView[] {
    return this.database
      .prepare<[string], ProposalRow>(
        `SELECT id, field_name, proposed_value, reason, status
         FROM resume_profile_proposals WHERE resume_id = ? ORDER BY created_at`,
      )
      .all(resumeId)
      .map(mapProposal);
  }

  private mapResume(row: ResumeRow): ResumeView {
    return {
      id: row.id,
      displayName: row.display_name,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      isDefault: Boolean(row.is_default),
      parsingStatus: row.parsing_status,
      parsingError: row.parsing_error,
      extractedSkills: parseJson<string[]>(row.extracted_skills_json, []),
      extractedCertifications: parseJson<string[]>(
        row.extracted_certifications_json,
        [],
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      proposals: this.getProposals(row.id),
    };
  }

  private metrics(sql: string): MetricItem[] {
    return this.database.prepare<[], MetricRow>(sql).all();
  }

  private scalar(sql: string, ...parameters: string[]): number {
    return (
      this.database.prepare<string[], CountRow>(sql).get(...parameters)
        ?.value ?? 0
    );
  }

  private text(sql: string): string | null {
    return this.database.prepare<[], TextRow>(sql).get()?.value ?? null;
  }

  private assertChanged(changes: number, message: string): void {
    if (changes === 0) throw new Error(message);
  }
}

function mapJobListItem(row: JobListRow): JobListItem {
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
    lastSeenAt: row.last_seen_at,
    provider: row.provider,
    favorite: Boolean(row.favorite),
    active: Boolean(row.active),
    verificationStatus: row.verification_status,
    eligibilityPassed:
      row.eligibility_passed === null ? null : Boolean(row.eligibility_passed),
    eligibilityRejection: row.eligibility_rejection,
    workArrangement: row.work_arrangement,
    scoreVersion: row.score_version,
  };
}

function mapProposal(row: ProposalRow): ResumeProposalView {
  return {
    id: row.id,
    fieldName: row.field_name,
    proposedValue: row.proposed_value,
    reason: row.reason,
    status: row.status,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
