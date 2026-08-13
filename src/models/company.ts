export const COMPANY_RESOLVER_VERSION = 'company-exact-v1' as const;

export type CompanyAssignmentResult = 'resolved' | 'ineligible' | 'conflict';

export interface CompanyResolution {
  companyId: string | null;
  normalizedKey: string | null;
  result: CompanyAssignmentResult;
}

export interface CompanyBucket {
  companyId: string | null;
  canonicalName: string;
  applicationCount: number;
}
