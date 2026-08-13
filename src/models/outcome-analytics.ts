export const OUTCOME_DEFINITION = 'application-outcomes-v1' as const;

export interface OutcomeMetric {
  key: string;
  label: string;
  numerator: number;
  denominator: number;
  sampleSize: number;
  rate: number | null;
  smallSample: boolean;
}

export interface OutcomeDimension extends OutcomeMetric {
  id: string | null;
  unknown: boolean;
}

export interface OutcomeAnalytics {
  definition: typeof OUTCOME_DEFINITION;
  definitionVersion: 1;
  scope: 'installation-local';
  period: { start: string; end: string; asOf: string };
  includedEventSets: Record<string, readonly string[]>;
  applications: {
    cohortSize: number;
    unknownAppliedBaseline: number;
    unknownOutcomeOccurrence: number;
    currentOutcomes: OutcomeMetric[];
    everReached: OutcomeMetric[];
    averageDaysToFirstResponse: number | null;
    responseTimingSampleSize: number;
  };
  companies: OutcomeDimension[];
  skills: OutcomeDimension[];
  certifications: OutcomeDimension[];
  unknownCompanyCount: number;
  unknownQualificationCount: number;
  sourceDataWatermark: string;
  generatedAt: string;
}
