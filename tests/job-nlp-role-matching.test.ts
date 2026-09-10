import { describe, expect, it } from 'vitest';

import { DEFAULT_SEARCH_PROFILE } from '../src/config/search-profile.js';
import {
  ROLE_MATCHING_INTELLIGENCE_VERSION,
  matchRoleShadow,
  runRoleMatchingShadow,
  type RoleMatchingPersistenceTarget,
  type RoleMatchingResult,
} from '../src/intelligence/nlp/roleMatching.js';

class MemoryRoleTarget implements RoleMatchingPersistenceTarget {
  public readonly rows = new Map<string, RoleMatchingResult>();

  public save(jobId: string, result: RoleMatchingResult): void {
    this.rows.set(jobId, result);
  }
}

describe('NLP role matching shadow mode (Stage 20)', () => {
  it('suggests an exact configured family without invoking production scoring', () => {
    const result = matchRoleShadow({
      title: 'Cybersecurity Analyst',
      profile: DEFAULT_SEARCH_PROFILE,
    });

    expect(result.method).toBe('deterministic-fallback');
    expect(result.version).toBe(ROLE_MATCHING_INTELLIGENCE_VERSION);
    expect(result.suggestedFamilyKey).toBe('security');
    expect(result.candidates[0]).toMatchObject({
      familyKey: 'security',
      matchedTitle: 'Cybersecurity Analyst',
      similarity: 1,
      decision: 'suggested',
    });
    expect(result.reconciliation.state).toBe('agreement');
    expect(result).not.toHaveProperty('score');
    expect(result).not.toHaveProperty('eligibility');
    expect(result).not.toHaveProperty('archive');
  });

  it('uses token overlap for a close title paraphrase and retains explainability', () => {
    const result = matchRoleShadow({
      title: 'Information Security Specialist',
      profile: DEFAULT_SEARCH_PROFILE,
      contextText: 'Monitor security operations and vulnerability events.',
    });

    expect(result.suggestedFamilyKey).toBe('security');
    expect(result.candidates[0]?.matchedTokens).toEqual([
      'information',
      'security',
    ]);
    expect(result.candidates[0]?.explanation).toContain('shared token');
  });

  it('abstains when the top families are too close or the title is weak', () => {
    const ambiguous = matchRoleShadow(
      {
        title: 'Network Support Analyst',
        profile: DEFAULT_SEARCH_PROFILE,
      },
      { minimumMargin: 0.5 },
    );
    const unknown = matchRoleShadow({
      title: 'Operations Professional',
      profile: DEFAULT_SEARCH_PROFILE,
    });

    expect(ambiguous.suggestedFamilyKey).toBeNull();
    expect(ambiguous.candidates[0]?.decision).toBe('abstained');
    expect(unknown.suggestedFamilyKey).toBeNull();
    expect(unknown.candidates[0]?.decision).toBe('rejected');
    expect(unknown.reconciliation.state).toBe('unknown');
  });

  it('reports shadow disagreement without changing deterministic families', () => {
    const result = matchRoleShadow({
      title: 'Network Support Analyst',
      profile: DEFAULT_SEARCH_PROFILE,
      deterministicFamilyKeys: ['support'],
    });

    expect(result.reconciliation.deterministicFamilyKeys).toEqual(['support']);
    expect(result.reconciliation.state).toBe('conflict');
    expect(result.reconciliation.shadowFamilyKey).not.toBeNull();
    expect(result.reconciliation.note).toContain('no production value changes');
  });

  it('validates bounds and does not mutate the profile', () => {
    const before = JSON.stringify(DEFAULT_SEARCH_PROFILE);

    expect(() =>
      matchRoleShadow(
        { title: 'Systems Administrator', profile: DEFAULT_SEARCH_PROFILE },
        { minimumSimilarity: 2 },
      ),
    ).toThrow('between 0 and 1');
    expect(() =>
      matchRoleShadow(
        { title: 'Systems Administrator', profile: DEFAULT_SEARCH_PROFILE },
        { maximumCandidates: 0 },
      ),
    ).toThrow('positive integer');
    expect(JSON.stringify(DEFAULT_SEARCH_PROFILE)).toBe(before);
  });

  it('persists only the shadow role record through an explicit target', () => {
    const target = new MemoryRoleTarget();
    const result = runRoleMatchingShadow(
      'job-role-1',
      { title: 'Systems Administrator', profile: DEFAULT_SEARCH_PROFILE },
      target,
    );

    expect(target.rows.get('job-role-1')).toEqual(result);
    expect(result.candidates[0]?.version).toBe(
      ROLE_MATCHING_INTELLIGENCE_VERSION,
    );
    expect(result.candidates[0]?.familyKey).toBe('infrastructure');
    expect(result).not.toHaveProperty('productionScore');
    expect(result).not.toHaveProperty('eligibility');
    expect(result).not.toHaveProperty('archive');
  });
});
