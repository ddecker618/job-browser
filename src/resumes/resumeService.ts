import { extname } from 'node:path';
import { readFile, readFileSync } from 'node:fs';
import { promisify } from 'node:util';

import mammoth from 'mammoth';

import type { CandidateProfile } from '../schemas/candidate-profile.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import { normalizeText } from '../utilities/normalization.js';

const readFileAsync = promisify(readFile);

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
): Promise<ResumeExtraction> {
  const extension = extname(originalFilename).toLowerCase();
  try {
    let text: string;
    if (['.txt', '.md'].includes(extension)) {
      text = readFileSync(storagePath, 'utf8');
    } else if (extension === '.docx') {
      text = (await mammoth.extractRawText({ path: storagePath })).value;
    } else if (extension === '.pdf') {
      text = await extractPdfText(storagePath);
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

async function extractPdfText(path: string): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFileAsync(path));
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
