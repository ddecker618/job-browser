import { describe, expect, it, vi } from 'vitest';

import { DiscoveryScheduler } from '../src/discovery/discoveryScheduler.js';

describe('discovery scheduler', () => {
  it('runs due sources sequentially when globally enabled', async () => {
    const calls: string[] = [];
    const sources = {
      getSchedulerEnabled: () => true,
      listDue: () => [{ id: 'one' }, { id: 'two' }],
      updateScheduleAfterRun: vi.fn(),
    };
    const coordinator = {
      runSource: (id: string) => {
        calls.push(id);
        return Promise.resolve([]);
      },
      stop: vi.fn(),
    };
    const scheduler = new DiscoveryScheduler(
      sources as never,
      coordinator as never,
      1000,
    );
    await scheduler.evaluate();
    expect(calls).toEqual(['one', 'two']);
  });

  it('does nothing when scheduled discovery is globally disabled', async () => {
    const coordinator = { runSource: vi.fn(), stop: vi.fn() };
    const scheduler = new DiscoveryScheduler(
      { getSchedulerEnabled: () => false, listDue: () => [] } as never,
      coordinator as never,
    );
    await scheduler.evaluate();
    expect(coordinator.runSource).not.toHaveBeenCalled();
  });
});
