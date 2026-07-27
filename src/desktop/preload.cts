import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('jobBrowserDesktop', {
  getRuntimeInfo: () => ipcRenderer.invoke('desktop:runtime-info'),
  openDataFolder: () => ipcRenderer.invoke('desktop:open-data'),
  openLogsFolder: () => ipcRenderer.invoke('desktop:open-logs'),
  createBackup: () => ipcRenderer.invoke('desktop:create-backup'),
  copyDiagnostics: () => ipcRenderer.invoke('desktop:copy-diagnostics'),
  restart: () => ipcRenderer.invoke('desktop:restart'),
  retryStartup: () => ipcRenderer.invoke('desktop:retry-startup'),
  safeExit: () => ipcRenderer.invoke('desktop:safe-exit'),
  getCredentialStatus: () => ipcRenderer.invoke('desktop:credentials-status'),
  setUsaJobsCredentials: (credentials: { email: string; apiKey: string }) =>
    ipcRenderer.invoke('desktop:set-usajobs-credentials', credentials),
  clearUsaJobsCredentials: () =>
    ipcRenderer.invoke('desktop:clear-usajobs-credentials'),
  getLinkedInProfilePath: () =>
    ipcRenderer.invoke('desktop:get-linkedin-profile-path'),
  clearLinkedInSession: () =>
    ipcRenderer.invoke('desktop:clear-linkedin-session'),
  onStartupProgress: (callback: (stage: string) => void) => {
    ipcRenderer.on('desktop:startup-progress', (_event, stage: string) =>
      callback(stage),
    );
  },
  onStartupFailure: (callback: (payload: Record<string, string>) => void) => {
    ipcRenderer.on(
      'desktop:startup-failure',
      (_event, payload: Record<string, string>) => callback(payload),
    );
  },
});
