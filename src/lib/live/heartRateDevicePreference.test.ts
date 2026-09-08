import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLastHeartRateDeviceName, setLastHeartRateDeviceName } from './heartRateDevicePreference';

/** Vitest runs in `node`, which has no localStorage. */
function installMemoryLocalStorage(): void {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  });
}

beforeEach(() => {
  installMemoryLocalStorage();
});

describe('heartRateDevicePreference', () => {
  it('returns null when nothing has been saved yet', () => {
    expect(getLastHeartRateDeviceName()).toBeNull();
  });

  it('remembers the last device name set', () => {
    setLastHeartRateDeviceName('Polar H10 ABC123');
    expect(getLastHeartRateDeviceName()).toBe('Polar H10 ABC123');
  });

  it('overwrites the remembered name on a later save', () => {
    setLastHeartRateDeviceName('Polar H10 ABC123');
    setLastHeartRateDeviceName('Wahoo TICKR X');
    expect(getLastHeartRateDeviceName()).toBe('Wahoo TICKR X');
  });

  it('fails closed (returns null / no throw) when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(() => setLastHeartRateDeviceName('X')).not.toThrow();
    expect(getLastHeartRateDeviceName()).toBeNull();
  });
});
