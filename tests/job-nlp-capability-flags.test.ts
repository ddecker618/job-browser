import { afterEach, describe, expect, it } from 'vitest';

import type { JobDatabase } from '../src/db/database.js';
import {
  DEFAULT_NLP_CAPABILITY_FLAGS,
  NLP_CAPABILITY_FLAGS_SETTING,
  NLP_CAPABILITY_FLAGS_VERSION,
  capabilityEnabled,
  readNlpCapabilityFlags,
} from '../src/intelligence/nlp/capabilityFlags.js';
import { projectNlpStatus } from '../src/intelligence/nlp/nlpStatus.js';
import { createTestDatabase } from './helpers/test-database.js';

const databases: JobDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('NLP capability flags and status (P20-P22)', () => {
  it('fails closed to independent off-by-default flags', () => {
    const database = createTestDatabase();
    databases.push(database);
    expect(readNlpCapabilityFlags(database)).toEqual(
      DEFAULT_NLP_CAPABILITY_FLAGS,
    );
    expect(capabilityEnabled(database, 'searchTieBreak')).toBe(false);
    database
      .prepare(
        'INSERT INTO app_settings (setting_key,setting_value_json,updated_at) VALUES (?,?,?)',
      )
      .run(NLP_CAPABILITY_FLAGS_SETTING, '{"invalid":true}', '2026-09-11');
    expect(readNlpCapabilityFlags(database)).toEqual(
      DEFAULT_NLP_CAPABILITY_FLAGS,
    );
  });

  it('reads each capability independently at decision time', () => {
    const database = createTestDatabase();
    databases.push(database);
    const flags = {
      ...DEFAULT_NLP_CAPABILITY_FLAGS,
      version: NLP_CAPABILITY_FLAGS_VERSION,
      searchTieBreak: true,
    };
    database
      .prepare(
        'INSERT INTO app_settings (setting_key,setting_value_json,updated_at) VALUES (?,?,?)',
      )
      .run(NLP_CAPABILITY_FLAGS_SETTING, JSON.stringify(flags), '2026-09-11');
    expect(capabilityEnabled(database, 'searchTieBreak')).toBe(true);
    expect(capabilityEnabled(database, 'jobIntelligenceExplanation')).toBe(
      false,
    );
  });

  it('projects bounded local status with exact trust wording', () => {
    const database = createTestDatabase();
    databases.push(database);
    const status = projectNlpStatus(database, null);
    expect(status.state).toBe('disabled');
    expect(status.counts).toEqual({
      jobs: 0,
      analyzed: 0,
      currentEnrichments: 0,
      currentRelevanceIndexes: 0,
      currentComparisons: 0,
    });
    expect(status.notice).toBe('Not used for scoring or eligibility.');
  });

  it('reports per-job worker failures as visible deterministic fallback', () => {
    const database = createTestDatabase();
    databases.push(database);
    const status = projectNlpStatus(database, {
      workerVersion: 'async-worker-v1',
      state: 'waiting',
      startedAt: '2026-09-11T00:00:00.000Z',
      lastSweep: {
        startedAt: '2026-09-11T00:00:00.000Z',
        finishedAt: '2026-09-11T00:00:01.000Z',
        processed: 1,
        extracted: 0,
        skipped: 0,
        failed: 1,
        failedJobIds: ['redacted-by-status'],
        capped: false,
        durationMs: 1000,
        aborted: false,
      },
      nextSweepAt: null,
      totals: { processed: 1, extracted: 0, skipped: 0, failed: 1 },
      lastFailure: null,
      staleRemainingHint: 1,
    });
    expect(status.state).toBe('degraded');
    expect(status.lastFailure).toContain(
      'Deterministic behavior remains active',
    );
  });
});
