import { useState, useEffect, useCallback } from "react";
import { isFieldHiddenByCanonical, CanonicalFieldId } from "@/lib/fieldResolver";
import i18n, { initialLanguage } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/i18n/config";
import { DEFAULT_PALETTE, type PaletteId } from "@/lib/palettes";
import { onGarageChange } from "@/lib/garageEvents";
import { STORE_NAMES } from "@/lib/dbUtils";

export interface AppSettings {
  useKph: boolean;                  // Speed unit: false = MPH, true = KPH
  useMetricDistance: boolean;       // Distance unit: false = ft/mi, true = m/km
  useMetricWeather: boolean;        // Weather units: false = °F/mph/inHg/ft, true = °C/(km/h)/hPa/m
  gForceSmoothing: boolean;
  gForceSmoothingStrength: number; // 0-100, maps to window size
  defaultHiddenFields: CanonicalFieldId[]; // Canonical field IDs to hide by default
  // Braking zone detection settings
  brakingEntryThreshold: number;    // 10-50, represents 0.10-0.50g (default: 25)
  brakingExitThreshold: number;     // 5-25, represents 0.05-0.25g (default: 10)
  brakingMinDuration: number;       // 50-500ms (default: 120)
  brakingSmoothingAlpha: number;    // 10-80, represents 0.1-0.8 (default: 40)
  brakingZoneColor: string;         // HSL color string (default: blue)
  brakingZoneWidth: number;         // 6-16 pixels (default: 10)
  brakingGraphWindow: number;       // 5-51 odd, SG filter window for graph (default: 25)
  brakeMaxG: number;                // 50-300, represents 0.5-3.0G, the G value that = 100% brake (default: 150 = 1.5G)
  autoSaveFiles: boolean;           // Auto-save imported/uploaded files to device (default: true)
  showSampleFiles: boolean;         // Show the bundled sample log in the file browser (default: true)
  darkMode: boolean;                // Dark mode enabled (default: true)
  palette: PaletteId;               // Colour palette (CSS-var override set, default: 'raceplex')
  gForceSource: 'gps' | 'hw';      // Which G-force source to show in simple mode (default: 'hw')
  deltaMethod: 'position' | 'distance'; // Lap delta algorithm (default: 'position')
  deltaSampleMeters: number;        // Arc-length resample spacing for position delta (default: 2)
  chartXAxis: 'time' | 'distance';  // Analysis chart X-axis scale (default: 'distance')
  language: SupportedLanguage;      // Display language (default: browser-detected, else 'en')
  mychronSsidPrefix: string;        // SSID prefix the Android Wi-Fi picker filters on for MyChron (default: 'MYCHRON5')
}

const SETTINGS_KEY_BASE = "raceplex:settings";
const DEFAULT_USER_ID = "default-user";

/**
 * Per-user settings key (plan 0011). The default seed user keeps the plain
 * `raceplex:settings` name so the localStorage rename migration produced by
 * `legacyDbMigration.ts` requires no follow-up; other users get a suffixed key
 * (`raceplex:settings:<userId>`). Read synchronously by useState-init and by
 * the i18n bootstrap, so no async lookup is possible here — resolved from
 * localStorage's active-user pointer directly.
 */
function settingsKey(): string {
  if (typeof localStorage === "undefined") return SETTINGS_KEY_BASE;
  try {
    const uid = localStorage.getItem("raceplex:activeUserId");
    if (!uid || uid === DEFAULT_USER_ID) return SETTINGS_KEY_BASE;
    return `${SETTINGS_KEY_BASE}:${uid}`;
  } catch {
    return SETTINGS_KEY_BASE;
  }
}

const defaultSettings: AppSettings = {
  useKph: false,
  useMetricDistance: false,
  useMetricWeather: false,
  gForceSmoothing: true,
  gForceSmoothingStrength: 50,
  defaultHiddenFields: [],
  // Braking zone defaults
  brakingEntryThreshold: 25,      // -0.25g
  brakingExitThreshold: 10,       // -0.10g
  brakingMinDuration: 120,        // 120ms
  brakingSmoothingAlpha: 40,      // 0.4
  brakingZoneColor: 'hsl(210, 90%, 55%)',  // Blue
  brakingZoneWidth: 10,           // 10px
  brakingGraphWindow: 25,         // SG window size (25 @ 25Hz = 1s)
  brakeMaxG: 150,                 // 1.5G = 100% brake
  autoSaveFiles: true,
  showSampleFiles: true,
  darkMode: false,
  palette: DEFAULT_PALETTE,
  gForceSource: 'hw',
  deltaMethod: 'position',
  deltaSampleMeters: 2,
  chartXAxis: 'distance',
  // Default to the language i18n resolved at boot (saved pref → browser → 'en'),
  // so a first-run user sees their browser language without an explicit choice.
  language: initialLanguage,
  // Mirrors MYCHRON_SSID_PREFIX in lib/loggers/mychron/ipc.ts — kept as a literal
  // here so the eager settings bundle doesn't pull the (lazy) MyChron IPC module.
  mychronSsidPrefix: 'MYCHRON5',
};

function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(settingsKey());
    if (stored) return { ...defaultSettings, ...JSON.parse(stored) };
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
  return defaultSettings;
}

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(loadSettings);

  // Persist settings under the currently-active user's key. When the user
  // switches, the effect that reacts to the USERS garage-event below reloads
  // settings first — so this write always lands under the new user's key.
  useEffect(() => {
    try {
      localStorage.setItem(settingsKey(), JSON.stringify(settings));
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  }, [settings]);

  // Reload settings when the active user switches (plan 0011). The switcher
  // emits a synthetic USERS garage-event; on receipt we replace state with the
  // new user's saved settings (or defaults, if they've never picked any).
  useEffect(() => {
    return onGarageChange((c) => {
      if (c.store !== STORE_NAMES.USERS) return;
      setSettingsState(loadSettings());
    });
  }, []);

  // Bridge the language preference to i18next. Lives here (not in a single UI
  // handler) so the active language always tracks the setting, no matter which
  // surface changed it. changeLanguage lazy-loads the locale's chunks on demand.
  useEffect(() => {
    if (i18n.language !== settings.language) {
      void i18n.changeLanguage(settings.language);
    }
  }, [settings.language]);

  const setSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettingsState((prev) => ({ ...prev, ...updates }));
  }, []);

  const toggleFieldDefault = useCallback((canonicalId: CanonicalFieldId) => {
    setSettingsState((prev) => {
      const isHidden = prev.defaultHiddenFields.includes(canonicalId);
      if (isHidden) {
        return {
          ...prev,
          defaultHiddenFields: prev.defaultHiddenFields.filter((f) => f !== canonicalId),
        };
      } else {
        return {
          ...prev,
          defaultHiddenFields: [...prev.defaultHiddenFields, canonicalId],
        };
      }
    });
  }, []);

  // Check if a field name should be hidden based on canonical mapping
  const isFieldHiddenByDefault = useCallback(
    (fieldName: string) => isFieldHiddenByCanonical(fieldName, settings.defaultHiddenFields),
    [settings.defaultHiddenFields]
  );

  return {
    settings,
    setSettings,
    toggleFieldDefault,
    isFieldHiddenByDefault,
  };
}
