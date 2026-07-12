import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { GpsSample } from '@/types/racing';

interface UsePlaybackOptions {
  samples: GpsSample[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  visibleRange: [number, number];
}

interface UsePlaybackReturn {
  isPlaying: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  averageFrameRate: number | null; // Hz
}

/**
 * Hook to manage playback of telemetry data at realistic speed.
 * Animates through samples based on their actual timestamps.
 *
 * The rAF loop reads its inputs through refs and is (re)subscribed only when
 * playback starts/stops — never per index change. The old loop depended on
 * `currentIndex`, so every tick cancelled and recreated the rAF and reset the
 * timing anchors: playback advanced at most one frame per two rAF frames and
 * constantly re-anchored its clock, so 60 Hz data could not play at real time.
 */
export function usePlayback({
  samples,
  currentIndex,
  onIndexChange,
  visibleRange,
}: UsePlaybackOptions): UsePlaybackReturn {
  const [isPlaying, setIsPlaying] = useState(false);

  // Latest inputs, readable from inside the loop without re-subscribing it.
  const samplesRef = useRef(samples);
  const onIndexChangeRef = useRef(onIndexChange);
  const visibleRangeRef = useRef(visibleRange);
  const currentIndexRef = useRef(currentIndex);
  useEffect(() => { samplesRef.current = samples; }, [samples]);
  useEffect(() => { onIndexChangeRef.current = onIndexChange; }, [onIndexChange]);
  useEffect(() => { visibleRangeRef.current = visibleRange; }, [visibleRange]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  // Calculate average frame rate from sample timestamps. Memoized on the
  // sample window — the old useCallback(...)() IIFE memoized the *function*
  // and re-diffed + re-sorted the whole window on every render (every
  // playback tick) for a constant value.
  const averageFrameRate = useMemo((): number | null => {
    if (samples.length < 2) return null;

    const timeDiffs: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      const diff = samples[i].t - samples[i - 1].t;
      if (diff > 0 && diff < 1000) { // Ignore gaps > 1 second
        timeDiffs.push(diff);
      }
    }
    if (timeDiffs.length === 0) return null;

    // Median to be robust against outliers
    timeDiffs.sort((a, b) => a - b);
    const medianInterval = timeDiffs[Math.floor(timeDiffs.length / 2)];
    return 1000 / medianInterval;
  }, [samples]);

  // Stop playback when visible range changes
  const rangeStart = visibleRange[0];
  const rangeEnd = visibleRange[1];
  useEffect(() => {
    setIsPlaying(false);
  }, [rangeStart, rangeEnd]);

  // The playback loop. Subscribed once per play; all per-tick state lives in
  // locals/refs. An external scrub mid-playback (currentIndex changing to a
  // value the loop didn't emit) re-anchors the clock at the new position.
  useEffect(() => {
    if (!isPlaying) return;
    if (samplesRef.current.length === 0) {
      setIsPlaying(false);
      return;
    }

    let raf: number;
    let startTimestamp = 0;
    let baseDataTime = 0;
    let emittedIndex = currentIndexRef.current;

    const step = (timestamp: number) => {
      const samples = samplesRef.current;
      const maxIndex = Math.min(
        samples.length - 1,
        visibleRangeRef.current[1] - visibleRangeRef.current[0],
      );
      if (maxIndex < 0) {
        setIsPlaying(false);
        return;
      }

      // First frame, or the user scrubbed while playing → anchor the clock
      // at the current position.
      if (startTimestamp === 0 || currentIndexRef.current !== emittedIndex) {
        emittedIndex = Math.min(currentIndexRef.current, maxIndex);
        startTimestamp = timestamp;
        baseDataTime = samples[emittedIndex]?.t ?? 0;
        raf = requestAnimationFrame(step);
        return;
      }

      // Advance to the sample matching the elapsed real time.
      const targetDataTime = baseDataTime + (timestamp - startTimestamp);
      let idx = emittedIndex;
      while (idx < maxIndex && samples[idx + 1] && samples[idx + 1].t <= targetDataTime) {
        idx++;
      }

      if (idx >= maxIndex) {
        emittedIndex = maxIndex;
        currentIndexRef.current = maxIndex;
        onIndexChangeRef.current(maxIndex);
        setIsPlaying(false);
        return;
      }

      if (idx !== emittedIndex) {
        emittedIndex = idx;
        currentIndexRef.current = idx;
        onIndexChangeRef.current(idx);
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  const play = useCallback(() => {
    if (samplesRef.current.length === 0) return;

    // If at the end, restart from beginning
    const maxIndex = visibleRangeRef.current[1] - visibleRangeRef.current[0];
    if (currentIndexRef.current >= maxIndex) {
      currentIndexRef.current = 0;
      onIndexChangeRef.current(0);
    }

    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  return {
    isPlaying,
    play,
    pause,
    toggle,
    averageFrameRate,
  };
}
