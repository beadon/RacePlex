import { Fragment, type ReactNode } from "react";
import {
  Shield,
  Play,
  FileText,
  Cpu,
  FolderOpen,
  Map,
  Bluetooth,
  Route,
  Trophy,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { SiteHeader } from "@/components/SiteHeader";
import { FileImport } from "@/components/FileImport";
import { ActionTile } from "@/components/ActionTile";
import { TrackEditor } from "@/components/TrackEditor";
import { LocalWeatherDialog } from "@/components/LocalWeatherDialog";
import { PluginMount } from "@/plugins/PluginMount";
import { MountSlot } from "@/plugins/mounts";
import { useAuth } from "@/contexts/AuthContext";
import { buildInfo, formatBuildLabel, commitUrl, isPreviewBuild } from "@/lib/buildInfo";
import { interceptExternal, isNativeApp } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { ParsedData } from "@/types/racing";

// Eager: the logger picker is lightweight and must open instantly. The heavy
// BLE flow it launches stays lazy (loaded only when the Fledgling is picked),
// so the protocol bundle is still kept off the initial landing payload.
import { LoggerDownload } from "@/components/LoggerDownload";

interface LandingPageProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  onOpenFileManager: () => void;
  /** Opens the file-manager drawer straight to the Profile (account) tab. */
  onOpenProfile: () => void;
  autoSave: boolean;
  autoSaveFile: (name: string, blob: Blob) => Promise<void>;
  onLoadSample: () => void;
  isLoadingSample: boolean;
  /** When false, the sample log is hidden everywhere — including this tile. */
  showSampleFiles: boolean;
  enableAdmin: boolean;
  enableCloud: boolean;
  /** The settings modal (trigger + dialog), rendered in the header. */
  settingsButton: ReactNode;
}

/**
 * The pre-data-load home screen shown by Index.tsx when no telemetry file is
 * loaded. The layout is deliberately simple: a large drag-and-drop dropzone
 * as the primary action, then a grid of big, single-purpose action tiles for
 * everything else (browse, sample, BLE download, track manager, hardware).
 * Reference dialogs (supported files, about, weather, browser compat, contact)
 * and resource links live below.
 *
 * Index.tsx owns the surrounding providers (DeviceProvider, etc.) and the
 * FileManagerDrawer, which the "Browse Saved Files" tile opens via
 * `onOpenFileManager`.
 */
export function LandingPage({
  onDataLoaded,
  onOpenFileManager,
  onOpenProfile,
  autoSave,
  autoSaveFile,
  onLoadSample,
  isLoadingSample,
  showSampleFiles,
  enableAdmin,
  enableCloud,
  settingsButton,
}: LandingPageProps) {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { t } = useTranslation(["landing", "common"]);

  // On the native (Tauri/Android) shell the user has already installed the app,
  // so the hero pitch just adds noise — hide it.
  const native = isNativeApp();

  return (
    <div className="min-h-screen bg-background flex flex-col safe-area-x">
      <SiteHeader settingsButton={settingsButton} enableCloud={enableCloud} onOpenProfile={onOpenProfile} />

      <main className="flex-1 px-6 py-10">
        <div className="mx-auto w-full max-w-4xl space-y-10">
          {/* Hero — pure marketing, so it's dropped on the native shell where
              the user has already chosen to install the app. */}
          {!native && (
            <div className="text-center space-y-3">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
                {t("landing:hero.title")}
              </h2>
              <p className="mx-auto max-w-xl text-sm text-muted-foreground">
                {t("landing:hero.subtitle")}
              </p>
              <p className="text-sm font-medium text-primary">
                {t("landing:hero.offlineNote")}
              </p>
            </div>
          )}

          {/* Primary action: a 50/50 split — most users download straight off a
              logger, so it gets equal billing with drag & drop / click-to-browse. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-stretch">
            <LoggerDownload
              onDataLoaded={onDataLoaded}
              autoSave={autoSave}
              autoSaveFile={autoSaveFile}
              renderTrigger={({ onOpen }) => (
                <button
                  type="button"
                  onClick={onOpen}
                  className="flex h-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-card/50 p-10 text-center transition-colors hover:border-primary/50 hover:bg-card"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Bluetooth className="h-7 w-7" />
                  </span>
                  <span className="text-xl font-semibold text-foreground">
                    {t("landing:tiles.logger.title")}
                  </span>
                  <span className="max-w-md text-sm text-muted-foreground">
                    {t("landing:tiles.logger.description")}
                  </span>
                </button>
              )}
            />
            <FileImport onDataLoaded={onDataLoaded} autoSave={autoSave} autoSaveFile={autoSaveFile} />
          </div>

          {/* Secondary actions — big, single-purpose tiles */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {showSampleFiles && (
              <ActionTile
                icon={Play}
                title={t("landing:tiles.sample.title")}
                description={isLoadingSample ? t("common:actions.loading") : t("landing:tiles.sample.description")}
                onClick={onLoadSample}
                disabled={isLoadingSample}
                spinning={isLoadingSample}
                featured
              />
            )}

            <ActionTile
              icon={FolderOpen}
              title={t("landing:tiles.browse.title")}
              description={t("landing:tiles.browse.description")}
              onClick={onOpenFileManager}
            />

            {/* Track manager — create/draw tracks & courses without a datalog. */}
            <TrackEditor
              triggerButton={
                <ActionTile
                  icon={Map}
                  title={t("landing:tiles.tracks.title")}
                  description={t("landing:tiles.tracks.description")}
                  /* No badge. Upstream dangled "🎁 contribute tracks, earn free cloud storage"
                     here; RacePlex has no cloud tier to reward anyone with. */
                />
              }
            />

            {/* Public leaderboards — only meaningful with the cloud backend. */}
            {enableCloud && (
              <ActionTile
                icon={Trophy}
                title={t("landing:tiles.leaderboards.title")}
                description={t("landing:tiles.leaderboards.description")}
                onClick={() => navigate('/leaderboards')}
              />
            )}

            <ActionTile
              icon={Cpu}
              title={t("landing:tiles.build.title")}
              description={t("landing:tiles.build.description")}
              href="https://github.com/TheAngryRaven/DovesDataLogger"
            />

            {/* Plugin-contributed landing tiles (e.g. the Tools plugin). Renders
                nothing when no plugin targets the slot, so the grid is unchanged
                in a plugin-absent build. */}
            <PluginMount slot={MountSlot.Landing} ctx={{}} />
          </div>

          {/* No roadmap, no "contact us", no credits/compat buttons.
              Upstream's landing page is a product surface — a feature roadmap with delivery
              estimates, a sales contact CTA, and tiering. RacePlex isn't selling anything, so
              the page just says what the app is and lets you drop a file on it. Roadmap lives
              where it belongs for an open-source project: GitHub issues.
              (Map data attribution is unaffected — Leaflet/CARTO/OSM credit each other on the
              map layer itself, which is where the licences actually require it.) */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span className="inline-flex">
              <LocalWeatherDialog />
            </span>
          </div>

          {enableAdmin && isAdmin && (
            <div className="flex items-center justify-center gap-6 flex-wrap">
              <button
                onClick={() => navigate('/admin')}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                <Shield className="w-3 h-3" />
                {t("landing:links.admin")}
              </button>
            </div>
          )}
        </div>
      </main>

      <footer
        className={cn(
          "border-t px-6 py-4",
          isPreviewBuild() ? "border-warning/60 bg-warning/10" : "border-border",
        )}
      >
        {/* No Privacy / Terms links. Those are the legal surface of a service that collects
            data and offers an account; RacePlex is neither. Everything runs locally, nothing
            is uploaded, and there is nobody to agree to terms with. */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
          <div>
            {/* No "Operated by <LLC>" line. RacePlex is not operated by a company — it's an
                open-source project, so the footer points at the source, not at an owner. */}
            <p className="text-center text-xs text-muted-foreground">
              <a
                href="https://github.com/beadon/RacePlex"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => interceptExternal(e, "https://github.com/beadon/RacePlex")}
                className="font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                {t("landing:footer.openSource")}
              </a>
            </p>
            <p
              className={cn(
                "mt-1 text-center text-[11px]",
                isPreviewBuild() ? "font-semibold text-warning" : "text-muted-foreground/60",
              )}
              title={buildInfo.buildDate ? `Built ${new Date(buildInfo.buildDate).toLocaleString()}` : undefined}
            >
              {commitUrl() ? (
                <a
                  href={commitUrl()!}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => interceptExternal(e, commitUrl()!)}
                  className={cn(
                    "underline-offset-4 transition-colors hover:underline",
                    isPreviewBuild() ? "hover:text-warning/80" : "hover:text-muted-foreground",
                  )}
                >
                  {formatBuildLabel()}
                </a>
              ) : (
                formatBuildLabel()
              )}
            </p>
          </div>

        </div>
        {isPreviewBuild() && (
          <p className="mx-auto mt-2 max-w-2xl text-center text-[11px] leading-relaxed text-warning">
            <Trans ns="landing" i18nKey="footer.previewWarning" components={{ strong: <strong /> }} />
          </p>
        )}
      </footer>
    </div>
  );
}
