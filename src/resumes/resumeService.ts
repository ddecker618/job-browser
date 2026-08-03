import { extname, resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';

import mammoth from 'mammoth';

import type { CandidateProfile } from '../schemas/candidate-profile.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import { normalizeText } from '../utilities/normalization.js';

export interface ResumeExtraction {
  parsingStatus: 'parsed' | 'pending' | 'failed';
  parsingError: string | null;
  skills: string[];
  certifications: string[];
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
  const extension = extname(originalFilename).toLowerCase();
  try {
    const resolvedStoragePath = resolveResumeStoragePath(
      resumeDirectory,
      storagePath,
    );
    const contents = await readFile(resolvedStoragePath);
    let text: string;
    if (['.txt', '.md'].includes(extension)) {
      text = contents.toString('utf8');
    } else if (extension === '.docx') {
      text = (await mammoth.extractRawText({ buffer: contents })).value;
    } else if (extension === '.pdf') {
      text = await extractPdfText(new Uint8Array(contents));
      if (text.trim().length === 0) {
        throw new Error(
          'No extractable PDF text was found. Scanned PDFs require OCR, which is not supported.',
        );
      }
    } else {
      throw new Error(`Unsupported resume format: ${extension || 'unknown'}`);
    }
    const normalized = normalizeText(text);
    const skills = matchingTerms(normalized, config.skills);
    const certifications = matchingTerms(normalized, config.certifications);
    const currentSkills = new Set(profile.skills.map(normalizeText));
    const currentCertifications = new Set(
      profile.certifications.map(normalizeText),
    );
    return {
      parsingStatus: 'parsed',
      parsingError: null,
      skills,
      certifications,
      proposedSkills: skills.filter(
        (skill) => !currentSkills.has(normalizeText(skill)),
      ),
      proposedCertifications: certifications.filter(
        (certification) =>
          !currentCertifications.has(normalizeText(certification)),
      ),
    };
  } catch (error) {
    return {
      parsingStatus: 'failed',
      parsingError: error instanceof Error ? error.message : String(error),
      skills: [],
      certifications: [],
      proposedSkills: [],
      proposedCertifications: [],
    };
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

function matchingTerms(
  text: string,
  catalog: readonly { name: string; aliases: readonly string[] }[],
): string[] {
  return catalog
    .filter((entry) =>
      [entry.name, ...entry.aliases].some((alias) =>
        text.includes(normalizeText(alias)),
      ),
    )
    .map((entry) => entry.name);
}
