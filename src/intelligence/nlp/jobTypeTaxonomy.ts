import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// P37 shadow - local occupation / job-type taxonomy.
//
// This is the curated catalog for the deterministic job-type classifier
// (see `jobTypeNormalization.ts`). It mirrors the layering used by the
// reviewed skill and role taxonomy paths: aliases are in-tree, the
// catalog is curated locally, and no similarity, embedding, model
// artifact, network fetch, or download is involved.
//
// No production path imports this catalog. It is shadow-only
// (`productionEffect: 'none'`). SCORING and HARD_GATE remain not
// authorized; deterministic eligibility, ranking, filtering, lifecycle,
// status, archive, and removal paths are unchanged.
// ---------------------------------------------------------------------------

export const JOB_TYPE_TAXONOMY_VERSION = 'job-type-taxonomy-v1';

export type JobTypeRelationship =
  | 'EXACT'
  | 'CANONICAL_ALIAS'
  | 'UNRELATED'
  | 'UNKNOWN';

export interface JobTypeCatalogEntry {
  key: string;
  label: string;
  aliases: readonly string[];
}

export interface JobTypeConcept {
  key: string;
  label: string;
  aliases: readonly string[];
}

export const DEFAULT_JOB_TYPE_CATALOG: readonly JobTypeCatalogEntry[] = [
  {
    key: 'software-engineering',
    label: 'Software Engineer',
    aliases: [
      'Software Engineer',
      'Software Developer',
      'Developer',
      'SWE',
      'Programmer',
    ],
  },
  {
    key: 'data-science-analytics',
    label: 'Data Scientist',
    aliases: [
      'Data Scientist',
      'Data Analyst',
      'BI Analyst',
      'Analytics Engineer',
      'Data Engineer',
      'Business Intelligence Analyst',
    ],
  },
  {
    key: 'cybersecurity',
    label: 'Cybersecurity Engineer',
    aliases: [
      'Cybersecurity Engineer',
      'Cyber Security Engineer',
      'Security Engineer',
      'SOC Analyst',
      'Penetration Tester',
      'Pen Tester',
      'AppSec Engineer',
      'Information Security Engineer',
      'InfoSec Engineer',
    ],
  },
  {
    key: 'devops-platform',
    label: 'DevOps Engineer',
    aliases: [
      'DevOps Engineer',
      'Dev Ops Engineer',
      'Site Reliability Engineer',
      'SRE',
      'Platform Engineer',
      'Release Engineer',
      'Reliability Engineer',
    ],
  },
  {
    key: 'network-engineering',
    label: 'Network Engineer',
    aliases: [
      'Network Engineer',
      'Network Administrator',
      'Network Admin',
      'Network Architect',
    ],
  },
  {
    key: 'systems-administration',
    label: 'Systems Administrator',
    aliases: [
      'Systems Administrator',
      'System Administrator',
      'Sysadmin',
      'Linux Administrator',
      'Windows Administrator',
      'IT Administrator',
      'Server Administrator',
    ],
  },
  {
    key: 'database-administration',
    label: 'Database Administrator',
    aliases: ['Database Administrator', 'DBA', 'Database Engineer'],
  },
  {
    key: 'qa-test-engineering',
    label: 'QA Engineer',
    aliases: [
      'QA Engineer',
      'Quality Assurance Engineer',
      'Quality Engineer',
      'Test Engineer',
      'SDET',
      'Software Test Engineer',
    ],
  },
  {
    key: 'project-program-management',
    label: 'Project Manager',
    aliases: [
      'Project Manager',
      'Program Manager',
      'Technical Project Manager',
      'TPM',
      'Technical Program Manager',
    ],
  },
  {
    key: 'product-management',
    label: 'Product Manager',
    aliases: ['Product Manager', 'Product Owner'],
  },
  {
    key: 'mlops-engineering',
    label: 'ML Ops Engineer',
    aliases: [
      'MLOps Engineer',
      'ML Ops Engineer',
      'Machine Learning Engineer',
      'ML Engineer',
    ],
  },
];

const ROLE_PREFIX_WORDS: readonly string[] = [
  'senior',
  'sr',
  'junior',
  'jr',
  'lead',
  'principal',
  'staff',
  'head',
  'director',
  'intern',
  'apprentice',
  'associate',
  'assistant',
  'deputy',
  'chief',
];

const EMPLOYMENT_TYPE_WORDS: readonly string[] = [
  'contract',
  'contractor',
  'temporary',
  'temp',
  'part',
  'time',
  'parttime',
  'fulltime',
  'freelance',
  'remote',
];

const GENERIC_WORDS: readonly string[] = [
  'job',
  'position',
  'role',
  'opening',
  'opportunity',
  'vacancy',
];

export const JOB_TYPE_STRIP_WORDS: ReadonlySet<string> = new Set([
  ...ROLE_PREFIX_WORDS,
  ...EMPLOYMENT_TYPE_WORDS,
  ...GENERIC_WORDS,
]);

export function normalizeJobTypeAlias(value: string): string {
  return value
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function jobTypeConcepts(
  catalog: readonly JobTypeCatalogEntry[] = DEFAULT_JOB_TYPE_CATALOG,
): JobTypeConcept[] {
  const seen = new Set<string>();
  const concepts: JobTypeConcept[] = [];
  for (const entry of catalog) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    const dedupedAliases = [...new Set([entry.label, ...entry.aliases])];
    concepts.push({
      key: entry.key,
      label: entry.label,
      aliases: dedupedAliases,
    });
  }
  return concepts;
}

export function findJobTypeConcept(
  key: string,
  catalog: readonly JobTypeCatalogEntry[] = DEFAULT_JOB_TYPE_CATALOG,
): JobTypeConcept | null {
  for (const entry of catalog) {
    if (entry.key === key) {
      return {
        key: entry.key,
        label: entry.label,
        aliases: [...new Set([entry.label, ...entry.aliases])],
      };
    }
  }
  return null;
}

export interface JobTypeAliasIndexEntry {
  key: string;
  matchedAlias: string;
}

export function jobTypeAliasIndex(
  catalog: readonly JobTypeCatalogEntry[] = DEFAULT_JOB_TYPE_CATALOG,
): ReadonlyMap<string, JobTypeAliasIndexEntry> {
  const index = new Map<string, JobTypeAliasIndexEntry>();
  for (const entry of catalog) {
    const seenForEntry = new Set<string>();
    for (const alias of entry.aliases) {
      const normalized = normalizeJobTypeAlias(alias);
      if (normalized.length === 0) continue;
      if (index.has(normalized)) {
        // Curated catalog reviews require alias disjointness. If a
        // reviewer accidentally inserts a colliding normalized alias,
        // the first entry wins and the second is silently skipped so
        // the classifier never claims an ambiguous concept. Catalog
        // lint coverage lives in
        // `tests/job-nlp-job-type-taxonomy.test.ts`.
        continue;
      }
      if (seenForEntry.has(normalized)) continue;
      seenForEntry.add(normalized);
      index.set(normalized, {
        key: entry.key,
        matchedAlias: alias,
      });
    }
  }
  return index;
}

export function jobTypeTaxonomyContentHash(
  catalog: readonly JobTypeCatalogEntry[] = DEFAULT_JOB_TYPE_CATALOG,
): string {
  const payload = {
    version: JOB_TYPE_TAXONOMY_VERSION,
    entries: catalog
      .map((entry) => ({
        key: entry.key,
        label: entry.label,
        aliases: [...entry.aliases].sort(),
      }))
      .sort((left, right) => left.key.localeCompare(right.key)),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
