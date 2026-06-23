import { useCallback, useMemo } from 'react';
import { GpsSample, Course, FieldMapping, Lap } from '@/types/racing';
import type { OverlayLine } from '@/lib/lapOverlays';
import type { VideoSyncState } from '@/hooks/useVideoSync';
import { PlaybackProvider, usePlaybackContext, type PlaybackContextValue } from '@/contexts/PlaybackContext';
import { calculateDistanceArray, mapIndexByDistance } from '@/lib/referenceUtils';
import { GraphPanel } from './GraphPanel';
import { MiniMap } from './MiniMap';
import { SecondaryVideo } from './SecondaryVideo';

interface SecondaryGraphStackProps {
  /** The overlay lap this panel mirrors (its own samples + label/colour). */
  overlay: OverlayLine;
  /** Graph set + heights mirrored from the main panel. */
  activeGraphs: string[];
  graphHeights: Record<string, number>;
  /** Main panel's full lap + visible window, for distance-mapping the cursor. */
  mainFilteredSamples: GpsSample[];
  visibleRange: [number, number];
  // Passthrough chart inputs (shared with the main panel).
  referenceSamples: GpsSample[];
  fieldMappings: FieldMapping[];
  course: Course | null;
  laps: Lap[];
  selectedLapNumber: number | null;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  sessionFileName: string | null;
  /** Move the shared cursor (scrubbing the mirror maps back onto the main lap). */
  onScrub: (index: number) => void;
  /** When set, mirror the relocated video as a passive, lap-synced second player. */
  videoState?: VideoSyncState;
  videoEnabled?: boolean;
}

const NO_OVERLAYS: OverlayLine[] = [];

/**
 * The right-hand stack of a split-graphs comparison. It mirrors the main panel's
 * graph set but renders them from the selected overlay lap's data, and overrides
 * the playback cursor for its subtree so every chart/map/video lands on the same
 * track position as the main cursor — in the overlay lap's own time.
 */
export function SecondaryGraphStack(props: SecondaryGraphStackProps) {
  const {
    overlay, activeGraphs, graphHeights, mainFilteredSamples, visibleRange,
    referenceSamples, fieldMappings, course, laps, selectedLapNumber, bounds,
    sessionFileName, onScrub, videoState, videoEnabled = false,
  } = props;

  // Cumulative distance for both laps — recomputed only when a lap changes, so
  // the per-tick cursor mapping is just a binary search.
  const { mainFullD, overlayFullD } = useMemo(() => ({
    mainFullD: calculateDistanceArray(mainFilteredSamples),
    overlayFullD: calculateDistanceArray(overlay.samples),
  }), [mainFilteredSamples, overlay.samples]);

  // Crop the overlay lap to the same track-position window as the main panel.
  const oStart = mapIndexByDistance(mainFullD, overlayFullD, visibleRange[0]);
  const oEnd = mapIndexByDistance(mainFullD, overlayFullD, visibleRange[1]);
  const secSamples = useMemo(
    () => overlay.samples.slice(oStart, oEnd + 1),
    [overlay.samples, oStart, oEnd],
  );

  // Override the playback cursor for the mirror subtree: the main cursor's track
  // position, resolved into the overlay lap's own sample.
  const mapToInner = useCallback((mainIndex: number): PlaybackContextValue => {
    const absMain = visibleRange[0] + mainIndex;
    const oIdx = mapIndexByDistance(mainFullD, overlayFullD, absMain);
    const secIdx = Math.max(0, Math.min(oIdx - oStart, secSamples.length - 1));
    return { currentIndex: secIdx, currentSample: secSamples[secIdx] ?? null };
  }, [visibleRange, mainFullD, overlayFullD, oStart, secSamples]);

  // Scrubbing the mirror moves the shared cursor: map the overlay index back
  // onto the main lap's visible window (onScrub indexes into that window).
  const handleSecondaryScrub = useCallback((secIndex: number) => {
    const absOverlay = oStart + secIndex;
    const mainAbs = mapIndexByDistance(overlayFullD, mainFullD, absOverlay);
    const windowMax = visibleRange[1] - visibleRange[0];
    const mainVisible = Math.max(0, Math.min(mainAbs - visibleRange[0], windowMax));
    onScrub(mainVisible);
  }, [oStart, overlayFullD, mainFullD, visibleRange, onScrub]);

  const renderVideo = videoEnabled && videoState
    ? () => <SecondaryVideo videoState={videoState} />
    : undefined;

  const renderMiniMap = useCallback(() => (
    <MiniMap
      samples={secSamples}
      allSamples={overlay.samples}
      course={course}
      bounds={bounds}
      rangeStart={oStart}
    />
  ), [secSamples, overlay.samples, course, bounds, oStart]);

  // The mirrored GraphPanel is created once per (non-cursor) render; CursorBridge
  // re-renders per playback tick but reuses this element, so only the cursor-
  // tracking children inside it re-render.
  const panel = (
    <GraphPanel
      secondary
      controlledActiveGraphs={activeGraphs}
      controlledGraphHeights={graphHeights}
      samples={secSamples}
      filteredSamples={overlay.samples}
      referenceSamples={referenceSamples}
      fieldMappings={fieldMappings}
      onScrub={handleSecondaryScrub}
      visibleRange={[oStart, oEnd]}
      onRangeChange={() => {}}
      minRange={1}
      formatRangeLabel={() => ''}
      sessionFileName={sessionFileName}
      overlayLines={NO_OVERLAYS}
      course={course}
      laps={laps}
      selectedLapNumber={selectedLapNumber}
      renderVideo={renderVideo}
      renderMiniMap={renderMiniMap}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-muted/30 px-2 py-1">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: overlay.color }} />
        <span className="truncate font-mono text-xs text-muted-foreground">{overlay.label}</span>
      </div>
      <div className="min-h-0 flex-1">
        <CursorBridge mapToInner={mapToInner}>{panel}</CursorBridge>
      </div>
    </div>
  );
}

/**
 * Reads the shared (outer) playback cursor and supplies the mirror subtree a
 * remapped cursor. Isolated so a playback tick re-renders only this bridge plus
 * the cursor-tracking leaves — never the mirrored GraphPanel element above.
 */
function CursorBridge({
  mapToInner, children,
}: {
  mapToInner: (mainIndex: number) => PlaybackContextValue;
  children: React.ReactNode;
}) {
  const { currentIndex } = usePlaybackContext();
  const value = useMemo(() => mapToInner(currentIndex), [mapToInner, currentIndex]);
  return <PlaybackProvider value={value}>{children}</PlaybackProvider>;
}
