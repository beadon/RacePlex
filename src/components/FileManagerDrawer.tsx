import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X, Gauge, Cpu, User, Bluetooth, Loader2, Settings, MapPin, Battery, BatteryLow, BatteryMedium, BatteryFull, BatteryWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileEntry, FileMetadata } from "@/lib/fileStorage";
import { Vehicle } from "@/lib/vehicleStorage";
import { VehicleType } from "@/lib/templateStorage";
import { ParsedData } from "@/types/racing";
import { FilesTab } from "./drawer/FilesTab";
import { VehiclesTab } from "./drawer/VehiclesTab";
import { DeviceSettingsTab } from "./drawer/DeviceSettingsTab";
import { DeviceTracksTab } from "./drawer/DeviceTracksTab";
import { ProfileTab } from "./tabs/ProfileTab";
import { LoggerDownload } from "./LoggerDownload";
import { useDeviceContext } from "@/contexts/DeviceContext";
import { isBleSupported, requestBatteryLevel, type BatteryInfo } from "@/lib/bleDatalogger";

type TopTab = "garage" | "profile" | "device";
type GarageTab = "files" | "vehicles" | "setups";
type DeviceTab = "settings" | "tracks";

interface FileManagerDrawerProps {
  isOpen: boolean;
  files: FileEntry[];
  fileMetadataMap: Map<string, FileMetadata>;
  storageUsed: number;
  storageQuota: number;
  onClose: () => void;
  onLoadFile: (name: string) => Promise<Blob | null>;
  onDeleteFile: (name: string) => Promise<void>;
  onExportFile: (name: string) => Promise<void>;
  onSaveFile: (name: string, blob: Blob) => Promise<void>;
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  autoSave: boolean;
  // Show the bundled sample log in the file browser (the "show sample files" setting).
  showSampleFiles: boolean;
  // Garage sub-tab to open straight to (defaults to "files").
  initialGarageTab?: GarageTab;
  // Top-level tab to open straight to (defaults to "garage"). "profile" is
  // honoured only when showProfile is set, otherwise it falls back to "garage".
  initialTopTab?: "garage" | "profile";
  // Profile tab is gated on a plugin (cloud-sync) contributing a Profile panel.
  showProfile: boolean;
  // Vehicle props
  vehicles: Vehicle[];
  vehicleTypes: VehicleType[];
  onAddVehicle: (vehicle: Omit<Vehicle, "id">) => Promise<void>;
  onUpdateVehicle: (vehicle: Vehicle) => Promise<void>;
  onRemoveVehicle: (id: string) => Promise<void>;
  // Open a saved session by file name (vehicle history → fastest-lap session).
  onOpenFile: (fileName: string) => void | Promise<void>;
  // Jump to the vehicle-type creator (closes the drawer, opens the Setups tab).
  // Omitted off-session, where the Setups tab isn't reachable.
  onCreateVehicleType?: () => void;
  // Off-session fallback: Setups normally lives in the main toolbar, but that
  // tab only exists once a session is loaded. When provided (landing page only),
  // host it as a garage sub-tab so setups/vehicle-types stay reachable. Passed as
  // a ready-made node so the drawer needn't know about setup props.
  setupsTab?: ReactNode;
  // Current session context (the browser opens at this track/course)
  currentTrackName: string | null;
  currentCourseName: string | null;
}

export function FileManagerDrawer({
  isOpen, files, fileMetadataMap, storageUsed, storageQuota,
  onClose, onLoadFile, onDeleteFile, onExportFile, onSaveFile, onDataLoaded, autoSave,
  showSampleFiles,
  initialGarageTab = "files",
  initialTopTab = "garage",
  showProfile,
  vehicles, vehicleTypes,
  onAddVehicle, onUpdateVehicle, onRemoveVehicle, onCreateVehicleType,
  onOpenFile,
  setupsTab,
  currentTrackName, currentCourseName,
}: FileManagerDrawerProps) {
  const { t } = useTranslation("drawer");
  // The three tab selections are derived from the props whenever the drawer
  // opens (see the `isOpen`-keyed override below), and user picks override the
  // derivation. Same pattern as FilesTab's nav — a reset-on-open effect would
  // trigger the set-state-in-effect rule; deriving with a stamped override
  // avoids it.
  const derivedTopTab: TopTab = initialTopTab === "profile" && showProfile ? "profile" : "garage";
  const derivedGarageTab: GarageTab = initialGarageTab;
  const derivedDeviceTab: DeviceTab = "settings";
  const [tabOverride, setTabOverride] = useState<{
    open: boolean;
    homeTop: TopTab; homeGarage: GarageTab; homeDevice: DeviceTab;
    top: TopTab; garage: GarageTab; device: DeviceTab;
  } | null>(null);
  const overrideActive =
    tabOverride?.open === isOpen &&
    tabOverride?.homeTop === derivedTopTab &&
    tabOverride?.homeGarage === derivedGarageTab &&
    tabOverride?.homeDevice === derivedDeviceTab;
  const topTab = overrideActive ? tabOverride!.top : derivedTopTab;
  const garageTab = overrideActive ? tabOverride!.garage : derivedGarageTab;
  const deviceTab = overrideActive ? tabOverride!.device : derivedDeviceTab;
  const setTopTab = (v: TopTab) => setTabOverride({
    open: isOpen, homeTop: derivedTopTab, homeGarage: derivedGarageTab, homeDevice: derivedDeviceTab,
    top: v, garage: garageTab, device: deviceTab,
  });
  const setGarageTab = (v: GarageTab) => setTabOverride({
    open: isOpen, homeTop: derivedTopTab, homeGarage: derivedGarageTab, homeDevice: derivedDeviceTab,
    top: topTab, garage: v, device: deviceTab,
  });
  const setDeviceTab = (v: DeviceTab) => setTabOverride({
    open: isOpen, homeTop: derivedTopTab, homeGarage: derivedGarageTab, homeDevice: derivedDeviceTab,
    top: topTab, garage: garageTab, device: v,
  });

  const garageTabs: { key: GarageTab; label: string }[] = [
    { key: "files", label: t("shell.garageTabs.files") },
    { key: "vehicles", label: t("shell.garageTabs.vehicles") },
    ...(setupsTab ? [{ key: "setups" as const, label: t("shell.garageTabs.setups") }] : []),
  ];

  const deviceTabs: { key: DeviceTab; label: string; icon: React.ReactNode }[] = [
    { key: "settings", label: t("shell.deviceTabs.settings"), icon: <Settings className="w-3.5 h-3.5" /> },
    { key: "tracks", label: t("shell.deviceTabs.tracks"), icon: <MapPin className="w-3.5 h-3.5" /> },
  ];

  const device = useDeviceContext();
  const bleAvailable = isBleSupported();
  const [battery, setBattery] = useState<BatteryInfo | null>(null);

  // Reset battery on open — the drawer might reopen against a different
  // connection (or the same connection with a fresh reading). setState here
  // is a legit "external event" (drawer opening) reaction; the tab reset
  // above is handled via the derived + override pattern instead.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot on drawer open; equivalent React idiom for "reset a scratch cache when a workspace reopens"
    if (isOpen) setBattery(null);
  }, [isOpen]);

  // Fetch battery on connect / when switching to device tab
  const fetchBattery = useCallback(async () => {
    if (!device.connection) return;
    try {
      const info = await requestBatteryLevel(device.connection);
      setBattery(info);
    } catch {
      // silent — device may not support BATT yet
    }
  }, [device.connection]);

  // Battery scratch state tracks the device connection: fetch on connect (when
  // the device tab is active — no point spamming BATT reads otherwise), clear
  // on disconnect. Genuine "subscribe to external state (connection lifecycle)
  // and setState from a callback."
  useEffect(() => {
    if (device.connection && topTab === "device") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchBattery is async and subscribes to an external system (BLE); this is the sanctioned "trigger a fetch when external state changes" case per React docs
      void fetchBattery();
      return;
    }
    if (!device.connection) {
      setBattery(null);
    }
  }, [device.connection, topTab, fetchBattery]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-10000 bg-black/40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-10001 w-full sm:w-1/2 min-w-[320px] bg-background border-l border-border flex flex-col shadow-2xl animate-in slide-in-from-right duration-200 safe-area-inset">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            {topTab === "garage" ? <Gauge className="w-5 h-5 text-primary" /> : topTab === "profile" ? <User className="w-5 h-5 text-primary" /> : <Cpu className="w-5 h-5 text-primary" />}
            <h2 className="font-semibold text-foreground">{topTab === "garage" ? t("shell.tabs.garage") : topTab === "profile" ? t("shell.tabs.profile") : t("shell.tabs.device")}</h2>
            {topTab === "device" && device.deviceName && (
              <span className="text-xs text-muted-foreground truncate max-w-[120px]">— {device.deviceName}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {topTab === "device" && device.connection && battery && (
              <button
                onClick={fetchBattery}
                className={`flex items-center gap-1 h-7 px-2 rounded text-xs font-medium transition-colors hover:bg-muted/50 ${
                  battery.percent <= 15 ? "text-destructive" : battery.percent <= 30 ? "text-orange-500" : "text-muted-foreground"
                }`}
                title={t("shell.batteryTitle", { voltage: battery.voltage.toFixed(2) })}
              >
                {battery.percent <= 15 ? <BatteryWarning className="w-4 h-4" /> :
                 battery.percent <= 30 ? <BatteryLow className="w-4 h-4" /> :
                 battery.percent <= 70 ? <BatteryMedium className="w-4 h-4" /> :
                 <BatteryFull className="w-4 h-4" />}
                {battery.percent}%
              </button>
            )}
            {topTab === "device" && device.connection && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={device.disconnectDevice}>{t("shell.disconnect")}</Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}><X className="w-4 h-4" /></Button>
          </div>
        </div>

        {/* Top-level Tab Bar */}
        <div className="flex border-b border-border shrink-0">
          <button onClick={() => setTopTab("garage")} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${topTab === "garage" ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}>
            <Gauge className="w-4 h-4" /> {t("shell.tabs.garage")}
          </button>
          {showProfile && (
            <button onClick={() => setTopTab("profile")} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${topTab === "profile" ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}>
              <User className="w-4 h-4" /> {t("shell.tabs.profile")}
            </button>
          )}
          <button onClick={() => setTopTab("device")} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${topTab === "device" ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}>
            <Cpu className="w-4 h-4" /> {t("shell.tabs.device")}
          </button>
        </div>

        {/* Garage Panel */}
        {topTab === "garage" && (
          <>
            <div className="flex gap-1 px-3 py-2 border-b border-border shrink-0">
              {garageTabs.map(tab => (
                <button key={tab.key} onClick={() => setGarageTab(tab.key)} className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${garageTab === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
                  {tab.label}
                </button>
              ))}
            </div>

            {garageTab === "files" && (
              <FilesTab files={files} fileMetadataMap={fileMetadataMap} vehicles={vehicles} currentTrackName={currentTrackName} currentCourseName={currentCourseName} isOpen={isOpen} storageUsed={storageUsed} storageQuota={storageQuota} onLoadFile={onLoadFile} onDeleteFile={onDeleteFile} onExportFile={onExportFile} onSaveFile={onSaveFile} onDataLoaded={onDataLoaded} onClose={onClose} autoSave={autoSave} showSampleFiles={showSampleFiles} />
            )}
            {garageTab === "vehicles" && (
              <VehiclesTab vehicles={vehicles} vehicleTypes={vehicleTypes} onAdd={onAddVehicle} onUpdate={onUpdateVehicle} onRemove={onRemoveVehicle} onCreateVehicleType={onCreateVehicleType} onOpenFile={onOpenFile} />
            )}
            {garageTab === "setups" && setupsTab}
          </>
        )}

        {/* Profile Panel — relocated from the main view's tab bar. */}
        {topTab === "profile" && showProfile && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <ProfileTab />
          </div>
        )}

        {/* Device Panel */}
        {topTab === "device" && (
          <>
            {!device.connection ? (
              // Every supported logger, through the same picker the Files tab and
              // the dashboard use — not just the Fledgling. The picker gates each
              // row on its own transport (Web Bluetooth, Wi-Fi, native shell), so
              // a browser without Web Bluetooth still reaches the loggers that
              // don't need it rather than hitting a dead end here.
              <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4 text-center">
                <Bluetooth className="w-12 h-12 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">{t("shell.connectTitle")}</h3>
                <p className="text-sm text-muted-foreground max-w-[260px]">{t("shell.connectDesc")}</p>
                <LoggerDownload
                  onDataLoaded={onDataLoaded}
                  autoSave={autoSave}
                  autoSaveFile={onSaveFile}
                  renderTrigger={({ onOpen }) => (
                    <Button onClick={onOpen} disabled={device.isConnecting} className="gap-2">
                      {device.isConnecting ? (<><Loader2 className="w-4 h-4 animate-spin" /> {t("shell.connecting")}</>) : (<><Bluetooth className="w-4 h-4" /> {t("shell.connect")}</>)}
                    </Button>
                  )}
                />
                {!bleAvailable && (
                  <p className="text-xs text-muted-foreground max-w-[260px]">{t("shell.btNotAvailableDesc")}</p>
                )}
              </div>
            ) : device.loggerKind && device.loggerKind !== "fledgling" ? (
              // Settings/tracks/firmware are Fledgling-only. Other loggers (MyChron,
              // Alfano) can connect for downloads but have no device-detail surface yet.
              <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4 text-center">
                <Cpu className="w-12 h-12 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">{t("shell.deviceFledglingOnlyTitle")}</h3>
                <p className="text-sm text-muted-foreground max-w-[260px]">{t("shell.deviceFledglingOnlyDesc")}</p>
              </div>
            ) : (
              <>
                <div className="flex gap-1 px-3 py-2 border-b border-border shrink-0">
                  {deviceTabs.map(tab => (
                    <button key={tab.key} onClick={() => setDeviceTab(tab.key)} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${deviceTab === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
                      {tab.icon} {tab.label}
                    </button>
                  ))}
                </div>
                {deviceTab === "settings" && <DeviceSettingsTab connection={device.connection} onResetComplete={() => { device.disconnectDevice(); onClose(); }} />}
                {deviceTab === "tracks" && <DeviceTracksTab connection={device.connection!} />}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
