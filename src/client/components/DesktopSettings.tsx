import { useEffect, useRef, useState } from 'react';

import { desktopBridge, type DesktopRuntimeInfo } from '../desktop.js';

export function DesktopSettings() {
  const bridge = desktopBridge();
  const [info, setInfo] = useState<DesktopRuntimeInfo | null>(null);
  const [message, setMessage] = useState('');
  const [closeToTray, setCloseToTray] = useState<boolean | null>(null);
  // Serializes overlapping setCloseToTray calls so a second toggle
  // does not race the first; the previous-value snapshot is captured at
  // request time so a failure rolls back to what the user actually saw.
  const pendingRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (bridge !== null) {
      void bridge.getRuntimeInfo().then(setInfo);
      void bridge
        .getCloseToTray()
        .then((value) => setCloseToTray(value.closeToTray));
    }
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
        <label className="desktop-toggle">
          <input
            type="checkbox"
            checked={closeToTray === true}
            disabled={closeToTray === null}
            onChange={(event) => {
              const next = event.target.checked;
              const previous = closeToTray;
              setCloseToTray(next);
              pendingRef.current = previous;
              void bridge
                .setCloseToTray(next)
                .then((value) => {
                  pendingRef.current = null;
                  setCloseToTray(value.closeToTray);
                  setMessage(
                    next
                      ? 'Closing the window will keep Job Browser running in the system tray.'
                      : 'Closing the window will exit Job Browser.',
                  );
                })
                .catch((error: unknown) => {
                  pendingRef.current = null;
                  // Roll back to the actual previous value, not a flipped
                  // boolean — if a concurrent toggle already updated the
                  // server, the backend response is the source of truth.
                  const rollback = previous ?? !next;
                  setCloseToTray(rollback);
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : 'Could not save the background-mode preference.',
                  );
                });
            }}
          />
          <span>
            Continue running in the background when the window is closed
          </span>
        </label>
        <p className="desktop-hint">
          When this is on, closing the window hides Job Browser in the system
          tray so scheduled discovery keeps running. Open the tray icon, or use
          the <em>Open Job Browser</em> / <em>Exit Job Browser</em> menu
          entries, to manage it. When it is off, closing the window exits the
          application.
        </p>
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
