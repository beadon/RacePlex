import { lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Bluetooth } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoggerPicker } from "@/components/LoggerPicker";
import { useDeviceContext } from "@/contexts/DeviceContext";
import { isNativeApp } from "@/lib/platform";
import type { ParsedData } from "@/types/racing";

// The Fledgling BLE flow is the only heavy part — lazy-load it so the protocol
// bundle (`lib/ble/*`) loads only when the user actually picks the Fledgling.
// The host itself (button + picker) stays eager so the menu opens instantly and
// never depends on a chunk finishing to load.
const DataloggerDownload = lazy(() =>
  import("@/components/DataloggerDownload").then((m) => ({ default: m.DataloggerDownload })),
);

// The native Fledgling BLE flow downloads over the Tauri shell instead of Web
// Bluetooth (which the native webview lacks). Lazy so `@tauri-apps/api` (dynamic
// import inside it) never enters the web/eager bundle.
const DovesloggerDownload = lazy(() =>
  import("@/components/DovesloggerDownload").then((m) => ({ default: m.DovesloggerDownload })),
);

// The native MyChron Wi-Fi flow is likewise lazy so `@tauri-apps/api` (dynamic
// import inside it) never enters the web/eager bundle.
const MyChronDownload = lazy(() =>
  import("@/components/MyChronDownload").then((m) => ({ default: m.MyChronDownload })),
);

// The native Alfano Bluetooth-serial flow (skeleton) is likewise lazy so
// `@tauri-apps/api` (dynamic import inside it) never enters the web/eager bundle.
const AlfanoDownload = lazy(() =>
  import("@/components/AlfanoDownload").then((m) => ({ default: m.AlfanoDownload })),
);

// The phone-GPS recorder wraps the lap-timer tool + first-time precision
// warning; lazy so the geolocation stack stays off the eager bundle.
const PhoneGpsRecord = lazy(() =>
  import("@/components/PhoneGpsRecord").then((m) => ({ default: m.PhoneGpsRecord })),
);

// RaceBox live capture pulls in the UBX ring buffer + Web Bluetooth transport;
// lazy so the whole `lib/live/*` stack stays off the eager bundle for anyone
// not using a RaceBox. See issue #32.
const RaceBoxLiveRecord = lazy(() =>
  import("@/components/RaceBoxLiveRecord").then((m) => ({ default: m.RaceBoxLiveRecord })),
);

// Dragy live capture — shares the UBX ring buffer with RaceBox but its own
// handshake + NAV-PVT decoder. Lazy for the same reason. Reverse-engineered
// protocol; expect firmware-dependent breakage.
const DragyLiveRecord = lazy(() =>
  import("@/components/DragyLiveRecord").then((m) => ({ default: m.DragyLiveRecord })),
);

interface LoggerDownloadProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  autoSave?: boolean;
  autoSaveFile?: (name: string, blob: Blob) => Promise<void>;
  /**
   * Optional custom trigger (e.g. a big landing-page ActionTile). Receives the
   * handler that opens the logger picker. When omitted, the default outline
   * button is rendered.
   */
  renderTrigger?: (args: { onOpen: () => void }) => ReactNode;
}

/**
 * Entry point for "Download from logger": renders the trigger (button or a
 * caller-supplied tile) and the image-based `LoggerPicker`. Picking the
 * Fledgling mounts the lazy Bluetooth download flow. MyChron (Wi-Fi) and Alfano
 * (Bluetooth serial) mount their native download flows on the native shell, and
 * fall back to explanatory dialogs inside the picker on the web.
 */
export function LoggerDownload({ onDataLoaded, autoSave, autoSaveFile, renderTrigger }: LoggerDownloadProps) {
  const { t } = useTranslation("logger");
  const { bleSupported } = useDeviceContext();
  // On the native app the webview has no Web Bluetooth, so we route the Fledgling
  // through native BLE IPC instead — which means the tile must be enabled there.
  const native = isNativeApp();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fledglingActive, setFledglingActive] = useState(false);
  const [mychronActive, setMychronActive] = useState(false);
  const [alfanoActive, setAlfanoActive] = useState(false);
  const [phoneGpsActive, setPhoneGpsActive] = useState(false);
  const [raceBoxLiveActive, setRaceBoxLiveActive] = useState(false);
  const [dragyLiveActive, setDragyLiveActive] = useState(false);

  const openPicker = useCallback(() => setPickerOpen(true), []);

  return (
    <>
      {renderTrigger ? (
        renderTrigger({ onOpen: openPicker })
      ) : (
        <Button variant="outline" onClick={openPicker}>
          <Bluetooth className="w-4 h-4 mr-2" />
          {t("title")}
        </Button>
      )}

      <LoggerPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        // Native downloads the Fledgling over BLE IPC, so the tile works there
        // even though the native webview lacks Web Bluetooth.
        bleSupported={bleSupported || native}
        onSelectFledgling={() => {
          setPickerOpen(false);
          setFledglingActive(true);
        }}
        onSelectMychron={() => {
          setPickerOpen(false);
          setMychronActive(true);
        }}
        onSelectAlfano={() => {
          setPickerOpen(false);
          setAlfanoActive(true);
        }}
        onSelectPhoneGps={() => {
          setPickerOpen(false);
          setPhoneGpsActive(true);
        }}
        onSelectRaceBoxLive={() => {
          setPickerOpen(false);
          setRaceBoxLiveActive(true);
        }}
        onSelectDragyLive={() => {
          setPickerOpen(false);
          setDragyLiveActive(true);
        }}
      />

      {fledglingActive && (
        <Suspense fallback={null}>
          {native ? (
            <DovesloggerDownload
              autoStart
              onDataLoaded={onDataLoaded}
              autoSave={autoSave}
              autoSaveFile={autoSaveFile}
              onClose={() => setFledglingActive(false)}
            />
          ) : (
            <DataloggerDownload
              autoStart
              onDataLoaded={onDataLoaded}
              autoSave={autoSave}
              autoSaveFile={autoSaveFile}
              onClose={() => setFledglingActive(false)}
            />
          )}
        </Suspense>
      )}

      {mychronActive && (
        <Suspense fallback={null}>
          <MyChronDownload
            autoStart
            onDataLoaded={onDataLoaded}
            autoSave={autoSave}
            autoSaveFile={autoSaveFile}
            onClose={() => setMychronActive(false)}
          />
        </Suspense>
      )}

      {alfanoActive && (
        <Suspense fallback={null}>
          <AlfanoDownload
            autoStart
            onDataLoaded={onDataLoaded}
            autoSave={autoSave}
            autoSaveFile={autoSaveFile}
            onClose={() => setAlfanoActive(false)}
          />
        </Suspense>
      )}

      {phoneGpsActive && (
        <Suspense fallback={null}>
          <PhoneGpsRecord open={phoneGpsActive} onClose={() => setPhoneGpsActive(false)} />
        </Suspense>
      )}

      {raceBoxLiveActive && (
        <Suspense fallback={null}>
          <RaceBoxLiveRecord
            open={raceBoxLiveActive}
            onClose={() => setRaceBoxLiveActive(false)}
            onDataLoaded={onDataLoaded}
          />
        </Suspense>
      )}

      {dragyLiveActive && (
        <Suspense fallback={null}>
          <DragyLiveRecord
            open={dragyLiveActive}
            onClose={() => setDragyLiveActive(false)}
            onDataLoaded={onDataLoaded}
          />
        </Suspense>
      )}
    </>
  );
}
