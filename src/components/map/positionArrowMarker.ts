import L from 'leaflet';
import { markerHeading } from '@/lib/mapMarker';

interface PositionSample {
  lat: number;
  lon: number;
  heading?: number;
}

/** Side length (px) of the square position-arrow icon. Centered anchor, so its
 *  half-extent (ARROW_MARKER_SIZE / 2) is how far the marker reaches from its
 *  GPS point to its visual edge — used by follow-pan to snap when the arrow's
 *  edge touches the viewport border. */
export const ARROW_MARKER_SIZE = 20;

/** SVG triangle/arrow marker pointing up; rotated per tick via CSS transform. */
function createArrowIcon(): L.DivIcon {
  const svg = `
    <svg width="${ARROW_MARKER_SIZE}" height="${ARROW_MARKER_SIZE}" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"
         style="transform-origin: center;">
      <polygon
        points="10,2 18,18 10,14 2,18"
        fill="hsl(180, 70%, 55%)"
        stroke="hsl(220, 20%, 10%)"
        stroke-width="1.5"
      />
    </svg>
  `;
  return L.divIcon({
    html: svg,
    className: 'arrow-marker',
    iconSize: [ARROW_MARKER_SIZE, ARROW_MARKER_SIZE],
    iconAnchor: [ARROW_MARKER_SIZE / 2, ARROW_MARKER_SIZE / 2],
  });
}

/**
 * Create-or-move the playback position arrow. The cursor advances at playback
 * rate, and removing + re-creating an L.marker (a DOM node + fresh divIcon
 * HTML) every tick churns the DOM at up to the data's Hz. Instead the marker
 * is created once; each tick is a setLatLng plus a CSS rotation on the
 * existing SVG element. Returns the marker to keep (or null when out of range).
 */
export function updatePositionMarker(
  map: L.Map,
  existing: L.Marker | null,
  samples: ReadonlyArray<PositionSample>,
  currentIndex: number,
): L.Marker | null {
  if (currentIndex < 0 || currentIndex >= samples.length) {
    if (existing) map.removeLayer(existing);
    return null;
  }

  const sample = samples[currentIndex];
  let marker = existing;
  if (!marker) {
    marker = L.marker([sample.lat, sample.lon], { icon: createArrowIcon() }).addTo(map);
  } else {
    marker.setLatLng([sample.lat, sample.lon]);
  }

  const svg = marker.getElement()?.querySelector('svg');
  if (svg) (svg as SVGElement).style.transform = `rotate(${markerHeading(samples, currentIndex)}deg)`;
  return marker;
}
