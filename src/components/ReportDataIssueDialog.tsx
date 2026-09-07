import { useState } from "react";
import { Bug, Loader2, ExternalLink, Copy, Check, AlertTriangle, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { buildDiagnosticReport, formatDiagnosticReport, dataIssueUrl, type DiagnosticReport } from "@/lib/dataIssueReport";

/**
 * "Report a data issue" — a rider's session isn't displaying right, and there's
 * no server here to send the file to. This runs the file through the app's own
 * parser locally, builds a diagnostic summary (never the raw GPS rows), and hands
 * the rider a prefilled GitHub issue to open. They attach the actual file
 * themselves by dragging it into the issue body — a URL can't carry attachments.
 *
 * Mirrors `DataExportSection`'s convention: mounted in the same three places
 * (Settings, Tools tab, Files drawer), no i18n (same low-traffic,
 * settings-adjacent surface).
 */

type Step = "pick" | "report";

export interface ReportDataIssueDialogProps {
  trigger: React.ReactNode;
}

export function ReportDataIssueDialog({ trigger }: ReportDataIssueDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("pick");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setStep("pick");
    setLoading(false);
    setReport(null);
    setCopied(false);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const onFile = async (file: File) => {
    setLoading(true);
    try {
      setReport(await buildDiagnosticReport(file));
      setStep("report");
    } finally {
      setLoading(false);
    }
  };

  const copyReport = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(formatDiagnosticReport(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy to the clipboard.");
    }
  };

  const openIssue = async () => {
    if (!report) return;
    const { url, prefilled } = dataIssueUrl(report);
    if (!prefilled) {
      await copyReport();
      toast("Report copied — paste it into the issue's Diagnostic report field.");
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-4 w-4" /> Report a data issue
          </DialogTitle>
          <DialogDescription>
            RacePlex has no server to send a broken file to, so this builds a diagnostic report on
            your machine and hands you a prefilled GitHub issue. Opening it needs a free GitHub
            account — that's the only way we can receive reports.
          </DialogDescription>
        </DialogHeader>

        {step === "pick" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pick the file that isn't displaying right. It stays on this device — only the counts
              and channel names below get sent anywhere, and only once you open the issue yourself.
            </p>
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/50"
            >
              <input
                type="file"
                className="hidden"
                disabled={loading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void onFile(file);
                }}
              />
              {loading ? (
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              ) : (
                <Upload className="h-8 w-8 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">
                {loading ? "Running the parser…" : "Choose a file"}
              </span>
            </label>
          </div>
        )}

        {step === "report" && report && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                GitHub issues are public. The report below has no coordinates in it — but if you
                attach the actual file, anyone can see the GPS track inside it, including where a
                ride started or ended. Only attach it if you're OK with that being public.
              </span>
            </div>

            <Textarea
              readOnly
              value={formatDiagnosticReport(report)}
              className="h-56 font-mono text-xs"
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void copyReport()}>
                {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                {copied ? "Copied" : "Copy report"}
              </Button>
              <Button size="sm" onClick={() => void openIssue()}>
                <ExternalLink className="mr-1.5 h-4 w-4" />
                Open GitHub issue
              </Button>
              <Button variant="ghost" size="sm" onClick={reset}>
                Pick a different file
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
