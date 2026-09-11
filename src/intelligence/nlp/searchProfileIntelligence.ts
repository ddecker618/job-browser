import type { SearchProfile } from '../../config/search-profile.js';
import type { SkillCatalogEntry } from './skills.js';
import {
  normalizeSkillPhrase,
  reviewedSkillRelationships,
  skillConcepts,
} from './skillNormalization.js';

export const SEARCH_PROFILE_INTELLIGENCE_VERSION =
  'search-profile-intelligence-v1';

export interface SearchProfileIntelligence {
  version: typeof SEARCH_PROFILE_INTELLIGENCE_VERSION;
  roleFamilies: {
    key: string;
    displayName: string;
    enabled: boolean;
    titleCount: number;
  }[];
  skillCoverage: {
    configuredCount: number;
    recognizedCount: number;
    unknownLabels: string[];
  };
  skillClusters: {
    left: string;
    right: string;
    relationship: 'STRONG_RELATED' | 'WEAK_RELATED';
  }[];
  preferenceAuthority: 'deterministic-only';
  productionEffect: 'none';
}

export function projectSearchProfileIntelligence(
  profile: SearchProfile,
  configuredSkills: readonly SkillCatalogEntry[],
): SearchProfileIntelligence {
  const concepts = skillConcepts();
  const labels = new Map(
    concepts.map((concept) => [concept.key, concept.label]),
  );
  const configuredKeys = new Set<string>();
  const unknownLabels: string[] = [];

  for (const skill of configuredSkills) {
    const phrases = [skill.name, ...skill.aliases];
    const match = phrases
      .map((phrase) => normalizeSkillPhrase(phrase))
      .find((candidate) => candidate.relationship !== 'UNKNOWN');
    if (match?.sourceConceptKey) configuredKeys.add(match.sourceConceptKey);
    else unknownLabels.push(skill.name);
  }

  const skillClusters = reviewedSkillRelationships()
    .filter(
      (relationship) =>
        configuredKeys.has(relationship.left) ||
        configuredKeys.has(relationship.right),
    )
    .map((relationship) => ({
      left: labels.get(relationship.left) ?? relationship.left,
      right: labels.get(relationship.right) ?? relationship.right,
      relationship: relationship.relationship,
    }));

  return {
    version: SEARCH_PROFILE_INTELLIGENCE_VERSION,
    roleFamilies: profile.families.map((family) => ({
      key: family.key,
      displayName: family.displayName,
      enabled: family.enabled,
      titleCount: family.titles.length,
    })),
    skillCoverage: {
      configuredCount: configuredSkills.length,
      recognizedCount: configuredSkills.length - unknownLabels.length,
      unknownLabels,
    },
    skillClusters,
    preferenceAuthority: 'deterministic-only',
    productionEffect: 'none',
  };
}
