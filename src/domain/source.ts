export interface Source {
  id: string;
  employer: string;
  sourceType: string;
  careersUrl: string | null;
  enabled: boolean;
  connector: string | null;
  lastSuccessfulRun: string | null;
  lastFailure: string | null;
  failureCount: number;
}
