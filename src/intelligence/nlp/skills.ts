import {
  NLP_EXTRACTION_VERSION,
  type NlpRequirementCategory,
  type NlpSegment,
} from '../../schemas/job-nlp.js';
import { normalizeText } from '../../utilities/normalization.js';

// ---------------------------------------------------------------------------
// Stage 10 - skill and technology extraction.
//
// Catalog matching is exact and conservative: aliases are boundary-aware,
// canonical names are never substituted for the raw evidence, and context is
// assigned per mention rather than to the whole segment. This is an additive
// shadow extractor and does not replace production skill scoring.
// ---------------------------------------------------------------------------

export const SKILL_INTELLIGENCE_VERSION = 'skill-intelligence-v1';

export type SkillEntityKind = 'skill' | 'technology';

export type SkillContext =
  | 'required'
  | 'preferred'
  | 'mentioned'
  | 'environment'
  | 'responsibility';

export interface SkillCatalogEntry {
  name: string;
  aliases: readonly string[];
  kind?: SkillEntityKind;
}

export interface SkillMention {
  name: string;
  normalizedName: string;
  raw: string;
  matchedAlias: string;
  kind: SkillEntityKind;
  context: SkillContext;
  span: { start: number; end: number };
}

export interface SkillExtraction {
  segmentIndex: number;
  mentions: SkillMention[];
  skills: SkillMention[];
  technologies: SkillMention[];
  confidence: number;
  method: 'entity-normalizer';
  version: typeof NLP_EXTRACTION_VERSION;
  skillVersion: typeof SKILL_INTELLIGENCE_VERSION;
}

export const DEFAULT_SKILL_CATALOG: readonly SkillCatalogEntry[] = [
  { name: 'Windows Server', aliases: ['windows server'], kind: 'technology' },
  { name: 'Linux', aliases: ['linux'], kind: 'technology' },
  { name: 'PowerShell', aliases: ['powershell'], kind: 'technology' },
  { name: 'Python', aliases: ['python'], kind: 'technology' },
  { name: 'Networking', aliases: ['networking', 'network troubleshooting'] },
  { name: 'TCP/IP', aliases: ['tcp/ip', 'tcp ip'], kind: 'technology' },
  {
    name: 'Active Directory',
    aliases: ['active directory', 'ad ds'],
    kind: 'technology',
  },
  { name: 'Azure', aliases: ['azure', 'microsoft azure'], kind: 'technology' },
  { name: 'AWS', aliases: ['aws', 'amazon web services'], kind: 'technology' },
  { name: 'Splunk', aliases: ['splunk'], kind: 'technology' },
  { name: 'CrowdStrike', aliases: ['crowdstrike'], kind: 'technology' },
  { name: 'VMware', aliases: ['vmware', 'vsphere'], kind: 'technology' },
  { name: 'Docker', aliases: ['docker'], kind: 'technology' },
  { name: 'Kubernetes', aliases: ['kubernetes', 'k8s'], kind: 'technology' },
  { name: 'Cisco', aliases: ['cisco'], kind: 'technology' },
  { name: 'Firewall', aliases: ['firewall', 'firewalls'] },
  { name: 'SIEM', aliases: ['siem'], kind: 'technology' },
  { name: 'EDR', aliases: ['edr'], kind: 'technology' },
  { name: 'Cribl', aliases: ['cribl'], kind: 'technology' },
  { name: 'DNS', aliases: ['dns'], kind: 'technology' },
  { name: 'DHCP', aliases: ['dhcp'], kind: 'technology' },
  { name: 'VLANs', aliases: ['vlan', 'vlans'], kind: 'technology' },
  { name: 'Wireshark', aliases: ['wireshark'], kind: 'technology' },
  { name: 'Nmap', aliases: ['nmap'], kind: 'technology' },
];

const TECHNOLOGY_NAMES = new Set(
  DEFAULT_SKILL_CATALOG.filter((entry) => entry.kind === 'technology').map(
    (entry) => normalizeText(entry.name),
  ),
);

const CONTEXT_RULES: readonly {
  context: Exclude<SkillContext, 'mentioned'>;
  pattern: RegExp;
}[] = [
  {
    context: 'required',
    pattern:
      /\brequired\b|\bmandatory\b|\bminimum\b|\bmust\b|\bshall\b|\bwe require\b|\bneed(?:s)? to\b/i,
  },
  {
    context: 'preferred',
    pattern:
      /\bpreferred\b|\bdesired\b|\bideally\b|\bnice[ -]to[ -]have\b|\bbonus\b|\bis a plus\b/i,
  },
  {
    context: 'responsibility',
    pattern:
      /\bresponsible for\b|\bmanage\b|\badminister\b|\bmonitor\b|\bconfigure\b|\bdevelop\b|\bmaintain\b|\btroubleshoot\b|\bdesign\b|\bdeploy\b|\bimplement\b|\bsupport\b|\boperate\b|\bbuild\b/i,
  },
  {
    context: 'environment',
    pattern:
      /\benvironment\b|\bplatform\b|\bstack\b|\binfrastructure\b|\btoolset\b|\btoolchain\b|\btools? include\b|\btechnologies include\b/i,
  },
];

export function extractSkills(
  segment: NlpSegment,
  catalog: readonly SkillCatalogEntry[] = DEFAULT_SKILL_CATALOG,
): SkillExtraction {
  const candidates: SkillMention[] = [];
  for (const entry of catalog) {
    const aliases = uniqueAliases(entry);
    for (const alias of aliases) {
      const pattern = aliasPattern(alias);
      let match = pattern.exec(segment.text);
      while (match !== null) {
        const start = match.index;
        const end = start + match[0].length;
        candidates.push({
          name: entry.name,
          normalizedName: normalizeText(entry.name),
          raw: match[0],
          matchedAlias: alias,
          kind: entry.kind ?? inferKind(entry),
          context: classifyContext(segment.text, (start + end) / 2),
          span: { start, end },
        });
        match = pattern.exec(segment.text);
      }
    }
  }

  const mentions = dedupeOverlappingMentions(candidates);
  const skills = mentions.filter((mention) => mention.kind === 'skill');
  const technologies = mentions.filter(
    (mention) => mention.kind === 'technology',
  );
  const confidence = mentions.length === 0 ? 0.4 : 0.9;

  return {
    segmentIndex: segment.index,
    mentions,
    skills,
    technologies,
    confidence,
    method: 'entity-normalizer',
    version: NLP_EXTRACTION_VERSION,
    skillVersion: SKILL_INTELLIGENCE_VERSION,
  };
}

export function extractSkillsBatch(
  segments: readonly NlpSegment[],
  categoriesByIndex: ReadonlyMap<number, readonly NlpRequirementCategory[]>,
  catalog: readonly SkillCatalogEntry[] = DEFAULT_SKILL_CATALOG,
): SkillExtraction[] {
  const results: SkillExtraction[] = [];
  for (const segment of segments) {
    const categories = categoriesByIndex.get(segment.index) ?? ['unknown'];
    if (!categories.includes('skill')) continue;
    results.push(extractSkills(segment, catalog));
  }
  return results;
}

function classifyContext(text: string, center: number): SkillContext {
  const clause = clauseBounds(text, center);
  const clauseText = text.slice(clause.start, clause.end);
  const localCenter = center - clause.start;
  let best: {
    context: Exclude<SkillContext, 'mentioned'>;
    distance: number;
  } | null = null;

  for (const rule of CONTEXT_RULES) {
    const flags = rule.pattern.flags.includes('g')
      ? rule.pattern.flags
      : `${rule.pattern.flags}g`;
    const pattern = new RegExp(rule.pattern.source, flags);
    let match = pattern.exec(clauseText);
    while (match !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const distance =
        localCenter < start
          ? start - localCenter
          : localCenter > end
            ? localCenter - end
            : 0;
      if (best === null || distance < best.distance) {
        best = { context: rule.context, distance };
      }
      match = pattern.exec(clauseText);
    }
  }
  return best?.context ?? 'mentioned';
}

function clauseBounds(
  text: string,
  center: number,
): { start: number; end: number } {
  const boundaries = [0];
  let cursor = text.indexOf(';');
  while (cursor !== -1) {
    boundaries.push(cursor + 1);
    cursor = text.indexOf(';', cursor + 1);
  }
  boundaries.push(text.length);
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index] ?? 0;
    const end = boundaries[index + 1] ?? text.length;
    if (center >= start && center < end) return { start, end };
  }
  return { start: 0, end: text.length };
}

function dedupeOverlappingMentions(
  candidates: readonly SkillMention[],
): SkillMention[] {
  const sorted = [...candidates].sort((left, right) => {
    if (left.span.start !== right.span.start) {
      return left.span.start - right.span.start;
    }
    if (left.span.end !== right.span.end) {
      return right.span.end - left.span.end;
    }
    return left.name.localeCompare(right.name);
  });
  const accepted: SkillMention[] = [];
  for (const candidate of sorted) {
    const overlaps = accepted.some(
      (existing) =>
        candidate.span.start < existing.span.end &&
        candidate.span.end > existing.span.start,
    );
    if (!overlaps) accepted.push(candidate);
  }
  return accepted.sort((left, right) => left.span.start - right.span.start);
}

function uniqueAliases(entry: SkillCatalogEntry): string[] {
  return [...new Set([entry.name, ...entry.aliases].map(normalizeText))].filter(
    (alias) => alias.length > 0,
  );
}

function aliasPattern(alias: string): RegExp {
  const escaped = escapeRegex(alias).replaceAll('\\ ', '\\s+');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'giu');
}

function inferKind(entry: SkillCatalogEntry): SkillEntityKind {
  return TECHNOLOGY_NAMES.has(normalizeText(entry.name))
    ? 'technology'
    : 'skill';
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
