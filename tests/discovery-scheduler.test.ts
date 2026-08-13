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

  it('runs one bounded Employer batch only when six-hour eligibility is due', async () => {
    const employerDiscovery = { runEligible: vi.fn().mockResolvedValue({}) };
    const sources = {
      getSchedulerEnabled: () => true,
      listDue: () => [],
      getEmployerDiscoverySettings: () => ({
        enabled: true,
        lastEvaluatedAt: '2026-01-01T00:00:00.000Z',
      }),
      markEmployerDiscoveryEvaluated: vi.fn(),
    };
    const scheduler = new DiscoveryScheduler(
      sources as never,
      { runSource: vi.fn(), stop: vi.fn() } as never,
      1000,
      employerDiscovery as never,
      () => new Date('2026-01-01T06:00:00.000Z'),
    );

    await scheduler.evaluate();
    expect(sources.markEmployerDiscoveryEvaluated).toHaveBeenCalledWith(
      '2026-01-01T06:00:00.000Z',
    );
    expect(employerDiscovery.runEligible).toHaveBeenCalledWith(25);
  });

  it('does not duplicate overlapping Employer scheduler evaluations', async () => {
    let resolveRun: (() => void) | undefined;
    const running = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    const employerDiscovery = { runEligible: vi.fn().mockReturnValue(running) };
    let lastEvaluatedAt: string | null = '2026-01-01T00:00:00.000Z';
    const sources = {
      getSchedulerEnabled: () => true,
      listDue: () => [],
      getEmployerDiscoverySettings: () => ({ enabled: true, lastEvaluatedAt }),
      markEmployerDiscoveryEvaluated: vi.fn((at: string) => {
        lastEvaluatedAt = at;
      }),
    };
    const scheduler = new DiscoveryScheduler(
      sources as never,
      { runSource: vi.fn(), stop: vi.fn() } as never,
      1000,
      employerDiscovery as never,
      () => new Date('2026-01-01T06:00:00.000Z'),
    );
    const first = scheduler.evaluate();
    const second = scheduler.evaluate();
    expect(employerDiscovery.runEligible).toHaveBeenCalledTimes(1);
    resolveRun?.();
    await Promise.all([first, second]);
  });

  it('advances Employer scheduling at startup without catch-up execution', () => {
    const employerDiscovery = { runEligible: vi.fn() };
    const sources = {
      listDue: () => [],
      getEmployerDiscoverySettings: () => ({
        enabled: true,
        lastEvaluatedAt: null,
      }),
      markEmployerDiscoveryEvaluated: vi.fn(),
    };
    const scheduler = new DiscoveryScheduler(
      sources as never,
      { stop: vi.fn() } as never,
      60_000,
      employerDiscovery as never,
      () => new Date('2026-01-01T00:00:00.000Z'),
    );

    scheduler.start();
    expect(sources.markEmployerDiscoveryEvaluated).toHaveBeenCalledWith(
      '2026-01-01T00:00:00.000Z',
    );
    expect(employerDiscovery.runEligible).not.toHaveBeenCalled();
    void scheduler.stop();
  });

  it('runs bounded health checks without startup catch-up or overlap', async () => {
    const health = { runEligible: vi.fn().mockResolvedValue({ checked: 1 }) };
    const sources = {
      getSchedulerEnabled: () => true,
      listDue: () => [],
    };
    const scheduler = new DiscoveryScheduler(
      sources as never,
      { runSource: vi.fn(), stop: vi.fn() } as never,
      1000,
      undefined,
      () => new Date('2026-01-01T00:00:00.000Z'),
      health as never,
    );
    await scheduler.evaluate();
    expect(health.runEligible).toHaveBeenCalledTimes(1);
    expect(health.runEligible).toHaveBeenCalledWith(25);
  });

  it('does not catch up overdue health checks immediately after startup', async () => {
    const health = { runEligible: vi.fn().mockResolvedValue({ checked: 1 }) };
    let now = new Date('2026-01-01T00:00:00.000Z');
    const sources = {
      getSchedulerEnabled: () => true,
      listDue: () => [],
      getEmployerDiscoverySettings: () => ({
        enabled: false,
        lastEvaluatedAt: null,
      }),
    };
    const scheduler = new DiscoveryScheduler(
      sources as never,
      { runSource: vi.fn(), stop: vi.fn() } as never,
      60_000,
      undefined,
      () => now,
      health as never,
    );
    scheduler.start();
    await scheduler.evaluate();
    expect(health.runEligible).not.toHaveBeenCalled();
    now = new Date('2026-01-02T00:00:00.000Z');
    await scheduler.evaluate();
    expect(health.runEligible).toHaveBeenCalledWith(25);
    await scheduler.stop();
  });
});
