/**
 * Speed-heatmap geometry for the Leaflet race-line maps.
 *
 * The maps used to add one polyline layer per GPS segment, which the default
 * SVG renderer turned into one DOM <path> node per sample pair — tens of
 * thousands of nodes on a full session. Instead, the speed range is quantized
 * into a fixed number of color buckets and consecutive same-bucket segments
 * chain into multi-part polylines, so the whole heatmap is ~20 canvas-rendered
 * layers regardless of sample count.
 */

export const HEATMAP_BUCKET_COUNT = 20;

interface HeatmapSample {
  lat: number;
  lon: number;
  speedMph: number;
}

/** Speed → color gradient (green → yellow → orange → red). */
export function getSpeedColor(speedMph: number, minSpeed: number, maxSpeed: number): string {
  const range = maxSpeed - minSpeed;
  const ratio = range > 0 ? Math.min(Math.max((speedMph - minSpeed) / range, 0), 1) : 0.5;

  if (ratio < 0.33) {
    const t = ratio / 0.33;
    const r = Math.round(76 + t * (230 - 76));
    const g = Math.round(175 + t * (180 - 175));
    const b = Math.round(80 - t * 80);
    return `rgb(${r},${g},${b})`;
  } else if (ratio < 0.66) {
    const t = (ratio - 0.33) / 0.33;
    const r = Math.round(230 + t * (240 - 230));
    const g = Math.round(180 - t * 80);
    const b = Math.round(0 + t * 50);
    return `rgb(${r},${g},${b})`;
  } else {
    const t = (ratio - 0.66) / 0.34;
    const r = Math.round(240 - t * 40);
    const g = Math.round(100 - t * 60);
    const b = Math.round(50 - t * 10);
    return `rgb(${r},${g},${b})`;
  }
}

/** Which color bucket a speed falls into. */
export function bucketIndexForSpeed(
  speedMph: number,
  minSpeed: number,
  maxSpeed: number,
  bucketCount: number = HEATMAP_BUCKET_COUNT,
): number {
  const range = maxSpeed - minSpeed;
  if (range <= 0 || bucketCount <= 1) return 0;
  const ratio = Math.min(Math.max((speedMph - minSpeed) / range, 0), 1);
  return Math.min(bucketCount - 1, Math.floor(ratio * bucketCount));
}

export interface HeatmapBucket {
  color: string;
  /** Polyline parts; each part is a chain of [lat, lon] points (≥ 2). */
  parts: [number, number][][];
}

/**
 * Group the race line's segments into per-color-bucket multi-polylines.
 * Segment i (samples i → i+1) keeps its old coloring rule — the speed at
 * sample i — quantized to the bucket's midpoint color. Consecutive segments in
 * the same bucket chain into one part, so parts stay visually continuous:
 * a bucket change starts the next part at the shared point.
 */
export function buildHeatmapSegments(
  samples: ReadonlyArray<HeatmapSample>,
  minSpeed: number,
  maxSpeed: number,
  bucketCount: number = HEATMAP_BUCKET_COUNT,
): HeatmapBucket[] {
  if (samples.length < 2) return [];

  const partsByBucket: [number, number][][][] = Array.from({ length: Math.max(1, bucketCount) }, () => []);

  let runBucket = bucketIndexForSpeed(samples[0].speedMph, minSpeed, maxSpeed, bucketCount);
  let runPart: [number, number][] = [[samples[0].lat, samples[0].lon]];

  for (let i = 1; i < samples.length; i++) {
    runPart.push([samples[i].lat, samples[i].lon]);
    if (i === samples.length - 1) break;
    const nextBucket = bucketIndexForSpeed(samples[i].speedMph, minSpeed, maxSpeed, bucketCount);
    if (nextBucket !== runBucket) {
      partsByBucket[runBucket].push(runPart);
      runPart = [[samples[i].lat, samples[i].lon]];
      runBucket = nextBucket;
    }
  }
  partsByBucket[runBucket].push(runPart);

  const range = maxSpeed - minSpeed;
  const buckets: HeatmapBucket[] = [];
  for (let b = 0; b < partsByBucket.length; b++) {
    if (partsByBucket[b].length === 0) continue;
    const midSpeed = minSpeed + (range * (b + 0.5)) / Math.max(1, bucketCount);
    buckets.push({ color: getSpeedColor(midSpeed, minSpeed, maxSpeed), parts: partsByBucket[b] });
  }
  return buckets;
}
