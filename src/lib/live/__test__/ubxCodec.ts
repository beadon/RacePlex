/**
 * Test helper: encode a UBX frame with a known payload + valid checksum.
 * Kept out of the runtime bundle (test-only) since RacePlex never SENDS
 * UBX packets, it only decodes them. Real transports (writes to Dragy's
 * handshake, RaceBox commands) build their frames with plain byte arrays;
 * they don't need this helper.
 */

import { ubxChecksum } from "../ubxRingBuffer";

export function encodeUbx(cls: number, id: number, payload: Uint8Array): Uint8Array {
  const buf = new Uint8Array(6 + payload.byteLength + 2);
  buf[0] = 0xb5;
  buf[1] = 0x62;
  buf[2] = cls;
  buf[3] = id;
  buf[4] = payload.byteLength & 0xff;
  buf[5] = (payload.byteLength >> 8) & 0xff;
  buf.set(payload, 6);
  const [ca, cb] = ubxChecksum(buf, 2, 6 + payload.byteLength);
  buf[6 + payload.byteLength] = ca;
  buf[6 + payload.byteLength + 1] = cb;
  return buf;
}
