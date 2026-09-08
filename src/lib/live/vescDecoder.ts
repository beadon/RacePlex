/**
 * VESC `COMM_GET_VALUES` and `COMM_GET_VALUES_SETUP` request/response
 * (issue #58, extended for the RT-gauge dashboard).
 *
 * `COMM_GET_VALUES` (id 4) is the original decoder in this file — raw ESC
 * telemetry, field layout from VESC firmware's own serialization
 * (`comm/commands.c`). It doesn't have speed, battery %, trip, or odometer.
 *
 * `COMM_GET_VALUES_SETUP` (id 47) is the richer command matching VESC Tool's
 * "RT Data" gauge screen — **speed, battery %, trip, and odometer, all
 * computed by the VESC's own firmware** using whatever wheel/gear/battery
 * config was set up on the board via VESC Tool's wizard. RacePlex never
 * needs to know the board's wheel size, pole count, or gear ratio itself.
 *
 * Field order and scale factors are copied from VESC Tool's own client
 * parser (`vesc_tool/commands.cpp`, the `COMM_GET_VALUES_SETUP` case) — not
 * the bare-firmware `comm/commands.c` handler, which turned out to describe
 * an older/shorter revision of this same response and does not match what a
 * real board sends. Verified byte-for-byte against a real capture from a
 * "BKB XENITH BLE" board (`vescDecoder.test.ts`'s golden fixture): every
 * decoded field matched what VESC Tool showed on screen for that same board
 * — including odometer (780.93 mi decoded vs. "780.9" shown).
 *
 * `COMM_GET_VALUES_SETUP_SELECTIVE` (a bitmask-gated variant that returns a
 * chosen subset of fields) exists in newer firmware but isn't needed here —
 * the plain command already returned the full set on the (self-reported
 * "needs a firmware upgrade") board this was tested against. Decoding stays
 * tolerant of a shorter response past `battery_level` — every field after
 * that individually checks the payload is long enough before reading it —
 * so an older board that omits trailing fields still yields a partial,
 * honest reading (missing fields are `undefined`) instead of failing to
 * decode at all.
 */

export const COMM_GET_VALUES = 4;
export const COMM_GET_VALUES_SETUP = 47;

/** The `COMM_GET_VALUES` request payload — a single command-id byte. */
export function buildGetValuesRequest(): Uint8Array {
  return new Uint8Array([COMM_GET_VALUES]);
}

/** The `COMM_GET_VALUES_SETUP` request payload — a single command-id byte. */
export function buildGetValuesSetupRequest(): Uint8Array {
  return new Uint8Array([COMM_GET_VALUES_SETUP]);
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

/**
 * Everything `VescValues` has, plus the fields only `COMM_GET_VALUES_SETUP`
 * carries — computed by the VESC's own firmware, not derived here. The
 * fields past `tripMeters` are optional: present on every firmware tested
 * so far, but genuinely absent rather than guessed on a board that doesn't
 * send them.
 */
export interface VescSetupValues extends VescValues {
  /** m/s, firmware-computed from the board's own configured wheel/gear setup. */
  speedMps: number;
  /** 0-1, firmware-computed from the board's own configured battery type/cell count. */
  batteryLevel: number;
  /** Meters, resettable trip distance (VESC's `tachometer`). */
  tripMeters: number;
  /** Watt-hours drawn so far this odometer period — pairs with `tripMeters` for a Wh/mi readout. */
  wattHours: number;
  /** Meters, lifetime distance — VESC Tool's "ODOMETER". Confirmed matching in practice. */
  odometerMeters?: number;
  /** ms since the VESC itself booted — NOT since this app connected. */
  uptimeMs?: number;
  /** VESCs on the CAN bus reporting into this total (2+ means a dual-motor board). */
  numVescs?: number;
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

/**
 * Decode a `COMM_GET_VALUES_SETUP` response payload. Field order matches
 * VESC Tool's own client parser exactly (see the file docstring) — verified
 * against a real capture. Returns null only when the response is too short
 * to contain even the fields every firmware generation is expected to send
 * (through `battery_level`); fields past that (amp-hours, trip, fault code,
 * vesc count, odometer, uptime) are individually optional so an older board
 * that omits them still yields a partial, honest reading.
 */
export function decodeGetValuesSetup(payload: Uint8Array): VescSetupValues | null {
  // command(1) + tempFet f16 + tempMotor f16 + current_motor f32 + current_in f32
  // + duty f16 + rpm f32 + speed f32 + v_in f16 + battery_level f16
  // = 1+2+2+4+4+2+4+4+2+2 = 27
  const MIN_LEN = 27;
  if (payload.length < MIN_LEN || payload[0] !== COMM_GET_VALUES_SETUP) return null;

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let o = 1;

  const tempEscC = readFloat16(view, o, 1e1); o += 2;
  const tempMotorC = readFloat16(view, o, 1e1); o += 2;
  const motorCurrentA = readFloat32(view, o, 1e2); o += 4;
  const batteryCurrentA = readFloat32(view, o, 1e2); o += 4;
  const dutyCycle = readFloat16(view, o, 1e3); o += 2;
  const erpm = readFloat32(view, o, 1e0); o += 4;
  const speedMps = readFloat32(view, o, 1e3); o += 4;
  const batteryVoltageV = readFloat16(view, o, 1e1); o += 2;
  const batteryLevel = readFloat16(view, o, 1e3); o += 2;

  const result: VescSetupValues = {
    tempEscC, tempMotorC, motorCurrentA, batteryCurrentA, dutyCycle, erpm,
    speedMps, batteryVoltageV, batteryLevel,
    ampHours: 0, tripMeters: 0, wattHours: 0, faultCode: 0,
  };

  if (payload.length < o + 16) return result;
  result.ampHours = readFloat32(view, o, 1e4); o += 4;
  o += 4; // amp_hours_charged — not surfaced
  result.wattHours = readFloat32(view, o, 1e4); o += 4;
  o += 4; // watt_hours_charged — not surfaced

  if (payload.length < o + 4) return result;
  result.tripMeters = readFloat32(view, o, 1e3); o += 4; // tachometer
  o += 4; // tachometer_abs — VESC Tool's own UI uses `odometer` (below) for the odometer figure, not this
  o += 4; // position — motor electrical position, not distance

  if (payload.length < o + 1) return result;
  result.faultCode = view.getInt8(o); o += 1;
  o += 1; // vesc_id — not surfaced
  if (payload.length < o + 1) return result;
  result.numVescs = view.getUint8(o); o += 1;
  o += 4; // battery_wh — pack capacity, not a live reading worth a gauge

  if (payload.length < o + 4) return result;
  result.odometerMeters = view.getUint32(o, false); o += 4;
  if (payload.length >= o + 4) result.uptimeMs = view.getUint32(o, false);

  return result;
}
