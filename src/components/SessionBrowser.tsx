import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder, ChevronRight } from "lucide-react";
import type { BrowserView, BrowserSession, FilterMode, NavState } from "@/lib/fileBrowserTree";

/** Logs shown per page before a "Show N more" control appears. */
const PAGE_SIZE = 10;

interface SessionBrowserProps {
  /** The resolved view to render (from `computeBrowserView`). */
  view: BrowserView;
  /** Apply a navigation (breadcrumb click, folder open, or filter change). */
  onNavigate: (nav: NavState) => void;
  /** Render one log row (the caller owns row chrome + actions). */
  renderRow: (session: BrowserSession) => React.ReactNode;
  emptyText?: string;
}

/**
 * Presentational Track→Course→logs browser: breadcrumb + optional Engine/Kart
 * filter + folders + the caller-rendered log rows. Pure UI over a computed
 * `BrowserView` — shared by the Files tab and the Profile cloud-logs panel.
 *
 * The final log list paginates 10 at a time once there are more than that —
 * a track with a season's worth of sessions otherwise renders every row at
 * once. Paging state is local (how many rows to show, not which ones), keyed
 * off the breadcrumb path so drilling into a different folder starts back
 * at the first page rather than carrying over an unrelated scroll position.
 */
export function SessionBrowser({ view, onNavigate, renderRow, emptyText }: SessionBrowserProps) {
  const { t } = useTranslation("drawer");
  const filterLabels: Record<FilterMode, string> = {
    none: t("browser.filterNone"),
    engine: t("browser.filterEngine"),
    kart: t("browser.filterKart"),
  };

  // Reset to the first page when navigation moves to a different folder —
  // the React-recommended "adjust state during render" pattern (a plain
  // effect here would fire an extra cascading render for no benefit).
  const navKey = view.breadcrumb.map((seg) => seg.label).join("/");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [pagedNavKey, setPagedNavKey] = useState(navKey);
  let effectiveVisibleCount = visibleCount;
  if (navKey !== pagedNavKey) {
    setPagedNavKey(navKey);
    setVisibleCount(PAGE_SIZE);
    effectiveVisibleCount = PAGE_SIZE;
  }
  const visibleSessions = view.sessions.slice(0, effectiveVisibleCount);
  const remaining = view.sessions.length - visibleSessions.length;
  return (
    <div className="space-y-1">
      {/* Breadcrumb — always shown so date-named logs read in context. */}
      <div className="flex items-center flex-wrap gap-0.5 px-1 pb-1 text-sm">
        {view.breadcrumb.map((seg, i) => {
          const isLast = i === view.breadcrumb.length - 1;
          return (
            <Fragment key={`${seg.label}-${i}`}>
              {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
              <button
                type="button"
                disabled={isLast}
                onClick={() => onNavigate(seg.nav)}
                className={isLast
                  ? "font-semibold text-foreground truncate"
                  : "text-muted-foreground hover:text-foreground truncate"}
              >
                {seg.label}
              </button>
            </Fragment>
          );
        })}
      </div>

      {/* Engine/Kart filter — only on the final log level. */}
      {view.showFilter && (
        <div className="flex items-center gap-2 px-1 pb-1">
          <span className="text-xs text-muted-foreground">{t("browser.groupBy")}</span>
          <div className="flex gap-0.5 bg-muted/50 rounded-md p-0.5">
            {(["none", "engine", "kart"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  // Keep the resolved track/course; clear any drilled-in folder.
                  const last = view.breadcrumb[view.breadcrumb.length - 1].nav;
                  onNavigate({ track: last.track, course: last.course, filter: mode });
                }}
                className={`px-2.5 py-0.5 text-xs font-medium rounded transition-colors ${
                  view.filterMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {filterLabels[mode]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Folders */}
      {view.folders.map((folder) => (
        <button
          key={`${folder.kind}-${folder.key}`}
          type="button"
          onClick={() => onNavigate(folder.nav)}
          className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors text-left"
        >
          <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="flex-1 text-sm font-medium text-foreground truncate">{folder.label}</span>
          <span className="text-xs text-muted-foreground shrink-0">{folder.count}</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
      ))}

      {/* Logs (final list, or unconfigured logs below filter folders) */}
      {visibleSessions.map((s) => (
        <Fragment key={s.fileName}>{renderRow(s)}</Fragment>
      ))}

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          className="w-full py-2 text-xs font-medium text-primary hover:underline"
        >
          {t("browser.showMore", { count: Math.min(PAGE_SIZE, remaining) })}
        </button>
      )}

      {view.folders.length === 0 && view.sessions.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-6">{emptyText ?? t("browser.emptyDefault")}</p>
      )}
    </div>
  );
}
