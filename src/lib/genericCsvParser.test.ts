/**
 * The fixtures below are SYNTHESISED from the column layouts described in issue #13 — they are not
 * copied from any real export. What matters for these tests is the SHAPE (delimiter, header
 * dialect, time unit, speed unit, GPS repeat rate), which is exactly what the issue documents.
 *
 * All four ride the same synthetic track: a straight run east at a constant 10 m/s, so the truth is
 * knowable — position-derived speed is 10 m/s, and any speed column can be checked against it.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  analyzeGenericCsv,
  inferTimeUnit,
  isGenericCsvFormat,
  parseGenericCsvFile,
  parseGenericCsvTable,
  previewMapping,
} from './genericCsvParser';
import { parseCsvTable } from './csvTable';
import { loadCsvMapping, saveCsvMapping, deleteCsvMapping, listCsvMappings } from './csvMappingStorage';
import { parseDatalogContent } from './datalogParser';

/** Vitest runs in `node`, which has no localStorage — the mapping store needs one. */
function installMemoryLocalStorage(): void {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  });
}

// ─── Synthetic ride ──────────────────────────────────────────────────────────

const LAT0 = 37.4;
const LON0 = -122.1;
/** Metres per degree of longitude at 37.4°N — used to walk east at a known ground speed. */
const M_PER_DEG_LON = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

/** Longitude after `seconds` at `mps` m/s heading due east. */
function lonAt(seconds: number, mps = 10): number {
  return LON0 + (seconds * mps) / M_PER_DEG_LON;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * VESC-like SUBSET, as Float Control / Floaty emit: semicolon-delimited, `ms_today`, `gnss_gVel`
 * in m/s, GNSS at 1 Hz while the ESC logs at 10 Hz, trailing `;` on every line, ESC channels.
 * Deliberately WITHOUT `gnss_lat`, so the real VESC parser declines it and it falls to us.
 */
function vescLikeSubset(): string {
  const header = 'ms_today;erpm;duty_cycle;current_motor;gps_lat;gps_long;gnss_gVel;gnss_alt;\n';
  // 09:00:00.000 local → 32,400,000 ms since midnight.
  const t0 = 32_400_000;
  const rows: string[] = [];
  for (let i = 0; i < 300; i++) {
    const sec = i / 10; // 10 Hz
    const fixSec = Math.floor(sec); // GNSS only fixes at 1 Hz — lat/lon REPEAT across 10 rows
    rows.push(
      [
        t0 + i * 100,
        (3000 + i * 5).toFixed(0),
        (0.4 + (i % 20) / 100).toFixed(3),
        (12 + (i % 7)).toFixed(2),
        LAT0.toFixed(7),
        lonAt(fixSec).toFixed(7),
        '10.0', // m/s
        '30.5',
        '',
      ].join(';'),
    );
  }
  return header + rows.join('\n') + '\n';
}

/** Float-Control-like: comma, `Time(s)` seconds-since-start, `Speed(km/h)`, 10 Hz GPS. */
function floatControlLike(): string {
  const header = 'Time(s),Latitude,Longitude,Speed(km/h),Altitude(m),Duty Cycle,ADC1,ADC2,Battery Voltage\n';
  const rows: string[] = [];
  for (let i = 0; i < 300; i++) {
    const sec = i / 10;
    rows.push(
      [
        sec.toFixed(2),
        LAT0.toFixed(7),
        lonAt(sec).toFixed(7),
        '36.0', // 10 m/s in km/h
        '30.5',
        (0.5).toFixed(2),
        '2.51',
        '0.00',
        (58 - i * 0.01).toFixed(2),
      ].join(','),
    );
  }
  return header + rows.join('\n') + '\n';
}

/** pOnewheel-like: epoch MILLISECONDS in `time`, `gps_lat` / `gps_long`, `speed_kph`, odd columns. */
function pOnewheelLike(): string {
  const header = 'time,gps_lat,gps_long,speed_kph,gps_alt,battery_percent,pitch,roll,motor_temp\n';
  const t0 = 1_750_000_000_000; // 2025-06-15T15:06:40Z
  const rows: string[] = [];
  for (let i = 0; i < 300; i++) {
    const sec = i / 10;
    rows.push(
      [
        t0 + i * 100,
        LAT0.toFixed(7),
        lonAt(sec).toFixed(7),
        '36.0',
        '30.5',
        (90 - i * 0.02).toFixed(1),
        (-1.2).toFixed(2),
        (0.3).toFixed(2),
        '41',
      ].join(','),
    );
  }
  return header + rows.join('\n') + '\n';
}

/**
 * TrackAddict-like: a `#` comment preamble (which csvTable keeps aside), `UTC Time` as epoch
 * SECONDS with a fractional part, `Speed (MPH)`, 10 Hz sensors against a 1 Hz GPS.
 */
function trackAddictLike(): string {
  const preamble =
    '# RaceRender Data: TrackAddict 4.3.7\n' +
    '# Session: 2025-06-15 14:26:40\n' +
    '# Vehicle: Onewheel GT\n';
  const header =
    'Time,UTC Time,Latitude,Longitude,Altitude (m),Speed (MPH),Heading,Accuracy (m),GPS_Update,Accel X,Accel Y,Accel Z\n';
  const t0 = 1_750_000_000; // epoch SECONDS, as a float — 2025-06-15T15:06:40Z
  const rows: string[] = [];
  for (let i = 0; i < 300; i++) {
    const sec = i / 10;
    const fixSec = Math.floor(sec);
    rows.push(
      [
        sec.toFixed(3),
        (t0 + sec).toFixed(3),
        LAT0.toFixed(7),
        lonAt(fixSec).toFixed(7),
        '30.5',
        '22.37', // 10 m/s in mph
        '90.0',
        '3.0',
        i % 10 === 0 ? '1' : '0',
        (0.01).toFixed(3),
        (0.02).toFixed(3),
        (1.0).toFixed(3),
      ].join(','),
    );
  }
  return preamble + header + rows.join('\n') + '\n';
}

/** No speed column at all — speed must be derived from the positions. */
function positionOnly(): string {
  const header = 'timestamp,latitude,longitude\n';
  const t0 = 1_750_000_000_000;
  const rows: string[] = [];
  for (let i = 0; i < 100; i++) {
    rows.push([t0 + i * 100, LAT0.toFixed(7), lonAt(i / 10).toFixed(7)].join(','));
  }
  return header + rows.join('\n') + '\n';
}

// ─── Detection ───────────────────────────────────────────────────────────────

describe('isGenericCsvFormat', () => {
  it('claims every shape in issue #13', () => {
    expect(isGenericCsvFormat(vescLikeSubset())).toBe(true);
    expect(isGenericCsvFormat(floatControlLike())).toBe(true);
    expect(isGenericCsvFormat(pOnewheelLike())).toBe(true);
    expect(isGenericCsvFormat(trackAddictLike())).toBe(true);
  });

  it('declines a table with no position columns', () => {
    expect(isGenericCsvFormat('rpm,volts,amps\n3000,58,12\n3100,57,13\n')).toBe(false);
  });

  it('declines a table whose position columns hold no fixes (pre-lock zeros)', () => {
    expect(isGenericCsvFormat('time,latitude,longitude\n0,0,0\n1,0,0\n2,0,0\n')).toBe(false);
  });

  it('declines NMEA, which is not a table', () => {
    expect(
      isGenericCsvFormat('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,,*6A\n'),
    ).toBe(false);
  });
});

// ─── Auto-mapping ────────────────────────────────────────────────────────────

describe('auto-mapping', () => {
  it('maps a semicolon VESC-like subset by name, ignoring the phantom trailing column', () => {
    const a = analyzeGenericCsv(vescLikeSubset());
    expect(a.table.delimiter).toBe(';');
    expect(a.table.columns).toEqual([
      'ms_today',
      'erpm',
      'duty_cycle',
      'current_motor',
      'gps_lat',
      'gps_long',
      'gnss_gVel',
      'gnss_alt',
    ]);
    expect(a.table.columns[a.mapping.lat]).toBe('gps_lat');
    expect(a.table.columns[a.mapping.lon]).toBe('gps_long');
    expect(a.table.columns[a.mapping.time]).toBe('ms_today');
    expect(a.table.columns[a.mapping.speed]).toBe('gnss_gVel');
    expect(a.table.columns[a.mapping.altitude]).toBe('gnss_alt');
  });

  it('maps Float-Control-like names, including the parenthetical units', () => {
    const a = analyzeGenericCsv(floatControlLike());
    expect(a.table.delimiter).toBe(',');
    expect(a.table.columns[a.mapping.lat]).toBe('Latitude');
    expect(a.table.columns[a.mapping.lon]).toBe('Longitude');
    expect(a.table.columns[a.mapping.time]).toBe('Time(s)');
    expect(a.table.columns[a.mapping.speed]).toBe('Speed(km/h)');
  });

  it('maps pOnewheel-like gps_lat / gps_long / speed_kph', () => {
    const a = analyzeGenericCsv(pOnewheelLike());
    expect(a.table.columns[a.mapping.lat]).toBe('gps_lat');
    expect(a.table.columns[a.mapping.lon]).toBe('gps_long');
    expect(a.table.columns[a.mapping.speed]).toBe('speed_kph');
    expect(a.table.columns[a.mapping.time]).toBe('time');
  });

  it('keeps a TrackAddict-like `#` preamble aside and prefers UTC Time over the relative Time', () => {
    const a = analyzeGenericCsv(trackAddictLike());
    expect(a.table.comments[0]).toContain('TrackAddict 4.3.7');
    expect(a.table.columns[a.mapping.time]).toBe('UTC Time');
    expect(a.table.columns[a.mapping.speed]).toBe('Speed (MPH)');
    expect(a.table.columns[a.mapping.heading]).toBe('Heading');
    expect(a.table.columns[a.mapping.accuracy]).toBe('Accuracy (m)');
  });

  it('never mistakes an accelerometer X/Y column for a coordinate', () => {
    const a = analyzeGenericCsv(trackAddictLike());
    expect(a.table.columns[a.mapping.lat]).toBe('Latitude');
    expect(a.table.columns[a.mapping.lon]).toBe('Longitude');
    // Accel X/Y ride along as ordinary telemetry instead.
    expect(a.preview.extraColumns).toContain('Accel X');
    expect(a.preview.extraColumns).toContain('Accel Y');
  });

  it('turns every unmapped numeric column into an extra channel', () => {
    const data = parseGenericCsvFile(floatControlLike());
    const names = data.fieldMappings.map((f) => f.name);
    expect(names).toContain('Duty Cycle');
    expect(names).toContain('ADC1');
    expect(names).toContain('ADC2');
    expect(names).toContain('Battery Voltage');
    expect(data.samples[0]!.extraFields['ADC1']).toBeCloseTo(2.51, 3);
  });

  it('refuses a file with no lat/lon rather than importing nonsense', () => {
    expect(() => analyzeGenericCsv('rpm,volts\n3000,58\n')).toThrow(/latitude/i);
  });
});

// ─── Time units ──────────────────────────────────────────────────────────────

describe('time-unit inference', () => {
  it('recognises epoch milliseconds', () => {
    expect(inferTimeUnit([1_750_000_000_000, 1_750_000_000_100]).unit).toBe('epoch_ms');
  });

  it('recognises epoch seconds (a float — TrackAddict UTC Time)', () => {
    expect(inferTimeUnit([1_750_000_000.0, 1_750_000_000.1]).unit).toBe('epoch_s');
  });

  it('recognises ms since midnight (VESC ms_today)', () => {
    expect(inferTimeUnit([32_400_000, 32_400_100, 32_400_200]).unit).toBe('ms_today');
  });

  it('separates elapsed seconds from elapsed ms by the row spacing', () => {
    expect(inferTimeUnit([0, 0.1, 0.2, 0.3]).unit).toBe('elapsed_s');
    expect(inferTimeUnit([0, 100, 200, 300]).unit).toBe('elapsed_ms');
  });

  it('flags an ambiguous elapsed column instead of pretending', () => {
    // 3-second gaps: could be a very slow logger in seconds, or a 3 ms one in ms. Neither is
    // plausible, and the honest answer is "not confident" so the dialog insists on a human.
    expect(inferTimeUnit([0, 3, 6, 9]).confident).toBe(false);
  });

  it('reads each fixture back at its real duration — the wrong-unit tell', () => {
    // Every fixture is 300 rows at 10 Hz = 29.9 s from first to last row.
    for (const [name, csv] of [
      ['vesc-like (ms_today)', vescLikeSubset()],
      ['float-control-like (Time(s))', floatControlLike()],
      ['pOnewheel-like (epoch ms)', pOnewheelLike()],
      ['trackaddict-like (epoch s)', trackAddictLike()],
    ] as const) {
      const data = parseGenericCsvFile(csv);
      expect(data.duration, name).toBeGreaterThan(28_000);
      expect(data.duration, name).toBeLessThan(30_000);
    }
  });

  it('hands out a wall-clock start date only for the absolute timebases', () => {
    expect(parseGenericCsvFile(pOnewheelLike()).startDate?.toISOString()).toBe(
      '2025-06-15T15:06:40.000Z',
    );
    expect(parseGenericCsvFile(trackAddictLike()).startDate?.toISOString()).toBe(
      '2025-06-15T15:06:40.000Z',
    );
    // `ms_today` and `Time(s)` are offsets, not instants — inventing a date would be a lie.
    expect(parseGenericCsvFile(vescLikeSubset()).startDate).toBeUndefined();
    expect(parseGenericCsvFile(floatControlLike()).startDate).toBeUndefined();
  });

  it('an overridden time unit changes the duration by exactly the unit ratio', () => {
    const table = parseCsvTable(floatControlLike());
    const { mapping } = analyzeGenericCsv(floatControlLike());

    const right = previewMapping(table, mapping);
    const wrong = previewMapping(table, { ...mapping, timeUnit: 'elapsed_ms' });

    // Reading `Time(s)` as milliseconds turns a 29.9 s ride into a 29.9 ms one — precisely the
    // "this claims to have lasted 4 hours" failure the dialog exists to make visible.
    expect(right.durationMs).toBeCloseTo(29_900, -2);
    expect(wrong.durationMs).toBeCloseTo(29.9, 1);
  });

  it('unwraps a ms_today column that crosses local midnight', () => {
    const header = 'ms_today,latitude,longitude\n';
    const rows: string[] = [];
    for (let i = 0; i < 20; i++) {
      // Start 1 s before midnight, at 10 Hz, so the column wraps 86_400_000 → 0.
      const ms = (86_399_000 + i * 100) % 86_400_000;
      rows.push([ms, LAT0.toFixed(7), lonAt(i / 10).toFixed(7)].join(','));
    }
    const data = parseGenericCsvFile(header + rows.join('\n'));
    expect(data.duration).toBeCloseTo(1900, 0);
    // Without unwrapping, the samples would run backwards in time.
    for (let i = 1; i < data.samples.length; i++) {
      expect(data.samples[i]!.t).toBeGreaterThan(data.samples[i - 1]!.t);
    }
  });

  it('falls back to a flagged 10 Hz assumption when there is no time column at all', () => {
    const a = analyzeGenericCsv('latitude,longitude,speed\n' +
      Array.from({ length: 30 }, (_, i) => `${LAT0},${lonAt(i)},10`).join('\n'));
    expect(a.mapping.time).toBe(-1);
    expect(a.mapping.timeUnit).toBe('row_index');
    expect(a.confidence).toBe('low');
    expect(a.notes.join(' ')).toMatch(/no time column/i);
  });
});

// ─── Speed units ─────────────────────────────────────────────────────────────

describe('speed-unit inference', () => {
  it('reads the unit off an annotated header (km/h)', () => {
    const a = analyzeGenericCsv(floatControlLike());
    expect(a.speedUnitSource).toBe('header');
    expect(a.mapping.speedUnit).toBe('kph');
    const data = parseGenericCsvTable(a.table, a.mapping);
    expect(data.samples[10]!.speedMps).toBeCloseTo(10, 1); // 36 km/h
  });

  it('reads mph off an annotated header', () => {
    const a = analyzeGenericCsv(trackAddictLike());
    expect(a.speedUnitSource).toBe('header');
    expect(a.mapping.speedUnit).toBe('mph');
    const data = parseGenericCsvTable(a.table, a.mapping);
    expect(data.samples[10]!.speedMps).toBeCloseTo(10, 1); // 22.37 mph
  });

  it('reads kph off a `speed_kph` name with no parenthetical', () => {
    const a = analyzeGenericCsv(pOnewheelLike());
    expect(a.speedUnitSource).toBe('header');
    expect(a.mapping.speedUnit).toBe('kph');
  });

  it('MEASURES an unlabelled column against GPS-derived speed rather than guessing', () => {
    // `gnss_gVel` names no unit anywhere. Its values (10.0) are equally plausible as m/s, km/h or
    // mph — only the positions can settle it, and they say m/s.
    const a = analyzeGenericCsv(vescLikeSubset());
    expect(a.speedUnitSource).toBe('measured');
    expect(a.mapping.speedUnit).toBe('mps');
    const data = parseGenericCsvTable(a.table, a.mapping);
    expect(data.samples[50]!.speedMps).toBeCloseTo(10, 1);
  });

  it('measures the SAME column values as km/h when the positions say so', () => {
    // Identical numbers in the speed column, a track walked 3.6x slower. The magnitude is
    // unchanged; only the relationship to the positions moved — and that is the only honest signal.
    const header = 'ms_today,latitude,longitude,vel\n';
    const rows: string[] = [];
    for (let i = 0; i < 300; i++) {
      const sec = i / 10;
      rows.push([32_400_000 + i * 100, LAT0.toFixed(7), lonAt(sec, 10 / 3.6).toFixed(7), '10.0'].join(','));
    }
    const a = analyzeGenericCsv(header + rows.join('\n'));
    expect(a.speedUnitSource).toBe('measured');
    expect(a.mapping.speedUnit).toBe('kph');
  });

  it('admits it is guessing when a parked log gives the measurement nothing to work with', () => {
    const header = 'ms_today,latitude,longitude,vel\n';
    const rows = Array.from({ length: 60 }, (_, i) =>
      [32_400_000 + i * 100, LAT0.toFixed(7), LON0.toFixed(7), '0.0'].join(','),
    );
    const a = analyzeGenericCsv(header + rows.join('\n'));
    expect(a.speedUnitSource).toBe('assumed');
    expect(a.confidence).toBe('low');
    expect(a.notes.join(' ')).toMatch(/ASSUMING/);
  });

  it('derives speed from the positions when there is no speed column', () => {
    const a = analyzeGenericCsv(positionOnly());
    expect(a.mapping.speed).toBe(-1);
    expect(a.speedUnitSource).toBe('derived');

    const data = parseGenericCsvTable(a.table, a.mapping);
    const mid = data.samples[Math.floor(data.samples.length / 2)]!;
    expect(mid.speedMps).toBeCloseTo(10, 0);
  });

  it('an overridden speed unit rescales the whole trace', () => {
    const table = parseCsvTable(vescLikeSubset());
    const { mapping } = analyzeGenericCsv(vescLikeSubset());
    const wrong = parseGenericCsvTable(table, { ...mapping, speedUnit: 'kph' });
    expect(wrong.samples[50]!.speedMps).toBeCloseTo(10 / 3.6, 2);
  });
});

// ─── GPS de-duplication / interpolation ──────────────────────────────────────

describe('GPS fix de-duplication', () => {
  it('keeps every fast-channel row and interpolates position between 1 Hz fixes', () => {
    const a = analyzeGenericCsv(vescLikeSubset());
    const data = parseGenericCsvTable(a.table, a.mapping);

    // Every row between the first and the last GPS fix survives (rows 0-290; the 9 rows after the
    // last fix have nothing to interpolate towards, so — like the VESC parser — they are dropped).
    // The ESC channels therefore keep their 10 Hz resolution. Decimating to the 30 GPS fixes would
    // be the "obvious" fix and would throw away 90% of the motor data.
    expect(data.samples.length).toBe(291);
    expect(a.preview.gpsFixCount).toBe(30);
    expect(data.samples[5]!.extraFields['erpm']).toBeDefined();

    // …and the positions are a smooth ramp, not a staircase: every row moves.
    const lons = data.samples.slice(0, 20).map((s) => s.lon);
    for (let i = 1; i < lons.length; i++) {
      expect(lons[i]!).toBeGreaterThan(lons[i - 1]!);
    }
  });

  it('interpolates linearly between the fixes it does have', () => {
    const a = analyzeGenericCsv(vescLikeSubset());
    const data = parseGenericCsvTable(a.table, a.mapping);
    // Rows 0 and 10 are real fixes 1 s apart; row 5 is halfway between them.
    const mid = (data.samples[0]!.lon + data.samples[10]!.lon) / 2;
    expect(data.samples[5]!.lon).toBeCloseTo(mid, 8);
  });

  it('honours a TrackAddict-shaped 1 Hz GPS against 10 Hz sensors', () => {
    const a = analyzeGenericCsv(trackAddictLike());
    expect(a.preview.gpsFixCount).toBe(30);
    const data = parseGenericCsvTable(a.table, a.mapping);
    expect(data.samples.length).toBe(291);
    expect(data.samples[3]!.extraFields['Accel Z']).toBeCloseTo(1, 3);
  });
});

// ─── Preview ─────────────────────────────────────────────────────────────────

describe('previewMapping', () => {
  it('reports the numbers a rider can sanity-check a mapping with', () => {
    const { preview } = analyzeGenericCsv(pOnewheelLike());
    expect(preview.rowCount).toBe(300);
    expect(preview.sampleCount).toBe(300);
    expect(preview.firstTimestamp).toBe('2025-06-15T15:06:40.000Z');
    expect(preview.durationMs).toBeCloseTo(29_900, -2);
    expect(preview.sampleRateHz).toBeCloseTo(10, 0);
    expect(preview.firstCoord?.lat).toBeCloseTo(LAT0, 6);
    expect(preview.maxSpeedMps).toBeCloseTo(10, 1);
  });

  it('says "relative" rather than inventing a date for an elapsed timebase', () => {
    const { preview } = analyzeGenericCsv(floatControlLike());
    expect(preview.firstTimestamp).toMatch(/relative/);
  });
});

// ─── Persistence ─────────────────────────────────────────────────────────────

describe('csvMappingStorage', () => {
  beforeEach(installMemoryLocalStorage);

  it('is keyed by the header shape, so the same device is remembered and a different one is not', () => {
    const a = analyzeGenericCsv(pOnewheelLike());
    const b = analyzeGenericCsv(floatControlLike());
    expect(a.headerHash).not.toBe(b.headerHash);

    // Same device, a different ride (different rows, same header) → the same key.
    const secondRide = analyzeGenericCsv(pOnewheelLike().split('\n').slice(0, 50).join('\n'));
    expect(secondRide.headerHash).toBe(a.headerHash);

    saveCsvMapping(a.headerHash, { ...a.mapping, speedUnit: 'mph' }, a.table.columns);
    expect(loadCsvMapping(secondRide.headerHash)?.speedUnit).toBe('mph');
    expect(loadCsvMapping(b.headerHash)).toBeNull();

    expect(listCsvMappings()).toHaveLength(1);
    deleteCsvMapping(a.headerHash);
    expect(loadCsvMapping(a.headerHash)).toBeNull();
  });

  it('a remembered override wins over the auto-proposal on the next import', async () => {
    const csv = vescLikeSubset();
    const a = analyzeGenericCsv(csv);
    // The rider (wrongly, but it is their call) says the m/s column is km/h.
    saveCsvMapping(a.headerHash, { ...a.mapping, speedUnit: 'kph' }, a.table.columns);

    const { importGenericCsvSync } = await import('./genericCsvImport');
    const data = importGenericCsvSync(csv);
    expect(data.samples[50]!.speedMps).toBeCloseTo(10 / 3.6, 2);
  });
});

// ─── Router wiring ───────────────────────────────────────────────────────────

describe('datalogParser routing', () => {
  beforeEach(installMemoryLocalStorage);

  it('routes an otherwise-unknown GPS CSV to the generic parser instead of failing on NMEA', () => {
    const data = parseDatalogContent(floatControlLike());
    expect(data.samples.length).toBe(300);
    expect(data.bounds.minLat).toBeCloseTo(LAT0, 5);
  });

  it('does not steal a file a named parser handles (VESC keeps its own)', () => {
    // A real VESC log has gnss_lat/gnss_lon; the VESC parser must still claim it.
    const csv = vescLikeSubset()
      .replace('gps_lat;gps_long', 'gnss_lat;gnss_lon')
      .replace(/gps_lat/g, 'gnss_lat');
    const data = parseDatalogContent(csv);
    // The VESC parser names its ESC channels; the generic one would pass `erpm` through verbatim.
    const names = data.fieldMappings.map((f) => f.name);
    expect(names.some((n) => n.toLowerCase().includes('erpm') || n === 'rpm')).toBe(true);
    expect(data.samples.length).toBe(291); // same 1 Hz-GNSS trimming as the generic path
  });
});
