import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MailPlus, Bluetooth, Wifi, Smartphone, Cable } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isNativeApp } from "@/lib/platform";
import { cn } from "@/lib/utils";

// Brand display names are proper nouns — intentionally not translated.
const FLEDGLING_NAME = "PerchWerks Fledgling";
const MYCHRON_NAME = "AiM MyChron 5+";
const ALFANO_NAME = "Alfano 6+";
const RACEBOX_NAME = "RaceBox Mini / Micro";
const DRAGY_NAME = "Dragy";
const PHONE_GPS_NAME = "This phone (GPS)";

interface LoggerPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether Web Bluetooth is available — gates the Fledgling (BLE) tile. */
  bleSupported: boolean;
  /** Begin the standard Bluetooth download flow (PerchWerks Fledgling). */
  onSelectFledgling: () => void;
  /**
   * Begin the native MyChron Wi-Fi flow. Only supplied (and only fired) on the
   * native shell; on web the MyChron card keeps its explanatory dialog.
   */
  onSelectMychron?: () => void;
  /**
   * Begin the native Alfano Bluetooth-serial flow. Only supplied (and only fired)
   * on the native shell; on web the Alfano card keeps its explanatory dialog
   * (Bluetooth serial can't be reached in-browser).
   */
  onSelectAlfano?: () => void;
  /**
   * Start recording using the phone/tablet's own GPS as a poor-man's logger.
   * The host wraps this in a first-time precision warning before the recording
   * flow actually starts.
   */
  onSelectPhoneGps?: () => void;
  /**
   * Begin the RaceBox live capture flow — Web Bluetooth to the device's
   * Nordic UART Service, sample stream into a growing session. Only offered
   * on Chromium/Android (Web Bluetooth doesn't exist on iOS Safari).
   */
  onSelectRaceBoxLive?: () => void;
  /**
   * Begin the Dragy live capture flow — Web Bluetooth on FD00, handshake +
   * NAV-PVT telemetry. Same Chromium-only constraint as RaceBox.
   */
  onSelectDragyLive?: () => void;
}

type Availability =
  | { kind: "ready"; label: string; icon: ReactNode }
  | { kind: "unavailable"; label: string; hint: string; icon: ReactNode };

interface LoggerRowProps {
  name: string;
  tag: string;
  availability: Availability;
  onClick: () => void;
}

/**
 * One row per logger option. Text-only by design — every supported logger
 * stands on equal visual footing with a plain name + short tag + honest
 * capability chip. No product photos, no "coming soon", no visual hierarchy
 * that would advertise one option over another.
 */
function LoggerRow({ name, tag, availability, onClick }: LoggerRowProps) {
  const unavailable = availability.kind === "unavailable";
  return (
    <button
      type="button"
      onClick={onClick}
      title={unavailable ? availability.hint : undefined}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors",
        "hover:border-primary/50 hover:bg-accent",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-foreground">{name}</div>
        <div className="text-xs text-muted-foreground">{tag}</div>
      </div>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
          unavailable
            ? "border-border bg-muted text-muted-foreground"
            : "border-primary/30 bg-primary/10 text-primary",
        )}
      >
        {availability.icon}
        {availability.label}
      </span>
    </button>
  );
}

/**
 * Logger chooser: pick a source before any download or recording begins. Every
 * supported source is a plain text row with an honest capability chip so no
 * single option is visually promoted. Fledgling runs over Web Bluetooth
 * (in-browser) or native BLE (native shell). MyChron (Wi-Fi) and Alfano
 * (Bluetooth serial) only download on the native shell; on web they explain
 * why. "This phone (GPS)" starts a poor-man's recording using the device's
 * own geolocation — the host wraps the callback in a first-time precision
 * warning before actually recording.
 */
export function LoggerPicker({
  open,
  onOpenChange,
  bleSupported,
  onSelectFledgling,
  onSelectMychron,
  onSelectAlfano,
  onSelectPhoneGps,
  onSelectRaceBoxLive,
  onSelectDragyLive,
}: LoggerPickerProps) {
  const { t } = useTranslation("logger");
  const [info, setInfo] = useState<"mychron" | "alfano" | null>(null);
  const native = isNativeApp();

  const bluetoothIcon = <Bluetooth className="h-3 w-3" />;
  const wifiIcon = <Wifi className="h-3 w-3" />;
  const cableIcon = <Cable className="h-3 w-3" />;
  const phoneIcon = <Smartphone className="h-3 w-3" />;

  const fledglingAvailability: Availability = bleSupported
    ? { kind: "ready", label: "Bluetooth", icon: bluetoothIcon }
    : { kind: "unavailable", label: "Bluetooth", hint: t("fledglingUnsupported"), icon: bluetoothIcon };

  const mychronAvailability: Availability = native
    ? { kind: "ready", label: "Wi-Fi", icon: wifiIcon }
    : { kind: "unavailable", label: "Desktop app", hint: "MyChron uses Wi-Fi — available in the native app.", icon: wifiIcon };

  const alfanoAvailability: Availability = native
    ? { kind: "ready", label: "Bluetooth serial", icon: cableIcon }
    : { kind: "unavailable", label: "Desktop app", hint: "Alfano uses Bluetooth serial — available in the native app.", icon: cableIcon };

  const phoneGpsAvailability: Availability =
    typeof navigator !== "undefined" && "geolocation" in navigator
      ? { kind: "ready", label: "Live", icon: phoneIcon }
      : { kind: "unavailable", label: "No GPS", hint: "This device has no geolocation available.", icon: phoneIcon };

  // Web Bluetooth only exists on Chromium (desktop + Android). iOS Safari and
  // Firefox return `undefined` for `navigator.bluetooth`. See issue #32.
  const webBluetoothAvailable = typeof navigator !== "undefined" && "bluetooth" in navigator;
  const raceBoxAvailability: Availability = webBluetoothAvailable
    ? { kind: "ready", label: "Bluetooth", icon: bluetoothIcon }
    : { kind: "unavailable", label: "Chrome/Edge", hint: "RaceBox live capture needs Web Bluetooth (Chrome/Edge on desktop or Android).", icon: bluetoothIcon };
  const dragyAvailability: Availability = webBluetoothAvailable
    ? { kind: "ready", label: "Bluetooth", icon: bluetoothIcon }
    : { kind: "unavailable", label: "Chrome/Edge", hint: "Dragy live capture needs Web Bluetooth (Chrome/Edge on desktop or Android).", icon: bluetoothIcon };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* Cap the height + scroll so a tall list never pushes the close (X) off
            the top of the screen on mobile; a side gutter keeps the panel off the
            screen edges on mobile, and safe-area-modal padding restores the inner
            padding (which a bare env() inset would zero out) while clearing notches. */}
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto safe-area-modal">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>
              Pick a source. Every option is a supported way to get lap data in.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <LoggerRow
              name={FLEDGLING_NAME}
              tag={t("tags.fledgling")}
              availability={fledglingAvailability}
              onClick={onSelectFledgling}
            />
            <LoggerRow
              name={RACEBOX_NAME}
              tag="Live capture over Bluetooth — the sample stream lands in a session as it records."
              availability={raceBoxAvailability}
              onClick={() => onSelectRaceBoxLive?.()}
            />
            <LoggerRow
              name={DRAGY_NAME}
              tag="Live NAV-PVT stream over Bluetooth — reverse-engineered protocol, firmware-dependent."
              availability={dragyAvailability}
              onClick={() => onSelectDragyLive?.()}
            />
            <LoggerRow
              name={MYCHRON_NAME}
              tag={t("tags.mychron")}
              availability={mychronAvailability}
              onClick={() => (native && onSelectMychron ? onSelectMychron() : setInfo("mychron"))}
            />
            <LoggerRow
              name={ALFANO_NAME}
              tag={t("tags.alfano")}
              availability={alfanoAvailability}
              onClick={() => (native && onSelectAlfano ? onSelectAlfano() : setInfo("alfano"))}
            />
            <LoggerRow
              name={PHONE_GPS_NAME}
              tag="Record with this device's built-in GPS — no logger needed."
              availability={phoneGpsAvailability}
              onClick={() => onSelectPhoneGps?.()}
            />
          </div>

          {/* Don't see your logger? Open a GitHub issue. Open-source projects
              take format requests in public, where a sample file can be attached
              and anyone can pick the work up. Adding parsers is the whole point. */}
          <a
            href="https://github.com/beadon/RacePlex/issues/new"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" className="w-full gap-2">
              <MailPlus className="h-4 w-4" />
              {t("requestLogger")}
            </Button>
          </a>

          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            {t("trademarks")}
          </p>

          {/* Phones: an explicit way back out (desktop keeps the corner X). */}
          <DialogClose asChild>
            <Button variant="outline" className="w-full sm:hidden">
              {t("close")}
            </Button>
          </DialogClose>
        </DialogContent>
      </Dialog>

      {/* MyChron — native shows the spec'd placeholder; web explains the upcoming app. */}
      <Dialog open={info === "mychron"} onOpenChange={(o) => !o && setInfo(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{native ? t("mychron.nativeTitle") : t("mychron.webTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {native ? t("mychron.nativeBody") : t("mychron.webBody")}
          </p>
        </DialogContent>
      </Dialog>

      {/* Alfano — Bluetooth serial, web can't reach it; explains the native app. */}
      <Dialog open={info === "alfano"} onOpenChange={(o) => !o && setInfo(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("alfano.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("alfano.body")}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
