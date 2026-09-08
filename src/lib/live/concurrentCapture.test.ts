import { describe, it, expect } from 'vitest';
import { ConcurrentSourceMerger } from './concurrentCapture';

interface Gps { lat: number }
interface Esc { current: number }

describe('ConcurrentSourceMerger', () => {
  it('pairs a primary sample with null secondary before any secondary has arrived', () => {
    const merger = new ConcurrentSourceMerger<Gps, Esc>();
    expect(merger.hasSecondary).toBe(false);
    const merged = merger.addPrimary({ receivedAt: 1000, data: { lat: 28.4 } });
    expect(merged.secondary).toBeNull();
    expect(merged.suspect).toBe(false);
    expect(merged.secondaryAgeMs).toBeNull();
  });

  it('pairs with the latest secondary and reports a clean (non-suspect) small age', () => {
    const merger = new ConcurrentSourceMerger<Gps, Esc>();
    merger.addSecondary({ receivedAt: 1000, data: { current: 12.3 } });
    const merged = merger.addPrimary({ receivedAt: 1020, data: { lat: 28.4 } });
    expect(merged.secondary).toEqual({ current: 12.3 });
    expect(merged.suspect).toBe(false);
    expect(merged.secondaryAgeMs).toBe(20);
  });

  it('flags a pairing suspect when the secondary is stale beyond maxAgeMs', () => {
    const merger = new ConcurrentSourceMerger<Gps, Esc>({ maxAgeMs: 250 });
    merger.addSecondary({ receivedAt: 1000, data: { current: 12.3 } });
    const merged = merger.addPrimary({ receivedAt: 1500, data: { lat: 28.4 } }); // 500ms stale
    expect(merged.suspect).toBe(true);
    expect(merged.secondaryAgeMs).toBe(500);
    expect(merged.secondary).toEqual({ current: 12.3 }); // still paired — just marked suspect, not dropped
  });

  it('flags suspect when the secondary is implausibly ahead too (clock/ordering anomaly)', () => {
    const merger = new ConcurrentSourceMerger<Gps, Esc>({ maxAgeMs: 250 });
    merger.addSecondary({ receivedAt: 2000, data: { current: 12.3 } });
    const merged = merger.addPrimary({ receivedAt: 1000, data: { lat: 28.4 } }); // secondary is "from the future"
    expect(merged.suspect).toBe(true);
    expect(merged.secondaryAgeMs).toBe(-1000);
  });

  it('respects a custom maxAgeMs threshold', () => {
    const merger = new ConcurrentSourceMerger<Gps, Esc>({ maxAgeMs: 50 });
    merger.addSecondary({ receivedAt: 1000, data: { current: 12.3 } });
    expect(merger.addPrimary({ receivedAt: 1040, data: { lat: 28.4 } }).suspect).toBe(false);
    expect(merger.addPrimary({ receivedAt: 1060, data: { lat: 28.4 } }).suspect).toBe(true);
  });

  it('always uses the most recently added secondary, not the first', () => {
    const merger = new ConcurrentSourceMerger<Gps, Esc>();
    merger.addSecondary({ receivedAt: 1000, data: { current: 1 } });
    merger.addSecondary({ receivedAt: 1010, data: { current: 2 } });
    const merged = merger.addPrimary({ receivedAt: 1015, data: { lat: 28.4 } });
    expect(merged.secondary).toEqual({ current: 2 });
    expect(merged.secondaryAgeMs).toBe(5);
  });

  it('multiple primary samples can pair with the same secondary sample while none newer has arrived', () => {
    const merger = new ConcurrentSourceMerger<Gps, Esc>();
    merger.addSecondary({ receivedAt: 1000, data: { current: 12.3 } });
    const a = merger.addPrimary({ receivedAt: 1010, data: { lat: 1 } });
    const b = merger.addPrimary({ receivedAt: 1020, data: { lat: 2 } });
    expect(a.secondary).toEqual({ current: 12.3 });
    expect(b.secondary).toEqual({ current: 12.3 });
    expect(a.secondaryAgeMs).toBe(10);
    expect(b.secondaryAgeMs).toBe(20);
  });

  it('reset() drops the buffered secondary — a disconnect should not keep pairing stale data forever', () => {
    const merger = new ConcurrentSourceMerger<Gps, Esc>();
    merger.addSecondary({ receivedAt: 1000, data: { current: 12.3 } });
    merger.reset();
    expect(merger.hasSecondary).toBe(false);
    const merged = merger.addPrimary({ receivedAt: 1010, data: { lat: 1 } });
    expect(merged.secondary).toBeNull();
    expect(merged.suspect).toBe(false);
  });
});
