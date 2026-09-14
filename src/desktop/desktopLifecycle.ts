/**
 * Pure, Electron-free helpers for the desktop lifecycle (tray, close-to-tray,
 * pause/resume, exit). Keeping these as plain functions lets us exercise the
 * decisions in the Node test environment without spinning up an Electron
 * process or mocking the `electron` module.
 */

export type CloseAction = 'close' | 'hide';

export interface CloseDecision {
  closeToTray: boolean;
  quitRequested: boolean;
  /**
   * Whether the tray is currently available. When `closeToTray` is on but
   * the tray was never created (e.g. startup failure left the desktop
   * running with no Exit path), the window must still close so the user
   * is not trapped behind a hidden window.
   */
  trayAvailable?: boolean;
}

/**
 * Decides what a window-close attempt should do.
 *
 * - `quitRequested` always wins (tray Exit, `app.quit()`, Windows shutdown):
 *   the window must actually close.
 * - Otherwise, when `closeToTray` is on AND the tray is available, the
 *   close is intercepted and the window is hidden so the backend,
 *   scheduler, and tray remain available.
 * - When `closeToTray` is off, OR the tray is unavailable, the existing
 *   close-and-quit behavior is preserved so an accessible exit path
 *   always exists.
 */
export function closeAction(decision: CloseDecision): CloseAction {
  if (decision.quitRequested) return 'close';
  if (decision.closeToTray && decision.trayAvailable === true) return 'hide';
  return 'close';
}

export interface TrayLabelState {
  backendRunning: boolean;
  paused: boolean;
  attentionSources: number;
  startupComplete: boolean;
}

/**
 * Builds the tray tooltip. Stays short enough for a Windows tray balloon and
 * never lies about runtime state: if the backend never finished starting up
 * the label says so, so a user can still find the Exit entry.
 */
export function trayLabel(state: TrayLabelState): string {
  if (!state.startupComplete) return 'Job Browser (startup incomplete)';
  if (!state.backendRunning) return 'Job Browser (stopped)';
  if (state.paused) return 'Job Browser (discovery paused)';
  if (state.attentionSources > 0) {
    const noun = state.attentionSources === 1 ? 'source needs' : 'sources need';
    return `Job Browser — ${String(state.attentionSources)} ${noun} attention`;
  }
  return 'Job Browser (discovery running)';
}

export function pauseMenuItemLabel(paused: boolean): string {
  return paused ? 'Resume Discovery' : 'Pause Discovery';
}
