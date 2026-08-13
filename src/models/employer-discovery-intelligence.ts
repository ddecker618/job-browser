import type { CareerSiteHealthStatus } from './employer.js';

export const EMPLOYER_DISCOVERY_INTELLIGENCE_VERSION =
  'employer-discovery-intelligence-v1';

export type DiscoverySchedulingClass =
  | 'high-priority'
  | 'normal'
  | 'stable'
  | 'degraded'
  | 'unsupported'
  | 'credential-required'
  | 'retired';

export interface DiscoveryPriorityComponent {
  code: string;
  points: number;
  explanation: string;
}

export interface CareerSiteActivityMetrics {
  windowStart: string;
  windowEnd: string;
  known: boolean;
  activeJobs: number | null;
  jobsFirstSeen: number | null;
  lastNewJobAt: string | null;
  lastSuccessfulDiscoveryAt: string | null;
  successfulRuns: number;
  failedRuns: number;
  zeroResultSuccessfulRuns: number;
}

export interface ProviderSuccessMetrics {
  providerId: string;
  providerName: string;
  attemptedCareerSites: number;
  successfulValidations: number;
  successfulSourceMappings: number;
  unsupportedOutcomes: number;
  credentialRequiredOutcomes: number;
  discoverySuccesses: number;
  discoveryFailures: number;
  interruptedRuns: number;
  zeroResultSuccessfulRuns: number;
  recentSuccessRate: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

export interface CareerSiteIntelligenceDecision {
  policyVersion: typeof EMPLOYER_DISCOVERY_INTELLIGENCE_VERSION;
  evaluatedAt: string;
  careerSiteId: string;
  employerId: string;
  employerName: string;
  url: string;
  providerId: string | null;
  schedulingClass: DiscoverySchedulingClass;
  priority: number;
  eligible: boolean;
  executable: boolean;
  cadenceHours: number | null;
  nextEligibleAt: string | null;
  healthStatus: CareerSiteHealthStatus;
  atsConfidence: number;
  providerSuccessRate: number | null;
  activity: CareerSiteActivityMetrics;
  components: DiscoveryPriorityComponent[];
  reasons: string[];
}

export interface EmployerActivityMetrics {
  employerId: string;
  employerName: string;
  known: boolean;
  activeJobs: number | null;
  jobsFirstSeen: number | null;
  lastNewJobAt: string | null;
  lastSuccessfulDiscoveryAt: string | null;
}

export interface DiscoveryIntelligenceSummary {
  policyVersion: typeof EMPLOYER_DISCOVERY_INTELLIGENCE_VERSION;
  evaluatedAt: string;
  activityWindow: { start: string; end: string; semantics: '[start,end)' };
  totals: {
    employers: number;
    careerSites: number;
    eligibleSites: number;
    executableSites: number;
    dueSoon: number;
    supportedSites: number;
    unsupportedSites: number;
    credentialRequiredSites: number;
    healthySites: number;
    warningSites: number;
    brokenSites: number;
    retiredSites: number;
    discoverySuccesses: number;
    discoveryFailures: number;
  };
  sitesBySchedulingClass: Record<DiscoverySchedulingClass, number>;
  sites: CareerSiteIntelligenceDecision[];
  providers: ProviderSuccessMetrics[];
  employers: EmployerActivityMetrics[];
  employersTruncated: boolean;
  lastEvaluationAt: string | null;
  lastDiscoveryRunAt: string | null;
}
