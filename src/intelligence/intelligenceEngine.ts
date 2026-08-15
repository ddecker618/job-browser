import type { JobDatabase } from '../db/database.js';
import {
  ROLE_DETAILS_BACKFILL_BATCH_SIZE,
  backfillRoleDetails,
} from '../db/backfill-role-details.js';
import { AnalyticsService } from '../analytics/analyticsService.js';
import { IntelligenceRepository } from '../database/intelligenceRepository.js';
import { log, type LogWriter } from '../logging/logger.js';
import type { AnalysisSummary } from '../models/intelligence.js';
import { JobRepository } from '../repositories/job-repository.js';
import type { CandidateProfile } from '../schemas/candidate-profile.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import { ROLE_DETAILS_VERSION } from '../schemas/role-details.js';
import { nowUtc } from '../utilities/timestamps.js';
import { extractRoleDetails } from './roleDetailsExtractor.js';
import { createScoreInputHash, createScoreVersion } from './scoreIdentity.js';
import { scoreJob } from './scoringEngine.js';
import { verifyPosting } from './verificationService.js';

export class IntelligenceEngine {
  private readonly intelligenceRepository: IntelligenceRepository;
  private readonly jobRepository: JobRepository;
  private readonly analytics: AnalyticsService;

  public constructor(
    private readonly database: JobDatabase,
    private readonly writeLog: LogWriter = log,
  ) {
    this.intelligenceRepository = new IntelligenceRepository(database);
    this.jobRepository = new JobRepository(database);
    this.analytics = new AnalyticsService(database);
  }

  public analyze(
    profile: CandidateProfile,
    config: ScoringConfig,
  ): AnalysisSummary {
    this.intelligenceRepository.saveProfile(profile);
    const scoreVersion = createScoreVersion(profile, config);
    const runId = this.intelligenceRepository.startRun(
      profile.id,
      scoreVersion,
    );
    const analyzedAt = nowUtc();
    this.writeLog('info', 'Analysis run started', {
      runId,
      profileId: profile.id,
    });

    try {
      const jobs = this.jobRepository.listCurrentJobs();
      let totalScore = 0;
      for (const job of jobs) {
        const jobText = buildJobTextForVerification(job);
        const verification = verifyPosting(jobText, job.postingUrl, 200);
        const intelligence = scoreJob(
          job,
          profile,
          config,
          analyzedAt,
          verification,
        );
        const roleDetails = extractRoleDetails(
          toRoleDetailsInput(job),
          config,
        );
        this.intelligenceRepository.saveIntelligence(profile.id, intelligence, {
          verification,
          scoreVersion,
          scoreInputHash: createScoreInputHash(
            job,
            profile,
            config,
            verification,
          ),
          roleDetailsJson: JSON.stringify(roleDetails),
        });
        totalScore += intelligence.overallScore;
      }
      const summary: AnalysisSummary = {
        runId,
        profileId: profile.id,
        jobsAnalyzed: jobs.length,
        averageScore:
          jobs.length === 0
            ? 0
            : Math.round((totalScore / jobs.length) * 10) / 10,
        scoreVersion,
      };
      this.analytics.generate(runId, profile.id, analyzedAt);
      this.intelligenceRepository.completeRun(summary);
      this.writeLog('info', 'Analysis run completed', { ...summary });
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.intelligenceRepository.failRun(runId, message);
      this.writeLog('error', 'Analysis run failed', {
        runId,
        profileId: profile.id,
        error: message,
        stackTrace: error instanceof Error ? (error.stack ?? null) : null,
      });
      throw new Error(`Analysis failed for profile ${profile.id}: ${message}`, {
        cause: error,
      });
    }
  }

  public reprocessIfStale(
    profile: CandidateProfile,
    config: ScoringConfig,
  ): AnalysisSummary | null {
    const scoreVersion = createScoreVersion(profile, config);
    const staleActiveJobs =
      this.database
        .prepare<[string], { count: number }>(
          `SELECT COUNT(*) AS count FROM jobs
         WHERE active = 1 AND status <> 'expired'
           AND (score_version IS NULL OR score_version <> ?)`,
        )
        .get(scoreVersion)?.count ?? 0;
    if (staleActiveJobs === 0) return null;
    return this.analyze(profile, config);
  }

  /**
   * Bounded startup reconciliation for a semantic-version change (1.0.15 ->
   * 1.0.16, role-details-v1 -> role-details-v2):
   *
   * 1. Re-extract role details for active jobs whose stored document is
   *    missing or carries an older semantic version, in a bounded batch. This
   *    is offline, idempotent, and restart-safe: each startup advances up to
   *    `roleDetailsBatchSize` jobs.
   * 2. Invalidate the persisted score/recommendation of every active job whose
   *    stored role details remain stale, so a pre-upgrade interpretation
   *    (e.g. "remote / Verified Match") cannot survive the re-interpretation.
   * 3. Run the existing stale-score pipeline, which recomputes scores from the
   *    corrected interpretation and writes the current role-details version.
   */
  public reconcileStaleData(
    profile: CandidateProfile,
    config: ScoringConfig,
    roleDetailsBatchSize = ROLE_DETAILS_BACKFILL_BATCH_SIZE,
  ): ReconcileStaleDataResult {
    const backfill = backfillRoleDetails(
      this.database,
      config,
      roleDetailsBatchSize,
    );
    const scoresInvalidated = this.invalidateScoresForStaleRoleDetails();
    const analysis = this.reprocessIfStale(profile, config);
    return {
      roleDetailsProcessed: backfill.processed,
      roleDetailsUpdated: backfill.updated,
      roleDetailsSkipped: backfill.skippedCurrentVersion,
      scoresInvalidated,
      analysis,
    };
  }

  private invalidateScoresForStaleRoleDetails(): number {
    const result = this.database
      .prepare(
        `UPDATE jobs SET score_version = NULL, score = NULL, recommendation = NULL,
           score_explanation = NULL, updated_at = ?
         WHERE active = 1 AND status <> 'expired'
           AND (role_details_json IS NULL
                OR json_extract(role_details_json, '$.version') IS NULL
                OR json_extract(role_details_json, '$.version') <> ?)`,
      )
      .run(nowUtc(), ROLE_DETAILS_VERSION);
    return result.changes;
  }
}

export interface ReconcileStaleDataResult {
  roleDetailsProcessed: number;
  roleDetailsUpdated: number;
  roleDetailsSkipped: number;
  scoresInvalidated: number;
  analysis: AnalysisSummary | null;
}

function buildJobTextForVerification(job: {
  title: string;
  description: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
  location: string | null;
  company: string;
}): string {
  const parts: string[] = [`${job.title} at ${job.company}`];
  if (job.location !== null) parts.push(`Location: ${job.location}`);
  if (job.description !== null) parts.push(job.description);
  if (job.requirements !== null) parts.push(job.requirements);
  if (job.preferredQualifications !== null)
    parts.push(job.preferredQualifications);
  return parts.join('\n\n');
}

function toRoleDetailsInput(job: {
  title: string;
  company: string;
  location: string | null;
  city: string | null;
  state: string | null;
  remoteType: string;
  teleworkEligible: boolean | null;
  employmentType: string;
  workSchedule: string | null;
  appointmentType: string | null;
  description: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
}): Parameters<typeof extractRoleDetails>[0] {
  return {
    title: job.title,
    company: job.company,
    location: job.location,
    city: job.city,
    state: job.state,
    remoteType: job.remoteType as Parameters<typeof extractRoleDetails>[0]['remoteType'],
    teleworkEligible: job.teleworkEligible,
    employmentType: job.employmentType as Parameters<
      typeof extractRoleDetails
    >[0]['employmentType'],
    workSchedule: job.workSchedule,
    appointmentType: job.appointmentType,
    description: job.description,
    requirements: job.requirements,
    preferredQualifications: job.preferredQualifications,
  };
}
