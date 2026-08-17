export const EMPLOYER_MANIFEST_VERSION = 'employer-seed-manifest-v1';

export interface EmployerManifestRow {
  employerName?: string | undefined;
  rootDomain?: string | undefined;
  careersUrl?: string | undefined;
  expectedAtsFamily?: string | undefined;
  atsTenant?: string | undefined;
  provenance: string;
  batchId?: string | undefined;
  notes?: string | undefined;
  enabled: boolean;
}

export interface EmployerManifest {
  version: typeof EMPLOYER_MANIFEST_VERSION;
  imports: readonly EmployerManifestRow[];
}

export type EmployerManifestRowStatus =
  | 'created'
  | 'reused'
  | 'rejected'
  | 'in-batch-duplicate'
  | 'ambiguous'
  | 'unsupported'
  | 'employer-only';

export interface EmployerManifestImportRowResult {
  index: number;
  status: EmployerManifestRowStatus;
  employerName: string | null;
  careersUrl: string | null;
  employerId: string | null;
  careerSiteId: string | null;
  sourceId: string | null;
  reason: string | null;
}

export interface EmployerManifestImportResult {
  version: string;
  dryRun: boolean;
  inputRows: number;
  invalid: number;
  inBatchDuplicates: number;
  employersCreated: number;
  employersReused: number;
  careerSitesCreated: number;
  careerSitesReused: number;
  sourcesCreated: number;
  sourcesReused: number;
  aliasesAdded: number;
  evidenceAdded: number;
  unsupportedCandidates: number;
  ambiguousConflicts: number;
  skipped: number;
  enabled: number;
  leftDisabled: number;
  batches: number;
  batchErrors: number;
  rows: EmployerManifestImportRowResult[];
}
