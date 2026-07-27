import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import { JobRepository } from '../src/repositories/job-repository.js';
import { createJobFixture } from './helpers/job-fixture.js';
import {
  createTestDatabase,
  insertTestSource,
} from './helpers/test-database.js';

interface CountRow {
  count: number;
}

describe('job status history', () => {
  let database: JobDatabase;
  let repository: JobRepository;
  let jobId: string;

  beforeEach(() => {
    database = createTestDatabase();
    repository = new JobRepository(database);
    const sourceId = insertTestSource(database);
    const job = createJobFixture();
    jobId = job.id;
    repository.upsertObservation({ job, sourceId, rawData: job });
  });

  afterEach(() => database.close());

  it('audits status transitions with UTC timestamp, actor, and reason', () => {
    const changedAt = new Date().toISOString();
    expect(
      repository.changeStatus(jobId, {
        status: 'applied',
        changedBy: 'user',
        reason: 'Application submitted manually',
        changedAt,
      }),
    ).toBe(true);

    expect(repository.getStatusHistory(jobId)).toEqual([
      expect.objectContaining({ previousStatus: null, newStatus: 'new' }),
      expect.objectContaining({
        previousStatus: 'new',
        newStatus: 'applied',
        changedAt,
        changedBy: 'user',
        reason: 'Application submitted manually',
      }),
    ]);
    expect(
      database
        .prepare<
          [string],
          CountRow
        >("SELECT COUNT(*) AS count FROM application_history WHERE job_id = ? AND event_type = 'applied'")
        .get(jobId)?.count,
    ).toBe(1);
  });

  it('does not audit a no-op status change', () => {
    expect(
      repository.changeStatus(jobId, { status: 'new', changedBy: 'user' }),
    ).toBe(false);
    expect(repository.getStatusHistory(jobId)).toHaveLength(1);
  });

  it('rolls back the status update if audit insertion fails', () => {
    database.exec(`
      CREATE TRIGGER reject_review_audit
      BEFORE INSERT ON job_status_history
      WHEN NEW.new_status = 'review'
      BEGIN
        SELECT RAISE(ABORT, 'audit unavailable');
      END
    `);

    expect(() =>
      repository.changeStatus(jobId, { status: 'review', changedBy: 'user' }),
    ).toThrow('audit unavailable');
    expect(repository.getStatus(jobId)).toBe('new');
    expect(repository.getStatusHistory(jobId)).toHaveLength(1);
  });
});
