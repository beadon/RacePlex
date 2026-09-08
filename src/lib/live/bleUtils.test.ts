import { describe, it, expect } from 'vitest';
import { withTimeout, isUserCancelledBluetoothPicker } from './bleUtils';

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

describe('isUserCancelledBluetoothPicker', () => {
  it('recognizes the NotFoundError requestDevice() rejects with on cancel', () => {
    expect(isUserCancelledBluetoothPicker(new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError'))).toBe(true);
  });

  it('is false for a real connection failure', () => {
    expect(isUserCancelledBluetoothPicker(new Error('GATT Server is disconnected'))).toBe(false);
  });

  it('is false for a different DOMException', () => {
    expect(isUserCancelledBluetoothPicker(new DOMException('boom', 'NetworkError'))).toBe(false);
  });

  it('is false for a non-Error value', () => {
    expect(isUserCancelledBluetoothPicker('boom')).toBe(false);
  });
});
