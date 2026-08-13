import type { JobDatabase } from '../db/database.js';
import { AnalyticsService } from '../analytics/analyticsService.js';
import { IntelligenceRepository } from '../database/intelligenceRepository.js';
import { log, type LogWriter } from '../logging/logger.js';
import type { AnalysisSummary } from '../models/intelligence.js';
import { JobRepository } from '../repositories/job-repository.js';
import type { CandidateProfile } from '../schemas/candidate-profile.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import { nowUtc } from '../utilities/timestamps.js';
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
        this.intelligenceRepository.saveIntelligence(profile.id, intelligence, {
          verification,
          scoreVersion,
          scoreInputHash: createScoreInputHash(
            job,
            profile,
            config,
            verification,
          ),
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
