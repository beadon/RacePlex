import { describe, it, expect } from 'vitest';
import { withTimeout } from './bleUtils';

describe('withTimeout', () => {
  it('resolves with the promise value when it settles before the timeout', async () => {
    const result = await withTimeout(Promise.resolve('done'), 1000);
    expect(result).toBe('done');
  });

  it('resolves to undefined when the promise never settles within the timeout', async () => {
    const neverSettles = new Promise<string>(() => {});
    const result = await withTimeout(neverSettles, 10);
    expect(result).toBeUndefined();
  });

  it('propagates a rejection that happens before the timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });
});
