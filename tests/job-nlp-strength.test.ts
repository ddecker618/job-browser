import { describe, expect, it } from 'vitest';

import { classifySegment } from '../src/intelligence/nlp/categorizer.js';
import { asSegmentInputs } from '../src/intelligence/nlp/categorizer.js';
import {
  STRENGTH_CLASSIFIER_VERSION,
  classifyStrength,
} from '../src/intelligence/nlp/strength.js';
import { NLP_EXTRACTION_VERSION } from '../src/schemas/job-nlp.js';

function strengthOf(text: string) {
  const segment = asSegmentInputs([{ index: 0, text, kind: 'sentence' }])[0]!;
  const classification = classifySegment(segment);
  const result = classifyStrength(segment, classification.categories);
  return {
    text,
    categories: classification.categories,
    strength: result.strength,
    confidence: result.confidence,
    result,
  };
}

describe('job-nlp strength/modality classifier (Stage 4)', () => {
  it('classifies explicit required', () => {
    expect(strengthOf('Security+ required.').strength).toBe('required');
  });

  it('classifies preferred', () => {
    expect(strengthOf('Security+ preferred.').strength).toBe('preferred');
  });

  it('classifies required-after-hire for post-hire timelines', () => {
    const result = strengthOf('Must obtain Security+ within 90 days of hire.');
    expect(result.strength).toBe('required-after-hire');
  });

  it('classifies ability-to-obtain before required', () => {
    expect(
      strengthOf('Must be able to obtain a Top Secret clearance.').strength,
    ).toBe('ability-to-obtain');
  });

  it('classifies equivalent experience accepted', () => {
    expect(
      strengthOf("Bachelor's degree or equivalent experience.").strength,
    ).toBe('equivalent-accepted');
  });

  it('classifies equivalency over preferred on combined statements', () => {
    expect(
      strengthOf('Security+ or equivalent certification preferred.').strength,
    ).toBe('equivalent-accepted');
  });

  it('classifies a bare requirement without markers as unknown', () => {
    const result = strengthOf(
      '5 years IT experience, including 2 years cybersecurity.',
    );
    expect(result.strength).toBe('unknown');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('classifies EEO boilerplate as informational', () => {
    expect(strengthOf('Equal Opportunity Employer.').strength).toBe(
      'informational',
    );
  });

  it('classifies benefits as informational', () => {
    expect(
      strengthOf(
        'We offer competitive compensation including health insurance and 401(k).',
      ).strength,
    ).toBe('informational');
  });

  it('classifies pure responsibilities as informational but skill-bearing duties as unknown', () => {
    expect(strengthOf('Responsible for managing a small team.').strength).toBe(
      'informational',
    );
    expect(
      strengthOf('Responsible for maintaining the SIEM platform.').strength,
    ).toBe('unknown');
  });

  it('classifies a remote description as informational but a must-reside as required', () => {
    expect(strengthOf('Remote position.').strength).toBe('informational');
    expect(
      strengthOf('Employees must reside within 50 miles of St. Louis.')
        .strength,
    ).toBe('required');
  });

  it('classifies travel with explicit required onto required', () => {
    expect(
      strengthOf('Some travel up to 10% of the time may be required.').strength,
    ).toBe('required');
  });

  it('paraphrase: we require / mandatory', () => {
    expect(strengthOf('We require a Security+ certification.').strength).toBe(
      'required',
    );
    expect(strengthOf('Mandatory: 5 years of experience.').strength).toBe(
      'required',
    );
  });

  it('paraphrase: ideally / desired / a plus', () => {
    expect(strengthOf('Knowledge of Kubernetes is desired.').strength).toBe(
      'preferred',
    );
    expect(strengthOf('Ideally you have a CISSP certification.').strength).toBe(
      'preferred',
    );
    expect(strengthOf('A CISSP certification is a plus.').strength).toBe(
      'nice-to-have',
    );
  });

  it('paraphrase: nice to have', () => {
    expect(strengthOf('Nice to have: familiarity with AWS.').strength).toBe(
      'nice-to-have',
    );
  });

  it('paraphrase: in lieu of / substitute', () => {
    expect(
      strengthOf('Experience in lieu of a degree will be considered.').strength,
    ).toBe('equivalent-accepted');
  });

  it('paraphrase: eligibility', () => {
    expect(
      strengthOf('Candidate must be eligible to obtain a clearance.').strength,
    ).toBe('ability-to-obtain');
  });

  it('reports modality method and version', () => {
    const text = 'Security+ required.';
    const segment = asSegmentInputs([{ index: 0, text, kind: 'sentence' }])[0]!;
    const classification = classifySegment(segment);
    const result = classifyStrength(segment, classification.categories);
    expect(result.method).toBe('modality-classifier');
    expect(result.version).toBe(NLP_EXTRACTION_VERSION);
    expect(result.strengthVersion).toBe(STRENGTH_CLASSIFIER_VERSION);
  });

  it('strength coexists with category classification', () => {
    const result = strengthOf('U.S. citizenship required.');
    expect(result.categories).toContain('citizenship');
    expect(result.strength).toBe('required');
  });
});
