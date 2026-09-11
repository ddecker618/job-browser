import type { ResumeSnapshotEvidenceSource } from '../../models/resume-snapshot.js';
import type { ResumeEvidenceItem } from './resumeEvidence.js';

export const SNAPSHOT_EVIDENCE_ADAPTER_VERSION = 'resume-snapshot-evidence-v1';

export function adaptResumeSnapshotEvidence(
  source: ResumeSnapshotEvidenceSource,
): ResumeEvidenceItem[] {
  const base = {
    parserVersion: source.parserVersion,
    normalizationVersion: source.normalizationVersion,
  };
  const result: ResumeEvidenceItem[] = [
    ...source.skills.map((item, index) => ({
      ...base,
      evidenceId: source.interpretationId + ':skill:' + String(index),
      kind: 'skill' as const,
      rawLabel: item.rawLabel,
      provenance: item.provenance,
    })),
    ...source.certifications.map((item, index) => ({
      ...base,
      evidenceId: source.interpretationId + ':certification:' + String(index),
      kind: 'certification' as const,
      rawLabel: item.rawLabel,
      provenance: item.provenance,
    })),
  ];
  const text = source.parsingStatus === 'parsed' ? source.normalizedText : null;
  result.push(
    ...experienceEvidence(source, text),
    ...educationEvidence(source, text),
    ...clearanceEvidence(source, text),
  );
  return result;
}

function common(
  source: ResumeSnapshotEvidenceSource,
  kind: 'experience' | 'education' | 'clearance',
  index: number,
  rawLabel: string,
) {
  return {
    evidenceId: source.interpretationId + ':' + kind + ':' + String(index),
    kind,
    rawLabel,
    provenance:
      'snapshot-normalized-payload:' + SNAPSHOT_EVIDENCE_ADAPTER_VERSION,
    parserVersion: source.parserVersion,
    normalizationVersion: source.normalizationVersion,
  };
}

function experienceEvidence(
  source: ResumeSnapshotEvidenceSource,
  text: string | null,
): ResumeEvidenceItem[] {
  if (text === null) return [unknown(source, 'experience')];
  const pattern =
    /\b(\d{1,2})\+?\s+years?\s+(?:of\s+)?(?:professional\s+|relevant\s+|related\s+)?experience\b/g;
  const found = [...text.matchAll(pattern)].flatMap((match, index) =>
    match[1] === undefined
      ? []
      : [
          {
            ...common(source, 'experience', index, match[0]),
            years: Number(match[1]),
            normalizedValue: match[1] + ' years',
          },
        ],
  );
  return found.length > 0 ? found : [unknown(source, 'experience')];
}

function educationEvidence(
  source: ResumeSnapshotEvidenceSource,
  text: string | null,
): ResumeEvidenceItem[] {
  if (text === null) return [unknown(source, 'education')];
  const definitions: readonly [string, RegExp][] = [
    ['doctorate', /\b(?:ph\.?d\.?|doctorate|doctoral degree)\b/g],
    ['master', /\b(?:master(?:'?s)?|m\.?s\.?|m\.?b\.?a\.?)\b/g],
    ['bachelor', /\b(?:bachelor(?:'?s)?|baccalaureate|b\.?s\.?)\b/g],
    ['associate', /\bassociate'?s\b/g],
    ['high-school', /\b(?:high school diploma|ged)\b/g],
  ];
  const found: ResumeEvidenceItem[] = [];
  for (const [value, pattern] of definitions) {
    for (const match of text.matchAll(pattern)) {
      found.push({
        ...common(source, 'education', found.length, match[0]),
        normalizedValue: value,
      });
    }
  }
  return found.length > 0 ? found : [unknown(source, 'education')];
}

function clearanceEvidence(
  source: ResumeSnapshotEvidenceSource,
  text: string | null,
): ResumeEvidenceItem[] {
  if (text === null) return [unknown(source, 'clearance')];
  const definitions: readonly [string, RegExp][] = [
    [
      'top secret/sci',
      /\b(?:top secret\s*\/\s*sci|ts\s*\/\s*sci)\s+clearance\b/g,
    ],
    ['top secret', /\btop secret\s+clearance\b/g],
    ['secret', /\bsecret\s+clearance\b/g],
    ['public trust', /\bpublic trust\s+(?:clearance|designation)\b/g],
  ];
  const found: ResumeEvidenceItem[] = [];
  for (const [value, pattern] of definitions) {
    for (const match of text.matchAll(pattern)) {
      if (found.some((item) => item.rawLabel.includes(match[0]))) continue;
      found.push({
        ...common(source, 'clearance', found.length, match[0]),
        normalizedValue: value,
      });
    }
  }
  return found.length > 0 ? found : [unknown(source, 'clearance')];
}

function unknown(
  source: ResumeSnapshotEvidenceSource,
  kind: 'experience' | 'education' | 'clearance',
): ResumeEvidenceItem {
  return {
    ...common(
      source,
      kind,
      0,
      'No structured ' + kind + ' evidence was parsed',
    ),
    normalizedValue: null,
    years: null,
  };
}
