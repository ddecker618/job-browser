import type { JobForScoring } from '../domain/job.js';
import type { ExtractedTerm } from '../models/intelligence.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import { normalizeText } from '../utilities/normalization.js';

type CatalogEntry = ScoringConfig['skills'][number];

export interface JobTerms {
  skills: ExtractedTerm[];
  certifications: ExtractedTerm[];
}

export function extractJobTerms(
  job: JobForScoring,
  config: ScoringConfig,
): JobTerms {
  const text = [
    job.title,
    job.description,
    job.requirements,
    job.preferredQualifications,
  ]
    .filter((value): value is string => value !== null)
    .join(' ');

  return {
    skills: extractTerms(text, config.skills),
    certifications: extractTerms(text, config.certifications),
  };
}

export function profileHasTerm(
  profileValues: readonly string[],
  entry: CatalogEntry,
): boolean {
  const profileText = normalizeText(profileValues.join(' '));
  return [entry.name, ...entry.aliases].some((alias) =>
    containsAlias(profileText, normalizeText(alias)),
  );
}

function extractTerms(
  text: string,
  catalog: readonly CatalogEntry[],
): ExtractedTerm[] {
  const normalizedText = normalizeText(text);
  const extracted: ExtractedTerm[] = [];

  for (const entry of catalog) {
    const aliases = new Set([entry.name, ...entry.aliases].map(normalizeText));
    let frequency = 0;
    for (const alias of aliases) frequency += countAlias(normalizedText, alias);
    if (frequency > 0) {
      extracted.push({
        name: entry.name,
        normalizedName: normalizeText(entry.name),
        frequency,
      });
    }
  }

  return extracted.sort((left, right) => left.name.localeCompare(right.name));
}

function countAlias(text: string, alias: string): number {
  const expression = new RegExp(
    `(?<![a-z0-9])${escapeRegExp(alias).replaceAll('\\ ', '\\s+')}((?![a-z0-9]))`,
    'giu',
  );
  return [...text.matchAll(expression)].length;
}

function containsAlias(text: string, alias: string): boolean {
  return countAlias(text, alias) > 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
