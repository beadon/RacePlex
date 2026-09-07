import { describe, it, expect } from 'vitest';
import { detectDeviceModel } from './deviceInfo';

function navWith(userAgentData: unknown): Navigator {
  return { userAgentData } as unknown as Navigator;
}

describe('detectDeviceModel', () => {
  it('returns the model when userAgentData reports one', async () => {
    const nav = navWith({
      getHighEntropyValues: async () => ({ model: 'Pixel 8 Pro' }),
    });
    expect(await detectDeviceModel(nav)).toBe('Pixel 8 Pro');
  });

  it('returns null when userAgentData is unavailable (Safari, Firefox, desktop Chrome)', async () => {
    expect(await detectDeviceModel(navWith(undefined))).toBeNull();
  });

  it('returns null when the model hint is empty', async () => {
    const nav = navWith({ getHighEntropyValues: async () => ({ model: '' }) });
    expect(await detectDeviceModel(nav)).toBeNull();
  });

  it('returns null instead of throwing when getHighEntropyValues rejects', async () => {
    const nav = navWith({
      getHighEntropyValues: async () => {
        throw new Error('denied');
      },
    });
    expect(await detectDeviceModel(nav)).toBeNull();
  });
});
