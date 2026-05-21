import { Button } from "@/components/ui/button";
import { FileText, Map } from "lucide-react";

export type EditorMode = "manual" | "visual";

interface EditorModeToggleProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
}

/**
 * Tiny manual/visual toggle for the track editor. Lives in its own file so
 * consumers can import the toggle statically while lazy-loading the heavy
 * `VisualEditor` component (which pulls in Leaflet + drawing tools).
 */
export function EditorModeToggle({ mode, onModeChange }: EditorModeToggleProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit">
      <Button
        variant={mode === "manual" ? "default" : "ghost"}
        size="sm"
        className="h-7 px-3 text-xs gap-1.5"
        onClick={() => onModeChange("manual")}
      >
        <FileText className="w-3.5 h-3.5" />
        Manual
      </Button>
      <Button
        variant={mode === "visual" ? "default" : "ghost"}
        size="sm"
        className="h-7 px-3 text-xs gap-1.5"
        onClick={() => onModeChange("visual")}
      >
        <Map className="w-3.5 h-3.5" />
        Visual
      </Button>
    </div>
  );
}
