import { randomUUID } from 'node:crypto';

import type { JobDatabase } from '../db/database.js';

interface RankedMetricRow {
  key: string;
  value: number;
  employer_count: number;
  average_score: number | null;
}

interface ScalarRow {
  value: number | null;
}

export class AnalyticsService {
  public constructor(private readonly database: JobDatabase) {}

  public generate(runId: string, profileId: string, generatedAt: string): void {
    this.database.transaction(() => {
      this.insertRankedMetrics(
        runId,
        profileId,
        'top_skill',
        this.database
          .prepare<[string], RankedMetricRow>(
            `SELECT skills.name AS key, SUM(job_skills.frequency) AS value,
               COUNT(DISTINCT jobs.company) AS employer_count,
               AVG(recommendations.overall_score) AS average_score
             FROM job_skills
             JOIN skills ON skills.id = job_skills.skill_id
             JOIN jobs ON jobs.id = job_skills.job_id
             LEFT JOIN recommendations ON recommendations.job_id = jobs.id
               AND recommendations.profile_id = ?
             GROUP BY skills.id ORDER BY value DESC, key LIMIT 25`,
          )
          .all(profileId),
        generatedAt,
      );
      this.insertRankedMetrics(
        runId,
        profileId,
        'top_certification',
        this.database
          .prepare<[string], RankedMetricRow>(
            `SELECT certifications.name AS key, COUNT(*) AS value,
               COUNT(DISTINCT jobs.company) AS employer_count,
               AVG(recommendations.overall_score) AS average_score
             FROM job_certifications
             JOIN certifications ON certifications.id = job_certifications.certification_id
             JOIN jobs ON jobs.id = job_certifications.job_id
             LEFT JOIN recommendations ON recommendations.job_id = jobs.id
               AND recommendations.profile_id = ?
             GROUP BY certifications.id ORDER BY value DESC, key LIMIT 25`,
          )
          .all(profileId),
        generatedAt,
      );
      this.insertSimpleRankedQuery(
        runId,
        profileId,
        'common_title',
        `SELECT title AS key, COUNT(*) AS value, COUNT(DISTINCT company) AS employer_count,
           AVG(score) AS average_score FROM jobs GROUP BY normalized_title
         ORDER BY value DESC, key LIMIT 25`,
        generatedAt,
      );
      this.insertSimpleRankedQuery(
        runId,
        profileId,
        'active_employer',
        `SELECT company AS key, COUNT(*) AS value, 1 AS employer_count,
           AVG(score) AS average_score FROM jobs WHERE active = 1 GROUP BY normalized_company
         ORDER BY value DESC, key LIMIT 25`,
        generatedAt,
      );

      this.insertScalar(
        runId,
        profileId,
        'average_salary',
        'all',
        this.scalar(
          `SELECT AVG(CASE
             WHEN salary_minimum IS NOT NULL AND salary_maximum IS NOT NULL
               THEN (salary_minimum + salary_maximum) / 2
             ELSE COALESCE(salary_maximum, salary_minimum)
           END) AS value FROM jobs`,
        ),
        generatedAt,
      );
      this.insertScalar(
        runId,
        profileId,
        'average_recommendation_score',
        'all',
        this.scalar(
          'SELECT AVG(overall_score) AS value FROM recommendations WHERE profile_id = ?',
          profileId,
        ),
        generatedAt,
      );
      this.insertScalar(
        runId,
        profileId,
        'new_jobs_today',
        generatedAt.slice(0, 10),
        this.scalar(
          'SELECT COUNT(*) AS value FROM jobs WHERE substr(first_seen_at, 1, 10) = ?',
          generatedAt.slice(0, 10),
        ),
        generatedAt,
      );
      this.insertScalar(
        runId,
        profileId,
        'duplicate_jobs',
        'all',
        this.scalar(
          `SELECT COUNT(*) AS value FROM (
             SELECT job_id FROM job_sources GROUP BY job_id HAVING COUNT(*) > 1
           )`,
        ),
        generatedAt,
      );
    })();
  }

  private insertSimpleRankedQuery(
    runId: string,
    profileId: string,
    metricName: string,
    sql: string,
    generatedAt: string,
  ): void {
    const rows = this.database.prepare<[], RankedMetricRow>(sql).all();
    this.insertRankedMetrics(runId, profileId, metricName, rows, generatedAt);
  }

  private insertRankedMetrics(
    runId: string,
    profileId: string,
    metricName: string,
    rows: readonly RankedMetricRow[],
    generatedAt: string,
  ): void {
    for (const row of rows) {
      this.insertMetric(
        runId,
        profileId,
        metricName,
        row.key,
        row.value,
        JSON.stringify({
          employerCount: row.employer_count,
          averageScore: row.average_score,
        }),
        generatedAt,
      );
    }
  }

  private insertScalar(
    runId: string,
    profileId: string,
    metricName: string,
    metricKey: string,
    value: number,
    generatedAt: string,
  ): void {
    this.insertMetric(
      runId,
      profileId,
      metricName,
      metricKey,
      value,
      null,
      generatedAt,
    );
  }

  private insertMetric(
    runId: string,
    profileId: string,
    metricName: string,
    metricKey: string,
    metricValue: number,
    detailsJson: string | null,
    generatedAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO analytics (
          id, analysis_run_id, profile_id, metric_name, metric_key,
          metric_value, details_json, generated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        runId,
        profileId,
        metricName,
        metricKey,
        metricValue,
        detailsJson,
        generatedAt,
      );
  }

  private scalar(sql: string, ...parameters: string[]): number {
    const row = this.database
      .prepare<string[], ScalarRow>(sql)
      .get(...parameters);
    return row?.value ?? 0;
  }
}
