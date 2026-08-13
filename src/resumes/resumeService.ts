import { extname, resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';

import mammoth from 'mammoth';

import type { CandidateProfile } from '../schemas/candidate-profile.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import { normalizeText } from '../utilities/normalization.js';

export interface ExtractedTermDetail {
  label: string;
  rawLabel: string;
  matchedBy: 'name' | 'alias';
}

export interface ResumeExtraction {
  parsingStatus: 'parsed' | 'pending' | 'failed';
  parsingError: string | null;
  normalizedText: string;
  skills: string[];
  certifications: string[];
  skillTerms: ExtractedTermDetail[];
  certificationTerms: ExtractedTermDetail[];
  proposedSkills: string[];
  proposedCertifications: string[];
}

export async function extractResume(
  storagePath: string,
  originalFilename: string,
  profile: CandidateProfile,
  config: ScoringConfig,
  resumeDirectory: string,
): Promise<ResumeExtraction> {
  try {
    const resolvedStoragePath = resolveResumeStoragePath(
      resumeDirectory,
      storagePath,
    );
    return await extractResumeFromPath(
      resolvedStoragePath,
      originalFilename,
      profile,
      config,
    );
  } catch (error) {
    return failedExtraction(error);
  }
}

export async function extractResumeFromPath(
  storagePath: string,
  originalFilename: string,
  profile: CandidateProfile,
  config: ScoringConfig,
): Promise<ResumeExtraction> {
  try {
    const contents = await readFile(storagePath);
    const text = await extractText(contents, originalFilename);
    const normalized = normalizeText(text);
    const skills = matchingTermDetails(normalized, config.skills);
    const certifications = matchingTermDetails(
      normalized,
      config.certifications,
    );
    const currentSkills = new Set(profile.skills.map(normalizeText));
    const currentCertifications = new Set(
      profile.certifications.map(normalizeText),
    );
    return {
      parsingStatus: 'parsed',
      parsingError: null,
      normalizedText: normalized,
      skills: skills.map((term) => term.label),
      certifications: certifications.map((term) => term.label),
      skillTerms: skills,
      certificationTerms: certifications,
      proposedSkills: skills
        .map((term) => term.label)
        .filter((skill) => !currentSkills.has(normalizeText(skill))),
      proposedCertifications: certifications
        .map((term) => term.label)
        .filter(
          (certification) => !currentCertifications.has(normalizeText(certification)),
        ),
    };
  } catch (error) {
    return failedExtraction(error);
  }
}

export function resolveResumeStoragePath(
  resumeDirectory: string,
  storagePath: string,
): string {
  const root = resolve(resumeDirectory);
  const candidate = resolve(storagePath);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!candidate.startsWith(rootPrefix)) {
    throw new Error(
      'Resume storage path must remain inside the configured resume directory',
    );
  }
  return candidate;
}

async function extractText(
  contents: Buffer,
  originalFilename: string,
): Promise<string> {
  const extension = extname(originalFilename).toLowerCase();
  if (['.txt', '.md'].includes(extension)) {
    return contents.toString('utf8');
  }
  if (extension === '.docx') {
    return (await mammoth.extractRawText({ buffer: contents })).value;
  }
  if (extension === '.pdf') {
    const text = await extractPdfText(new Uint8Array(contents));
    if (text.trim().length === 0) {
      throw new Error(
        'No extractable PDF text was found. Scanned PDFs require OCR, which is not supported.',
      );
    }
    return text;
  }
  throw new Error(`Unsupported resume format: ${extension || 'unknown'}`);
}

async function extractPdfText(data: Uint8Array): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await getDocument({ data, useSystemFonts: true }).promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .filter(Boolean)
          .join(' '),
      );
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  return pages.join('\n');
}

function matchingTermDetails(
  text: string,
  catalog: readonly { name: string; aliases: readonly string[] }[],
): ExtractedTermDetail[] {
  const found: ExtractedTermDetail[] = [];
  for (const entry of catalog) {
    const nameMatch = text.includes(normalizeText(entry.name));
    if (nameMatch) {
      found.push({
        label: entry.name,
        rawLabel: normalizeText(entry.name),
        matchedBy: 'name',
      });
      continue;
    }
    for (const alias of entry.aliases) {
      if (text.includes(normalizeText(alias))) {
        found.push({
          label: entry.name,
          rawLabel: normalizeText(alias),
          matchedBy: 'alias',
        });
        break;
      }
    }
  }
  return found;
}

function failedExtraction(error: unknown): ResumeExtraction {
  return {
    parsingStatus: 'failed',
    parsingError: error instanceof Error ? error.message : String(error),
    normalizedText: '',
    skills: [],
    certifications: [],
    skillTerms: [],
    certificationTerms: [],
    proposedSkills: [],
    proposedCertifications: [],
  };
}