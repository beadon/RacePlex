import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { interceptExternal } from "@/lib/platform";
import { CATEGORIES, FORMAT_LABELS, type Device, type DeviceStatus } from "@/lib/devices";
import type { ReactNode } from "react";

/**
 * Which telemetry collectors work with RacePlex, and how.
 *
 * The content is data, not code — `src/data/supported-devices.json`, readable straight from the
 * repo and editable by anyone without touching TypeScript. The same file backs the table in the
 * README, so the two can't drift.
 *
 * This replaced upstream's "build your own DovesDataLogger" tile, which pointed at one specific
 * piece of hardware belonging to the project's author. Telling riders which devices work is
 * genuinely useful; steering them toward one product is advertising. RacePlex sells nothing and
 * is affiliated with none of these vendors — a device is listed because it works.
 */

const STATUS_STYLES: Record<DeviceStatus, string> = {
  verified: "border-success/40 bg-success/10 text-success",
  expected: "border-border bg-muted text-muted-foreground",
  partial: "border-warning/40 bg-warning/10 text-warning",
  no: "border-destructive/40 bg-destructive/10 text-destructive",
};

function DeviceRow({ device }: { device: Device }) {
  const { t } = useTranslation(["landing"]);

  const name = device.url ? (
    <a
      href={device.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => interceptExternal(e, device.url!)}
      className="text-primary hover:underline"
    >
      {device.name}
    </a>
  ) : (
    device.name
  );

  return (
    <div className="border-b border-border/60 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="font-semibold text-foreground">{name}</p>
        <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[device.status]}`}>
          {t(`supportedDevices.status.${device.status}`)}
        </Badge>
        {/* A capability, not a support status — so it reads differently from the
            status badge beside it. Only on hardware RacePlex speaks to itself. */}
        {device.live && (
          <Badge
            variant="outline"
            title={t("supportedDevices.liveTitle")}
            className="gap-1 border-primary/40 bg-primary/10 text-[10px] text-primary"
          >
            <Radio className="h-2.5 w-2.5" aria-hidden />
            {t("supportedDevices.live")}
          </Badge>
        )}
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        {device.rateHz && (
          <span>
            <span className="font-medium text-foreground">{device.rateHz}</span>{" "}
            {t("supportedDevices.rate")}
          </span>
        )}
        {device.imu && <span>{t("supportedDevices.imu")}</span>}
        {device.price && <span>{device.price}</span>}
        {device.exports.length > 0 && (
          <span>
            {t("supportedDevices.via")}{" "}
            <span className="text-foreground">
              {device.exports.map((f) => FORMAT_LABELS[f] ?? f).join(", ")}
            </span>
          </span>
        )}
      </div>

      {device.notes && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{device.notes}</p>
      )}
    </div>
  );
}

export function SupportedDevicesDialog({ trigger }: { trigger: ReactNode }) {
  const { t } = useTranslation(["landing"]);

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("supportedDevices.title")}</DialogTitle>
          <DialogDescription>{t("supportedDevices.description")}</DialogDescription>
        </DialogHeader>

        <div>
          {CATEGORIES.map((category) => (
            <section key={category.id} className="mb-6 last:mb-0">
              <h3 className="text-sm font-semibold text-foreground">{category.name}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{category.blurb}</p>
              <div className="mt-2">
                {category.devices.map((device) => (
                  <DeviceRow key={device.name} device={device} />
                ))}
              </div>
            </section>
          ))}

          <p className="mt-4 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
            {t("supportedDevices.footer")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
