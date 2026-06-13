// First-party Tools plugin.
//
// Contributes the Tools tab (a self-gating main-view tab, like Coach): a
// chromeless panel that shows a picker of utility tools and renders the one
// the user opens. The tools themselves live under this folder and are lazy —
// nothing here rides the initial bundle. Fully offline.

import { lazy } from "react";
import { Wrench } from "lucide-react";
import type { DataViewerPlugin } from "@/plugins/types";
import { PANELS_POINT, PanelSlot, type PluginPanel } from "@/plugins/panels";

const ToolsPanel = lazy(() => import("./ToolsPanel"));

const plugin: DataViewerPlugin = {
  id: "tools",
  name: "Track Tools",
  version: "0.1.0",
  setup(ctx) {
    ctx.registry.contribute(PANELS_POINT, {
      id: "tools-home",
      title: "Tools",
      slot: PanelSlot.Tools,
      icon: Wrench,
      component: ToolsPanel,
      // The panel owns its full layout (picker grid / opened tool).
      chromeless: true,
    } satisfies PluginPanel);
  },
};

export default plugin;
