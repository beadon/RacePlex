import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { VideoOff } from 'lucide-react';
import type { VideoSyncState } from '@/hooks/useVideoSync';
import { usePlaybackContext } from '@/contexts/PlaybackContext';
import { coverageOf, sessionMsToVideoSec, type VideoCoverage } from '@/lib/videoTimeline';

/**
 * A second <video> for the split-graphs comparison panel, frame-locked to the
 * main player.
 *
 * It shares the main recording (same source + `syncOffsetMs`) but tracks the
 * overlay lap's own footage: mounted inside the secondary panel's overridden
 * PlaybackProvider, `currentSample` here is the overlay lap's sample at the
 * distance-matched cursor position, so both videos show the same point on track.
 *
 * Sync model: the main player is the master clock (its frame callback drives the
 * shared cursor). This element actively plays when the main does and trims its
 * own playbackRate to converge on the cursor-derived target — smooth motion that
 * stays locked even though the overlay lap advances at a different pace. Audio is
 * muted (the main owns sound). Where the overlay point has no footage the panel
 * blanks but the cursor keeps running.
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

  const { syncOffsetMs, exportChunks, videoDuration, isPlaying } = videoState;

  const coverage: VideoCoverage = currentSample
    ? coverageOf(currentSample.t, syncOffsetMs, videoDuration)
    : 'before';
  const covered = coverage === 'covered' && exportChunks.length > 0;

  // Resolve the target footage position (virtual time + chunk) for the cursor.
  const target = useMemo(() => {
    if (!covered || !currentSample) return null;
    const virtualSec = sessionMsToVideoSec(currentSample.t, syncOffsetMs);
    const chunk =
      exportChunks.find((c) => virtualSec >= c.startOffsetSec && virtualSec < c.startOffsetSec + c.durationSec) ??
      exportChunks[exportChunks.length - 1];
    return {
      virtualSec,
      chunkUrl: chunk.url,
      chunkStart: chunk.startOffsetSec,
      localSec: Math.max(0, virtualSec - chunk.startOffsetSec),
    };
  }, [covered, currentSample, syncOffsetMs, exportChunks]);

  // The playback loop reads the latest target without re-subscribing per tick.
  const targetRef = useRef(target);
  targetRef.current = target;

  // Swap the <video> source when the cursor crosses a chunk boundary; defer the
  // seek until the new chunk's metadata loads.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !target) return;
    if (currentSrcRef.current !== target.chunkUrl) {
      currentSrcRef.current = target.chunkUrl;
      pendingSeekRef.current = target.localSec;
      video.src = target.chunkUrl;
      video.load();
    }
  }, [target?.chunkUrl, target?.localSec, target]);

  // Apply a deferred seek once a freshly-swapped chunk is ready.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onReady = () => {
      if (pendingSeekRef.current !== null) {
        try { video.currentTime = pendingSeekRef.current; } catch { /* retry next tick */ }
        pendingSeekRef.current = null;
      }
    };
    video.addEventListener('loadedmetadata', onReady);
    return () => video.removeEventListener('loadedmetadata', onReady);
  }, []);

  // Paused / scrubbing: hold on the exact target frame.
  useEffect(() => {
    if (isPlaying) return;
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) video.pause();
    video.playbackRate = 1;
    if (target && currentSrcRef.current === target.chunkUrl && Math.abs(video.currentTime - target.localSec) > 0.05) {
      try { video.currentTime = target.localSec; } catch { /* not ready */ }
    }
  }, [isPlaying, target?.localSec, target?.chunkUrl, target]);

  // Playing: actively play and lock to the moving target. The target advances
  // non-linearly (overlay lap has its own pace), so trim playbackRate to
  // converge for smooth motion; hard-seek only on a big jump.
  useEffect(() => {
    const video = videoRef.current;
    if (!isPlaying || !covered || !video) {
      if (video && !video.paused) video.pause();
      if (video) video.playbackRate = 1;
      return;
    }
    video.play().catch(() => {});
    let raf = 0;
    let active = true;
    const loop = () => {
      if (!active) return;
      const v = videoRef.current;
      const tgt = targetRef.current;
      if (v && tgt && currentSrcRef.current === tgt.chunkUrl) {
        const elementVirtual = tgt.chunkStart + v.currentTime;
        const drift = elementVirtual - tgt.virtualSec; // >0 ahead, <0 behind
        if (Math.abs(drift) > 0.3) {
          try { v.currentTime = tgt.localSec; } catch { /* ignore */ }
          v.playbackRate = 1;
        } else {
          v.playbackRate = Math.max(0.5, Math.min(1.5, 1 - drift * 1.5));
        }
        if (v.paused) v.play().catch(() => {});
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      active = false;
      cancelAnimationFrame(raf);
      video.playbackRate = 1;
    };
  }, [isPlaying, covered]);

  return (
    <div className="relative h-full w-full bg-black">
      <video ref={videoRef} className="h-full w-full object-contain" muted playsInline preload="auto" />
      {!covered && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground bg-black/70">
          <VideoOff className="h-6 w-6" />
          <span className="text-xs">
            {coverage === 'after' ? t('graphs.splitVideoEnded') : t('graphs.splitVideoStartsLater')}
          </span>
        </div>
      )}
    </div>
  );
}
