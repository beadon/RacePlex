import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { isVescCsvFormat, parseVescCsvFile } from './vescCsvParser';
import { parseDatalogContent } from './datalogParser';
import { columnIndex, detectDelimiter, parseCsvTable } from './csvTable';
import { MPS_TO_KPH, haversineDistance } from './parserUtils';

const real = readFileSync(resolve(__dirname, '__fixtures__/vesc-tool.csv'), 'utf-8');

describe('csvTable — the generic engine', () => {
  it('picks the delimiter by counting, not guessing', () => {
    expect(detectDelimiter('a;b;c;d')).toBe(';');
    expect(detectDelimiter('a,b,c,d')).toBe(',');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
  });

  it("doesn't let a comma inside a quoted field win the vote", () => {
    expect(detectDelimiter('"Smith, John";age;city')).toBe(';');
  });

  /**
   * VESC ends every line with a `;`, so a naive split yields one MORE token than there are
   * columns. Anything parsing positionally then runs off the end — which is exactly the class of
   * bug this engine exists to make impossible.
   */
  it('drops the phantom column a trailing delimiter creates', () => {
    const t = parseCsvTable('a;b;c;\n1;2;3;\n');
    expect(t.columns).toEqual(['a', 'b', 'c']);
    expect(t.rows[0]).toEqual(['1', '2', '3']);
  });

  it('keeps # comment lines aside rather than choking on them', () => {
    const t = parseCsvTable('# RaceRender Data: TrackAddict 4.3.7\n"Time","Lat"\n0,1\n');
    expect(t.comments[0]).toContain('TrackAddict');
    expect(t.columns).toEqual(['Time', 'Lat']);
    expect(t.rows[0]).toEqual(['0', '1']);
  });

  /** The VESC Express / SD-card dialect tags each header token `key:name:unit:...`. */
  it('unwraps the tagged header dialect down to the bare key', () => {
    const t = parseCsvTable('kmh_gnss:Speed GNSS:km/h:1:0:0;gnss_lat:Latitude:deg:5:0:0\n1;2\n');
    expect(t.columns).toEqual(['kmh_gnss', 'gnss_lat']);
  });

  it('finds a column by any of its names, ignoring case/underscores/units', () => {
    const cols = ['gnss_lat', 'GPS-Long', 'Altitude (m)'];
    expect(columnIndex(cols, 'latitude', 'gnss_lat')).toBe(0);
    expect(columnIndex(cols, 'gps_long')).toBe(1);
    expect(columnIndex(cols, 'altitude')).toBe(2);
    expect(columnIndex(cols, 'nonesuch')).toBe(-1);
  });
});

describe('isVescCsvFormat', () => {
  it('recognises the real log', () => {
    expect(isVescCsvFormat(real)).toBe(true);
  });

  it('recognises the tagged VESC Express dialect too', () => {
    expect(isVescCsvFormat('ms_today:Time:ms:0:1:1;gnss_lat:Lat:deg:5:0:0;gnss_lon:Lon:deg:5:0:0\n')).toBe(
      true,
    );
  });

  it('ignores CSVs that are not VESC', () => {
    expect(isVescCsvFormat('Record,Time,Latitude,Longitude,Lap,GForceX\n')).toBe(false);
    expect(isVescCsvFormat('name,email\n')).toBe(false);
  });
});

describe('parseVescCsvFile — a real Onewheel ride', () => {
  const parsed = parseVescCsvFile(real);

  /**
   * THE headline behaviour, and the one that is easy to get subtly wrong.
   *
   * The ESC logs at ~12 Hz; the GNSS only fixes at ~1 Hz. So the same lat/lon is repeated across a
   * dozen consecutive rows.
   *
   * The tempting fix is to keep one sample per GPS fix. That is WRONG: it also drops the ESC
   * channels to 1 Hz — and a nosedive is a duty-cycle spike lasting a fraction of a second. At
   * 1 Hz you cannot see one, which would make the import worthless for the exact thing it exists
   * for.
   *
   * So we keep every ESC row and interpolate the position between fixes: full-rate motor data AND
   * a smooth track.
   */
  it('keeps every ESC row at full rate, rather than downsampling to the GPS rate', () => {
    const table = parseCsvTable(real);
    expect(table.rows.length).toBe(400);

    // Nearly every row survives (we trim only what falls outside the first/last GPS fix).
    expect(parsed.samples.length).toBeGreaterThan(300);

    // The ESC channels therefore keep their ~12 Hz resolution...
    const dts: number[] = [];
    for (let i = 1; i < parsed.samples.length; i++) {
      dts.push(parsed.samples[i].t - parsed.samples[i - 1].t);
    }
    dts.sort((a, b) => a - b);
    const medianDt = dts[Math.floor(dts.length / 2)];
    expect(medianDt).toBeLessThan(150); // ms — i.e. faster than 7 Hz, not 1 Hz
  });

  it('interpolates the position between fixes instead of stair-stepping the track', () => {
    // A staircase shows up as long runs of identical coordinates. After interpolation, consecutive
    // samples should almost always differ while the board is moving.
    let identical = 0;
    for (let i = 1; i < parsed.samples.length; i++) {
      const a = parsed.samples[i - 1];
      const b = parsed.samples[i];
      if (a.lat === b.lat && a.lon === b.lon) identical++;
    }
    // Allow a few (the board is stationary at times); reject a staircase (which would be ~90%).
    expect(identical / parsed.samples.length).toBeLessThan(0.3);
  });

  /**
   * A stair-stepped track produces a speed derived from position that alternates between zero and
   * a spike. Interpolation should keep it sane — assert no physically absurd jumps.
   */
  it('produces a position trace with no teleports', () => {
    let worst = 0;
    for (let i = 1; i < parsed.samples.length; i++) {
      const a = parsed.samples[i - 1];
      const b = parsed.samples[i];
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0) continue;
      worst = Math.max(worst, haversineDistance(a.lat, a.lon, b.lat, b.lon) / dt);
    }
    expect(worst).toBeLessThan(30); // m/s — 108 km/h; a Onewheel does not do that
  });

  it('does not claim rows were "rejected" — they were kept', () => {
    // An earlier version reported the repeated-fix rows as 368 "short-row rejections", which told
    // the rider their file was broken when it was fine.
    expect(parsed.parserStats).toBeUndefined();
  });

  it('reads the position (a real ride near Melbourne)', () => {
    expect(parsed.samples[0].lat).toBeCloseTo(-37.71, 1);
    expect(parsed.samples[0].lon).toBeCloseTo(145.03, 1);
  });

  /**
   * `gnss_gVel` is metres per second — NOT km/h, despite `kmh_gnss` being the name everyone cites.
   * That name is one of vesc_tool's internal display labels and never appears on disk.
   *
   * If we read it as km/h, every speed would come out 3.6x too low — and still look plausible.
   */
  it('reads gnss_gVel as m/s, not km/h', () => {
    const maxKph = Math.max(...parsed.samples.map((s) => s.speedKph));
    // A Onewheel cruising: ~19 km/h top. As km/h misread it would be ~5 km/h — walking pace.
    expect(maxKph).toBeGreaterThan(12);
    expect(maxKph).toBeLessThan(30);
  });

  it('agrees with speed derived independently from the positions', () => {
    const ratios: number[] = [];
    for (let i = 1; i < parsed.samples.length; i++) {
      const a = parsed.samples[i - 1];
      const b = parsed.samples[i];
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0) continue;
      const derived = haversineDistance(a.lat, a.lon, b.lat, b.lon) / dt;
      if (derived < 2 || b.speedMps < 2) continue;
      ratios.push(b.speedMps / derived);
    }
    ratios.sort((x, y) => x - y);
    const median = ratios[Math.floor(ratios.length / 2)];
    // ~1.0 confirms m/s. It would be 3.6 (or 1/3.6) if we had the unit wrong.
    expect(median).toBeGreaterThan(0.85);
    expect(median).toBeLessThan(1.15);
    expect(MPS_TO_KPH).toBeCloseTo(3.6, 5); // guard the constant this all hangs on
  });

  /**
   * The whole reason to import a VESC log rather than a GPX of the same ride: the ESC channels.
   * A nosedive is a duty-cycle event that a GPS trace only sees the aftermath of.
   */
  it('brings the ESC channels along — motor current, battery sag, duty cycle, ERPM', () => {
    const s = parsed.samples.find((x) => x.extraFields['ERPM'] !== undefined)!;
    expect(s).toBeDefined();
    expect(s.extraFields['Duty Cycle']).toBeDefined();
    expect(s.extraFields['Motor Current (A)']).toBeDefined();
    expect(s.extraFields['Battery Voltage (V)']).toBeGreaterThan(20);

    // And they're switched ON by default — they are the point, not an optional extra.
    const names = parsed.fieldMappings.filter((f) => f.enabled).map((f) => f.name);
    expect(names).toContain('Motor Current (A)');
    expect(names).toContain('Duty Cycle');
  });

  it('starts at t=0 and runs forward', () => {
    expect(parsed.samples[0].t).toBe(0);
    expect(parsed.duration).toBeGreaterThan(0);
    for (let i = 1; i < parsed.samples.length; i++) {
      expect(parsed.samples[i].t).toBeGreaterThanOrEqual(parsed.samples[i - 1].t);
    }
  });
});

describe('degenerate input', () => {
  it('refuses a log whose GNSS never locked, rather than inventing a ride at (0,0)', () => {
    const noFix =
      'ms_today;erpm;gnss_lat;gnss_lon;gnss_gVel;\n' +
      '1000;0;0.00000000;0.00000000;0;\n' +
      '1100;0;0.00000000;0.00000000;0;\n';
    expect(() => parseVescCsvFile(noFix)).toThrow(/no GPS fixes/i);
  });

  it('handles a subset log with columns in a different order (Float Control / Floaty shape)', () => {
    // Positional parsing would produce garbage here. Name-based parsing does not care.
    const subset =
      'gnss_lon;gnss_lat;ms_today;gnss_gVel;\n' +
      '145.0361;-37.7110;1000;5.0;\n' +
      '145.0362;-37.7111;1100;5.5;\n';
    const p = parseVescCsvFile(subset);
    expect(p.samples).toHaveLength(2);
    expect(p.samples[0].lat).toBeCloseTo(-37.711, 3);
    expect(p.samples[0].lon).toBeCloseTo(145.0361, 3);
    expect(p.samples[1].speedMps).toBeCloseTo(5.5, 2);
  });
});

describe('dispatch', () => {
  it('routes a VESC log through parseDatalogContent', () => {
    const p = parseDatalogContent(real);
    expect(p.samples.length).toBeGreaterThan(20);
    expect(p.samples[0].lat).toBeCloseTo(-37.71, 1);
  });
});
