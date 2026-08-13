import { createHash } from 'node:crypto';

import type { JobDatabase } from '../db/database.js';
import {
  OUTCOME_DEFINITION,
  type OutcomeAnalytics,
  type OutcomeDimension,
  type OutcomeMetric,
} from '../models/outcome-analytics.js';

const EVENT_SETS = {
  response: [
    'recruiter_contact',
    'phone_screen',
    'technical_interview',
    'manager_interview',
    'final_interview',
    'interview',
    'offer',
    'accepted',
    'rejected',
  ],
  interview: [
    'phone_screen',
    'technical_interview',
    'manager_interview',
    'final_interview',
    'interview',
  ],
  offer: ['offer', 'accepted'],
  acceptance: ['accepted'],
  rejection: ['rejected'],
  ghosting: ['ghosted'],
  withdrawal: ['withdrawn'],
} as const;

const LABELS: Record<keyof typeof EVENT_SETS, string> = {
  response: 'Response',
  interview: 'Interview',
  offer: 'Offer',
  acceptance: 'Acceptance',
  rejection: 'Rejection',
  ghosting: 'Ghosting',
  withdrawal: 'Withdrawal',
};

interface ApplicationRow {
  id: string;
  status: string;
  company_id: string | null;
  canonical_name: string | null;
}

interface EventRow {
  id: string;
  application_id: string;
  event_type: string;
  resulting_status: string | null;
  occurred_at_sort: string | null;
  recorded_at_sort: string | null;
  submitted_resume_snapshot_id: string | null;
}

interface QualificationRow {
  snapshot_id: string;
  kind: 'skill' | 'certification';
  identity: string;
  label: string;
}

interface CohortApplication {
  application: ApplicationRow;
  applied: EventRow;
  outcomes: EventRow[];
}

export class OutcomeAnalyticsRepository {
  public constructor(private readonly database: JobDatabase) {}

  public calculate(
    start: string,
    end: string,
    asOf = new Date().toISOString(),
  ): OutcomeAnalytics {
    if (start >= end)
      throw new RangeError('Outcome window start must precede end');
    if (end > asOf)
      throw new RangeError('Outcome window end cannot exceed as-of time');

    const applications = this.database
      .prepare<[], ApplicationRow>(
        `SELECT applications.id, applications.status, applications.company_id,
                companies.canonical_name
           FROM applications
           LEFT JOIN companies ON companies.id = applications.company_id
          ORDER BY applications.id`,
      )
      .all();
    const events = this.database
      .prepare<[], EventRow>(
        `SELECT id, application_id, event_type, resulting_status,
                occurred_at_sort, recorded_at_sort, submitted_resume_snapshot_id
           FROM application_effective_events
          ORDER BY application_id,
                   COALESCE(occurred_at_sort, recorded_at_sort), recorded_at_sort, id`,
      )
      .all();
    const eventsByApplication = new Map<string, EventRow[]>();
    for (const event of events) {
      const current = eventsByApplication.get(event.application_id) ?? [];
      current.push(event);
      eventsByApplication.set(event.application_id, current);
    }

    let unknownAppliedBaseline = 0;
    let unknownOutcomeOccurrence = 0;
    const cohort: CohortApplication[] = [];
    for (const application of applications) {
      const effective = eventsByApplication.get(application.id) ?? [];
      const applied = effective.find(
        (event) =>
          event.event_type === 'applied' &&
          event.occurred_at_sort !== null &&
          event.occurred_at_sort <= asOf,
      );
      if (applied === undefined) {
        unknownAppliedBaseline += 1;
        continue;
      }
      const appliedAt = applied.occurred_at_sort;
      if (appliedAt === null) continue;
      if (appliedAt < start || appliedAt >= end) continue;
      const outcomes = effective.filter((event) => {
        if (event.event_type === 'applied') return false;
        if (event.occurred_at_sort === null) {
          if (isMetricEvent(event.event_type)) unknownOutcomeOccurrence += 1;
          return false;
        }
        return (
          event.occurred_at_sort >= appliedAt && event.occurred_at_sort <= asOf
        );
      });
      cohort.push({ application, applied, outcomes });
    }

    const everReached = metricEntries(cohort, (item, set) =>
      item.outcomes.some((event) => set.includes(event.event_type as never)),
    );
    const currentOutcomes = metricEntries(cohort, (item, set) => {
      const supporting = [...item.outcomes]
        .reverse()
        .find((event) => event.resulting_status === item.application.status);
      return (
        supporting !== undefined && set.includes(supporting.event_type as never)
      );
    });
    const responseDurations = cohort.flatMap((item) => {
      const response = item.outcomes.find((event) =>
        EVENT_SETS.response.includes(event.event_type as never),
      );
      return response?.occurred_at_sort === null || response === undefined
        ? []
        : [
            (Date.parse(response.occurred_at_sort) -
              Date.parse(item.applied.occurred_at_sort ?? '')) /
              86_400_000,
          ];
    });

    const companyGroups = new Map<string, CohortApplication[]>();
    for (const item of cohort) {
      const key = item.application.company_id ?? '__unknown__';
      const group = companyGroups.get(key) ?? [];
      group.push(item);
      companyGroups.set(key, group);
    }
    const companies = [...companyGroups.entries()]
      .map(([id, group]) =>
        dimensionMetric(
          id === '__unknown__' ? null : id,
          group[0]?.application.canonical_name ?? 'Unknown / Unlinked',
          group,
        ),
      )
      .sort(
        (left, right) =>
          right.denominator - left.denominator ||
          left.label.localeCompare(right.label),
      );

    const qualifications = this.loadQualifications();
    const usableSnapshots = this.loadUsableSnapshotIds();
    const skillGroups = new Map<
      string,
      { label: string; items: CohortApplication[] }
    >();
    const certificationGroups = new Map<
      string,
      { label: string; items: CohortApplication[] }
    >();
    let unknownQualificationCount = 0;
    for (const item of cohort) {
      const snapshotId = item.applied.submitted_resume_snapshot_id;
      if (snapshotId === null || !usableSnapshots.has(snapshotId)) {
        unknownQualificationCount += 1;
        continue;
      }
      for (const qualification of qualifications.filter(
        (row) => row.snapshot_id === snapshotId,
      )) {
        const target =
          qualification.kind === 'skill' ? skillGroups : certificationGroups;
        const existing = target.get(qualification.identity) ?? {
          label: qualification.label,
          items: [],
        };
        if (
          !existing.items.some(
            (candidate) => candidate.application.id === item.application.id,
          )
        ) {
          existing.items.push(item);
        }
        target.set(qualification.identity, existing);
      }
    }

    const generatedAt = new Date().toISOString();
    return {
      definition: OUTCOME_DEFINITION,
      definitionVersion: 1,
      scope: 'installation-local',
      period: { start, end, asOf },
      includedEventSets: EVENT_SETS,
      applications: {
        cohortSize: cohort.length,
        unknownAppliedBaseline,
        unknownOutcomeOccurrence,
        currentOutcomes,
        everReached,
        averageDaysToFirstResponse:
          responseDurations.length === 0
            ? null
            : responseDurations.reduce((sum, value) => sum + value, 0) /
              responseDurations.length,
        responseTimingSampleSize: responseDurations.length,
      },
      companies,
      skills: mapQualificationGroups(skillGroups),
      certifications: mapQualificationGroups(certificationGroups),
      unknownCompanyCount: companyGroups.get('__unknown__')?.length ?? 0,
      unknownQualificationCount,
      sourceDataWatermark: createHash('sha256')
        .update(JSON.stringify({ applications, events }))
        .digest('hex'),
      generatedAt,
    };
  }

  private loadUsableSnapshotIds(): Set<string> {
    return new Set(
      this.database
        .prepare<[], { snapshot_id: string }>(
          `SELECT snapshot_id FROM resume_snapshot_interpretations
            WHERE parsing_status = 'parsed' ORDER BY snapshot_id`,
        )
        .all()
        .map((row) => row.snapshot_id),
    );
  }

  private loadQualifications(): QualificationRow[] {
    return this.database
      .prepare<[], QualificationRow>(
        `SELECT interpretations.snapshot_id, 'skill' AS kind,
                COALESCE(skills.id, links.raw_label) AS identity,
                COALESCE(skills.name, links.raw_label) AS label
           FROM resume_snapshot_interpretation_skills links
           JOIN resume_snapshot_interpretations interpretations
             ON interpretations.id = links.interpretation_id
           LEFT JOIN skills ON skills.id = links.skill_id
         UNION ALL
         SELECT interpretations.snapshot_id, 'certification' AS kind,
                COALESCE(certifications.id, links.raw_label) AS identity,
                COALESCE(certifications.name, links.raw_label) AS label
           FROM resume_snapshot_interpretation_certifications links
           JOIN resume_snapshot_interpretations interpretations
             ON interpretations.id = links.interpretation_id
           LEFT JOIN certifications ON certifications.id = links.certification_id
          ORDER BY kind, label`,
      )
      .all();
  }
}

function metricEntries(
  cohort: CohortApplication[],
  qualifies: (item: CohortApplication, set: readonly string[]) => boolean,
): OutcomeMetric[] {
  return Object.entries(EVENT_SETS).map(([key, set]) => {
    const numerator = cohort.filter((item) => qualifies(item, set)).length;
    return metric(
      key,
      LABELS[key as keyof typeof EVENT_SETS],
      numerator,
      cohort.length,
    );
  });
}

function dimensionMetric(
  id: string | null,
  label: string,
  items: CohortApplication[],
): OutcomeDimension {
  const numerator = items.filter((item) =>
    item.outcomes.some((event) =>
      EVENT_SETS.response.includes(event.event_type as never),
    ),
  ).length;
  return {
    ...metric(id ?? 'unknown', label, numerator, items.length),
    id,
    unknown: id === null,
  };
}

function mapQualificationGroups(
  groups: Map<string, { label: string; items: CohortApplication[] }>,
): OutcomeDimension[] {
  return [...groups.entries()]
    .map(([id, group]) => dimensionMetric(id, group.label, group.items))
    .sort(
      (left, right) =>
        right.denominator - left.denominator ||
        left.label.localeCompare(right.label),
    );
}

function metric(
  key: string,
  label: string,
  numerator: number,
  denominator: number,
): OutcomeMetric {
  return {
    key,
    label,
    numerator,
    denominator,
    sampleSize: denominator,
    rate: denominator === 0 ? null : numerator / denominator,
    smallSample: denominator < 10,
  };
}

function isMetricEvent(eventType: string): boolean {
  return Object.values(EVENT_SETS).some((set) =>
    set.includes(eventType as never),
  );
}
