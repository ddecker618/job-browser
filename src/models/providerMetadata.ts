export interface ProviderMetadata {
  id: string;
  providerId: string;
  providerName: string;
  enabled: boolean;
  configurationJson: string | null;
  lastSuccessfulRun: string | null;
  lastFailure: string | null;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}
