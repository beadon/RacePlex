// Tools-tab surface for the data export (plan 0013).
//
// The export itself is core (`lib/dataExport.ts`) and the UI is the shared
// DataExportSection, mounted in Settings and the Files drawer too. This is just
// the Tools-tab entry point: a rider looking for "how do I get my data out"
// browses the tools, so it needs to be findable here as well.

import type { PluginPanelProps } from "@/plugins/panels";
import { DataExportSection } from "@/components/DataExportSection";

export default function MyDataTool(_props: PluginPanelProps) {
  return (
    <div className="max-w-2xl">
      <DataExportSection />
    </div>
  );
}
