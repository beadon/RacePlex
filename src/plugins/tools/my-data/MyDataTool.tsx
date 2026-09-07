// Tools-tab surface for the data export (plan 0013) and data-issue reporting
// (plan 0014).
//
// Both are core (`lib/dataExport.ts`, `lib/dataIssueReport.ts`) and share UI
// mounted in Settings and the Files drawer too. This is just the Tools-tab entry
// point: a rider looking for "how do I get my data out" or "why isn't this
// displaying right" browses the tools, so both need to be findable here too.

import { Bug } from "lucide-react";
import type { PluginPanelProps } from "@/plugins/panels";
import { Button } from "@/components/ui/button";
import { DataExportSection } from "@/components/DataExportSection";
import { ReportDataIssueDialog } from "@/components/ReportDataIssueDialog";

export default function MyDataTool(_props: PluginPanelProps) {
  return (
    <div className="max-w-2xl space-y-4">
      <DataExportSection />
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Bug className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-medium">Something not displaying right?</h3>
        </div>
        <ReportDataIssueDialog
          trigger={
            <Button variant="outline" size="sm">
              Report a data issue
            </Button>
          }
        />
      </div>
    </div>
  );
}
