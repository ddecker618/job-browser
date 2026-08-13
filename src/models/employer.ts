import type { AtsSupportState } from './source-management.js';

export interface Employer {
  id: string;
  name: string;
  normalizedName: string;
  websiteUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VerificationState = 'verified' | 'unverified' | 'unknown';
export type CareerSiteHealthStatus =
  | 'healthy'
  | 'warning'
  | 'broken'
  | 'retired'
  | 'unknown';

export interface CareerSiteHealth {
  status: CareerSiteHealthStatus;
  checkedAt: string | null;
  message: string | null;
  failureCount: number;
  effectiveUrl: string | null;
  nextCheckAt: string | null;
}

export interface CareerSiteVerificationHistory {
  id: string;
  careerSiteId: string;
  requestedUrl: string;
  effectiveUrl: string | null;
  httpStatus: number | null;
  resultClassification: string;
  previousAtsProvider: string | null;
  detectedAtsPlatform: string | null;
  detectedProvider: string | null;
  confidence: number;
  evidence: readonly string[];
  previousHealthStatus: CareerSiteHealthStatus;
  resultingHealthStatus: CareerSiteHealthStatus;
  reason: string;
  observedAt: string;
}
export type CareerSiteDiscoveryState =
  | 'ready'
  | 'source-created'
  | 'source-reused'
  | 'completed'
  | 'failed'
  | 'unsupported'
  | 'backoff'
  | 'retired';

export interface CareerSiteDiscoveryStatus {
  sourceId: string | null;
  state: CareerSiteDiscoveryState;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastResult: string | null;
  nextAttemptAt: string | null;
  provenance: string;
}

export interface FingerprintEvidence {
  kind: string;
  detail: string;
  confidence: number;
  observedAt: string;
}

export interface CareerSiteEvidence {
  id: string;
  careerSiteId: string;
  kind: string;
  detail: string;
  confidence: number;
  observedAt: string;
  createdAt: string;
}

export interface CareerSiteFingerprint {
  atsPlatform: string | null;
  atsDetectedProvider: string | null;
  confidence: number;
  confidenceLabel: 'high' | 'medium' | 'low';
  supportState: AtsSupportState;
  evidence: FingerprintEvidence[];
  detectedVariant: string | null;
  listingsUrl: string | null;
  sitemapUrl: string | null;
  portalOrigin: string | null;
  explanation: string;
  detectionVersion: string;
  observedAt: string;
  structuredFallback: boolean;
  failureCategory: string | null;
}

export interface CareerSite {
  id: string;
  employerId: string;
  url: string;
  normalizedUrl: string;
  fingerprint: CareerSiteFingerprint | null;
  verificationState: VerificationState;
  lastVerifiedAt: string | null;
  discovery: CareerSiteDiscoveryStatus;
  health: CareerSiteHealth;
  createdAt: string;
  updatedAt: string;
}

export interface CareerSiteSummary {
  id: string;
  employerId: string;
  employerName: string;
  url: string;
  atsPlatform: string | null;
  atsDetectedProvider: string | null;
  confidence: number;
  confidenceLabel: 'high' | 'medium' | 'low';
  supportState: AtsSupportState;
  verificationState: VerificationState;
  lastVerifiedAt: string | null;
  discovery: CareerSiteDiscoveryStatus;
  health: CareerSiteHealth;
  explanation: string | null;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface EmployerWithSites {
  employer: Employer;
  careerSites: CareerSiteSummary[];
}

export interface EmployerSeed {
  name: string;
  websiteUrl: string | null;
  careerSiteUrls: readonly string[];
  provenance: string;
}

export interface EmployerSeedImportResult {
  considered: number;
  employersCreated: number;
  employersReused: number;
  careerSitesCreated: number;
  careerSitesReused: number;
  rejected: number;
  truncated: boolean;
}
