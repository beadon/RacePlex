/**
 * VESC `COMM_GET_VALUES` request/response (issue #58).
 *
 * Field layout and scale factors are VESC firmware's own serialization
 * (`comm/commands.c`, `COMM_GET_VALUES` case) — a `buffer_append_float16`/
 * `_float32` call is `round(value * scale)` stored big-endian in that many
 * bytes. Only the fields RacePlex's file-based VESC import already surfaces
 * (`vescCsvParser.ts`'s `ESC_CHANNELS`) are decoded; later fields (PID
 * position, controller id, extra MOS sensors, Vd/Vq, status flags — added in
 * newer firmware) are present on the wire but not read, so this only
 * requires firmware new enough to include this front section, which has
 * been stable across VESC firmware versions.
 */

export const COMM_GET_VALUES = 4;

/** The `COMM_GET_VALUES` request payload — a single command-id byte. */
export function buildGetValuesRequest(): Uint8Array {
  return new Uint8Array([COMM_GET_VALUES]);
}

export interface VescValues {
  /** °C, MOSFET/ESC temperature. */
  tempEscC: number;
  /** °C, motor temperature (from a thermistor, when the motor has one). */
  tempMotorC: number;
  /** Amps, motor phase current. */
  motorCurrentA: number;
  /** Amps, battery-side current — what actually drains the pack. */
  batteryCurrentA: number;
  /** 0-1. */
  dutyCycle: number;
  /** Electrical RPM (not mechanical — divide by pole pairs for wheel RPM). */
  erpm: number;
  /** Volts, filtered battery voltage — the standard "sag under load" signal. */
  batteryVoltageV: number;
  /** Amp-hours drawn so far this odometer period. */
  ampHours: number;
  /** Non-zero means the ESC is currently faulted; see VESC's `mc_fault_code`. */
  faultCode: number;
}

function readFloat16(view: DataView, offset: number, scale: number): number {
  return view.getInt16(offset, false) / scale;
}

function readFloat32(view: DataView, offset: number, scale: number): number {
  return view.getInt32(offset, false) / scale;
}

/**
 * Decode a `COMM_GET_VALUES` response payload (the bytes `VescPacketReader`
 * yields, including the leading command-id byte). Returns null when the
 * payload isn't a `COMM_GET_VALUES` response, or is too short to contain the
 * fields above — a malformed/truncated packet should be dropped, not
 * silently produce a wrong reading (the exact "silent errors" this feature
 * is meant to avoid).
 */
export function decodeGetValues(payload: Uint8Array): VescValues | null {
  // command(1) + tempFet f16 + tempMotor f16 + 4×f32(motor/in/id/iq current)
  // + duty f16 + rpm f32 + voltage f16 + ampHours f32 = 1+2+2+16+2+4+2+4 = 33
  const MIN_LEN = 33;
  if (payload.length < MIN_LEN || payload[0] !== COMM_GET_VALUES) return null;

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let o = 1;

  const tempEscC = readFloat16(view, o, 1e1); o += 2;
  const tempMotorC = readFloat16(view, o, 1e1); o += 2;
  const motorCurrentA = readFloat32(view, o, 1e2); o += 4;
  const batteryCurrentA = readFloat32(view, o, 1e2); o += 4;
  o += 4; // id current — not surfaced
  o += 4; // iq current — not surfaced
  const dutyCycle = readFloat16(view, o, 1e3); o += 2;
  const erpm = readFloat32(view, o, 1e0); o += 4;
  const batteryVoltageV = readFloat16(view, o, 1e1); o += 2;
  const ampHours = readFloat32(view, o, 1e4); o += 4;

  // Everything past here (amp-hours charged, watt-hours, tachometer, fault
  // code, …) is optional — older firmware/BLE bridges may not send it, and
  // it's fine for faultCode to just be absent (0) rather than block the rest
  // of a valid reading.
  let faultCode = 0;
  const FAULT_OFFSET = o + 4 /* amp-hours charged */ + 4 /* watt-hours */
    + 4 /* watt-hours charged */ + 4 /* tachometer */ + 4; /* tachometer abs */
  if (payload.length > FAULT_OFFSET) faultCode = view.getUint8(FAULT_OFFSET);

  return { tempEscC, tempMotorC, motorCurrentA, batteryCurrentA, dutyCycle, erpm, batteryVoltageV, ampHours, faultCode };
}
