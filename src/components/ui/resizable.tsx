import { GripVertical } from "lucide-react";
import { forwardRef, useImperativeHandle, type ComponentProps } from "react";
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
  useGroupRef,
  type PanelImperativeHandle,
  type GroupImperativeHandle,
} from "react-resizable-panels";

import { cn } from "@/lib/utils";

// v4 API renames:
// - <PanelGroup> → <Group>
// - <PanelResizeHandle> → <Separator>
// - direction="horizontal" → orientation="horizontal"
// - <Panel ref={r}> where r: ImperativePanelHandle
//   → <Panel panelRef={r}> where r = usePanelRef()
// - <PanelGroup ref={r}> where r: ImperativePanelGroupHandle
//   → <Group groupRef={r}> where r = useGroupRef()
// - Panel onCollapse/onExpand removed → derive from onResize prev vs next
// - Panel `order` prop removed → derive from render order
//
// The shadcn wrapper keeps its old public shape (direction, ref) so callers
// stay untouched — the translation to v4's names happens right here.

type GroupProps = ComponentProps<typeof Group>;

interface ResizablePanelGroupProps extends Omit<GroupProps, "orientation"> {
  /** v3 alias for v4's `orientation`. Kept so callsites don't have to churn. */
  direction?: GroupProps["orientation"];
  orientation?: GroupProps["orientation"];
}

const ResizablePanelGroup = forwardRef<GroupImperativeHandle, ResizablePanelGroupProps>(
  ({ className, direction, orientation, ...props }, forwardedRef) => {
    const groupRef = useGroupRef();
    useImperativeHandle(forwardedRef, () => groupRef.current!, [groupRef]);
    return (
      <Group
        groupRef={groupRef}
        orientation={direction ?? orientation ?? "horizontal"}
        className={cn(
          "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
          className,
        )}
        {...props}
      />
    );
  },
);
ResizablePanelGroup.displayName = "ResizablePanelGroup";

// v4's Panel accepts a `panelRef` prop (not React's ref) for imperative access.
// Wrapper accepts a normal ref and adapts.
type PanelProps = ComponentProps<typeof Panel>;

interface ResizablePanelProps extends PanelProps {
  /** Deprecated in v4 but preserved here as a no-op so existing callsites
   *  compile — v4 derives group order from render order. */
  order?: number;
  /** Deprecated in v4 — derive from onResize prev vs next in v4-native code. */
  onCollapse?: () => void;
  /** Deprecated in v4 — same as onCollapse. */
  onExpand?: () => void;
}

const ResizablePanel = forwardRef<PanelImperativeHandle, ResizablePanelProps>(
  ({ onCollapse, onExpand, order: _order, onResize, ...props }, forwardedRef) => {
    const panelRef = usePanelRef();
    useImperativeHandle(forwardedRef, () => panelRef.current!, [panelRef]);
    // Adapt the removed onCollapse/onExpand callbacks by watching onResize.
    const resize: PanelProps["onResize"] = (nextSize, id, prevSize) => {
      onResize?.(nextSize, id, prevSize);
      if (prevSize === undefined) return;
      const wasCollapsed = prevSize.asPercentage === 0;
      const isCollapsed = nextSize.asPercentage === 0;
      if (isCollapsed && !wasCollapsed) onCollapse?.();
      else if (!isCollapsed && wasCollapsed) onExpand?.();
    };
    return <Panel panelRef={panelRef} onResize={resize} {...props} />;
  },
);
ResizablePanel.displayName = "ResizablePanel";

type SeparatorProps = ComponentProps<typeof Separator>;

interface ResizableHandleProps extends SeparatorProps {
  withHandle?: boolean;
  /** v3 prop removed in v4; accepted here as a no-op so callsites stay quiet. */
  hitAreaMargins?: { coarse?: number; fine?: number };
}

const ResizableHandle = ({
  withHandle,
  className,
  hitAreaMargins: _hitAreaMargins,
  children,
  ...props
}: ResizableHandleProps) => (
  // The visible divider stays a 1px line, and the ARIA "separator" element is
  // widened via the `after` pseudo to ~16px so touch drags reliably grab.
  <Separator
    className={cn(
      "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-4 after:-translate-x-1/2 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-4 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 [&[data-panel-group-direction=vertical]>div]:rotate-90",
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
    {children}
  </Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
