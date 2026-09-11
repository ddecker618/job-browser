import { afterEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import {
  NLP_REAL_DATA_VALIDATION_VERSION,
  runNlpRealDataValidation,
} from '../src/intelligence/nlp/realDataValidation.js';
import { createTestDatabase } from './helpers/test-database.js';

const databases: JobDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('real-data NLP validation harness (P23)', () => {
  it('writes only versioned shadow rows while production job rows stay byte-equivalent', async () => {
    const database = createTestDatabase();
    databases.push(database);
    const insert = database.prepare(`
      INSERT INTO jobs (
        id, title, normalized_title, company, normalized_company, description,
        remote_type, employment_type, source_name, source_type, first_seen_at,
        last_seen_at, active, seniority_level, status, created_at, updated_at,
        score, eligibility_passed, score_explanation
      ) VALUES (?, 'SOC Analyst', 'soc analyst', 'Fixture', 'fixture', ?,
        'unknown', 'unknown', 'Fixture', 'fixture', '2026-01-01', '2026-01-01',
        1, 'unknown', 'new', '2026-01-01', '2026-01-01', 42, 1, 'fixture')
    `);
    for (let index = 0; index < 30; index++) {
      insert.run(
        `validation-${String(index).padStart(3, '0')}`,
        index % 2 === 0
          ? 'Linux and Splunk required. Two years of experience.'
          : 'Security+ preferred. This is a remote position.',
      );
    }

    const report = await runNlpRealDataValidation(database, {
      limit: 30,
      batchSize: 10,
    });

    expect(report.validationVersion).toBe(NLP_REAL_DATA_VALIDATION_VERSION);
    expect(report.worker).toMatchObject({
      extracted: 30,
      skipped: 0,
      failed: 0,
    });
    expect(report.comparisons.jobs).toBe(30);
    expect(report.comparisons.comparisons).toBe(90);
    expect(report.productionInvariance.unchanged).toBe(true);
    expect(report.responsiveness.mainThreadYieldObserved).toBe(true);
    expect(report.shadowRows).toEqual({
      enrichments: 30,
      relevanceIndexes: 30,
      comparisons: 30,
    });
    expect(report.networkRequests).toBe(0);
    expect(report.originalDatabaseWrites).toBe(0);
    expect(report.productionEffect).toBe('none');
  });
});
