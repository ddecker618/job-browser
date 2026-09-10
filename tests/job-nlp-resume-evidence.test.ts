import { describe, expect, it } from 'vitest';

import { skillConcepts } from '../src/intelligence/nlp/skillNormalization.js';
import {
  matchResumeEvidence,
  type ResumeEvidenceItem,
  type ResumeEvidenceRequirement,
} from '../src/intelligence/nlp/resumeEvidence.js';
import type { SkillCatalogEntry } from '../src/intelligence/nlp/skills.js';

const concepts = skillConcepts();

function concept(label: string) {
  const result = concepts.find((item) => item.label === label);
  if (result === undefined) throw new Error(`Missing concept ${label}`);
  return result;
}

function requirement(
  requirementId: string,
  phrase: string,
  targetLabel: string,
  kind: ResumeEvidenceRequirement['kind'] = 'skill',
): ResumeEvidenceRequirement {
  return {
    requirementId,
    phrase,
    kind,
    targetConcept: concept(targetLabel),
  };
}

function evidence(
  evidenceId: string,
  rawLabel: string,
  kind: ResumeEvidenceItem['kind'] = 'skill',
): ResumeEvidenceItem {
  return {
    evidenceId,
    kind,
    rawLabel,
    provenance: 'snapshot-interpretation-1:skills',
    parserVersion: 'resume-parser-v1',
    normalizationVersion: 'resume-normalization-v1',
  };
}

describe('NLP resume evidence matching shadow mode (Stage 22)', () => {
  it('reports a direct match while preserving source evidence and no possession claim', () => {
    const result = matchResumeEvidence({
      requirements: [requirement('req-python', 'Python', 'Python')],
      evidence: [evidence('evidence-python', 'Python')],
    })[0];

    expect(result).toMatchObject({
      requirementId: 'req-python',
      status: 'DIRECT_MATCH',
      consideredEvidenceCount: 1,
      assertsPossession: false,
      productionEffect: 'none',
      evidence: [
        {
          evidenceId: 'evidence-python',
          rawLabel: 'Python',
          provenance: 'snapshot-interpretation-1:skills',
          relationship: 'EXACT',
        },
      ],
    });
  });

  it('distinguishes canonical aliases from reviewed related evidence', () => {
    const results = matchResumeEvidence({
      requirements: [
        requirement('req-kubernetes', 'Kubernetes', 'Kubernetes'),
        requirement('req-siem', 'SIEM', 'SIEM'),
        requirement('req-azure', 'Azure', 'Azure'),
      ],
      evidence: [
        evidence('evidence-k8s', 'k8s'),
        evidence('evidence-splunk', 'Splunk'),
        evidence('evidence-aws', 'AWS'),
      ],
    });

    expect(results.map((item) => item.status)).toEqual([
      'DIRECT_MATCH',
      'STRONG_RELATED_EVIDENCE',
      'WEAK_RELATED_EVIDENCE',
    ]);
    expect(results[1]?.evidence[1]?.relationship).toBe('STRONG_RELATED');
    expect(results[2]?.evidence[2]?.relationship).toBe('WEAK_RELATED');
  });

  it('distinguishes no evidence from unknown evidence', () => {
    const noEvidence = matchResumeEvidence({
      requirements: [requirement('req-python', 'Python', 'Python')],
      evidence: [evidence('evidence-aws', 'AWS')],
    })[0];
    const unknown = matchResumeEvidence({
      requirements: [requirement('req-kubernetes', 'Kubernetes', 'Kubernetes')],
      evidence: [
        evidence('evidence-unknown', 'A proprietary internal platform'),
      ],
    })[0];

    expect(noEvidence?.status).toBe('NO_EVIDENCE');
    expect(unknown?.status).toBe('UNKNOWN');
    expect(unknown?.evidence[0]?.relationship).toBe('UNKNOWN');
  });

  it('does not treat a different evidence kind as possession of a requirement', () => {
    const certificationCatalog: readonly SkillCatalogEntry[] = [
      {
        name: 'CompTIA Security+',
        aliases: ['security+'],
        kind: 'skill',
      },
    ];
    const securityConcept = skillConcepts(certificationCatalog)[0];
    if (securityConcept === undefined) throw new Error('Missing certification');

    const results = matchResumeEvidence({
      requirements: [
        {
          requirementId: 'req-cert',
          phrase: 'Security+',
          kind: 'certification',
          targetConcept: securityConcept,
        },
      ],
      evidence: [evidence('evidence-skill', 'security+', 'skill')],
      catalog: certificationCatalog,
    });

    expect(results[0]?.status).toBe('NO_EVIDENCE');
    expect(results[0]?.evidence[0]).toMatchObject({
      kind: 'skill',
      relationship: null,
      score: null,
    });
    expect(results[0]?.assertsPossession).toBe(false);
  });

  it('returns UNKNOWN for an unnormalized requirement and exposes no write path', () => {
    const source = [evidence('evidence-python', 'Python')];
    const before = JSON.stringify(source);
    const results = matchResumeEvidence({
      requirements: [
        {
          requirementId: 'req-unresolved',
          phrase: 'Unresolved skill phrase',
          kind: 'skill',
          targetConcept: null,
        },
      ],
      evidence: source,
    });

    expect(results[0]?.status).toBe('UNKNOWN');
    expect(results[0]?.explanation).toContain('no possession claim');
    expect(results[0]).not.toHaveProperty('save');
    expect(results[0]).not.toHaveProperty('score');
    expect(JSON.stringify(source)).toBe(before);
  });
});
