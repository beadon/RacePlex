/**
 * Dragy handshake (issue #32).
 *
 * Reverse-engineered from `jremick/dragy-dash`: the device sends a 2-byte
 * challenge on the FD03 characteristic; the client responds with a 4-byte
 * reply `[a, b, a^b, a&b]` written back to FD03. Without this, subscribing
 * to the telemetry characteristic gets you nothing.
 */

export function dragyHandshakeReply(challenge: Uint8Array): Uint8Array {
  if (challenge.byteLength < 2) {
    throw new Error("Dragy handshake needs a 2-byte challenge, got " + challenge.byteLength);
  }
  const a = challenge[0];
  const b = challenge[1];
  return new Uint8Array([a, b, a ^ b, a & b]);
}
