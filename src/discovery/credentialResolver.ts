export interface CredentialResolver {
  status(
    providerId: string,
  ): Promise<{ configured: boolean; available: boolean }>;
  resolve(providerId: string): Promise<Readonly<Record<string, string>> | null>;
}

export const unavailableCredentialResolver: CredentialResolver = {
  status: () => Promise.resolve({ configured: false, available: false }),
  resolve: () => Promise.resolve(null),
};
