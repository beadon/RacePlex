import { commitUrl, formatBuildLabel } from "@/lib/buildInfo";
import { interceptExternal } from "@/lib/platform";
import { cn } from "@/lib/utils";

/**
 * Version + commit of this build, linking to the exact commit on GitHub.
 * Shared by the About dialog and the Dashboard footer — the deployed site
 * showed its version nowhere for a while (the About dialog was the only
 * host, and that's a click deep), so it's at-a-glance on the home page too now.
 */
export function BuildStamp({ className }: { className?: string }) {
  const label = formatBuildLabel();
  if (!label) return null; // no tag and no hash — say nothing rather than invent one
  const href = commitUrl();

  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <span className="text-muted-foreground">Version</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => interceptExternal(e, href)}
          className="font-mono text-foreground hover:text-primary transition-colors"
        >
          {label}
        </a>
      ) : (
        <span className="font-mono text-foreground">{label}</span>
      )}
    </div>
  );
}
