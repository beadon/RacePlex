/**
 * Decode the Bluetooth SIG standard Heart Rate Measurement characteristic
 * (`org.bluetooth.characteristic.heart_rate_measurement`, `0x2A37`) — issue
 * #87. Unlike the VESC/BMS transports, this is an openly documented GATT
 * spec every compliant device (chest strap, watch, Apple Watch's Workout app
 * broadcast) already speaks; no protocol reverse-engineering involved.
 *
 * Byte layout (spec-defined):
 *   [0]     Flags — bit0: BPM format (0=u8, 1=u16); bits1-2: sensor-contact
 *           status/support; bit3: Energy Expended present; bit4: one or more
 *           RR-Interval values present; bits5-7 reserved.
 *   [1..]   Heart Rate Value — u8 or u16 (little-endian) per bit0.
 *   [..]    Energy Expended, u16 kJoules, only if bit3 set — read past but
 *           not surfaced; not useful for racing analysis.
 *   [..]    Zero or more RR-Interval values, u16 each (little-endian, units
 *           of 1/1024 s), only if bit4 set. A device can batch several
 *           readings since the last notification; only the most recent is
 *           kept, matching this codebase's flat one-value-per-channel model.
 */

export interface HeartRateSample {
  bpm: number;
  /** Most recent beat-to-beat interval, ms, when the device reports it. */
  rrIntervalMs?: number;
  /** Only meaningful when the device supports contact detection at all. */
  contactDetected?: boolean;
}

/** Decode one Heart Rate Measurement notification payload. Null if too short to contain a BPM value. */
export function decodeHeartRateMeasurement(data: Uint8Array): HeartRateSample | null {
  if (data.length < 2) return null;

  const flags = data[0];
  const is16Bit = (flags & 0x01) !== 0;
  const contactSupported = (flags & 0x04) !== 0;
  const contactDetected = (flags & 0x02) !== 0;
  const energyPresent = (flags & 0x08) !== 0;
  const rrPresent = (flags & 0x10) !== 0;

  let offset = 1;
  let bpm: number;
  if (is16Bit) {
    if (data.length < offset + 2) return null;
    bpm = data[offset] | (data[offset + 1] << 8);
    offset += 2;
  } else {
    bpm = data[offset];
    offset += 1;
  }

  if (energyPresent) offset += 2;

  let rrIntervalMs: number | undefined;
  if (rrPresent) {
    while (offset + 1 < data.length) {
      const raw = data[offset] | (data[offset + 1] << 8);
      rrIntervalMs = (raw / 1024) * 1000;
      offset += 2;
    }
  }

  return {
    bpm,
    rrIntervalMs,
    contactDetected: contactSupported ? contactDetected : undefined,
  };
}
