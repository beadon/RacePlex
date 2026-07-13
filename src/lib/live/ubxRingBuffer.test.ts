/**
 * UBX ring buffer tests — chunk-boundary resilience + resync on corruption.
 * These are pure and don't touch Web Bluetooth.
 */

import { describe, it, expect } from "vitest";
import { UbxRingBuffer, ubxChecksum, type UbxPacket } from "./ubxRingBuffer";
import { encodeUbx } from "./__test__/ubxCodec";

/** Concatenate several byte arrays into one. */
function join(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

describe("ubxChecksum", () => {
  it("computes the 8-bit Fletcher over a range", () => {
    // Trivial: [1,2,3] gives A=6, B=(1)+(1+2)+(1+2+3) mod 256 = 10.
    const [a, b] = ubxChecksum(new Uint8Array([1, 2, 3]), 0, 3);
    expect(a).toBe(6);
    expect(b).toBe(10);
  });
});

describe("UbxRingBuffer", () => {
  it("extracts one complete packet fed as a single chunk", () => {
    const ring = new UbxRingBuffer();
    const packet = encodeUbx(0xff, 0x01, new Uint8Array([1, 2, 3, 4]));
    const out = ring.push(packet);
    expect(out).toHaveLength(1);
    expect(out[0].cls).toBe(0xff);
    expect(out[0].id).toBe(0x01);
    expect(Array.from(out[0].payload)).toEqual([1, 2, 3, 4]);
    expect(ring.pendingBytes).toBe(0);
  });

  it("stitches a packet fragmented across three BLE-sized chunks", () => {
    // The RaceBox spec is explicit that a notification is NOT a packet —
    // fragmentation on any byte boundary must work. Test the pathological
    // case: sync split from header split from payload.
    const ring = new UbxRingBuffer();
    const packet = encodeUbx(0xff, 0x01, new Uint8Array(80).fill(42));
    const a = packet.slice(0, 1);            // first sync byte only
    const b = packet.slice(1, 40);           // second sync + header + partial payload
    const c = packet.slice(40);              // rest of payload + checksum

    expect(ring.push(a)).toHaveLength(0);
    expect(ring.push(b)).toHaveLength(0);
    const out = ring.push(c);
    expect(out).toHaveLength(1);
    expect(out[0].payload.byteLength).toBe(80);
    expect(ring.pendingBytes).toBe(0);
  });

  it("emits multiple packets from a single chunk that concatenates them", () => {
    const ring = new UbxRingBuffer();
    const p1 = encodeUbx(0xff, 0x01, new Uint8Array([1, 2]));
    const p2 = encodeUbx(0xff, 0x21, new Uint8Array([3, 4]));
    const out = ring.push(join(p1, p2));
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(0x01);
    expect(out[1].id).toBe(0x21);
  });

  it("resyncs past junk bytes before the sync word", () => {
    const ring = new UbxRingBuffer();
    const junk = new Uint8Array([0x00, 0xff, 0xab, 0xcd]);
    const packet = encodeUbx(0xff, 0x01, new Uint8Array([9]));
    const out = ring.push(join(junk, packet));
    expect(out).toHaveLength(1);
    expect(Array.from(out[0].payload)).toEqual([9]);
  });

  it("discards a packet whose checksum fails and resyncs past it", () => {
    const ring = new UbxRingBuffer();
    const good = encodeUbx(0xff, 0x01, new Uint8Array([7]));
    const bad = encodeUbx(0xff, 0x01, new Uint8Array([1, 2, 3]));
    bad[bad.byteLength - 1] ^= 0xff; // flip the last byte of the checksum
    const out = ring.push(join(bad, good));
    // The corrupt one is dropped; the good one still lands.
    expect(out).toHaveLength(1);
    expect(Array.from(out[0].payload)).toEqual([7]);
  });

  it("holds partial trailing bytes for the next push", () => {
    const ring = new UbxRingBuffer();
    const packet = encodeUbx(0xff, 0x01, new Uint8Array([1, 2, 3]));
    const cut = Math.floor(packet.byteLength * 0.6);
    ring.push(packet.slice(0, cut));
    expect(ring.pendingBytes).toBeGreaterThan(0);
    const out = ring.push(packet.slice(cut));
    expect(out).toHaveLength(1);
  });

  it("survives a fuzz stream of random-sized chunks", () => {
    // 25 Hz for 1 s ≈ 25 packets, chunked at random 1..40-byte notifications:
    // exactly the shape a real BLE connection produces.
    const packets: Uint8Array[] = [];
    const expected: Array<{ cls: number; id: number }> = [];
    for (let i = 0; i < 25; i++) {
      const cls = 0xff;
      const id = i % 2 === 0 ? 0x01 : 0x21;
      const payload = new Uint8Array(80);
      // Just fill with a recognisable pattern.
      for (let j = 0; j < 80; j++) payload[j] = (i + j) & 0xff;
      packets.push(encodeUbx(cls, id, payload));
      expected.push({ cls, id });
    }
    const stream = join(...packets);

    const ring = new UbxRingBuffer();
    const seen: UbxPacket[] = [];
    let i = 0;
    // Deterministic pseudo-random chunker (no seed needed for determinism —
    // the modulo-based sizes give the same partition every run).
    while (i < stream.byteLength) {
      const size = 1 + ((i * 7 + 3) % 40);
      const end = Math.min(i + size, stream.byteLength);
      seen.push(...ring.push(stream.slice(i, end)));
      i = end;
    }
    expect(seen).toHaveLength(expected.length);
    expect(seen.map((s) => ({ cls: s.cls, id: s.id }))).toEqual(expected);
  });

  it("reset() drops all pending bytes", () => {
    const ring = new UbxRingBuffer();
    ring.push(new Uint8Array([0xb5, 0x62, 0xff, 0x01, 0x00, 0x00])); // partial header
    expect(ring.pendingBytes).toBeGreaterThan(0);
    ring.reset();
    expect(ring.pendingBytes).toBe(0);
  });
});

