import { describe, expect, it } from 'vitest';

import { DEFAULT_SEARCH_PROFILE } from '../src/config/search-profile.js';
import {
  ROLE_FAMILY_SUGGESTION_VERSION,
  projectRoleFamilySuggestion,
} from '../src/intelligence/nlp/roleFamilySuggestion.js';

describe('role family suggestion projection (P7)', () => {
  it('requires a non-empty jobId', () => {
    expect(() =>
      projectRoleFamilySuggestion('  ', {
        title: 'Cybersecurity Analyst',
        profile: DEFAULT_SEARCH_PROFILE,
      }),
    ).toThrow('must not be empty');
  });

  it('surfaces the family only in agreement, with evidence and never-gate authority', () => {
    const result = projectRoleFamilySuggestion('job-1', {
      title: 'Cybersecurity Analyst',
      profile: DEFAULT_SEARCH_PROFILE,
    });

    expect(result.suggestionVersion).toBe(ROLE_FAMILY_SUGGESTION_VERSION);
    expect(result.state).toBe('agreement');
    expect(result.suggestedFamilyKey).toBe('security');
    expect(result.suggestedDisplayName).toBe('Security');
    expect(result.suggestedSource).toBe('nlp-reconciled');
    expect(result.reason).toContain('agrees with the structured');
    expect(result.evidence.decision).toBe('suggested');
    expect(result.evidence.similarity).toBe(1);
    expect(result.nlpAbstained).toBe(false);
    expect(result.authority).toEqual({
      gate: 'never',
      score: 'deterministic-unaffected',
      ranking: 'deterministic-unaffected',
      eligibility: 'deterministic-unaffected',
      lifecycle: 'deterministic-unaffected',
    });
  });

  it('is deterministic for a fixed input', () => {
    const input = {
      title: 'Cybersecurity Analyst',
      profile: DEFAULT_SEARCH_PROFILE,
    };
    expect(projectRoleFamilySuggestion('job-2', input)).toEqual(
      projectRoleFamilySuggestion('job-2', input),
    );
  });

  it('never surfaces an NLP claim on conflict; deterministic evidence is preserved', () => {
    const result = projectRoleFamilySuggestion('job-3', {
      title: 'Network Support Analyst',
      profile: DEFAULT_SEARCH_PROFILE,
      deterministicFamilyKeys: ['support'],
    });

    expect(result.state).toBe('conflict');
    expect(result.suggestedFamilyKey).toBeNull();
    expect(result.suggestedSource).toBeNull();
    expect(result.reason).toContain('stays authoritative');
    expect(result.evidence.deterministicFamilyKeys).toEqual(['support']);
    expect(result.evidence.shadowFamilyKey).not.toBeNull();
  });

  it('never surfaces an nlp-only suggestion without a structured counterpart', () => {
    const result = projectRoleFamilySuggestion('job-4', {
      title: 'Information Security Specialist',
      profile: DEFAULT_SEARCH_PROFILE,
      deterministicFamilyKeys: [],
    });

    expect(result.state).toBe('nlp-only');
    expect(result.suggestedFamilyKey).toBeNull();
    expect(result.reason).toContain('no NLP claim is surfaced');
    expect(result.evidence.shadowFamilyKey).toBe('security');
  });

  it('keeps the deterministic family when NLP abstains, marked deterministic', () => {
    const result = projectRoleFamilySuggestion(
      'job-5',
      {
        title: 'Network Support Analyst',
        profile: DEFAULT_SEARCH_PROFILE,
        deterministicFamilyKeys: ['support'],
      },
      { minimumMargin: 0.5 },
    );

    expect(result.state).toBe('deterministic-only');
    expect(result.nlpAbstained).toBe(true);
    expect(result.suggestedFamilyKey).toBe('support');
    expect(result.suggestedSource).toBe('deterministic');
    expect(result.reason).toContain('no NLP role claim is surfaced');
  });

  it('reports the deterministic family only when no NLP family exists', () => {
    const result = projectRoleFamilySuggestion('job-6', {
      title: 'Operations Professional',
      profile: DEFAULT_SEARCH_PROFILE,
      deterministicFamilyKeys: ['operations'],
    });

    expect(result.state).toBe('deterministic-only');
    expect(result.suggestedFamilyKey).toBe('operations');
    expect(result.suggestedSource).toBe('deterministic');
    expect(result.reason).toContain('no NLP role claim is surfaced');
  });

  it('abstains with an empty suggestion on unknown titles', () => {
    const result = projectRoleFamilySuggestion('job-7', {
      title: 'Operations Professional',
      profile: DEFAULT_SEARCH_PROFILE,
    });

    expect(result.state).toBe('unknown');
    expect(result.suggestedFamilyKey).toBeNull();
    expect(result.suggestedSource).toBeNull();
    expect(result.reason).toContain('Neither deterministic');
  });
});
