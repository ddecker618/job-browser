import { describe, expect, it } from 'vitest';

import {
  SKILL_INTELLIGENCE_VERSION,
  extractSkills,
  extractSkillsBatch,
  type SkillCatalogEntry,
} from '../src/intelligence/nlp/skills.js';
import type { NlpSegment } from '../src/schemas/job-nlp.js';

function segment(text: string, index = 0): NlpSegment {
  return {
    index,
    text,
    normalized: text.toLowerCase(),
    kind: 'sentence',
    sourceField: 'description',
    charStart: 0,
    charEnd: text.length,
  };
}

const customCatalog: readonly SkillCatalogEntry[] = [
  { name: 'Python', aliases: ['python'], kind: 'technology' },
  { name: 'Docker', aliases: ['docker'], kind: 'technology' },
  { name: 'Kubernetes', aliases: ['kubernetes', 'k8s'], kind: 'technology' },
  { name: 'Networking', aliases: ['network troubleshooting'], kind: 'skill' },
  { name: 'Linux', aliases: ['linux'], kind: 'technology' },
  { name: 'Splunk', aliases: ['splunk'], kind: 'technology' },
];

describe('skill intelligence - extraction and normalization', () => {
  it('extracts canonical technologies and preserves raw aliases', () => {
    const result = extractSkills(
      segment('Experience with Python, Docker, and k8s.'),
      customCatalog,
    );
    expect(result.technologies.map((item) => item.name)).toEqual([
      'Python',
      'Docker',
      'Kubernetes',
    ]);
    expect(result.technologies[2]?.raw).toBe('k8s');
    expect(result.technologies[2]?.matchedAlias).toBe('k8s');
  });

  it('does not match aliases embedded inside unrelated words', () => {
    const result = extractSkills(
      segment('Build dockerized systems and Pythonic tooling.'),
      customCatalog,
    );
    expect(result.mentions).toEqual([]);
  });

  it('keeps skill and technology kinds separate', () => {
    const result = extractSkills(
      segment('Networking and Linux experience are useful.'),
      customCatalog,
    );
    expect(result.skills.map((item) => item.name)).toEqual(['Networking']);
    expect(result.technologies.map((item) => item.name)).toEqual(['Linux']);
  });

  it('deduplicates overlapping aliases in favor of the longest evidence', () => {
    const catalog: readonly SkillCatalogEntry[] = [
      { name: 'Azure', aliases: ['azure'], kind: 'technology' },
      {
        name: 'Microsoft Azure',
        aliases: ['microsoft azure'],
        kind: 'technology',
      },
    ];
    const result = extractSkills(
      segment('Microsoft Azure experience.'),
      catalog,
    );
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]?.name).toBe('Microsoft Azure');
  });
});

describe('skill intelligence - contextual labels', () => {
  it('labels required and preferred mentions independently', () => {
    const result = extractSkills(
      segment('Python is required; Docker is preferred.'),
      customCatalog,
    );
    expect(result.mentions.map((item) => item.context)).toEqual([
      'required',
      'preferred',
    ]);
  });

  it('labels environment and responsibility contexts', () => {
    const result = extractSkills(
      segment('Linux is part of the platform; administer Splunk daily.'),
      customCatalog,
    );
    expect(result.mentions.find((item) => item.name === 'Linux')?.context).toBe(
      'environment',
    );
    expect(
      result.mentions.find((item) => item.name === 'Splunk')?.context,
    ).toBe('responsibility');
  });

  it('defaults an unqualified mention to mentioned', () => {
    const result = extractSkills(
      segment('Python appears in the job description.'),
      customCatalog,
    );
    expect(result.mentions[0]?.context).toBe('mentioned');
  });

  it('does not let a later clause bleed into an earlier mention', () => {
    const result = extractSkills(
      segment('Python is preferred; Docker is required.'),
      customCatalog,
    );
    expect(result.mentions[0]?.context).toBe('preferred');
    expect(result.mentions[1]?.context).toBe('required');
  });
});

describe('skill intelligence - evidence and batch behavior', () => {
  it('preserves exact raw text and spans', () => {
    const text = 'Use Kubernetes (k8s) in production.';
    const result = extractSkills(segment(text), customCatalog);
    const item = result.mentions[0];
    expect(item).toBeDefined();
    expect(text.slice(item?.span.start ?? 0, item?.span.end ?? 0)).toBe(
      item?.raw,
    );
    expect(item?.raw).toBe('Kubernetes');
  });

  it('batch extraction is gated on the skill category', () => {
    const segments = [
      segment('Python required.', 0),
      segment('Security+ required.', 1),
      segment('Docker preferred.', 2),
    ];
    const categories = new Map<number, readonly ('skill' | 'certification')[]>([
      [0, ['skill']],
      [1, ['certification']],
      [2, ['skill']],
    ]);
    const results = extractSkillsBatch(segments, categories, customCatalog);
    expect(results.map((item) => item.segmentIndex)).toEqual([0, 2]);
  });

  it('reports metadata and confidence bounds', () => {
    const result = extractSkills(segment('Python required.'), customCatalog);
    expect(result.skillVersion).toBe(SKILL_INTELLIGENCE_VERSION);
    expect(result.version).toBe('job-nlp-v1');
    expect(result.method).toBe('entity-normalizer');
    expect(result.confidence).toBe(0.9);
    const empty = extractSkills(
      segment('No catalog term here.'),
      customCatalog,
    );
    expect(empty.confidence).toBe(0.4);
  });

  it('returns conservative empty output without a catalog match', () => {
    const result = extractSkills(
      segment('Experience with an unfamiliar proprietary platform.'),
      customCatalog,
    );
    expect(result.mentions).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.technologies).toEqual([]);
  });
});
