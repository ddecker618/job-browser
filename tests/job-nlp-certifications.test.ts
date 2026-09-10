import { describe, expect, it } from 'vitest';

import {
  CERTIFICATION_INTELLIGENCE_VERSION,
  certificationCatalog,
  extractCertifications,
  extractCertificationsBatch,
} from '../src/intelligence/nlp/certifications.js';
import type { NlpSegment } from '../src/schemas/job-nlp.js';

const categoricalSegments = new Map<number, readonly 'certification'[]>([
  [0, ['certification']],
]);

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

const displayName: Record<string, string> = {
  'security-plus': 'CompTIA Security+',
  'network-plus': 'CompTIA Network+',
  'a-plus': 'CompTIA A+',
  'cysa-plus': 'CompTIA CySA+',
  securityx: 'CompTIA SecurityX',
  'casp-plus': 'CompTIA CASP+',
  cissp: 'ISC2 CISSP',
  cism: 'ISACA CISM',
  ccna: 'Cisco CCNA',
  ccnp: 'Cisco CCNP',
  ccie: 'Cisco CCIE',
  'aws-certified': 'AWS Certified',
  'azure-certified': 'Microsoft Azure Certified',
  'microsoft-certified': 'Microsoft Certified',
};

describe('certification intelligence - catalog', () => {
  it('catalog covers the known certifications and families', () => {
    const keys = certificationCatalog().map((entry) => entry.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'security-plus',
        'network-plus',
        'a-plus',
        'cysa-plus',
        'securityx',
        'casp-plus',
        'cissp',
        'cism',
        'ccna',
        'ccnp',
        'ccie',
        'aws-certified',
        'azure-certified',
        'microsoft-certified',
      ]),
    );
  });
});

describe('certification intelligence - extraction', () => {
  it('recognizes Security+ as required', () => {
    const result = extractCertifications(
      segment('CompTIA Security+ certification required for this role.'),
    );
    expect(result.certifications).toEqual([
      {
        key: 'security-plus',
        name: 'CompTIA Security+',
        vendor: 'comptia',
        raw: 'Security+',
        modality: 'required',
        equivalency: false,
        span: { start: 8, end: 17 },
      },
    ]);
    expect(result.confidence).toBe(0.9);
    expect(result.method).toBe('entity-normalizer');
    expect(result.version).toBe('job-nlp-v1');
    expect(result.certificationVersion).toBe('certification-intelligence-v1');
  });

  it('scopes modality to preferred', () => {
    const result = extractCertifications(
      segment('Security+ preferred, but Network+ is required.'),
    );
    const [byKey] = result.certifications;
    expect(result.certifications.length).toBe(2);
    expect(result.certifications.map((item) => item.key)).toEqual([
      'security-plus',
      'network-plus',
    ]);
    expect(byKey?.modality).toBe('preferred');
    expect(result.certifications[1]?.modality).toBe('required');
  });

  it('recognizes equivalency phrases', () => {
    const result = extractCertifications(
      segment('Security+ or equivalent certification preferred.'),
    );
    const item = result.certifications[0];
    expect(item?.modality).toBe('equivalent-accepted');
    expect(item?.equivalency).toBe(true);
  });

  it('distinguishes obtain-after-hire from bare requirement', () => {
    const afterHire = extractCertifications(
      segment('Must obtain Security+ within 90 days of hire.'),
    );
    expect(afterHire.certifications[0]?.modality).toBe('required-after-hire');

    const bare = extractCertifications(
      segment('Must obtain Security+ certification.'),
    );
    expect(bare.certifications[0]?.modality).toBe('required');
  });

  it('recognizes ability-to-obtain', () => {
    const result = extractCertifications(
      segment('Ability to obtain a Security+ certification is required.'),
    );
    expect(result.certifications[0]?.modality).toBe('ability-to-obtain');
  });

  it('extracts multiple certifications in one statement', () => {
    const result = extractCertifications(
      segment('CISSP, CISM, and CCNA are strongly preferred.'),
    );
    expect(result.certifications.map((item) => item.key)).toEqual([
      'cissp',
      'cism',
      'ccna',
    ]);
    for (const item of result.certifications) {
      expect(item.modality).toBe('preferred');
    }
  });

  it('normalizes SecurityX and CASP+', () => {
    const result = extractCertifications(
      segment('CASP+ or SecurityX required.'),
    );
    expect(result.certifications.map((item) => item.key)).toEqual([
      'casp-plus',
      'securityx',
    ]);
    for (const item of result.certifications) {
      expect(item.name).toBe(displayName[item.key] ?? item.name);
      expect(item.modality).toBe('required');
    }
  });

  it('normalizes vendor families', () => {
    const azure = extractCertifications(
      segment('Microsoft Certified: Azure Solutions Architect is a plus.'),
    );
    expect(azure.certifications.map((item) => item.key)).toEqual([
      'microsoft-certified',
      'azure-certified',
    ]);
    expect(azure.certifications[0]?.modality).toBe('nice-to-have');

    const aws = extractCertifications(
      segment('AWS Certified Solutions Architect - Associate preferred.'),
    );
    expect(aws.certifications[0]?.key).toBe('aws-certified');
    expect(aws.certifications[0]?.modality).toBe('preferred');
  });

  it('does not invent certifications from plain security language', () => {
    const result = extractCertifications(
      segment('We value a strong security posture.'),
    );
    expect(result.certifications).toEqual([]);
    expect(result.confidence).toBe(0.4);
  });

  it('does not treat a school grade A+ as the CompTIA A+', () => {
    const result = extractCertifications(
      segment('Minimum grade of A+ required for admission.'),
    );
    expect(result.certifications).toEqual([]);
  });

  it('reports raw text and span integrity', () => {
    const result = extractCertifications(
      segment('You must hold a valid CCNA.'),
    );
    const item = result.certifications[0];
    expect(item).toBeDefined();
    const raw = (item as { raw: string }).raw;
    const span = (item as { span: { start: number; end: number } }).span;
    expect('You must hold a valid CCNA.'.slice(span.start, span.end)).toBe(raw);
  });

  it('returns empty for segments without known certifications', () => {
    const result = extractCertifications(
      segment('Bachelor and certification queries go here.'),
      // intentionally no certification keyword beyond "certification"
    );
    expect(result.certifications).toEqual([]);
  });

  it('batch honors the certification category gate', () => {
    const segments = [
      segment('Security+ required.', 0),
      segment('We value our cleared team.', 1),
    ];
    const results = extractCertificationsBatch(segments, categoricalSegments);
    expect(results).toHaveLength(1);
    expect(results[0]?.segmentIndex).toBe(0);
    expect(results[0]?.certifications[0]?.key).toBe('security-plus');
  });
});

describe('certification intelligence - metadata', () => {
  it('version constants are present', () => {
    expect(CERTIFICATION_INTELLIGENCE_VERSION).toBeDefined();
    expect(displayName['security-plus']).toBe('CompTIA Security+');
  });
});
