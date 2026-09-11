import { afterEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import {
  LOCAL_PRODUCTION_LOAD_AUDIT_VERSION,
  runLocalProductionLoadAudit,
} from '../src/intelligence/nlp/productionLoadAudit.js';
import { createTestDatabase } from './helpers/test-database.js';

const databases: JobDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('local production-load NLP audit (P16)', () => {
  it('copies bounded job text in memory, yields the event loop, and proves cache reuse without database writes', async () => {
    const database = createTestDatabase();
    databases.push(database);
    const insert = database.prepare(`
      INSERT INTO jobs (
        id, title, normalized_title, company, normalized_company, description,
        remote_type, employment_type, source_name, source_type, first_seen_at,
        last_seen_at, active, seniority_level, status, created_at, updated_at
      ) VALUES (?, 'SOC Analyst', 'soc analyst', 'Fixture', 'fixture', ?,
        'unknown', 'unknown', 'Fixture', 'fixture',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1,
        'unknown', 'new', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z')
    `);
    for (let index = 0; index < 60; index++) {
      insert.run(
        `load-job-${String(index).padStart(3, '0')}`,
        'Splunk and Linux required. Security+ preferred. Two years experience.',
      );
    }
    const before = database.prepare('SELECT * FROM jobs ORDER BY id').all();

    const report = await runLocalProductionLoadAudit(database, {
      limit: 60,
      batchSize: 15,
    });

    expect(report.auditVersion).toBe(LOCAL_PRODUCTION_LOAD_AUDIT_VERSION);
    expect(report.corpus.caseCount).toBe(60);
    expect(report.corpus.descriptionsIncludedInReport).toBe(false);
    expect(report.worker).toMatchObject({
      batchSize: 15,
      batchCount: 4,
      extracted: 60,
      failed: 0,
    });
    expect(report.worker.p95BatchMs).toBeGreaterThanOrEqual(0);
    expect(report.cache).toEqual({
      strategy: 'content-hash-and-extraction-version',
      retrySkipped: 60,
      retryExtracted: 0,
    });
    expect(report.responsiveness.mainThreadYieldObserved).toBe(true);
    expect(report.networkRequests).toBe(0);
    expect(report.sourceDatabaseWrites).toBe(0);
    expect(report.productionEffect).toBe('none');
    expect(database.prepare('SELECT * FROM jobs ORDER BY id').all()).toEqual(
      before,
    );
  });
});
