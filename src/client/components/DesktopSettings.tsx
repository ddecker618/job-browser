import { useEffect, useState } from 'react';

import { desktopBridge, type DesktopRuntimeInfo } from '../desktop.js';

export function DesktopSettings() {
  const bridge = desktopBridge();
  const [info, setInfo] = useState<DesktopRuntimeInfo | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (bridge !== null) void bridge.getRuntimeInfo().then(setInfo);
  }, [bridge]);
  if (bridge === null) {
    return (
      <section className="form-panel desktop-settings">
        <div className="section-heading">
          <span>03</span>
          <div>
            <h3>Desktop application</h3>
            <p>
              Desktop directory and backup actions are available in the
              installed application.
            </p>
          </div>
        </div>
        <div className="desktop-runtime">
          <strong>Web mode</strong>
          <span>Run Electron to access desktop controls.</span>
        </div>
      </section>
    );
  }
  return (
    <section className="form-panel desktop-settings">
      <div className="section-heading">
        <span>03</span>
        <div>
          <h3>Desktop application</h3>
          <p>Runtime health, data locations, backup, and recovery actions.</p>
        </div>
      </div>
      <div>
        {info === null ? (
          <p>Loading desktop information…</p>
        ) : (
          <dl className="desktop-info">
            <div>
              <dt>Version</dt>
              <dd>{info.version}</dd>
            </div>
            <div>
              <dt>Backend</dt>
              <dd>
                {info.backendStatus} · {info.backendUrl ?? 'Not started'}
              </dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>{info.databasePath}</dd>
            </div>
            <div>
              <dt>Resumes</dt>
              <dd>{info.resumeDirectory}</dd>
            </div>
            <div>
              <dt>Logs</dt>
              <dd>{info.logDirectory}</dd>
            </div>
            <div>
              <dt>Backups</dt>
              <dd>{info.backupDirectory}</dd>
            </div>
          </dl>
        )}
        <div className="card-actions">
          <button type="button" onClick={() => void bridge.openDataFolder()}>
            Open Data Folder
          </button>
          <button type="button" onClick={() => void bridge.openLogsFolder()}>
            Open Logs Folder
          </button>
          <button
            type="button"
            onClick={() =>
              void bridge
                .copyDiagnostics()
                .then(() => setMessage('Diagnostic information copied.'))
            }
          >
            Copy Diagnostics
          </button>
          <button
            type="button"
            onClick={() =>
              void bridge
                .createBackup()
                .then((path) => setMessage(`Backup created: ${path}`))
                .catch((error: unknown) =>
                  setMessage(
                    error instanceof Error ? error.message : String(error),
                  ),
                )
            }
          >
            Create Backup
          </button>
          <button type="button" onClick={() => void bridge.restart()}>
            Restart Application
          </button>
        </div>
        {message ? (
          <p className="desktop-message" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
