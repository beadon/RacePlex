import { FileText } from "lucide-react";
import { useTranslation, Trans } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { interceptExternal } from "@/lib/platform";

const LIBXRK_URL = "https://github.com/m3rlin45/libxrk";
const GPMF_EXTRACT_URL = "https://github.com/JuanIrache/gpmf-extract";
const GOPRO_TELEMETRY_URL = "https://github.com/JuanIrache/gopro-telemetry";

// Format ids in display order; their name/body text lives in the `landing`
// locale (supportedFiles.primary.<id> / .secondary.<id>). Format names,
// extensions and brand/library links stay literal inside the locale strings.
// Ordered by what an eskate rider is actually likely to have, which is not the order upstream
// used (its own DovesDataLogger formats came first). RaceBox is the common GPS logger in this
// class; GPX comes out of nearly every other logger, phone app and watch; VBO is the one format
// Dragy·Lap, RaceChrono and RaceBox all emit. Upstream's own formats stay fully supported, just
// further down the list.
// VESC leads: it is the only format carrying the ESC channels (motor current, battery sag, duty
// cycle) alongside GPS, which is the whole reason an eskate rider would pick this over a car tool.
// `genericCsv` sits mid-list because it is the catch-all rather than a headline — but it MUST be
// listed, or a rider with an unknown logger has no way to learn that their file will just work.
const PRIMARY_IDS = [
  "vescCsv",
  "raceboxCsv",
  "gpx",
  "gopro",
  "genericCsv",
  "vbo",
  "nmea",
  "dove",
  "dovex",
] as const;
const SECONDARY_IDS = ["ubx", "xrk", "iracing", "fit", "motecLd", "motecCsv", "alfano", "aimCsv"] as const;
const EXPERIMENTAL = new Set(["motecLd", "motecCsv", "alfano", "aimCsv"]);

// Shared rich-text components for the format bodies. `<Trans>` only uses the
// tags a given string references, so one map covers every format.
const FORMAT_COMPONENTS = {
  code: <code className="text-primary" />,
  em: <em className="font-medium text-foreground not-italic" />,
  logger: <span className="text-foreground" />,
  libxrk: (
    <a href={LIBXRK_URL} target="_blank" rel="noopener noreferrer" onClick={(e) => interceptExternal(e, LIBXRK_URL)} className="text-primary hover:underline" />
  ),
  gpmf: (
    <a href={GPMF_EXTRACT_URL} target="_blank" rel="noopener noreferrer" onClick={(e) => interceptExternal(e, GPMF_EXTRACT_URL)} className="text-primary hover:underline" />
  ),
  gpmfTelemetry: (
    <a href={GOPRO_TELEMETRY_URL} target="_blank" rel="noopener noreferrer" onClick={(e) => interceptExternal(e, GOPRO_TELEMETRY_URL)} className="text-primary hover:underline" />
  ),
};

export function SupportedFilesDialog() {
  const { t } = useTranslation("landing");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileText className="w-4 h-4" />
          <span className="hidden sm:inline">{t("supportedFiles.trigger")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("supportedFiles.title")}</DialogTitle>
          <DialogDescription>{t("supportedFiles.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {PRIMARY_IDS.map((id) => (
            <div key={id} className="p-3 rounded-md border border-primary/30 bg-primary/5">
              <p className="font-semibold text-foreground">{t(`supportedFiles.primary.${id}.name`)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                <Trans t={t} i18nKey={`supportedFiles.primary.${id}.body`} components={FORMAT_COMPONENTS} />
              </p>
            </div>
          ))}

          <div className="border-t border-border my-2" />

          {SECONDARY_IDS.map((id) => (
            <div key={id} className="p-3 rounded-md border border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-foreground">{t(`supportedFiles.secondary.${id}.name`)}</p>
                {EXPERIMENTAL.has(id) && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 font-medium">
                    {t("supportedFiles.experimental")}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                <Trans t={t} i18nKey={`supportedFiles.secondary.${id}.body`} components={FORMAT_COMPONENTS} />
              </p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
