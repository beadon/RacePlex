import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CloudDownload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type { FileManagerSectionContext } from "@/plugins/mounts";
import { cloudOnlyNames, markPushed } from "./fileSync";
import { listCloudFiles, downloadCloudFile } from "./syncEngine";

/**
 * Bottom-of-file-list bulk action: pull every cloud log file that isn't already
 * on this device. Sign-in lives on the Profile tab; this only shows when signed
 * in. Pulled files persist via `ctx.onSaveFile` (which refreshes the list).
 */
export default function DownloadAllCloudLogs({ ctx }: { ctx: FileManagerSectionContext }) {
  const { user } = useAuth();
  const online = useOnlineStatus();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const localNames = useMemo(() => ctx.files.map((f) => f.name), [ctx.files]);

  if (!user) return null;

  const busy = progress !== null;

  const downloadAll = async () => {
    if (busy) return;
    setProgress({ done: 0, total: 0 });
    try {
      const cloud = await listCloudFiles(user.id);
      const pending = cloudOnlyNames(cloud.map((c) => c.name), localNames);
      if (pending.length === 0) {
        toast("All cloud logs are already on this device.");
        return;
      }
      let ok = 0;
      let failed = 0;
      setProgress({ done: 0, total: pending.length });
      for (const name of pending) {
        try {
          const blob = await downloadCloudFile(user.id, name);
          if (!blob) throw new Error("no data");
          await ctx.onSaveFile(name, blob);
          await markPushed(name);
          ok++;
        } catch {
          failed++;
        }
        setProgress({ done: ok + failed, total: pending.length });
      }
      if (failed) toast.error(`Downloaded ${ok} log${ok === 1 ? "" : "s"}; ${failed} failed.`);
      else toast.success(`Downloaded ${ok} cloud log${ok === 1 ? "" : "s"} to this device.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to download cloud logs");
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="px-4 py-3 border-t border-border shrink-0">
      <Button variant="outline" className="w-full" onClick={downloadAll} disabled={busy || !online}>
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CloudDownload className="w-4 h-4 mr-2" />}
        {busy && progress && progress.total > 0
          ? `Downloading ${progress.done}/${progress.total}…`
          : "Download all cloud logs"}
      </Button>
      {!online && (
        <p className="mt-1.5 text-xs text-muted-foreground text-center">You're offline.</p>
      )}
    </div>
  );
}
