import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetAsyncSnapshotRegistry,
  __storeSubscribe,
  __storeGetSnapshot,
  __storeRefresh,
  __storeInvalidate,
} from './useAsyncSnapshot';

// Tests target the module-level store cache — the surface useAsyncSnapshot
// wraps with useSyncExternalStore. The React binding itself is a canonical
// two-line call and doesn't need its own test (the React docs already cover
// it; testing it would require @testing-library/react as a new dev dep for
// no meaningful coverage).

afterEach(() => {
  __resetAsyncSnapshotRegistry();
});

// Small helper: flush all microtasks so async load promises settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useAsyncSnapshot cache', () => {
  it('starts at the initial value and populates when load() resolves', async () => {
    const load = vi.fn(() => Promise.resolve([1, 2, 3]));
    const onChange = vi.fn();

    __storeSubscribe('test:initial', [] as number[], load, onChange);

    // Snapshot is the initial value immediately after subscribe.
    expect(__storeGetSnapshot<number[]>('test:initial')).toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);

    await flush();

    expect(__storeGetSnapshot<number[]>('test:initial')).toEqual([1, 2, 3]);
    // The listener is called once when the load resolves.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('shares one cache between subscribers with the same key', async () => {
    const load = vi.fn(() => Promise.resolve(['x']));
    const onA = vi.fn();
    const onB = vi.fn();

    __storeSubscribe('test:share', [] as string[], load, onA);
    __storeSubscribe('test:share', [] as string[], load, onB);

    await flush();

    expect(__storeGetSnapshot<string[]>('test:share')).toEqual(['x']);
    // Both listeners get notified once when the shared load resolves.
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).toHaveBeenCalledTimes(1);
    // The load runs exactly once, not once per subscriber.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe removes only that listener; others keep receiving updates', async () => {
    const load = vi.fn(() => Promise.resolve('v1'));
    const onA = vi.fn();
    const onB = vi.fn();

    const unsubA = __storeSubscribe('test:unsub', 'init', load, onA);
    __storeSubscribe('test:unsub', 'init', load, onB);
    await flush();
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).toHaveBeenCalledTimes(1);

    unsubA();
    await __storeRefresh('test:unsub', () => Promise.resolve('v2'));

    expect(onA).toHaveBeenCalledTimes(1); // gone after unsub
    expect(onB).toHaveBeenCalledTimes(2); // still receives
    expect(__storeGetSnapshot('test:unsub')).toBe('v2');
  });

  it('refresh() runs load() again and notifies subscribers', async () => {
    let n = 0;
    const load = vi.fn(() => Promise.resolve(++n));
    const onChange = vi.fn();

    __storeSubscribe('test:refresh', 0, load, onChange);
    await flush();
    expect(__storeGetSnapshot<number>('test:refresh')).toBe(1);

    await __storeRefresh('test:refresh', load);

    expect(__storeGetSnapshot<number>('test:refresh')).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('external invalidation triggers a refetch (simulating garageEvents)', async () => {
    let n = 0;
    const load = vi.fn(() => Promise.resolve(++n));
    const onChange = vi.fn();

    __storeSubscribe('test:invalidate', 0, load, onChange);
    await flush();
    expect(__storeGetSnapshot<number>('test:invalidate')).toBe(1);

    __storeInvalidate('test:invalidate', load);
    await flush();

    expect(__storeGetSnapshot<number>('test:invalidate')).toBe(2);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does not re-run load() while an initial load is still in flight', async () => {
    let resolve!: (v: number) => void;
    const load = vi.fn(
      () =>
        new Promise<number>((r) => {
          resolve = r;
        }),
    );
    const onA = vi.fn();
    const onB = vi.fn();

    __storeSubscribe('test:inflight', 0, load, onA);
    __storeSubscribe('test:inflight', 0, load, onB);

    // While the first load is pending, load() must not be called again.
    expect(load).toHaveBeenCalledTimes(1);

    resolve(42);
    await flush();

    expect(__storeGetSnapshot<number>('test:inflight')).toBe(42);
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).toHaveBeenCalledTimes(1);
  });

  it('load() rejection leaves the cache at its initial value and logs', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi.fn(() => Promise.reject(new Error('boom')));
    const onChange = vi.fn();

    __storeSubscribe('test:reject', 'idle', load, onChange);
    await flush();

    expect(__storeGetSnapshot('test:reject')).toBe('idle');
    expect(errorSpy).toHaveBeenCalled();
    // Listener should NOT fire — nothing usable changed.
    expect(onChange).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('a listener throwing does not stop the others from being called', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi.fn(() => Promise.resolve('ok'));
    const bad = vi.fn(() => {
      throw new Error('nope');
    });
    const good = vi.fn();

    __storeSubscribe('test:throw', 'init', load, bad);
    __storeSubscribe('test:throw', 'init', load, good);
    await flush();

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
