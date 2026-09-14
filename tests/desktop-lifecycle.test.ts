import { describe, expect, it } from 'vitest';

import {
  closeAction,
  pauseMenuItemLabel,
  trayLabel,
  type CloseAction,
  type TrayLabelState,
} from '../src/desktop/desktopLifecycle.js';

describe('desktop lifecycle helpers', () => {
  describe('closeAction', () => {
    it('returns "close" when the application is quitting (tray Exit, Windows shutdown)', () => {
      expect(
        closeAction({ closeToTray: true, quitRequested: true }),
      ).toBe<CloseAction>('close');
      expect(
        closeAction({ closeToTray: false, quitRequested: true }),
      ).toBe<CloseAction>('close');
    });

    it('returns "hide" when close-to-tray is on and the tray is available', () => {
      expect(
        closeAction({
          closeToTray: true,
          quitRequested: false,
          trayAvailable: true,
        }),
      ).toBe<CloseAction>('hide');
    });

    it('returns "close" when close-to-tray is on but the tray was never created (startup-failure fallback)', () => {
      expect(
        closeAction({
          closeToTray: true,
          quitRequested: false,
          trayAvailable: false,
        }),
      ).toBe<CloseAction>('close');
    });

    it('returns "close" when close-to-tray is off, preserving prior behavior', () => {
      expect(
        closeAction({ closeToTray: false, quitRequested: false }),
      ).toBe<CloseAction>('close');
    });
  });

  describe('trayLabel', () => {
    const baseRunning: TrayLabelState = {
      backendRunning: true,
      paused: false,
      attentionSources: 0,
      startupComplete: true,
    };

    it('reports startup incomplete when the backend never finished starting', () => {
      expect(
        trayLabel({
          ...baseRunning,
          backendRunning: false,
          startupComplete: false,
        }),
      ).toBe('Job Browser (startup incomplete)');
    });

    it('reports the backend as stopped once startup completed but the handle is gone', () => {
      expect(
        trayLabel({
          ...baseRunning,
          backendRunning: false,
          startupComplete: true,
        }),
      ).toBe('Job Browser (stopped)');
    });

    it('reports discovery paused', () => {
      expect(trayLabel({ ...baseRunning, paused: true })).toBe(
        'Job Browser (discovery paused)',
      );
    });

    it('uses singular wording for a single attention-required source', () => {
      expect(trayLabel({ ...baseRunning, attentionSources: 1 })).toBe(
        'Job Browser — 1 source needs attention',
      );
    });

    it('uses plural wording for multiple attention-required sources', () => {
      expect(trayLabel({ ...baseRunning, attentionSources: 3 })).toBe(
        'Job Browser — 3 sources need attention',
      );
    });

    it('reports discovery running when no attention is required', () => {
      expect(trayLabel(baseRunning)).toBe('Job Browser (discovery running)');
    });
  });

  describe('pauseMenuItemLabel', () => {
    it('reads "Pause Discovery" when discovery is currently running', () => {
      expect(pauseMenuItemLabel(false)).toBe('Pause Discovery');
    });

    it('reads "Resume Discovery" when discovery is currently paused', () => {
      expect(pauseMenuItemLabel(true)).toBe('Resume Discovery');
    });
  });
});
