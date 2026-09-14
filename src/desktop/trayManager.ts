import { Tray, Menu, type MenuItemConstructorOptions } from 'electron';

import {
  pauseMenuItemLabel,
  trayLabel,
  type TrayLabelState,
} from './desktopLifecycle.js';

export interface TraySummary {
  schedulerEnabled: boolean;
  running: boolean;
  attentionSources: number;
  startupComplete: boolean;
}

export interface TrayActions {
  openDashboard(): void;
  togglePause(): Promise<void>;
  exit(): void;
  refreshSummary(): Promise<TraySummary>;
}

export interface TrayManagerOptions {
  iconPath: string;
  actions: TrayActions;
  getSummary: () => Promise<TraySummary>;
}

/**
 * Wraps Electron's `Tray` so the rest of the desktop main process can stay
 * unaware of Electron's tray/menu APIs. The manager is created unconditionally
 * after the window so a startup failure still leaves an Exit path; the
 * tooltip and pause label reflect the latest summary from `getSummary`.
 */
export class TrayManager {
  private tray: Tray | null = null;
  private destroying = false;
  private cachedSummary: TraySummary = {
    schedulerEnabled: true,
    running: false,
    attentionSources: 0,
    startupComplete: false,
  };

  public constructor(private readonly options: TrayManagerOptions) {}

  public async create(): Promise<void> {
    this.cachedSummary = await this.options.getSummary();
    const tray = new Tray(this.options.iconPath);
    tray.setToolTip(trayLabel(this.toLabelState(this.cachedSummary)));
    tray.on('click', () => this.options.actions.openDashboard());
    // Assign `tray` before installing the menu so the menu's `click` handlers
    // can rely on `this.tray` being set, and so a failure while building the
    // menu below can be cleaned up by destroy() without an unset state.
    this.tray = tray;
    try {
      this.refreshMenu();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  public async refresh(): Promise<void> {
    if (this.tray === null) return;
    // An in-flight refresh may resolve after destroy() (e.g. the
    // getSummary() promise resolving post-quit). Guard so we do not call
    // into a destroyed tray.
    this.cachedSummary = await this.options.getSummary();
    if (this.destroying) return;
    // TypeScript cannot prove destroy() didn't run during the await,
    // so guard at runtime even though the lint rule considers the
    // null check redundant against the early return above.
    const tray = this.tray as Tray | null;
    if (tray === null) {
      return;
    }
    tray.setToolTip(trayLabel(this.toLabelState(this.cachedSummary)));
    this.refreshMenu();
  }

  public async togglePause(): Promise<void> {
    await this.options.actions.togglePause();
    await this.refresh();
  }

  public destroy(): void {
    this.destroying = true;
    try {
      this.tray?.destroy();
    } catch {
      // Tray destroy can throw if the underlying icon was already released
      // (e.g. on Windows when the display server is gone). Swallow: the
      // destroy call is best-effort and the OS will reclaim the resource.
    }
    this.tray = null;
  }

  public get isCreated(): boolean {
    return this.tray !== null && !this.destroying;
  }

  private toLabelState(summary: TraySummary): TrayLabelState {
    return {
      backendRunning: summary.running || summary.startupComplete,
      paused: !summary.schedulerEnabled,
      attentionSources: summary.attentionSources,
      startupComplete: summary.startupComplete,
    };
  }

  private refreshMenu(): void {
    if (this.tray === null) return;
    const items: MenuItemConstructorOptions[] = [
      {
        label: 'Open Job Browser',
        click: () => this.options.actions.openDashboard(),
      },
      { type: 'separator' },
      {
        label: pauseMenuItemLabel(!this.cachedSummary.schedulerEnabled),
        click: () => {
          void this.togglePause();
        },
      },
    ];
    if (this.cachedSummary.attentionSources > 0) {
      const noun =
        this.cachedSummary.attentionSources === 1
          ? 'source needs'
          : 'sources need';
      items.push({ type: 'separator' });
      items.push({
        label: `${String(this.cachedSummary.attentionSources)} ${noun} attention`,
        enabled: false,
      });
    }
    if (!this.cachedSummary.startupComplete) {
      items.push({ type: 'separator' });
      items.push({ label: 'Startup incomplete', enabled: false });
    }
    items.push({ type: 'separator' });
    items.push({
      label: 'Exit Job Browser',
      click: () => this.options.actions.exit(),
    });
    const menu = Menu.buildFromTemplate(items);
    if (process.platform !== 'darwin') {
      this.tray.setContextMenu(menu);
    }
  }
}
