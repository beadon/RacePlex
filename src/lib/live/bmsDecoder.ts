/**
 * JBD (Jiabaida) BMS `COMM 0x03` (basic info) and `COMM 0x04` (cell voltages)
 * decoders (issue #73). Field order, scales, and the MOSFET-vs-cell
 * temperature-sensor assignment were all verified against a real unit (a
 * "SP17S005P17S20A" pack) by cross-checking every decoded value against the
 * vendor app's own RT Data screen — not just plausible-looking numbers.
 *
 * Response frame layout (see `bmsPacket.ts`): `BmsResponseFrame.data` is
 * already stripped of the start byte, cmd, status, len, checksum, and stop
 * — this module only decodes the data payload itself.
 */

export const COMM_BASIC_INFO = 0x03;
export const COMM_CELL_VOLTAGES = 0x04;
/** Device name / model string (e.g. "SP17S005P17S20A") — a model/batch code, not a guaranteed per-unit serial; see plan docs for issue #74. */
export const COMM_DEVICE_NAME = 0x05;

export function buildBasicInfoRequest(): Uint8Array {
  return buildBmsRequestInternal(COMM_BASIC_INFO);
}
export function buildCellVoltagesRequest(): Uint8Array {
  return buildBmsRequestInternal(COMM_CELL_VOLTAGES);
}
export function buildDeviceNameRequest(): Uint8Array {
  return buildBmsRequestInternal(COMM_DEVICE_NAME);
}

// Re-exported thinly so callers only need one import site for "build a request".
import { buildBmsRequest as buildBmsRequestInternal } from "./bmsPacket";

export interface BmsBasicInfo {
  /** Pack terminal voltage, volts. */
  voltageV: number;
  /** Pack current, amps. Sign convention matches the vendor app: positive while charging. */
  currentA: number;
  /** Remaining capacity, amp-hours. */
  remainAh: number;
  /** Nominal (design) capacity, amp-hours. */
  nominalAh: number;
  /** Cycle count — Ah-throughput-based (see `Origin Setting`'s "cycle capacity" divisor), not literal full charge/discharge cycles. */
  cycles: number;
  /** State of charge, 0-100. */
  socPct: number;
  /** True when the charge MOSFET is enabled. */
  chargeFetOn: boolean;
  /** True when the discharge MOSFET is enabled. */
  dischargeFetOn: boolean;
  numCells: number;
  numTemps: number;
  /**
   * Sensor temperatures, °C, in protocol order. Confirmed on a real unit
   * that index 0 is the **MOSFET/board sensor** (the vendor app's "MOS"
   * reading) and the rest are pack-area sensors — this is a firmware/vendor
   * convention, not a guarantee that holds on every JBD-family board.
   */
  tempsC: number[];
  /** Non-zero protection-status bits — 0 means no protection currently triggered. */
  protectionStatus: number;
  /** Non-zero balance-status bits (low + high cell groups combined) — 0 means not balancing. */
  balanceStatus: number;
}

/**
 * Decode a `COMM_BASIC_INFO` response payload (the `data` field of a
 * `BmsResponseFrame`, i.e. `bmsPacket.ts` has already stripped framing).
 * Returns null when the payload is too short to contain the fields this app
 * reads — a truncated/malformed response should be dropped, not guessed at.
 */
export function decodeBasicInfo(data: Uint8Array): BmsBasicInfo | null {
  // voltage(2) current(2) remainAh(2) nominalAh(2) cycles(2) prodDate(2)
  // balanceLo(2) balanceHi(2) protection(2) swVersion(1) soc(1) fet(1)
  // numCells(1) numTemps(1) = 23 bytes minimum (before any temps).
  const MIN_LEN = 23;
  if (data.length < MIN_LEN) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const voltageV = view.getUint16(0, false) / 100;
  const currentA = view.getInt16(2, false) / 100;
  const remainAh = view.getUint16(4, false) / 100;
  const nominalAh = view.getUint16(6, false) / 100;
  const cycles = view.getUint16(8, false);
  const balanceStatus = ((view.getUint16(12, false) << 16) | view.getUint16(14, false)) >>> 0;
  const protectionStatus = view.getUint16(16, false);
  const socPct = data[19];
  const fet = data[20];
  const numCells = data[21];
  const numTemps = data[22];

  const tempsC: number[] = [];
  for (let t = 0; t < numTemps; t++) {
    const offset = 23 + t * 2;
    if (offset + 1 >= data.length) break;
    tempsC.push((view.getUint16(offset, false) - 2731) / 10);
  }

  return {
    voltageV,
    currentA,
    remainAh,
    nominalAh,
    cycles,
    socPct,
    chargeFetOn: (fet & 0x01) !== 0,
    dischargeFetOn: (fet & 0x02) !== 0,
    numCells,
    numTemps,
    tempsC,
    protectionStatus,
    balanceStatus,
  };
}

export interface BmsCellVoltages {
  /** Per-cell voltage, volts, in physical cell order. */
  cellsV: number[];
  highV: number;
  lowV: number;
  avgV: number;
  /** highV - lowV — the vendor app's own "VolDiff" reading. */
  diffV: number;
}

/** Decode a `COMM_CELL_VOLTAGES` response payload. Returns null for an empty or odd-length payload. */
export function decodeCellVoltages(data: Uint8Array): BmsCellVoltages | null {
  if (data.length < 2 || data.length % 2 !== 0) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const cellsV: number[] = [];
  for (let i = 0; i < data.length; i += 2) {
    cellsV.push(view.getUint16(i, false) / 1000);
  }

  const highV = Math.max(...cellsV);
  const lowV = Math.min(...cellsV);
  const avgV = cellsV.reduce((a, b) => a + b, 0) / cellsV.length;

  return { cellsV, highV, lowV, avgV, diffV: highV - lowV };
}

/** Decode a `COMM_DEVICE_NAME` response payload as an ASCII string. */
export function decodeDeviceName(data: Uint8Array): string | null {
  if (data.length === 0) return null;
  return String.fromCharCode(...data);
}
