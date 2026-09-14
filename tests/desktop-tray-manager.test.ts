import { beforeEach, describe, expect, it, vi } from 'vitest';

interface TrayRecord {
  setToolTipCalls: string[];
  destroyCalls: number;
  setContextMenuCalls: number;
}

let record: TrayRecord;
let menuThrows = false;

beforeEach(() => {
  vi.resetModules();
  record = {
    setToolTipCalls: [],
    destroyCalls: 0,
    setContextMenuCalls: 0,
  };
  menuThrows = false;
  class MockTray {
    public setToolTip(text: string): void {
      record.setToolTipCalls.push(text);
    }
    public setContextMenu(): void {
      record.setContextMenuCalls += 1;
    }
    public destroy(): void {
      record.destroyCalls += 1;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public on(_event: string, _handler: () => void): void {
      // no-op
    }
  }
  vi.doMock('electron', () => ({
    Tray: MockTray,
    Menu: {
      buildFromTemplate: () => {
        if (menuThrows) {
          throw new Error('menu construction failed');
        }
        return { fake: true };
      },
    },
  }));
});

describe('TrayManager refresh-after-destroy', () => {
  it('guards refresh() against running after destroy()', async () => {
    const { TrayManager } = await import('../src/desktop/trayManager.js');
    let summaryCalls = 0;
    const manager = new TrayManager({
      iconPath: '/tmp/icon.png',
      actions: {
        openDashboard: () => undefined,
        togglePause: () => Promise.resolve(),
        exit: () => undefined,
        refreshSummary: () => {
          summaryCalls += 1;
          return Promise.resolve({
            schedulerEnabled: true,
            running: false,
            attentionSources: 0,
            startupComplete: false,
          });
        },
      },
      getSummary: () => {
        summaryCalls += 1;
        return Promise.resolve({
          schedulerEnabled: true,
          running: false,
          attentionSources: 0,
          startupComplete: false,
        });
      },
    });

    await manager.create();
    const initialTooltipCalls = record.setToolTipCalls.length;
    const initialMenuCalls = record.setContextMenuCalls;
    const initialSummaryCalls = summaryCalls;
    expect(initialTooltipCalls).toBeGreaterThan(0);
    expect(initialMenuCalls).toBeGreaterThan(0);

    manager.destroy();
    expect(record.destroyCalls).toBe(1);
    expect(manager.isCreated).toBe(false);

    await manager.refresh();
    expect(summaryCalls).toBe(initialSummaryCalls);
    expect(record.setToolTipCalls.length).toBe(initialTooltipCalls);
    expect(record.setContextMenuCalls).toBe(initialMenuCalls);
  });

  it('cleans up partially-created state if menu construction throws', async () => {
    menuThrows = true;
    const { TrayManager } = await import('../src/desktop/trayManager.js');
    const manager = new TrayManager({
      iconPath: '/tmp/icon.png',
      actions: {
        openDashboard: () => undefined,
        togglePause: () => Promise.resolve(),
        exit: () => undefined,
        refreshSummary: () =>
          Promise.resolve({
            schedulerEnabled: true,
            running: false,
            attentionSources: 0,
            startupComplete: false,
          }),
      },
      getSummary: () =>
        Promise.resolve({
          schedulerEnabled: true,
          running: false,
          attentionSources: 0,
          startupComplete: false,
        }),
    });
    await expect(manager.create()).rejects.toThrow('menu construction failed');
    expect(record.destroyCalls).toBe(1);
    expect(manager.isCreated).toBe(false);
  });
});
