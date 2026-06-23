import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { VideoOff } from 'lucide-react';
import type { VideoSyncState } from '@/hooks/useVideoSync';
import { usePlaybackContext } from '@/contexts/PlaybackContext';

/**
 * A passive, second <video> element for the split-graphs secondary panel.
 *
 * It shares the main player's recording (same source + sync offset) but seeks
 * independently to the overlay lap's own time. Because it is mounted inside the
 * secondary panel's overridden PlaybackProvider, `currentSample` here is the
 * overlay lap's sample at the distance-matched cursor position — so the two
 * videos show the same point on track in their respective footage.
 *
 * There is no transport UI: the shared playback control (main panel) drives the
 * cursor, and this element follows it by seeking. Audio is muted to avoid
 * doubling the main player's sound.
 */
interface SecondaryVideoProps {
  videoState: VideoSyncState;
}

export function SecondaryVideo({ videoState }: SecondaryVideoProps) {
  const { t } = useTranslation('session');
  const { currentSample } = usePlaybackContext();
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentSrcRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<number | null>(null);

  const { syncOffsetMs, exportChunks, videoDuration } = videoState;

  // The virtual (whole-recording) time the overlay lap maps to at the cursor.
  const telemetryMs = currentSample?.t ?? null;
  const videoSec = telemetryMs === null ? null : (telemetryMs - syncOffsetMs) / 1000;
  const inRange = videoSec !== null && videoSec >= 0 && videoSec <= videoDuration && exportChunks.length > 0;

  // Resolve which chunk holds this virtual time, plus the local offset within it.
  const target = (() => {
    if (!inRange || videoSec === null) return null;
    const chunk =
      exportChunks.find((c) => videoSec >= c.startOffsetSec && videoSec < c.startOffsetSec + c.durationSec) ??
      exportChunks[exportChunks.length - 1];
    return { url: chunk.url, localSec: Math.max(0, videoSec - chunk.startOffsetSec) };
  })();

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !target) return;

    // Swap the source when the cursor crosses a chunk boundary; defer the seek
    // until the new chunk has metadata.
    if (currentSrcRef.current !== target.url) {
      currentSrcRef.current = target.url;
      pendingSeekRef.current = target.localSec;
      video.src = target.url;
      video.load();
      return;
    }

    // Same chunk: nudge to the target frame only when meaningfully off, so we
    // don't fight the element with sub-frame seeks every tick.
    if (Math.abs(video.currentTime - target.localSec) > 0.05) {
      try {
        video.currentTime = target.localSec;
      } catch {
        // Seeking before metadata is ready throws; the loadedmetadata handler
        // below applies the pending seek instead.
        pendingSeekRef.current = target.localSec;
      }
    }
  }, [target?.url, target?.localSec, target]);

  // Apply a deferred seek once a freshly-swapped chunk is ready.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onReady = () => {
      if (pendingSeekRef.current !== null) {
        try {
          video.currentTime = pendingSeekRef.current;
        } catch {
          /* still not ready — a later tick will retry */
        }
        pendingSeekRef.current = null;
      }
    };
    video.addEventListener('loadedmetadata', onReady);
    return () => video.removeEventListener('loadedmetadata', onReady);
  }, []);

  return (
    <div className="relative h-full w-full bg-black">
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        muted
        playsInline
        preload="auto"
      />
      {!inRange && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground bg-black/70">
          <VideoOff className="h-6 w-6" />
          <span className="text-xs">{t('graphs.splitVideoOutOfRange')}</span>
        </div>
      )}
    </div>
  );
}
