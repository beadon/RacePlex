import { CircularGauge } from "./CircularGauge";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { formatDistance, speedUnitLabel } from "@/lib/units";
import type { VescSetupValues } from "@/lib/live/vescDecoder";

/**
 * Mimics VESC Tool's "RT Data" gauge screen (issue #58's follow-up) — a
 * rider already reads this exact layout on their board, so RacePlex reuses
 * it rather than inventing a new one. Every reading is a tick-mark ring plus
 * a needle pointer, same as VESC Tool's dials; color marks temperature/
 * battery gauges as "watch this one" but never carries the reading alone.
 *
 * Gauge ranges (current/power/duty/speed) are fixed defaults, not read from
 * the board's own configured limits — VESC doesn't hand those over on
 * `COMM_GET_VALUES_SETUP`, and reading `COMM_GET_MCCONF` just to scale a
 * dial isn't worth the extra round trip. A reading past the printed range
 * still shows correctly (the needle just pins at the end stop).
 */

const PRIMARY = "hsl(var(--primary))";
const WARNING = "hsl(var(--warning))";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-border bg-card px-3 py-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="tabular-nums text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

export function VescGaugeDashboard({ values }: { values: VescSetupValues }) {
  const { useKph, useMetricDistance } = useSettingsContext();

  const speedValue = useKph ? values.speedMps * 3.6 : values.speedMps * 2.236936;
  const powerW = values.batteryCurrentA * values.batteryVoltageV;
  const tripDistance = useMetricDistance ? values.tripMeters / 1000 : values.tripMeters / 1609.344;
  const consumpValue = tripDistance > 0.05 ? values.wattHours / tripDistance : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <CircularGauge
          label="Current" unit="A" min={-100} max={200} tickStep={50}
          value={values.motorCurrentA} needleColor={PRIMARY} className="w-full h-auto"
        />
        <CircularGauge
          label="Power" unit="W" min={-4000} max={8000} tickStep={2000}
          value={powerW} needleColor={PRIMARY} className="w-full h-auto"
        />
        <CircularGauge
          label="Duty" unit="%" min={-100} max={100} tickStep={25}
          value={values.dutyCycle * 100} needleColor={PRIMARY} className="w-full h-auto"
        />
      </div>

      <div className="grid grid-cols-5 gap-2 items-center">
        <div className="col-span-3">
          <CircularGauge
            label="Speed" unit={speedUnitLabel(useKph)} min={-60} max={60} tickStep={10}
            value={speedValue} needleColor={PRIMARY} className="w-full h-auto"
          />
        </div>
        <div className="col-span-2">
          <CircularGauge
            label="Battery" unit="%" min={0} max={100} tickStep={10}
            value={values.batteryLevel * 100} needleColor={WARNING} className="w-full h-auto"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <CircularGauge
          label="Temp ESC" unit="°C" min={0} max={100} tickStep={20}
          value={values.tempEscC} needleColor={WARNING} className="w-full h-auto"
        />
        <CircularGauge
          label="Consump." unit={useMetricDistance ? "WH/KM" : "WH/MI"} min={-50} max={50} tickStep={10}
          value={consumpValue} decimals={1} needleColor={PRIMARY} className="w-full h-auto"
        />
        <CircularGauge
          label="Temp Motor" unit="°C" min={0} max={100} tickStep={20}
          value={values.tempMotorC} needleColor={WARNING} className="w-full h-auto"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatBox label="Odometer" value={values.odometerMeters !== undefined ? formatDistance(values.odometerMeters, useMetricDistance) : "--"} />
        <StatBox label="Trip" value={formatDistance(values.tripMeters, useMetricDistance)} />
        <StatBox label="Up-time" value={values.uptimeMs !== undefined ? formatDuration(values.uptimeMs) : "--"} />
      </div>

      {values.faultCode !== 0 && (
        <p className="text-center text-xs text-destructive">VESC fault code {values.faultCode}</p>
      )}
      {values.numVescs !== undefined && values.numVescs > 1 && (
        <p className="text-center text-[10px] text-muted-foreground">{values.numVescs} VESCs on CAN bus</p>
      )}
    </div>
  );
}
