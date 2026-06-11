/**
 * Pure math for the maps' position-arrow marker.
 */

interface MarkerSample {
  lat: number;
  lon: number;
  heading?: number;
}

/**
 * Heading (degrees, 0 = north) for the position marker at `currentIndex`:
 * the sample's own heading when present, otherwise the bearing derived from
 * movement since the previous sample, otherwise 0.
 */
export function markerHeading(samples: ReadonlyArray<MarkerSample>, currentIndex: number): number {
  const sample = samples[currentIndex];
  if (!sample) return 0;

  let heading = sample.heading ?? 0;
  if (heading === 0 && currentIndex > 0) {
    const prev = samples[currentIndex - 1];
    const dLat = sample.lat - prev.lat;
    const dLon = sample.lon - prev.lon;
    if (Math.abs(dLat) > 0.00001 || Math.abs(dLon) > 0.00001) {
      heading = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
    }
  }
  return heading;
}
