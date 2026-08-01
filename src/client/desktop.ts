export interface DesktopRuntimeInfo {
  desktop: boolean;
  version: string;
  databasePath: string;
  resumeDirectory: string;
  logDirectory: string;
  backupDirectory: string;
  backendStatus: string;
  backendUrl: string | null;
  executablePath?: string;
  rendererMode?: string;
  commitIdentifier?: string;
}

export interface DesktopBridge {
  getRuntimeInfo(): Promise<DesktopRuntimeInfo>;
  openDataFolder(): Promise<string>;
  openLogsFolder(): Promise<string>;
  createBackup(): Promise<string>;
  copyDiagnostics(): Promise<void>;
  restart(): Promise<void>;
  retryStartup(): Promise<void>;
  safeExit(): Promise<void>;
  getCredentialStatus(): Promise<{ configured: boolean; available: boolean }>;
  setUsaJobsCredentials(credentials: {
    email: string;
    apiKey: string;
  }): Promise<{ configured: boolean; available: boolean }>;
  clearUsaJobsCredentials(): Promise<void>;
  getUsaJobsProfilePath(): Promise<string>;
  clearUsaJobsSession(): Promise<{ cleared: boolean }>;
  onStartupProgress(callback: (stage: string) => void): void;
  onStartupFailure(callback: (payload: Record<string, string>) => void): void;
}

declare global {
  interface Window {
    jobBrowserDesktop?: DesktopBridge;
  }
}

export function desktopBridge(): DesktopBridge | null {
  return window.jobBrowserDesktop ?? null;
}
