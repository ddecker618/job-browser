import { describe, expect, it } from 'vitest';

import { DEFAULT_SEARCH_PROFILE } from '../src/config/search-profile.js';
import {
  projectSearchProfileIntelligence,
  SEARCH_PROFILE_INTELLIGENCE_VERSION,
} from '../src/intelligence/nlp/searchProfileIntelligence.js';

describe('search profile NLP context (P15)', () => {
  it('projects role families, reviewed skill coverage, and related clusters without mutating preferences', () => {
    const profileBefore = structuredClone(DEFAULT_SEARCH_PROFILE);
    const skills = [
      { name: 'Splunk', aliases: ['splunk enterprise'] },
      { name: 'AWS', aliases: ['amazon web services'] },
      { name: 'Unreviewed Tool', aliases: ['unreviewed-tool'] },
    ];
    const skillsBefore = structuredClone(skills);

    const result = projectSearchProfileIntelligence(
      DEFAULT_SEARCH_PROFILE,
      skills,
    );

    expect(result.version).toBe(SEARCH_PROFILE_INTELLIGENCE_VERSION);
    expect(result.roleFamilies).toHaveLength(
      DEFAULT_SEARCH_PROFILE.families.length,
    );
    expect(result.skillCoverage).toEqual({
      configuredCount: 3,
      recognizedCount: 2,
      unknownLabels: ['Unreviewed Tool'],
    });
    expect(result.skillClusters).toEqual(
      expect.arrayContaining([
        {
          left: 'Splunk',
          right: 'SIEM',
          relationship: 'STRONG_RELATED',
        },
        { left: 'AWS', right: 'Azure', relationship: 'WEAK_RELATED' },
      ]),
    );
    expect(result.preferenceAuthority).toBe('deterministic-only');
    expect(result.productionEffect).toBe('none');
    expect(DEFAULT_SEARCH_PROFILE).toEqual(profileBefore);
    expect(skills).toEqual(skillsBefore);
  });
});
