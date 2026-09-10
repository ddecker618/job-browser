import { describe, expect, it } from 'vitest';

import {
  CATEGORY_CLASSIFIER_VERSION,
  asSegmentInputs,
  classifySegment,
  classifySegments,
} from '../src/intelligence/nlp/categorizer.js';
import { NLP_EXTRACTION_VERSION } from '../src/schemas/job-nlp.js';

function classify(text: string) {
  return classifySegment(
    asSegmentInputs([{ index: 0, text, kind: 'sentence' }])[0]!,
  );
}

describe('job-nlp category classifier (Stage 3)', () => {
  it('classifies certifications', () => {
    const result = classify('Security+ required.');
    expect(result.categories).toContain('certification');
    expect(result.categories).not.toContain('skill');
  });

  it('classifies experience', () => {
    const result = classify(
      '5 years of IT experience, including 2 years of cybersecurity.',
    );
    expect(result.categories).toContain('experience');
  });

  it('classifies education without over-triggering on equivalency', () => {
    const result = classify("Bachelor's degree or equivalent experience.");
    expect(result.categories).toContain('education');
    expect(result.categories).not.toContain('experience');
  });

  it('classifies citizenship', () => {
    const result = classify('U.S. citizenship required.');
    expect(result.categories).toContain('citizenship');
  });

  it('classifies applicant-directed clearance requirements', () => {
    const result = classify('Must be able to obtain a Top Secret clearance.');
    expect(result.categories).toContain('clearance');
  });

  it('does NOT read company clearance descriptions as applicant clearance', () => {
    const result = classify('Our cleared team supports Secret environments.');
    expect(result.categories).not.toContain('clearance');
    expect(result.categories).toContain('company-description');
  });

  it('classifies remote work as a work arrangement', () => {
    const result = classify('Remote position.');
    expect(result.categories).toContain('work-arrangement');
    expect(result.categories).not.toContain('location');
  });

  it('classifies commute/residency language as location', () => {
    const result = classify(
      'Employees must reside within 50 miles of St. Louis.',
    );
    expect(result.categories).toContain('location');
  });

  it('classifies travel', () => {
    const result = classify(
      'Some travel up to 10% of the time may be required.',
    );
    expect(result.categories).toContain('travel');
  });

  it('classifies employment type and schedule as a multi-label', () => {
    const result = classify('Full-time position, Monday through Friday.');
    expect(result.categories).toContain('employment-type');
    expect(result.categories).toContain('schedule');
  });

  it('classifies compensation and benefits as a multi-label', () => {
    const result = classify(
      'We offer competitive compensation including health insurance and 401(k).',
    );
    expect(result.categories).toContain('compensation');
    expect(result.categories).toContain('benefit');
  });

  it('classifies EEO boilerplate as legal-eeo-boilerplate (dominant)', () => {
    const result = classify('We are an Equal Opportunity Employer.');
    expect(result.categories).toContain('legal-eeo-boilerplate');
    expect(result.categories).not.toContain('benefit');
    expect(result.categories).not.toContain('skill');
  });

  it('classifies responsibilities', () => {
    const result = classify('Responsible for maintaining the SIEM platform.');
    expect(result.categories).toContain('responsibility');
    expect(result.categories).toContain('skill');
  });

  it('classifies soft-skill statements as skills', () => {
    const result = classify('Excellent communication skills required.');
    expect(result.categories).toContain('skill');
  });

  it('classifies benefits', () => {
    const result = classify('Medical, dental, and vision insurance offered.');
    expect(result.categories).toContain('benefit');
  });

  it('returns unknown when no signal is present', () => {
    const result = classify(
      'Candidates should apply for available opportunities.',
    );
    expect(result.categories).toEqual(['unknown']);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('emits strong confidence for high-signal categories', () => {
    const result = classify('U.S. citizenship required.');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('propagates segmentation indices through multi-label classification', () => {
    const segments = asSegmentInputs([
      { index: 0, text: 'Security+ required.', kind: 'sentence' },
      { index: 1, text: 'Full-time.', kind: 'sentence' },
      {
        index: 2,
        text: 'We are an Equal Opportunity Employer.',
        kind: 'sentence',
      },
    ]);
    const results = classifySegments(segments);
    expect(results.map((r) => r.segmentIndex)).toEqual([0, 1, 2]);
    expect(results[0]?.categories).toContain('certification');
    expect(results[1]?.categories).toContain('employment-type');
    expect(results[2]?.categories).toContain('legal-eeo-boilerplate');
  });

  it('reports classifier method and extraction version', () => {
    const result = classify('Security+ required.');
    expect(result.method).toBe('category-classifier');
    expect(result.version).toBe(NLP_EXTRACTION_VERSION);
    expect(result.classificationVersion).toBe(CATEGORY_CLASSIFIER_VERSION);
  });

  it('does not classify a skill requirement as clearance merely because it mentions Secret-like tooling', () => {
    const result = classify('Experience with the Splunk SIEM platform.');
    expect(result.categories).toContain('skill');
    expect(result.categories).not.toContain('clearance');
    expect(result.categories).not.toContain('citizenship');
  });
});
