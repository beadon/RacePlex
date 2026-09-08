/**
 * React binding for `holdToConfirm.ts`'s pure state machine — drives it off a
 * `requestAnimationFrame` loop while a pointer is held down, so a component
 * gets live 0-1 progress to animate (e.g. a filling ring) plus a single
 * `onConfirm` call the instant the hold completes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { IDLE_HOLD_STATE, startHold, cancelHold, updateHold, type HoldState } from "@/lib/holdToConfirm";

export interface HoldToConfirmController {
  /** 0-1 progress toward completion; 0 while not held. */
  progress: number;
  /** Spread onto the control's pointer handlers. */
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerLeave: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}

export function useHoldToConfirm(durationMs: number, onConfirm: () => void): HoldToConfirmController {
  const [progress, setProgress] = useState(0);
  const stateRef = useRef<HoldState>(IDLE_HOLD_STATE);
  const rafRef = useRef<number | null>(null);
  const onConfirmRef = useRef(onConfirm);
  useEffect(() => {
    onConfirmRef.current = onConfirm;
  }, [onConfirm]);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // A plain local function (not a hook), created fresh per press, so its
  // recursive `requestAnimationFrame(loop)` self-reference is ordinary JS
  // closure semantics rather than a hook self-reference the lint rules flag.
  const begin = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      stateRef.current = startHold(performance.now());
      stopLoop();

      const loop = () => {
        const { state, justCompleted } = updateHold(stateRef.current, performance.now(), durationMs);
        stateRef.current = state;
        setProgress(state.progress);
        if (justCompleted) {
          stopLoop();
          stateRef.current = cancelHold();
          setProgress(0);
          onConfirmRef.current();
          return;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    },
    [durationMs, stopLoop],
  );

  const release = useCallback(() => {
    stopLoop();
    stateRef.current = cancelHold();
    setProgress(0);
  }, [stopLoop]);

  return {
    progress,
    handlers: {
      onPointerDown: begin,
      onPointerUp: release,
      onPointerLeave: release,
      onPointerCancel: release,
    },
  };
}
