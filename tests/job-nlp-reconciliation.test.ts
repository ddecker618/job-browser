import { describe, expect, it } from 'vitest';

import {
  RECONCILIATION_INTELLIGENCE_VERSION,
  reconcileFact,
  reconcileFacts,
  type ReconciliationSide,
} from '../src/intelligence/nlp/reconciliation.js';

function side(
  value: string | null = null,
  strength: ReconciliationSide['strength'] = null,
  entity: string | null = null,
  scope: string | null = null,
): ReconciliationSide {
  return { value, strength, entity, scope };
}

describe('NLP reconciliation - states and authority', () => {
  it('reports agreement when all dimensions match', () => {
    const result = reconcileFact({
      factId: 'arrangement-1',
      category: 'work-arrangement',
      deterministic: side('remote', 'informational', 'remote', 'nationwide'),
      nlp: side(' REMOTE ', 'informational', 'remote', 'nationwide'),
    });
    expect(result.state).toBe('agreement');
    expect(result.nature).toEqual([]);
    expect(result.authority).toBe('deterministic');
    expect(result.authoritativeValue).toBe('remote');
  });

  it('reports deterministic-only with missing NLP nature', () => {
    const result = reconcileFact({
      factId: 'clearance-1',
      category: 'clearance',
      deterministic: side('Secret', 'required'),
      nlp: side(),
    });
    expect(result.state).toBe('deterministic-only');
    expect(result.nature).toEqual(['missing-nlp']);
    expect(result.authority).toBe('deterministic');
    expect(result.authoritativeValue).toBe('Secret');
  });

  it('reports NLP-only with missing deterministic nature', () => {
    const result = reconcileFact({
      factId: 'skill-1',
      category: 'skill',
      deterministic: side(),
      nlp: side('Python', 'preferred', 'Python'),
    });
    expect(result.state).toBe('nlp-only');
    expect(result.nature).toEqual(['missing-deterministic']);
    expect(result.authority).toBe('nlp');
    expect(result.authoritativeValue).toBe('Python');
  });

  it('reports value conflicts while preserving both sides', () => {
    const deterministic = side('onsite', 'required', 'office', 'local');
    const nlp = side('remote', 'required', 'remote', 'nationwide');
    const result = reconcileFact({
      factId: 'location-1',
      category: 'work-arrangement',
      deterministic,
      nlp,
    });
    expect(result.state).toBe('conflict');
    expect(result.nature).toEqual(['value', 'entity', 'scope']);
    expect(result.deterministic).toEqual(deterministic);
    expect(result.nlp).toEqual(nlp);
    expect(result.authority).toBe('deterministic');
    expect(result.authoritativeValue).toBe('onsite');
  });

  it('classifies modality conflicts separately from value conflicts', () => {
    const result = reconcileFact({
      factId: 'experience-1',
      category: 'experience',
      deterministic: side('5 years', 'required'),
      nlp: side('5 years', 'preferred'),
    });
    expect(result.state).toBe('conflict');
    expect(result.nature).toEqual(['modality']);
  });

  it('classifies entity and scope conflicts separately', () => {
    const entityResult = reconcileFact({
      factId: 'certification-1',
      category: 'certification',
      deterministic: side('certification', 'required', 'Security+'),
      nlp: side('certification', 'required', 'CISSP'),
    });
    expect(entityResult.nature).toEqual(['entity']);

    const scopeResult = reconcileFact({
      factId: 'location-2',
      category: 'location',
      deterministic: side('remote', null, null, 'California'),
      nlp: side('remote', null, null, 'nationwide'),
    });
    expect(scopeResult.nature).toEqual(['scope']);
  });

  it('reports unknown when neither side has a fact', () => {
    const result = reconcileFact({
      factId: 'unknown-1',
      category: 'unknown',
      deterministic: side(),
      nlp: side(),
    });
    expect(result.state).toBe('unknown');
    expect(result.nature).toEqual([]);
    expect(result.authority).toBe('none');
    expect(result.authoritativeValue).toBeNull();
  });

  it('uses conflict when both sides exist but one dimension is missing', () => {
    const result = reconcileFact({
      factId: 'education-1',
      category: 'education',
      deterministic: side('bachelor', 'required'),
      nlp: side('bachelor'),
    });
    expect(result.state).toBe('conflict');
    expect(result.nature).toEqual(['missing-nlp']);
  });
});

describe('NLP reconciliation - batch and metadata', () => {
  it('reconciles a deterministic batch without changing input order', () => {
    const results = reconcileFacts([
      {
        factId: 'one',
        category: 'skill',
        deterministic: side('Python'),
        nlp: side('Python'),
      },
      {
        factId: 'two',
        category: 'travel',
        deterministic: side(),
        nlp: side('25% travel'),
      },
    ]);
    expect(results.map((result) => result.factId)).toEqual(['one', 'two']);
    expect(results.map((result) => result.state)).toEqual([
      'agreement',
      'nlp-only',
    ]);
  });

  it('reports method, version, and confidence', () => {
    const result = reconcileFact({
      factId: 'meta-1',
      category: 'location',
      deterministic: side('hybrid'),
      nlp: side('hybrid'),
    });
    expect(result.method).toBe('reconciliation');
    expect(result.version).toBe('job-nlp-v1');
    expect(result.reconciliationVersion).toBe(
      RECONCILIATION_INTELLIGENCE_VERSION,
    );
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.note).toContain('agree');
  });
});
