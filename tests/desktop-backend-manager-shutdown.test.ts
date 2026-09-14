import { describe, expect, it, vi } from 'vitest';

import { BackendManager } from '../src/desktop/backendManager.js';

interface StubHandle {
  stopCalls: number;
  stop(): Promise<void>;
}

function makeStubHandle(
  behavior: () => Promise<void> = () => Promise.resolve(),
): {
  handle: StubHandle;
  stopSpy: ReturnType<typeof vi.fn>;
} {
  const stopSpy = vi.fn(behavior);
  const handle: StubHandle = {
    stopCalls: 0,
    stop: () => {
      handle.stopCalls += 1;
      return stopSpy();
    },
  };
  return { handle, stopSpy };
}

function attachStubHandle(
  manager: BackendManager,
  initial: StubHandle,
): { isCleared: () => boolean; setCleared: (value: boolean) => void } {
  let cleared = false;
  Object.defineProperty(manager, 'handle', {
    configurable: true,
    get: () => (cleared ? null : initial),
    set: () => {
      cleared = true;
    },
  });
  return {
    isCleared: () => cleared,
    setCleared: (value: boolean) => {
      cleared = value;
    },
  };
}

describe('BackendManager shutdown coordination', () => {
  it('reports currentShutdown only while a shutdown is in flight', async () => {
    const manager = new BackendManager();
    const { handle, stopSpy } = makeStubHandle(async () => {
      // Yield once so the test can observe currentShutdown !== null.
      await new Promise((accept) => setImmediate(accept));
    });
    attachStubHandle(manager, handle);
    expect(manager.currentShutdown).toBeNull();
    const first = manager.stop();
    expect(manager.currentShutdown).not.toBeNull();
    await first;
    expect(manager.currentShutdown).toBeNull();
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('serializes a second stop() against the in-flight shutdown', async () => {
    const manager = new BackendManager();
    const { handle, stopSpy } = makeStubHandle(async () => {
      // Long enough that a second stop() lands while this is running.
      await new Promise((accept) => setTimeout(accept, 30));
    });
    attachStubHandle(manager, handle);
    const first = manager.stop();
    const second = manager.stop();
    await Promise.all([first, second]);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('clears the handle before awaiting so other code sees "no backend" during cleanup', async () => {
    const manager = new BackendManager();
    let handleSeenDuringStop: unknown = null;
    const { handle } = makeStubHandle(() => {
      // While stop() is awaiting, manager.current must be null.
      handleSeenDuringStop = manager.current;
      return Promise.resolve();
    });
    attachStubHandle(manager, handle);
    await manager.stop();
    expect(handleSeenDuringStop).toBeNull();
    expect(manager.current).toBeNull();
  });

  it('clears the in-flight slot on a failed first attempt', async () => {
    const manager = new BackendManager();
    const { handle, stopSpy } = makeStubHandle(() =>
      Promise.reject(new Error('transient')),
    );
    attachStubHandle(manager, handle);
    await expect(manager.stop()).rejects.toThrow('transient');
    // The shutdown promise slot must be cleared so a future caller does
    // not hang on a rejected promise that is no longer being awaited.
    expect(manager.currentShutdown).toBeNull();
    // The handle is also cleared (it was consumed by the failed attempt),
    // so a second stop() becomes a no-op rather than re-running cleanup.
    await manager.stop();
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});
