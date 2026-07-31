import { createHash, randomUUID } from 'node:crypto';

import type { JobDatabase } from '../db/database.js';
import type { ApplicationEventType } from '../domain/application-history.js';
import { APPLICATION_EVENT_TYPES } from '../domain/application-history.js';
import type { Job } from '../domain/job.js';
import { JOB_STATUSES, type JobStatus } from '../domain/job-status.js';
import type { JobStatusHistory } from '../domain/job-status-history.js';
import {
  normalizedJobSchema,
  type NormalizedJob,
} from '../schemas/normalized-job.js';
import {
  canonicalizePostingUrl,
  normalizeLocation,
} from '../utilities/normalization.js';
import { assertUtcTimestamp, nowUtc } from '../utilities/timestamps.js';
import {
  DEFAULT_SEARCH_PROFILE,
  familiesForJobTitle,
  searchProfileSchema,
  type SearchProfile,
} from '../config/search-profile.js';

interface JobIdRow {
  id: string;
}

interface JobStatusRow {
  status: JobStatus;
}

interface JobSourceIdentityRow extends JobIdRow {
  job_id: string;
  source_id: string;
  external_id: string | null;
  canonical_posting_url: string | null;
  content_hash: string | null;
}

interface StatusHistoryRow {
  id: string;
  job_id: string;
  previous_status: JobStatus | null;
  new_status: JobStatus;
  changed_at: string;
  changed_by: string;
  reason: string | null;
}

interface CountRow {
  count: number;
}

export interface JobObservation {
  job: NormalizedJob;
  sourceId: string;
  providerId?: string | null;
  rawData: unknown;
  runId?: string;
  providerConfidence?: number | null;
}

export interface UpsertJobResult {
  jobId: string;
  inserted: boolean;
  rediscovered: boolean;
  crossSourceMerge: boolean;
  materiallyUpdated: boolean;
  identityConflict: boolean;
}

export interface StatusChange {
  status: JobStatus;
  changedBy: string;
  reason?: string | null;
  changedAt?: string;
}

const INSERT_JOB_SQL = `
  INSERT INTO jobs (
    id, fingerprint, external_id, title, normalized_title, company, normalized_company,
    location, normalized_location, city, state, remote_type, employment_type,
    salary_minimum, salary_maximum, salary_text, description, requirements,
    preferred_qualifications, posting_url, source_name, source_type, date_posted,
    first_seen_at, last_seen_at, active, clearance_requirement,
    sponsorship_available, estimated_experience_years, seniority_level, score,
    recommendation, score_explanation, status, created_at, updated_at
    , agency, department, grade_low, grade_high, pay_plan, appointment_type,
    work_schedule, telework_eligible, opening_date, closing_date, application_urls_json,
    last_verified_at, discovery_count, materially_updated_at, removed_at, provider_confidence,
    matched_families
  ) VALUES (
    @id, @fingerprint, @externalId, @title, @normalizedTitle, @company, @normalizedCompany,
    @location, @normalizedLocation, @city, @state, @remoteType, @employmentType,
    @salaryMinimum, @salaryMaximum, @salaryText, @description, @requirements,
    @preferredQualifications, @postingUrl, @sourceName, @sourceType, @datePosted,
    @firstSeenAt, @lastSeenAt, @active, @clearanceRequirement,
    @sponsorshipAvailable, @estimatedExperienceYears, @seniorityLevel, @score,
    @recommendation, @scoreExplanation, @status, @createdAt, @updatedAt,
    @agency, @department, @gradeLow, @gradeHigh, @payPlan, @appointmentType,
    @workSchedule, @teleworkEligible, @openingDate, @closingDate, @applicationUrlsJson,
    @lastVerifiedAt, 1, NULL, NULL, @providerConfidence,
    @matchedFamilies
  )
`;

const APPLICATION_STATUSES = new Set<JobStatus>([
  'applied',
  'interview',
  'rejected',
  'offer',
]);

export class JobRepository {
  public constructor(private readonly database: JobDatabase) {}

  public upsertObservation(observation: JobObservation): UpsertJobResult {
    const job = normalizedJobSchema.parse(observation.job);
    const canonicalPostingUrl = canonicalizePostingUrl(job.postingUrl);
    const canonicalUrls = canonicalIdentityUrls(job);
    const rawDataJson = serializeRawData(observation.rawData);
    const contentHash = postingContentHash(job);
    const providerConfidence = observation.providerConfidence ?? null;

    return this.database.transaction(() => {
      const identity = this.resolveIdentity(
        job,
        observation.sourceId,
        canonicalUrls,
      );
      let jobId = identity.jobId;
      let inserted = false;
      let materiallyUpdated = false;
      let rediscovered = false;
      let crossSourceMerge = false;

      if (identity.conflictingJobIds.length > 0) {
        this.recordIdentityConflicts(
          observation,
          job,
          canonicalUrls,
          identity.jobId,
          identity.conflictingJobIds,
          identity.signalTypes,
        );
      }

      if (jobId === null) {
        const timestamp = nowUtc();
        const fingerprint = this.collisionSafeFingerprint(
          job.fingerprint,
          observation.sourceId,
          observation.providerId ?? null,
          job.externalId,
          canonicalUrls,
        );
        jobId = job.id;
        this.database.prepare(INSERT_JOB_SQL).run({
          ...job,
          fingerprint,
          normalizedLocation: normalizeLocation(job.location),
          active: 1,
          sponsorshipAvailable:
            job.sponsorshipAvailable === null
              ? null
              : Number(job.sponsorshipAvailable),
          createdAt: timestamp,
          updatedAt: timestamp,
          teleworkEligible:
            job.teleworkEligible === null ? null : Number(job.teleworkEligible),
          applicationUrlsJson: JSON.stringify(job.applicationUrls),
          lastVerifiedAt: job.lastSeenAt,
          providerConfidence,
          matchedFamilies: computeMatchedFamilies(this.database, job.title),
        });
        this.insertStatusHistory(
          jobId,
          null,
          job.status,
          timestamp,
          'ingestion',
          'Initial status',
        );
        if (APPLICATION_STATUSES.has(job.status)) {
          this.insertApplicationEvent(
            jobId,
            job.status,
            timestamp,
            'ingestion',
            'Initial status',
          );
        }
        this.insertJobSource(
          jobId,
          observation.sourceId,
          job,
          canonicalPostingUrl,
          rawDataJson,
          observation.providerId ?? null,
          observation.runId ?? null,
          contentHash,
          providerConfidence,
        );
        inserted = true;
      } else {
        const identityConflict = identity.conflictingJobIds.length > 0;
        const association = this.findSourceAssociation(
          jobId,
          observation.sourceId,
          job.externalId,
          canonicalUrls,
        );
        rediscovered = association !== null;
        crossSourceMerge = association === null && !identityConflict;
        if (association === null && !identityConflict) {
          this.insertJobSource(
            jobId,
            observation.sourceId,
            job,
            canonicalPostingUrl,
            rawDataJson,
            observation.providerId ?? null,
            observation.runId ?? null,
            contentHash,
            providerConfidence,
          );
        } else if (association !== null) {
          materiallyUpdated =
            !identityConflict &&
            association.content_hash !== null &&
            association.content_hash !== contentHash;
          this.updateJobSource(
            association.id,
            job,
            rawDataJson,
            observation.providerId ?? null,
            observation.runId ?? null,
            contentHash,
            providerConfidence,
            materiallyUpdated,
            !identityConflict,
          );
        }
        if (!identityConflict || association !== null) {
          this.updateCanonicalJob(
            jobId,
            job,
            providerConfidence,
            materiallyUpdated,
          );
        }
      }

      this.saveImmutableObservation(
        observation.runId ?? null,
        jobId,
        observation.sourceId,
        observation.providerId ?? null,
        job,
        rawDataJson,
      );
      return {
        jobId,
        inserted,
        rediscovered,
        crossSourceMerge,
        materiallyUpdated,
        identityConflict: identity.conflictingJobIds.length > 0,
      };
    })();
  }

  public changeStatus(jobId: string, change: StatusChange): boolean {
    if (!JOB_STATUSES.includes(change.status)) {
      throw new Error(`Invalid job status: ${change.status}`);
    }
    if (change.changedBy.trim().length === 0) {
      throw new Error('Status changes require a non-empty changedBy value');
    }

    const changedAt = change.changedAt ?? nowUtc();
    assertUtcTimestamp(changedAt, 'changedAt');
    const reason = change.reason ?? null;

    return this.database.transaction(() => {
      const row = this.database
        .prepare<[string], JobStatusRow>('SELECT status FROM jobs WHERE id = ?')
        .get(jobId);
      if (row === undefined) {
        throw new Error(`Cannot change status: job ${jobId} does not exist`);
      }
      if (row.status === change.status) {
        return false;
      }

      this.database
        .prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?')
        .run(change.status, changedAt, jobId);
      this.insertStatusHistory(
        jobId,
        row.status,
        change.status,
        changedAt,
        change.changedBy,
        reason,
      );
      if (APPLICATION_STATUSES.has(change.status)) {
        this.insertApplicationEvent(
          jobId,
          change.status,
          changedAt,
          change.changedBy,
          reason,
        );
      }
      return true;
    })();
  }

  public getStatus(jobId: string): JobStatus | null {
    return (
      this.database
        .prepare<[string], JobStatusRow>('SELECT status FROM jobs WHERE id = ?')
        .get(jobId)?.status ?? null
    );
  }

  public getStatusHistory(jobId: string): JobStatusHistory[] {
    return this.database
      .prepare<[string], StatusHistoryRow>(
        `SELECT id, job_id, previous_status, new_status, changed_at, changed_by, reason
         FROM job_status_history WHERE job_id = ? ORDER BY changed_at, rowid`,
      )
      .all(jobId)
      .map((row) => ({
        id: row.id,
        jobId: row.job_id,
        previousStatus: row.previous_status,
        newStatus: row.new_status,
        changedAt: row.changed_at,
        changedBy: row.changed_by,
        reason: row.reason,
      }));
  }

  public countJobs(): number {
    const row = this.database
      .prepare<[], CountRow>('SELECT COUNT(*) AS count FROM jobs')
      .get();
    if (row === undefined) throw new Error('Unable to count jobs');
    return row.count;
  }

  public countJobSources(jobId: string): number {
    const row = this.database
      .prepare<
        [string],
        CountRow
      >('SELECT COUNT(*) AS count FROM job_sources WHERE job_id = ?')
      .get(jobId);
    if (row === undefined)
      throw new Error(`Unable to count sources for job ${jobId}`);
    return row.count;
  }

  public findJob(jobId: string): Job | null {
    const row = this.database
      .prepare<
        [string],
        Record<string, unknown>
      >('SELECT * FROM jobs WHERE id = ?')
      .get(jobId);
    return row === undefined ? null : mapJob(row);
  }

  public listJobs(): Job[] {
    return this.database
      .prepare<
        [],
        Record<string, unknown>
      >('SELECT * FROM jobs ORDER BY first_seen_at DESC, id')
      .all()
      .map(mapJob);
  }

  public refreshMatchedFamilies(): void {
    const rows = this.database
      .prepare<[], { id: string; title: string }>('SELECT id, title FROM jobs')
      .all();
    const update = this.database.prepare(
      'UPDATE jobs SET matched_families = ?, updated_at = ? WHERE id = ?',
    );
    const timestamp = nowUtc();
    this.database.transaction(() => {
      for (const row of rows) {
        update.run(
          computeMatchedFamilies(this.database, row.title),
          timestamp,
          row.id,
        );
      }
    })();
  }

  private resolveIdentity(
    job: NormalizedJob,
    sourceId: string,
    canonicalUrls: readonly string[],
  ): {
    jobId: string | null;
    conflictingJobIds: string[];
    signalTypes: string[];
  } {
    const matches: { jobId: string; priority: number; signal: string }[] = [];
    if (job.externalId !== null) {
      const byExternalId = this.database
        .prepare<
          [string, string],
          JobIdRow
        >('SELECT job_id AS id FROM job_sources WHERE source_id = ? AND external_id = ?')
        .get(sourceId, job.externalId);
      if (byExternalId !== undefined) {
        matches.push({
          jobId: byExternalId.id,
          priority: 0,
          signal: 'source-provider-external-id',
        });
      }
    }

    for (const canonicalUrl of canonicalUrls) {
      for (const row of this.database
        .prepare<
          [string],
          JobIdRow
        >('SELECT DISTINCT job_id AS id FROM job_sources WHERE canonical_posting_url = ? ORDER BY first_seen_at')
        .all(canonicalUrl)) {
        matches.push({ jobId: row.id, priority: 1, signal: 'canonical-url' });
      }
    }
    if (canonicalUrls.length > 0) {
      for (const row of this.database
        .prepare<
          [],
          { id: string; application_urls_json: string }
        >(`SELECT id, application_urls_json FROM jobs WHERE application_urls_json <> '[]'`)
        .all()) {
        if (
          parseStringArray(row.application_urls_json).some((url) =>
            canonicalUrls.includes(canonicalizePostingUrl(url) ?? ''),
          )
        ) {
          matches.push({
            jobId: row.id,
            priority: 1,
            signal: 'canonical-application-url',
          });
        }
      }
    }

    if (job.externalId !== null) {
      for (const row of this.database
        .prepare<[string, string], JobIdRow>(
          `SELECT DISTINCT job_sources.job_id AS id
             FROM job_sources JOIN jobs ON jobs.id = job_sources.job_id
            WHERE job_sources.external_id = ? AND jobs.normalized_company = ?
            ORDER BY jobs.first_seen_at`,
        )
        .all(job.externalId, job.normalizedCompany)) {
        matches.push({
          jobId: row.id,
          priority: 2,
          signal: 'trusted-employer-external-id',
        });
      }
    }

    if (matches.length > 0) {
      matches.sort(
        (left, right) =>
          left.priority - right.priority ||
          left.jobId.localeCompare(right.jobId),
      );
      const selected = matches[0];
      if (selected === undefined) throw new Error('Identity match disappeared');
      const conflictingJobIds = [
        ...new Set(
          matches
            .map((match) => match.jobId)
            .filter((jobId) => jobId !== selected.jobId),
        ),
      ];
      return {
        jobId: selected.jobId,
        conflictingJobIds,
        signalTypes: [...new Set(matches.map((match) => match.signal))],
      };
    }

    const byFingerprint = this.database
      .prepare<[string], JobIdRow>('SELECT id FROM jobs WHERE fingerprint = ?')
      .get(job.fingerprint);
    if (byFingerprint !== undefined) {
      if (
        this.fingerprintHasConflictingStrongIdentity(
          byFingerprint.id,
          job.externalId,
          canonicalUrls,
        )
      ) {
        return {
          jobId: null,
          conflictingJobIds: [byFingerprint.id],
          signalTypes: ['fingerprint-strong-identity-collision'],
        };
      }
      return {
        jobId: byFingerprint.id,
        conflictingJobIds: [],
        signalTypes: ['fingerprint'],
      };
    }

    const byManualApplication = this.database
      .prepare<[string, string], JobIdRow>(
        `SELECT id FROM jobs
         WHERE normalized_company = ? AND normalized_title = ?
           AND normalized_location IS NULL AND source_type = 'manual' AND status = 'applied'
         ORDER BY first_seen_at LIMIT 1`,
      )
      .get(job.normalizedCompany, job.normalizedTitle);
    return {
      jobId: byManualApplication?.id ?? null,
      conflictingJobIds: [],
      signalTypes:
        byManualApplication === undefined ? [] : ['seeded-manual-application'],
    };
  }

  private fingerprintHasConflictingStrongIdentity(
    jobId: string,
    externalId: string | null,
    canonicalUrls: readonly string[],
  ): boolean {
    if (externalId === null && canonicalUrls.length === 0) return false;
    const identities = this.database
      .prepare<
        [string],
        { external_id: string | null; canonical_posting_url: string | null }
      >(`SELECT external_id, canonical_posting_url FROM job_sources WHERE job_id = ?`)
      .all(jobId);
    return identities.some(
      (identity) =>
        (externalId !== null &&
          identity.external_id !== null &&
          identity.external_id !== externalId) ||
        (canonicalUrls.length > 0 &&
          identity.canonical_posting_url !== null &&
          !canonicalUrls.includes(identity.canonical_posting_url)),
    );
  }

  private findSourceAssociation(
    jobId: string,
    sourceId: string,
    externalId: string | null,
    canonicalUrls: readonly string[],
  ): JobSourceIdentityRow | null {
    const rows = this.database
      .prepare<[string, string], JobSourceIdentityRow>(
        `SELECT id, job_id, source_id, external_id, canonical_posting_url, content_hash
           FROM job_sources WHERE job_id = ? AND source_id = ? ORDER BY first_seen_at`,
      )
      .all(jobId, sourceId);
    if (externalId !== null) {
      const byExternalId = rows.find((row) => row.external_id === externalId);
      if (byExternalId !== undefined) return byExternalId;
    }
    const byUrl = rows.find(
      (row) =>
        row.canonical_posting_url !== null &&
        canonicalUrls.includes(row.canonical_posting_url),
    );
    if (byUrl !== undefined) return byUrl;
    return rows[0] ?? null;
  }

  private updateCanonicalJob(
    jobId: string,
    job: NormalizedJob,
    providerConfidence: number | null,
    materiallyUpdated: boolean,
  ): void {
    const timestamp = nowUtc();
    this.database
      .prepare(
        `UPDATE jobs SET
          title = CASE WHEN @materiallyUpdated = 1 THEN @title ELSE title END,
          normalized_title = CASE WHEN @materiallyUpdated = 1 THEN @normalizedTitle ELSE normalized_title END,
          company = CASE WHEN @materiallyUpdated = 1 THEN @company ELSE company END,
          normalized_company = CASE WHEN @materiallyUpdated = 1 THEN @normalizedCompany ELSE normalized_company END,
          location = CASE WHEN @materiallyUpdated = 1 THEN @location ELSE location END,
          normalized_location = CASE WHEN @materiallyUpdated = 1 THEN @normalizedLocation ELSE normalized_location END,
          city = CASE WHEN @materiallyUpdated = 1 THEN @city ELSE city END,
          state = CASE WHEN @materiallyUpdated = 1 THEN @state ELSE state END,
          remote_type = CASE WHEN @materiallyUpdated = 1 THEN @remoteType ELSE remote_type END,
          employment_type = CASE WHEN @materiallyUpdated = 1 THEN @employmentType ELSE employment_type END,
          salary_minimum = CASE WHEN @materiallyUpdated = 1 THEN @salaryMinimum ELSE salary_minimum END,
          salary_maximum = CASE WHEN @materiallyUpdated = 1 THEN @salaryMaximum ELSE salary_maximum END,
          salary_text = CASE WHEN @materiallyUpdated = 1 THEN @salaryText ELSE salary_text END,
          description = CASE WHEN @materiallyUpdated = 1 THEN @description ELSE description END,
          requirements = CASE WHEN @materiallyUpdated = 1 THEN @requirements ELSE requirements END,
          preferred_qualifications = CASE WHEN @materiallyUpdated = 1 THEN @preferredQualifications ELSE preferred_qualifications END,
          posting_url = CASE WHEN @materiallyUpdated = 1 THEN @postingUrl ELSE posting_url END,
          date_posted = CASE WHEN @materiallyUpdated = 1 THEN @datePosted ELSE date_posted END,
          agency = CASE WHEN @materiallyUpdated = 1 THEN @agency ELSE agency END,
          department = CASE WHEN @materiallyUpdated = 1 THEN @department ELSE department END,
          grade_low = CASE WHEN @materiallyUpdated = 1 THEN @gradeLow ELSE grade_low END,
          grade_high = CASE WHEN @materiallyUpdated = 1 THEN @gradeHigh ELSE grade_high END,
          pay_plan = CASE WHEN @materiallyUpdated = 1 THEN @payPlan ELSE pay_plan END,
          appointment_type = CASE WHEN @materiallyUpdated = 1 THEN @appointmentType ELSE appointment_type END,
          work_schedule = CASE WHEN @materiallyUpdated = 1 THEN @workSchedule ELSE work_schedule END,
          telework_eligible = CASE WHEN @materiallyUpdated = 1 THEN @teleworkEligible ELSE telework_eligible END,
          opening_date = CASE WHEN @materiallyUpdated = 1 THEN @openingDate ELSE opening_date END,
          closing_date = CASE WHEN @materiallyUpdated = 1 THEN @closingDate ELSE closing_date END,
          clearance_requirement = CASE WHEN @materiallyUpdated = 1 THEN @clearanceRequirement ELSE clearance_requirement END,
          sponsorship_available = CASE WHEN @materiallyUpdated = 1 THEN @sponsorshipAvailable ELSE sponsorship_available END,
          estimated_experience_years = CASE WHEN @materiallyUpdated = 1 THEN @estimatedExperienceYears ELSE estimated_experience_years END,
          seniority_level = CASE WHEN @materiallyUpdated = 1 THEN @seniorityLevel ELSE seniority_level END,
          application_urls_json = CASE WHEN @materiallyUpdated = 1 THEN @applicationUrlsJson ELSE application_urls_json END,
          last_seen_at = CASE WHEN @lastSeenAt > last_seen_at THEN @lastSeenAt ELSE last_seen_at END,
          last_verified_at = CASE WHEN @lastSeenAt > COALESCE(last_verified_at, '') THEN @lastSeenAt ELSE last_verified_at END,
          discovery_count = discovery_count + 1,
          materially_updated_at = CASE WHEN @materiallyUpdated = 1 THEN @lastSeenAt ELSE materially_updated_at END,
          active = 1, removed_at = NULL,
           provider_confidence = COALESCE(@providerConfidence, provider_confidence),
           matched_families = @matchedFamilies,
           score_version = CASE WHEN @materiallyUpdated = 1 THEN NULL ELSE score_version END,
           score_input_hash = CASE WHEN @materiallyUpdated = 1 THEN NULL ELSE score_input_hash END,
           updated_at = @updatedAt
         WHERE id = @jobId`,
      )
      .run({
        jobId,
        materiallyUpdated: Number(materiallyUpdated),
        title: job.title,
        normalizedTitle: job.normalizedTitle,
        company: job.company,
        normalizedCompany: job.normalizedCompany,
        location: job.location,
        normalizedLocation: normalizeLocation(job.location),
        city: job.city,
        state: job.state,
        remoteType: job.remoteType,
        employmentType: job.employmentType,
        salaryMinimum: job.salaryMinimum,
        salaryMaximum: job.salaryMaximum,
        salaryText: job.salaryText,
        description: job.description,
        requirements: job.requirements,
        preferredQualifications: job.preferredQualifications,
        postingUrl: job.postingUrl,
        datePosted: job.datePosted,
        agency: job.agency,
        department: job.department,
        gradeLow: job.gradeLow,
        gradeHigh: job.gradeHigh,
        payPlan: job.payPlan,
        appointmentType: job.appointmentType,
        workSchedule: job.workSchedule,
        teleworkEligible:
          job.teleworkEligible === null ? null : Number(job.teleworkEligible),
        openingDate: job.openingDate,
        closingDate: job.closingDate,
        clearanceRequirement: job.clearanceRequirement,
        sponsorshipAvailable:
          job.sponsorshipAvailable === null
            ? null
            : Number(job.sponsorshipAvailable),
        estimatedExperienceYears: job.estimatedExperienceYears,
        seniorityLevel: job.seniorityLevel,
        applicationUrlsJson: JSON.stringify(job.applicationUrls),
        lastSeenAt: job.lastSeenAt,
        providerConfidence,
        matchedFamilies: computeMatchedFamilies(this.database, job.title),
        updatedAt: timestamp,
      });
  }

  private insertJobSource(
    jobId: string,
    sourceId: string,
    job: NormalizedJob,
    canonicalPostingUrl: string | null,
    rawDataJson: string | null,
    providerId: string | null,
    runId: string | null,
    contentHash: string,
    providerConfidence: number | null,
  ): void {
    this.database
      .prepare(
        `INSERT INTO job_sources (
          id, job_id, source_id, external_id, posting_url, canonical_posting_url,
          raw_data_json, first_seen_at, last_seen_at, provider_id, active,
          last_verified_at, discovery_count, consecutive_snapshot_misses,
          content_hash, provider_confidence, last_seen_run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, 0, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        jobId,
        sourceId,
        job.externalId,
        job.postingUrl,
        canonicalPostingUrl,
        rawDataJson,
        job.firstSeenAt,
        job.lastSeenAt,
        providerId,
        job.lastSeenAt,
        contentHash,
        providerConfidence,
        runId,
      );
  }

  private updateJobSource(
    id: string,
    job: NormalizedJob,
    rawDataJson: string | null,
    providerId: string | null,
    runId: string | null,
    contentHash: string,
    providerConfidence: number | null,
    materiallyUpdated: boolean,
    acceptContent: boolean,
  ): void {
    this.database
      .prepare(
        `UPDATE job_sources SET
           last_seen_at = CASE WHEN ? > last_seen_at THEN ? ELSE last_seen_at END,
           last_verified_at = CASE WHEN ? > COALESCE(last_verified_at, '') THEN ? ELSE last_verified_at END,
           raw_data_json = CASE WHEN ? = 1 THEN COALESCE(?, raw_data_json) ELSE raw_data_json END,
           provider_id = COALESCE(provider_id, ?),
           active = 1, removed_at = NULL, consecutive_snapshot_misses = 0,
           discovery_count = discovery_count + 1,
           materially_updated_at = CASE WHEN ? = 1 THEN ? ELSE materially_updated_at END,
           content_hash = CASE WHEN ? = 1 THEN ? ELSE content_hash END,
           provider_confidence = COALESCE(?, provider_confidence),
           last_seen_run_id = ?
         WHERE id = ?`,
      )
      .run(
        job.lastSeenAt,
        job.lastSeenAt,
        job.lastSeenAt,
        job.lastSeenAt,
        Number(acceptContent),
        rawDataJson,
        providerId,
        Number(materiallyUpdated),
        job.lastSeenAt,
        Number(acceptContent),
        contentHash,
        providerConfidence,
        runId,
        id,
      );
  }

  private collisionSafeFingerprint(
    fingerprint: string,
    sourceId: string,
    providerId: string | null,
    externalId: string | null,
    canonicalUrls: readonly string[],
  ): string {
    const existing = this.database
      .prepare<[string], JobIdRow>('SELECT id FROM jobs WHERE fingerprint = ?')
      .get(fingerprint);
    if (existing === undefined) return fingerprint;
    return createHash('sha256')
      .update(
        [
          fingerprint,
          sourceId,
          providerId ?? '',
          externalId ?? '',
          ...[...canonicalUrls].sort(),
        ].join('\u001f'),
      )
      .digest('hex');
  }

  private recordIdentityConflicts(
    observation: JobObservation,
    job: NormalizedJob,
    canonicalUrls: readonly string[],
    selectedJobId: string | null,
    conflictingJobIds: readonly string[],
    signalTypes: readonly string[],
  ): void {
    const externalIdHash =
      job.externalId === null ? null : hashDiagnostic(job.externalId);
    const canonicalUrlHash =
      canonicalUrls.length === 0
        ? null
        : hashDiagnostic([...canonicalUrls].sort().join('\u001f'));
    for (const conflictingJobId of conflictingJobIds) {
      this.database
        .prepare(
          `INSERT INTO identity_conflict_diagnostics (
             id, run_id, source_id, provider_id, selected_job_id,
             conflicting_job_id, signal_types, external_id_hash,
             canonical_url_hash, fingerprint, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          observation.runId ?? null,
          observation.sourceId,
          observation.providerId ?? null,
          selectedJobId,
          conflictingJobId,
          JSON.stringify([...new Set(signalTypes)].sort()),
          externalIdHash,
          canonicalUrlHash,
          job.fingerprint,
          nowUtc(),
        );
    }
  }

  private saveImmutableObservation(
    runId: string | null,
    jobId: string,
    sourceId: string,
    providerId: string | null,
    job: NormalizedJob,
    rawDataJson: string | null,
  ): void {
    this.database
      .prepare(
        `INSERT INTO job_observations (
          id, run_id, job_id, source_id, provider_id, external_id, posting_url,
          application_urls_json, raw_data_json, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        runId,
        jobId,
        sourceId,
        providerId,
        job.externalId,
        job.postingUrl,
        JSON.stringify(job.applicationUrls),
        rawDataJson,
        job.lastSeenAt,
      );
  }

  private insertStatusHistory(
    jobId: string,
    previousStatus: JobStatus | null,
    newStatus: JobStatus,
    changedAt: string,
    changedBy: string,
    reason: string | null,
  ): void {
    this.database
      .prepare(
        `INSERT INTO job_status_history
          (id, job_id, previous_status, new_status, changed_at, changed_by, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        jobId,
        previousStatus,
        newStatus,
        changedAt,
        changedBy,
        reason,
      );
  }

  private insertApplicationEvent(
    jobId: string,
    eventType: JobStatus,
    occurredAt: string,
    source: string,
    notes: string | null,
  ): void {
    if (!APPLICATION_EVENT_TYPES.includes(eventType as ApplicationEventType))
      return;
    this.database
      .prepare(
        `INSERT INTO application_history
          (id, job_id, event_type, occurred_at, notes, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), jobId, eventType, occurredAt, notes, source, nowUtc());
    this.upsertApplication(jobId, eventType, occurredAt, notes);
  }

  private upsertApplication(
    jobId: string,
    status: JobStatus,
    occurredAt: string,
    notes: string | null,
  ): void {
    const timestamp = nowUtc();
    this.database
      .prepare(
        `INSERT INTO applications (
          id, job_id, status, applied_at, last_event_at, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          status = excluded.status,
          applied_at = COALESCE(applications.applied_at, excluded.applied_at),
          last_event_at = excluded.last_event_at,
          notes = COALESCE(excluded.notes, applications.notes),
          updated_at = excluded.updated_at`,
      )
      .run(
        randomUUID(),
        jobId,
        status,
        status === 'applied' ? occurredAt : null,
        occurredAt,
        notes,
        timestamp,
        timestamp,
      );
  }
}

function serializeRawData(rawData: unknown): string | null {
  if (rawData === undefined) return null;
  try {
    return JSON.stringify(rawData);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to serialize raw job data: ${message}`, {
      cause: error,
    });
  }
}

function mapJob(row: Record<string, unknown>): Job {
  return {
    id: String(row['id']),
    fingerprint: String(row['fingerprint']),
    externalId: nullableString(row['external_id']),
    title: String(row['title']),
    normalizedTitle: String(row['normalized_title']),
    company: String(row['company']),
    normalizedCompany: String(row['normalized_company']),
    location: nullableString(row['location']),
    city: nullableString(row['city']),
    state: nullableString(row['state']),
    remoteType: row['remote_type'] as Job['remoteType'],
    employmentType: row['employment_type'] as Job['employmentType'],
    salaryMinimum: nullableNumber(row['salary_minimum']),
    salaryMaximum: nullableNumber(row['salary_maximum']),
    salaryText: nullableString(row['salary_text']),
    description: nullableString(row['description']),
    requirements: nullableString(row['requirements']),
    preferredQualifications: nullableString(row['preferred_qualifications']),
    postingUrl: nullableString(row['posting_url']),
    sourceName: String(row['source_name']),
    sourceType: String(row['source_type']),
    datePosted: nullableString(row['date_posted']),
    agency: nullableString(row['agency']),
    department: nullableString(row['department']),
    gradeLow: nullableString(row['grade_low']),
    gradeHigh: nullableString(row['grade_high']),
    payPlan: nullableString(row['pay_plan']),
    appointmentType: nullableString(row['appointment_type']),
    workSchedule: nullableString(row['work_schedule']),
    teleworkEligible:
      row['telework_eligible'] === null
        ? null
        : Boolean(row['telework_eligible']),
    openingDate: nullableString(row['opening_date']),
    closingDate: nullableString(row['closing_date']),
    applicationUrls: parseStringArray(row['application_urls_json']),
    firstSeenAt: String(row['first_seen_at']),
    lastSeenAt: String(row['last_seen_at']),
    lastVerifiedAt: nullableString(row['last_verified_at']),
    discoveryCount: Number(row['discovery_count']),
    materiallyUpdatedAt: nullableString(row['materially_updated_at']),
    removedAt: nullableString(row['removed_at']),
    providerConfidence: nullableNumber(row['provider_confidence']),
    matchedFamilies: nullableString(row['matched_families']),
    active: Boolean(row['active']),
    clearanceRequirement: nullableString(row['clearance_requirement']),
    sponsorshipAvailable:
      row['sponsorship_available'] === null
        ? null
        : Boolean(row['sponsorship_available']),
    estimatedExperienceYears: nullableNumber(row['estimated_experience_years']),
    seniorityLevel: row['seniority_level'] as Job['seniorityLevel'],
    score: nullableNumber(row['score']),
    recommendation: nullableString(row['recommendation']),
    scoreExplanation: nullableString(row['score_explanation']),
    status: row['status'] as JobStatus,
    verificationStatus: nullableString(row['verification_status']),
    eligibilityPassed:
      row['eligibility_passed'] === null
        ? null
        : Boolean(row['eligibility_passed']),
    eligibilityRejection: nullableString(row['eligibility_rejection']),
    workArrangement: nullableString(row['work_arrangement']),
    illinoisEligibility: nullableString(row['illinois_eligibility']),
    scheduleClassification: nullableString(row['schedule_classification']),
    verifiedAt: nullableString(row['verified_at']),
    scoreVersion: nullableString(row['score_version']),
    scoreInputHash: nullableString(row['score_input_hash']),
  };
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string')
    throw new Error('Expected a string database value');
  return value;
}

function nullableNumber(value: unknown): number | null {
  return value === null ? null : Number(value);
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
}

function canonicalIdentityUrls(job: NormalizedJob): string[] {
  return [job.postingUrl, ...job.applicationUrls]
    .map(canonicalizePostingUrl)
    .filter((value): value is string => value !== null)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
}

function postingContentHash(job: NormalizedJob): string {
  const content = {
    title: normalizeContent(job.title),
    company: normalizeContent(job.company),
    location: normalizeContent(job.location),
    remoteType: job.remoteType,
    employmentType: job.employmentType,
    salaryMinimum: job.salaryMinimum,
    salaryMaximum: job.salaryMaximum,
    salaryText: normalizeContent(job.salaryText),
    description: normalizeContent(job.description),
    requirements: normalizeContent(job.requirements),
    preferredQualifications: normalizeContent(job.preferredQualifications),
    postingUrl: canonicalizePostingUrl(job.postingUrl),
    applicationUrls: job.applicationUrls
      .map((url) => canonicalizePostingUrl(url))
      .filter((url): url is string => url !== null)
      .sort(),
    datePosted: job.datePosted,
    agency: normalizeContent(job.agency),
    department: normalizeContent(job.department),
    gradeLow: normalizeContent(job.gradeLow),
    gradeHigh: normalizeContent(job.gradeHigh),
    payPlan: normalizeContent(job.payPlan),
    appointmentType: normalizeContent(job.appointmentType),
    workSchedule: normalizeContent(job.workSchedule),
    teleworkEligible: job.teleworkEligible,
    openingDate: job.openingDate,
    closingDate: job.closingDate,
    clearanceRequirement: normalizeContent(job.clearanceRequirement),
    sponsorshipAvailable: job.sponsorshipAvailable,
    estimatedExperienceYears: job.estimatedExperienceYears,
    seniorityLevel: job.seniorityLevel,
  };
  return hashDiagnostic(JSON.stringify(content));
}

function normalizeContent(value: string | null): string | null {
  return value === null
    ? null
    : value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function hashDiagnostic(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

let _cachedProfile: SearchProfile | null = null;
let _cachedProfileJson: string | null | undefined;

function loadSearchProfile(database: JobDatabase): SearchProfile {
  const row = database
    .prepare<
      [],
      { setting_value_json: string } | undefined
    >(`SELECT setting_value_json FROM app_settings WHERE setting_key = 'searchProfile'`)
    .get();
  const profileJson = row?.setting_value_json ?? null;
  if (_cachedProfile !== null && _cachedProfileJson === profileJson) {
    return _cachedProfile;
  }
  _cachedProfileJson = profileJson;
  if (row === undefined) {
    _cachedProfile = DEFAULT_SEARCH_PROFILE;
    return _cachedProfile;
  }
  try {
    const parsed = searchProfileSchema.safeParse(
      JSON.parse(row.setting_value_json),
    );
    if (parsed.success) {
      _cachedProfile = parsed.data;
      return _cachedProfile;
    }
  } catch {
    // fall through
  }
  _cachedProfile = DEFAULT_SEARCH_PROFILE;
  return _cachedProfile;
}

function computeMatchedFamilies(
  database: JobDatabase,
  title: string,
): string | null {
  const profile = loadSearchProfile(database);
  const families = familiesForJobTitle(title, profile);
  return families.length > 0 ? families.join(',') : null;
}
