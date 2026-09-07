import { describe, it, expect, vi } from 'vitest';
import { shouldReloadForStaleChunk, clearStaleChunkReloadGuard } from './staleChunkRecovery';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe('shouldReloadForStaleChunk', () => {
  it('allows a reload the first time this session', () => {
    expect(shouldReloadForStaleChunk(fakeStorage())).toBe(true);
  });

  it('refuses a second reload in the same session (would loop)', () => {
    const storage = fakeStorage();
    expect(shouldReloadForStaleChunk(storage)).toBe(true);
    expect(shouldReloadForStaleChunk(storage)).toBe(false);
  });

  it('allows a reload again after the guard is cleared (a later deploy is also stale)', () => {
    const storage = fakeStorage();
    expect(shouldReloadForStaleChunk(storage)).toBe(true);
    clearStaleChunkReloadGuard(storage);
    expect(shouldReloadForStaleChunk(storage)).toBe(true);
  });

  it('still allows a reload when storage throws (private browsing)', () => {
    const throwing: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => {
        throw new Error('disabled');
      },
      setItem: () => {
        throw new Error('disabled');
      },
    };
    expect(shouldReloadForStaleChunk(throwing)).toBe(true);
  });
});

describe('clearStaleChunkReloadGuard', () => {
  it('does not throw when storage throws', () => {
    const throwing: Pick<Storage, 'removeItem'> = {
      removeItem: () => {
        throw new Error('disabled');
      },
    };
    expect(() => clearStaleChunkReloadGuard(throwing)).not.toThrow();
  });

  it('is a no-op on already-clear storage', () => {
    const storage = fakeStorage();
    const spy = vi.spyOn(storage, 'removeItem');
    clearStaleChunkReloadGuard(storage);
    expect(spy).toHaveBeenCalledWith('raceplex:reloadedForStaleChunk');
  });
});
