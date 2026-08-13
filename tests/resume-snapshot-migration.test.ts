import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import { createTestDatabase } from './helpers/test-database.js';

const BASE_TIME = '2026-01-01T00:00:00.000Z';

describe('resume_snapshots migration (018) invariants', () => {
  let database: JobDatabase;

  beforeEach(() => {
    database = createTestDatabase();
    seedResume('resume-live');
    seedSnapshot(
      'snapshot-mig',
      {
        sourceResumeId: 'resume-live',
        liveResumeId: 'resume-live',
        contentHash: 'a'.repeat(64),
        storageKey: 'storage-key-mig',
        reuseKey: 'reuse-key-mig',
      },
      'interpretation-mig',
    );
  });

  afterEach(() => database.close());

  it('records a parsed snapshot with a captured interpretation and catalog terms', () => {
    const row = database
      .prepare('SELECT * FROM resume_snapshots WHERE id = ?')
      .get('snapshot-mig') as { parsing_status: string; storage_key: string };
    expect(row.parsing_status).toBe('parsed');
    expect(row.storage_key).toBe('storage-key-mig');
    expect(
      (
        database
          .prepare(
            'SELECT COUNT(*) AS value FROM resume_snapshot_interpretations',
          )
          .get() as { value: number }
      ).value,
    ).toBe(1);
    expect(
      (
        database
          .prepare(
            'SELECT COUNT(*) AS value FROM resume_snapshot_interpretation_skills',
          )
          .get() as { value: number }
      ).value,
    ).toBe(1);
  });

  it('freezes Snapshot rows except the live-lineage transition', () => {
    expect(() =>
      database
        .prepare('UPDATE resume_snapshots SET content_hash = ? WHERE id = ?')
        .run('b'.repeat(64), 'snapshot-mig'),
    ).toThrow('ResumeSnapshot rows are immutable');
    expect(() =>
      database
        .prepare('UPDATE resume_snapshots SET parsing_error = ? WHERE id = ?')
        .run('new error', 'snapshot-mig'),
    ).toThrow('ResumeSnapshot rows are immutable');
    expect(() =>
      database
        .prepare(
          'UPDATE resume_snapshots SET live_resume_id = NULL WHERE id = ?',
        )
        .run('snapshot-mig'),
    ).not.toThrow();
  });

  it('freezes Snapshot interpretations and their term relationships', () => {
    expect(() =>
      database
        .prepare(
          'UPDATE resume_snapshot_interpretations SET parsing_error = ? WHERE id = ?',
        )
        .run('changed', 'interpretation-mig'),
    ).toThrow('ResumeSnapshot interpretations are immutable');
    expect(() =>
      database
        .prepare(
          'UPDATE resume_snapshot_interpretation_skills SET provenance = ?',
        )
        .run('changed'),
    ).toThrow('ResumeSnapshot Skill relationships are immutable');
    expect(() =>
      database
        .prepare(
          'UPDATE resume_snapshot_interpretation_certifications SET provenance = ?',
        )
        .run('changed'),
    ).toThrow('ResumeSnapshot Certification relationships are immutable');
  });

  it('keeps snapshot provenance while a Resume delete clears only the live link', () => {
    database.prepare('DELETE FROM resumes WHERE id = ?').run('resume-live');

    const row = database
      .prepare(
        'SELECT source_resume_id, live_resume_id FROM resume_snapshots WHERE id = ?',
      )
      .get('snapshot-mig') as {
      source_resume_id: string | null;
      live_resume_id: string | null;
    };
    expect(row.source_resume_id).toBe('resume-live');
    expect(row.live_resume_id).toBeNull();
    expect(
      (
        database
          .prepare(
            'SELECT COUNT(*) AS value FROM resume_snapshots WHERE id = ?',
          )
          .get('snapshot-mig') as { value: number }
      ).value,
    ).toBe(1);
  });

  it('cascades term relationships when an interpretation is deleted', () => {
    database
      .prepare('DELETE FROM resume_snapshot_interpretations WHERE id = ?')
      .run('interpretation-mig');

    expect(
      (
        database
          .prepare(
            'SELECT COUNT(*) AS value FROM resume_snapshot_interpretation_skills',
          )
          .get() as { value: number }
      ).value,
    ).toBe(0);
  });

  it('enforces uniqueness on the reuse identity', () => {
    expect(() =>
      seedSnapshot(
        'snapshot-second',
        {
          sourceResumeId: 'resume-live',
          contentHash: 'a'.repeat(64),
          storageKey: 'storage-key-second',
          reuseKey: 'reuse-key-mig',
        },
        'interpretation-second',
      ),
    ).toThrow();
  });

  it('allows only the Applied event type to carry a Snapshot association', () => {
    seedApplication('application-mig');

    expect(() =>
      insertEvent({
        id: 'event-interview',
        applicationId: 'application-mig',
        eventType: 'technical_interview',
        submittedResumeSnapshotId: 'snapshot-mig',
      }),
    ).toThrow('Resume snapshot association requires an Applied event');

    expect(() =>
      insertEvent({
        id: 'event-applied',
        applicationId: 'application-mig',
        eventType: 'applied',
        submittedResumeSnapshotId: 'snapshot-mig',
      }),
    ).not.toThrow();

    const association = database
      .prepare(
        'SELECT submitted_resume_snapshot_id FROM application_history WHERE id = ?',
      )
      .get('event-applied') as { submitted_resume_snapshot_id: string | null };
    expect(association.submitted_resume_snapshot_id).toBe('snapshot-mig');
  });

  it('RESTRICTs deleting a Snapshot still referenced by an Applied event or Application', () => {
    seedApplication('application-restrict');
    insertEvent({
      id: 'event-restrict',
      applicationId: 'application-restrict',
      eventType: 'applied',
      submittedResumeSnapshotId: 'snapshot-mig',
    });

    expect(() =>
      database
        .prepare('DELETE FROM resume_snapshots WHERE id = ?')
        .run('snapshot-mig'),
    ).toThrow();

    database
      .prepare(
        'UPDATE applications SET submitted_resume_snapshot_id = ? WHERE id = ?',
      )
      .run('snapshot-mig', 'application-restrict');
    expect(() =>
      database
        .prepare('DELETE FROM resume_snapshots WHERE id = ?')
        .run('snapshot-mig'),
    ).toThrow();
  });

  function seedResume(resumeId: string): void {
    database
      .prepare(
        `INSERT INTO resumes (
          id, display_name, original_filename, storage_path, mime_type, size_bytes,
          is_default, parsing_status, extracted_skills_json,
          extracted_certifications_json, parsing_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 'parsed', '[]', '[]', NULL, ?, ?)`,
      )
      .run(
        resumeId,
        'resume.txt',
        'resume.txt',
        `${resumeId}.txt`,
        'text/plain',
        7,
        BASE_TIME,
        BASE_TIME,
      );
  }

  function seedSnapshot(
    snapshotId: string,
    row: {
      sourceResumeId: string;
      liveResumeId?: string;
      contentHash: string;
      storageKey: string;
      reuseKey: string | null;
    },
    interpretationId: string,
  ): void {
    database
      .prepare(
        `INSERT INTO resume_snapshots (
          id, source_resume_id, live_resume_id, content_hash, storage_key,
          original_filename, mime_type, extension, size_bytes, parser_version,
          normalization_version, parsing_status, parsing_error, reuse_key,
          created_at
        ) VALUES (?, ?, ?, ?, ?, 'resume.txt', 'text/plain', '.txt', 7,
          'resume-parser-v1', 'resume-normalization-v1', 'parsed', NULL, ?, ?)`,
      )
      .run(
        snapshotId,
        row.sourceResumeId,
        row.liveResumeId ?? null,
        row.contentHash,
        row.storageKey,
        row.reuseKey,
        BASE_TIME,
      );
    database
      .prepare(
        `INSERT INTO resume_snapshot_interpretations (
          id, snapshot_id, schema_version, parser_version,
          normalization_version, parsing_status, parsing_error,
          normalized_payload_json, created_at
        ) VALUES (?, ?, 1, 'resume-parser-v1', 'resume-normalization-v1',
          'parsed', NULL, '{"schemaVersion":1}', ?)`,
      )
      .run(interpretationId, snapshotId, BASE_TIME);
    database
      .prepare(
        `INSERT INTO resume_snapshot_interpretation_skills (
          interpretation_id, skill_id, raw_label, provenance
        ) VALUES (?, NULL, 'siem', 'resume-extract:name')`,
      )
      .run(interpretationId);
    database
      .prepare(
        `INSERT INTO resume_snapshot_interpretation_certifications (
          interpretation_id, certification_id, raw_label, provenance
        ) VALUES (?, NULL, 'security+', 'resume-extract:alias')`,
      )
      .run(interpretationId);
  }

  function seedApplication(applicationId: string): void {
    database
      .prepare(
        `INSERT INTO jobs (
          id, fingerprint, title, normalized_title, company, normalized_company,
          remote_type, employment_type, source_name, source_type, first_seen_at,
          last_seen_at, active, seniority_level, status, created_at, updated_at
        ) VALUES ('job-mig', 'fingerprint:job-mig', 'Job mig', 'job mig',
          'Example Company', 'example company', 'remote', 'full-time', 'Test',
          'fixture', ?, ?, 1, 'mid', 'new', ?, ?)`,
      )
      .run(BASE_TIME, BASE_TIME, BASE_TIME, BASE_TIME);
    database
      .prepare(
        `INSERT INTO applications (
          id, job_id, status, applied_at, applied_at_precision, last_event_at,
          last_recorded_at, title_at_application, company_at_application,
          location_at_application, application_url, source_id, provider_id,
          source_label, notes, legacy_provenance, created_at, updated_at
        ) VALUES (?, 'job-mig', 'applied', ?, 'exact', ?, ?, 'Title', 'Company',
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        applicationId,
        BASE_TIME,
        BASE_TIME,
        BASE_TIME,
        BASE_TIME,
        BASE_TIME,
      );
  }

  function insertEvent(event: {
    id: string;
    applicationId: string;
    eventType: string;
    submittedResumeSnapshotId: string | null;
  }): void {
    database
      .prepare(
        `INSERT INTO application_history (
          id, application_id, job_id, event_type, resulting_status, occurred_at,
          occurred_at_sort, occurrence_precision, recorded_at_sort, notes,
          source, metadata_json, supersedes_event_id, supersede_action,
          submitted_resume_snapshot_id, created_at
        ) VALUES (?, ?, 'job-mig', ?, ?, ?,
          '2026-01-02T00:00:00.000Z', 'exact', '2026-01-03T00:00:00.000Z',
          NULL, 'test', NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        event.id,
        event.applicationId,
        event.eventType,
        event.eventType === 'applied' ? 'applied' : null,
        '2026-01-02T00:00:00.000Z',
        event.submittedResumeSnapshotId,
        BASE_TIME,
      );
  }
});
