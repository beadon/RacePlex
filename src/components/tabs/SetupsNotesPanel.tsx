import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Which of the two panels the small-screen tab bar has selected. */
export type SetupsNotesTab = "setups" | "notes";

interface SetupsNotesPanelProps {
  /**
   * The panel the user picked from the toolbar. Only affects the small-screen
   * (single-panel) layout — at `md` and up both panels are always visible.
   */
  active: SetupsNotesTab;
  /** The Setups panel content (rendered on the left half at `md`+). */
  setups: ReactNode;
  /** The Notes panel content (rendered on the right half at `md`+). */
  notes: ReactNode;
}

/**
 * Responsive container that hosts the Setups and Notes panels together.
 *
 * - **Below `md`** (phones): only the `active` panel is shown, full width. The
 *   toolbar exposes Setups and Notes as two separate tabs there.
 * - **`md` and up** (tablets/desktop): both panels sit side by side in a 50/50
 *   split, reclaiming the horizontal space a single centred panel wastes. The
 *   toolbar collapses to one combined "Setups & Notes" tab.
 *
 * Both panels stay mounted at every breakpoint and visibility is pure CSS, so
 * crossing the breakpoint (or switching the small-screen tab) never remounts a
 * panel or drops its in-progress form state.
 */
export function SetupsNotesPanel({ active, setups, notes }: SetupsNotesPanelProps) {
  return (
    <div className="h-full flex">
      <SplitHalf show={active === "setups"} className="md:border-r md:border-border">
        {setups}
      </SplitHalf>
      <SplitHalf show={active === "notes"}>{notes}</SplitHalf>
    </div>
  );
}

/**
 * One half of the split. Hidden on small screens unless it's the active panel;
 * always an equal-width column at `md`+ (the responsive utilities override the
 * small-screen `hidden`/`w-full` via their media query).
 */
function SplitHalf({
  show,
  className,
  children,
}: {
  show: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 min-h-0 flex-col overflow-hidden md:flex md:w-1/2",
        show ? "flex w-full" : "hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}
