import { afterEach, describe, expect, it } from 'vitest';

import { OutcomeAnalyticsRepository } from '../src/analytics/outcomeAnalyticsRepository.js';
import type { JobDatabase } from '../src/db/database.js';
import type { OutcomeMetric } from '../src/models/outcome-analytics.js';
import { createTestDatabase } from './helpers/test-database.js';

const databases: JobDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function setup(): {
  database: JobDatabase;
  analytics: OutcomeAnalyticsRepository;
} {
  const database = createTestDatabase();
  databases.push(database);
  return { database, analytics: new OutcomeAnalyticsRepository(database) };
}

describe('application-outcomes-v1', () => {
  it('distinguishes current outcomes from ever reached and applies replacement/void semantics', () => {
    const { database, analytics } = setup();
    insertApplication(database, 'a1', 'rejected', null);
    insertEvent(
      database,
      'applied-1',
      'a1',
      'applied',
      'applied',
      '2026-01-01T00:00:00.000Z',
    );
    insertEvent(
      database,
      'offer-original',
      'a1',
      'offer',
      'offer',
      '2026-01-05T00:00:00.000Z',
    );
    insertEvent(
      database,
      'offer-replacement',
      'a1',
      'offer',
      'offer',
      '2026-01-07T00:00:00.000Z',
      {
        supersedes: 'offer-original',
        action: 'replace',
      },
    );
    insertEvent(
      database,
      'rejected-1',
      'a1',
      'rejected',
      'rejected',
      '2026-01-10T00:00:00.000Z',
    );
    insertEvent(
      database,
      'void-offer',
      'a1',
      'void',
      null,
      '2026-01-11T00:00:00.000Z',
      {
        supersedes: 'offer-replacement',
        action: 'void',
      },
    );

    const result = analytics.calculate(
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    );
    expect(metric(result.applications.everReached, 'offer')).toMatchObject({
      numerator: 0,
      denominator: 1,
    });
    expect(metric(result.applications.everReached, 'rejection').numerator).toBe(
      1,
    );
    expect(
      metric(result.applications.currentOutcomes, 'rejection').numerator,
    ).toBe(1);
    expect(metric(result.applications.currentOutcomes, 'offer').numerator).toBe(
      0,
    );
  });

  it('uses half-open windows, correct denominators, zero samples, and small-sample disclosure', () => {
    const { database, analytics } = setup();
    insertApplication(database, 'start', 'interview', null);
    insertEvent(
      database,
      'applied-start',
      'start',
      'applied',
      'applied',
      '2026-01-01T00:00:00.000Z',
    );
    insertEvent(
      database,
      'interview-start',
      'start',
      'interview',
      'interview',
      '2026-01-02T00:00:00.000Z',
    );
    insertApplication(database, 'end', 'applied', null);
    insertEvent(
      database,
      'applied-end',
      'end',
      'applied',
      'applied',
      '2026-02-01T00:00:00.000Z',
    );

    const result = analytics.calculate(
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    );
    expect(result.applications.cohortSize).toBe(1);
    expect(metric(result.applications.everReached, 'interview')).toMatchObject({
      numerator: 1,
      denominator: 1,
      sampleSize: 1,
      smallSample: true,
    });

    const empty = analytics.calculate(
      '2025-01-01T00:00:00.000Z',
      '2025-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    );
    expect(metric(empty.applications.everReached, 'response')).toMatchObject({
      numerator: 0,
      denominator: 0,
      rate: null,
    });
  });

  it('groups exact Companies, keeps punctuation distinct, and exposes unknown', () => {
    const { database, analytics } = setup();
    insertCompany(database, 'company-1', 'Acme, Inc.', 'acme, inc.');
    insertCompany(database, 'company-2', 'Acme Inc', 'acme inc');
    for (const [id, companyId] of [
      ['a1', 'company-1'],
      ['a2', 'company-2'],
      ['a3', null],
    ] as const) {
      insertApplication(database, id, 'applied', companyId);
      insertEvent(
        database,
        `applied-${id}`,
        id,
        'applied',
        'applied',
        '2026-01-01T00:00:00.000Z',
      );
    }

    const result = analytics.calculate(
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    );
    expect(result.companies.map((company) => company.label).sort()).toEqual([
      'Acme Inc',
      'Acme, Inc.',
      'Unknown / Unlinked',
    ]);
    expect(result.unknownCompanyCount).toBe(1);
  });

  it('uses capture-time Skill and Certification evidence and reports missing dimensions', () => {
    const { database, analytics } = setup();
    insertApplication(database, 'a1', 'interview', null);
    insertSnapshotQualifications(database, 'snapshot-1');
    insertEvent(
      database,
      'applied-a1',
      'a1',
      'applied',
      'applied',
      '2026-01-01T00:00:00.000Z',
      {
        snapshotId: 'snapshot-1',
      },
    );
    insertEvent(
      database,
      'interview-a1',
      'a1',
      'interview',
      'interview',
      '2026-01-03T00:00:00.000Z',
    );
    insertApplication(database, 'a2', 'applied', null);
    insertEvent(
      database,
      'applied-a2',
      'a2',
      'applied',
      'applied',
      '2026-01-02T00:00:00.000Z',
    );

    const result = analytics.calculate(
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    );
    expect(result.skills).toEqual([
      expect.objectContaining({
        label: 'TypeScript',
        numerator: 1,
        denominator: 1,
      }),
    ]);
    expect(result.certifications).toEqual([
      expect.objectContaining({
        label: 'Security+',
        numerator: 1,
        denominator: 1,
      }),
    ]);
    expect(result.unknownQualificationCount).toBe(1);
  });

  it('uses existing indexes in representative effective-event query plans', () => {
    const { database } = setup();
    const details = database
      .prepare<[string, string], { detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT application_id, occurred_at_sort
           FROM application_effective_events
          WHERE event_type = 'applied' AND occurred_at_sort >= ? AND occurred_at_sort < ?`,
      )
      .all('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')
      .map((row) => row.detail)
      .join(' ');
    expect(details).toMatch(
      /application_history_event_occurrence_application_idx/,
    );
    expect(details).toMatch(/application_history_one_direct_superseder_idx/);
  });
});

function metric(metrics: OutcomeMetric[], key: string): OutcomeMetric {
  return metrics.find((candidate) => candidate.key === key)!;
}

function insertApplication(
  database: JobDatabase,
  id: string,
  status: string,
  companyId: string | null,
): void {
  database
    .prepare(
      `INSERT INTO jobs (id, fingerprint, title, normalized_title, company,
        normalized_company, remote_type, employment_type, source_name, source_type,
        first_seen_at, last_seen_at, active, seniority_level, status, created_at, updated_at)
       VALUES (?, ?, 'Role', 'role', 'Unknown', 'unknown', 'unknown', 'unknown',
        'test', 'test', ?, ?, 1, 'unknown', 'new', ?, ?)`,
    )
    .run(
      `job-${id}`,
      id.padEnd(64, '0'),
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
  database
    .prepare(
      `INSERT INTO applications (id, job_id, status, company_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      `job-${id}`,
      status,
      companyId,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
}

function insertEvent(
  database: JobDatabase,
  id: string,
  applicationId: string,
  eventType: string,
  resultingStatus: string | null,
  occurredAt: string,
  options: { supersedes?: string; action?: string; snapshotId?: string } = {},
): void {
  database
    .prepare(
      `INSERT INTO application_history (id, application_id, job_id, event_type,
        resulting_status, occurred_at, occurred_at_sort, occurrence_precision,
        recorded_at_sort, source, metadata_json, supersedes_event_id,
        supersede_action, submitted_resume_snapshot_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'exact', ?, 'user',
        '{"definition":"application-event-v1"}', ?, ?, ?, ?)`,
    )
    .run(
      id,
      applicationId,
      `job-${applicationId}`,
      eventType,
      resultingStatus,
      occurredAt,
      occurredAt,
      occurredAt,
      options.supersedes ?? null,
      options.action ?? null,
      options.snapshotId ?? null,
      occurredAt,
    );
}

function insertCompany(
  database: JobDatabase,
  id: string,
  name: string,
  key: string,
): void {
  database
    .prepare(
      `INSERT INTO companies (id, canonical_name, normalized_key, resolver_version, created_at, updated_at)
       VALUES (?, ?, ?, 'company-exact-v1', ?, ?)`,
    )
    .run(id, name, key, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
}

function insertSnapshotQualifications(
  database: JobDatabase,
  snapshotId: string,
): void {
  database.exec(`
    INSERT INTO resume_snapshots (id, content_hash, storage_key, original_filename,
      mime_type, extension, size_bytes, parser_version, normalization_version,
      parsing_status, created_at)
    VALUES ('${snapshotId}', '${'a'.repeat(64)}', '${snapshotId}.pdf', 'resume.pdf',
      'application/pdf', 'pdf', 10, 'v1', 'v1', 'parsed', '2026-01-01T00:00:00.000Z');
    INSERT INTO resume_snapshot_interpretations (id, snapshot_id, schema_version,
      parser_version, normalization_version, parsing_status, normalized_payload_json,
      created_at)
    VALUES ('interpretation-1', '${snapshotId}', 1, 'v1', 'v1', 'parsed', '{}',
      '2026-01-01T00:00:00.000Z');
    INSERT INTO skills (id, name, normalized_name) VALUES ('skill-1', 'TypeScript', 'typescript');
    INSERT INTO certifications (id, name, normalized_name) VALUES ('cert-1', 'Security+', 'security+');
    INSERT INTO resume_snapshot_interpretation_skills
      (interpretation_id, skill_id, raw_label, provenance)
    VALUES ('interpretation-1', 'skill-1', 'TypeScript', 'capture');
    INSERT INTO resume_snapshot_interpretation_certifications
      (interpretation_id, certification_id, raw_label, provenance)
    VALUES ('interpretation-1', 'cert-1', 'Security+', 'capture');
  `);
}
