import { describe, expect, it } from 'vitest';

import {
  NLP_PERFORMANCE_AUDIT_VERSION,
  performanceInputFingerprint,
  runNlpPerformanceAudit,
} from '../src/intelligence/nlp/performanceAudit.js';

describe('NLP performance audit (Stage 24)', () => {
  it('produces a stable input fingerprint for the local benchmark corpus', () => {
    expect(performanceInputFingerprint()).toBe(performanceInputFingerprint());
    expect(performanceInputFingerprint()).toMatch(/^[a-f0-9]{64}$/);
  });

  it('measures the deterministic shadow pipeline without an embedding runtime', () => {
    const report = runNlpPerformanceAudit({
      iterations: 2,
      warmupIterations: 1,
    });

    expect(report.auditVersion).toBe(NLP_PERFORMANCE_AUDIT_VERSION);
    expect(report.corpus.caseCount).toBeGreaterThan(40);
    expect(report.cache.fingerprint).toBe(report.corpus.fingerprint);
    expect(report.cache.runtimeCacheBytes).toBe(0);
    expect(report.embedding).toEqual({
      status: 'not-installed',
      measured: false,
      networkRequests: 0,
      note: 'No embedding runtime, model artifact, or model acquisition path is installed.',
    });
    expect(report.networkRequests).toBe(0);
    expect(report.productionEffect).toBe('none');
    expect(report.database.rowCount).toBe(100);
    expect(report.database.enrichmentJsonBytes).toBeGreaterThan(0);
    expect(report.metrics.reprocessing.iterations).toBe(2);
  });
});
