import { describe, expect, it } from 'vitest';

import {
  cleanForSegmentation,
  segmentRoleDescription,
  type RoleDescriptionParts,
} from '../src/intelligence/nlp/segmenter.js';
import { nlpSegmentSchema } from '../src/schemas/job-nlp.js';

const LEGAL_EEO = 'Equal Opportunity Employer.';

function parts(
  overrides: Partial<RoleDescriptionParts> = {},
): RoleDescriptionParts {
  return {
    title: 'Security Analyst',
    location: null,
    description: LEGAL_EEO,
    requirements: null,
    preferredQualifications: null,
    ...overrides,
  };
}

describe('job-nlp segmenter', () => {
  it('produces a versionable contract-valid segment for a simple sentence', () => {
    const segments = segmentRoleDescription(
      parts({ description: 'Security+ required.' }),
    );
    const target = segments.find((s) => s.text.includes('Security+ required'));
    expect(target).toBeDefined();
    expect(nlpSegmentSchema.safeParse(target).success).toBe(true);
    expect(target?.kind).toBe('sentence');
    expect(target?.sourceField).toBe('description');
  });

  it('splits a paragraph into sentences at sentence boundaries', () => {
    const description =
      'Remote position. Employees must reside within 50 miles of St. Louis.';
    const segments = segmentRoleDescription(parts({ description }));
    const texts = segments.map((s) => s.text);
    expect(texts).toContain('Remote position.');
    expect(texts).toContain(
      'Employees must reside within 50 miles of St. Louis.',
    );
  });

  it('does not split after common abbreviations', () => {
    const description =
      'Must be a U.S. citizen and eligible to obtain a Secret clearance.';
    const segments = segmentRoleDescription(parts({ description }));
    expect(segments.some((s) => s.text.includes('U.S. citizen'))).toBe(true);
    expect(segments.some((s) => s.text === 'Must be a U.S.')).toBe(false);
  });

  it('splits colon-delimited requirements into a label fragment and content', () => {
    const description = 'Requirements: Security+ required.';
    const segments = segmentRoleDescription(parts({ description }));
    const texts = segments.map((s) => s.text);
    expect(texts).toContain('Requirements:');
    expect(texts).toContain('Security+ required.');
  });

  it('splits semicolon lists into separate fragments', () => {
    const description = "Bachelor's preferred; equivalent experience accepted.";
    const segments = segmentRoleDescription(parts({ description }));
    const texts = segments.map((s) => s.text);
    expect(texts).toContain("Bachelor's preferred;");
    expect(texts).toContain('equivalent experience accepted.');
  });

  it('keeps comma clauses inside a single segment', () => {
    const description =
      '5 years IT experience, including 2 years cybersecurity.';
    const segments = segmentRoleDescription(parts({ description }));
    expect(segments.some((s) => s.text === description)).toBe(true);
  });

  it('handles bullet-list requirements as bullets', () => {
    const description = [
      '- Security+ preferred.',
      '- 5 years IT experience.',
      '- Bachelor\u2019s degree or equivalent.',
    ].join('\n');
    const segments = segmentRoleDescription(parts({ description }));
    const bullets = segments.filter((s) => s.kind === 'bullet');
    expect(bullets.length).toBeGreaterThanOrEqual(3);
    const combined = segments.map((s) => s.text).join(' | ');
    expect(combined).toContain('Security+ preferred.');
    expect(combined).toContain('5 years IT experience.');
    expect(combined).toContain('Bachelor\u2019s degree or equivalent.');
  });

  it('detects numbered list items', () => {
    const description =
      '1. Security+ required.\n2. Red Hat Linux administration.';
    const segments = segmentRoleDescription(parts({ description }));
    expect(segments.some((s) => s.kind === 'list-item')).toBe(true);
  });

  it('handles HTML-derived content as segments', () => {
    const description =
      '<ul><li>Security+ required.</li><li>5 years experience.</li></ul>';
    const segments = segmentRoleDescription(parts({ description }));
    const texts = segments.map((s) => s.text);
    expect(texts).toContain('Security+ required.');
    expect(texts).toContain('5 years experience.');
  });

  it('recognizes section headings as heading segments', () => {
    const description = 'Required Qualifications:\n- Security+ required.';
    const segments = segmentRoleDescription(parts({ description }));
    const headings = segments.filter((s) => s.kind === 'heading');
    expect(headings.some((h) => h.text === 'Required Qualifications:')).toBe(
      true,
    );
  });

  it('preserves verbatim evidence text and valid spans for every segment', () => {
    const description =
      'Responsible for SIEM monitoring.\nBachelor\u2019s preferred; equivalent experience accepted.';
    const input = parts({ description });
    const segments = segmentRoleDescription(input);
    const sourceByField: Record<
      | 'title'
      | 'location'
      | 'description'
      | 'requirements'
      | 'preferredQualifications',
      string
    > = {
      title: input.title,
      location: input.location ?? '',
      description: input.description ?? '',
      requirements: input.requirements ?? '',
      preferredQualifications: input.preferredQualifications ?? '',
    };
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(segment.charStart).toBeLessThanOrEqual(segment.charEnd);
      if (segment.sourceField === 'other') continue;
      const original = sourceByField[segment.sourceField];
      const verbatim = original
        .slice(segment.charStart, segment.charEnd)
        .trim();
      expect(segment.text).toBe(verbatim);
    }
  });

  it('emits contiguous global segment indices starting at 0', () => {
    const description =
      'Security+ required.\n- 5 years experience.\nEducation preferred.';
    const segments = segmentRoleDescription(parts({ description }));
    segments.forEach((segment, i) => {
      expect(segment.index).toBe(i);
    });
    expect(segments[0]?.index).toBe(0);
  });

  it('concatenates source fields in a stable order', () => {
    const segments = segmentRoleDescription(
      parts({
        location: 'Remote - St. Louis, MO',
        requirements: 'Security+ required.',
        preferredQualifications: 'CISSP preferred.',
      }),
    );
    const order = segments.map((s) => `${s.sourceField}:${s.text}`);
    const title = order.findIndex((s) => s.startsWith('title:'));
    const location = order.findIndex((s) => s.startsWith('location:'));
    const description = order.findIndex((s) => s.startsWith('description:'));
    const requirements = order.findIndex((s) => s.startsWith('requirements:'));
    const preferred = order.findIndex((s) =>
      s.startsWith('preferredQualifications:'),
    );
    expect(title).toBeLessThan(location);
    expect(location).toBeLessThan(description);
    expect(description).toBeLessThan(requirements);
    expect(requirements).toBeLessThan(preferred);
  });

  it('handles malformed provider formatting without crashing', () => {
    const description = 'Security+ required.Preferred: CISSP&nbsp;or CISM.SC';
    const segments = segmentRoleDescription(parts({ description }));
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(segment.text.length).toBeGreaterThan(0);
    }
  });

  it('cleans HTML tags position-preservingly', () => {
    const input = '<p>Security+ required.</p>';
    const cleaned = cleanForSegmentation(input);
    expect(cleaned.length).toBe(input.length);
    expect(cleaned).toBe('   Security+ required.\n   ');
  });

  it('keeps EEO boilerplate as its own segment', () => {
    const segments = segmentRoleDescription(parts());
    expect(segments.some((s) => s.text === LEGAL_EEO)).toBe(true);
  });

  it('treats the title as a heading-like segment', () => {
    const segments = segmentRoleDescription(parts());
    const title = segments.find((s) => s.sourceField === 'title');
    expect(title?.kind).toBe('heading');
    expect(title?.text).toBe('Security Analyst');
  });
});
