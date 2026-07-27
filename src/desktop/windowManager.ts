import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { BrowserWindow, screen, shell } from 'electron';

import { classifyNavigation } from './navigation.js';

interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

export class WindowManager {
  public window: BrowserWindow | null = null;
  private applicationOrigin = '';

  public create(options: {
    preload: string;
    startupHtml: string;
    icon: string;
    windowState: string;
    development: boolean;
  }): BrowserWindow {
    const bounds = loadBounds(options.windowState);
    const validated = validateBounds(bounds);
    const window = new BrowserWindow({
      title: 'Job Browser',
      width: validated.width,
      height: validated.height,
      ...(validated.x === undefined ? {} : { x: validated.x }),
      ...(validated.y === undefined ? {} : { y: validated.y }),
      minWidth: 1100,
      minHeight: 700,
      show: false,
      backgroundColor: '#090d12',
      ...(existsSync(options.icon) ? { icon: options.icon } : {}),
      autoHideMenuBar: true,
      webPreferences: {
        preload: options.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: options.development,
      },
    });
    this.window = window;
    window.setMenuBarVisibility(false);
    if (bounds.maximized === true) window.maximize();
    window.once('ready-to-show', () => window.show());
    window.on('close', () => saveBounds(window, options.windowState));
    window.webContents.setWindowOpenHandler(({ url }) => {
      const decision = classifyNavigation(url, this.applicationOrigin);
      if (decision.action === 'external') void shell.openExternal(decision.url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      const decision = classifyNavigation(url, this.applicationOrigin);
      if (decision.action === 'allow') return;
      event.preventDefault();
      if (decision.action === 'external') void shell.openExternal(decision.url);
    });
    void window.loadFile(options.startupHtml);
    return window;
  }

  public sendProgress(stage: string): void {
    this.window?.webContents.send('desktop:startup-progress', stage);
  }

  public sendFailure(payload: Record<string, string>): void {
    this.window?.webContents.send('desktop:startup-failure', payload);
  }

  public async loadDashboard(url: string): Promise<void> {
    this.applicationOrigin = new URL(url).origin;
    await this.window?.loadURL(url);
  }

  public focus(): void {
    if (this.window === null) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }
}

export function validateBounds(bounds: WindowBounds): WindowBounds {
  const displays = screen.getAllDisplays();
  const width = Math.max(1100, bounds.width || 1440);
  const height = Math.max(700, bounds.height || 900);
  if (bounds.x === undefined || bounds.y === undefined)
    return { width, height };
  const visible = displays.some((display) => {
    const area = display.workArea;
    return (
      bounds.x !== undefined &&
      bounds.y !== undefined &&
      bounds.x < area.x + area.width - 100 &&
      bounds.y < area.y + area.height - 100 &&
      bounds.x + 100 > area.x &&
      bounds.y + 100 > area.y
    );
  });
  return visible ? { ...bounds, width, height } : { width, height };
}

function loadBounds(path: string): WindowBounds {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as WindowBounds;
  } catch {
    return { width: 1440, height: 900 };
  }
}

function saveBounds(window: BrowserWindow, path: string): void {
  const bounds = window.getBounds();
  writeFileSync(
    path,
    `${JSON.stringify({ ...bounds, maximized: window.isMaximized() }, null, 2)}\n`,
    'utf8',
  );
}
