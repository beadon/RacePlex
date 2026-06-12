import { createContext, useContext } from 'react';
import type { GpsSample } from '@/types/racing';

/**
 * The playback cursor, deliberately split out of SessionContext: the cursor
 * advances at playback rate (up to the data's sample rate), and a context
 * update re-renders every consumer regardless of memo(). With the cursor in
 * its own context, only the components that actually track it (charts, maps,
 * video player) re-render per tick — the rest of the session tree, including
 * the memo'd view tabs, stays quiet during playback.
 */
export interface PlaybackContextValue {
  /** Scrub index into the visible window's samples. */
  currentIndex: number;
  /** The sample at currentIndex, or null when out of range. */
  currentSample: GpsSample | null;
}

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

export function PlaybackProvider({
  children, value,
}: { children: React.ReactNode; value: PlaybackContextValue }) {
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook conventionally co-located with its provider
export function usePlaybackContext(): PlaybackContextValue {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error('usePlaybackContext must be used within PlaybackProvider');
  return ctx;
}
