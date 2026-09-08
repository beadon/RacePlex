import { useMemo } from 'react';

/**
 * A single round gauge: a ring of tick marks with numeric labels and a
 * needle pointing at the current value, modeled on VESC Tool's RT Data
 * screen. The tick ring + needle carries the reading — color is decoration
 * only, never the only way a value is conveyed.
 */
export interface CircularGaugeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  /** Interval between labeled major ticks. */
  tickStep: number;
  /** Minor (unlabeled) ticks drawn between each pair of major ticks. */
  minorPerMajor?: number;
  /** Decimal places for the center readout when `formatValue` isn't given. */
  decimals?: number;
  /** Overrides the default numeric center readout (e.g. "∞", a duration). */
  formatValue?: (value: number) => string;
  needleColor?: string;
  size?: number;
  className?: string;
}

const START_ANGLE_DEG = 135;
const SWEEP_DEG = 270;
const VIEWBOX = 200;
const CENTER = VIEWBOX / 2;
const OUTER_RADIUS = 92;
const MAJOR_TICK_LEN = 14;
const MINOR_TICK_LEN = 7;
const LABEL_RADIUS = 65;
/** The needle starts this far out from center, leaving the middle clear for the label/value/unit text. */
const NEEDLE_INNER_RADIUS = 40;
const NEEDLE_OUTER_RADIUS = 80;
const NEEDLE_HUB_RADIUS = 3.5;

function pointOnCircle(radius: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

function angleForFraction(fraction: number): number {
  return START_ANGLE_DEG + fraction * SWEEP_DEG;
}

export function CircularGauge({
  label,
  value,
  min,
  max,
  unit,
  tickStep,
  minorPerMajor = 5,
  decimals = 0,
  formatValue,
  needleColor = 'hsl(var(--primary))',
  size = 180,
  className,
}: CircularGaugeProps) {
  const range = max - min;
  const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  const fraction = range === 0 ? 0 : (clamped - min) / range;
  const needleAngle = angleForFraction(fraction);

  const ticks = useMemo(() => {
    const majors: { value: number; angle: number }[] = [];
    const minors: { angle: number }[] = [];
    if (tickStep <= 0 || range <= 0) return { majors, minors };

    const count = Math.round(range / tickStep);
    for (let i = 0; i <= count; i++) {
      const tickValue = min + i * tickStep;
      const tickFraction = (tickValue - min) / range;
      majors.push({ value: tickValue, angle: angleForFraction(tickFraction) });

      if (i < count && minorPerMajor > 1) {
        for (let m = 1; m < minorPerMajor; m++) {
          const minorFraction = tickFraction + (m / minorPerMajor) * (tickStep / range);
          minors.push({ angle: angleForFraction(minorFraction) });
        }
      }
    }
    return { majors, minors };
  }, [min, range, tickStep, minorPerMajor]);

  const needlePivot = pointOnCircle(NEEDLE_INNER_RADIUS, needleAngle);
  const needleTip = pointOnCircle(NEEDLE_OUTER_RADIUS, needleAngle);

  const displayValue = formatValue
    ? formatValue(value)
    : Number.isFinite(value)
      ? value.toFixed(decimals)
      : '--';

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={`${label}: ${displayValue}${unit ? ` ${unit}` : ''}`}
    >
      <circle cx={CENTER} cy={CENTER} r={OUTER_RADIUS + 4} className="fill-card stroke-border" strokeWidth={1} />

      {ticks.minors.map((tick, i) => {
        const inner = pointOnCircle(OUTER_RADIUS - MINOR_TICK_LEN, tick.angle);
        const outer = pointOnCircle(OUTER_RADIUS, tick.angle);
        return (
          <line
            key={`minor-${i}`}
            x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
            className="stroke-muted-foreground/40"
            strokeWidth={1}
          />
        );
      })}

      {ticks.majors.map((tick, i) => {
        const inner = pointOnCircle(OUTER_RADIUS - MAJOR_TICK_LEN, tick.angle);
        const outer = pointOnCircle(OUTER_RADIUS, tick.angle);
        const labelPos = pointOnCircle(LABEL_RADIUS, tick.angle);
        return (
          <g key={`major-${i}`}>
            <line
              x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
              className="stroke-muted-foreground"
              strokeWidth={1.5}
            />
            <text
              x={labelPos.x} y={labelPos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              fontSize={11}
            >
              {Math.abs(tick.value) >= 1000 ? `${Math.round(tick.value / 1000)}k` : Math.round(tick.value)}
            </text>
          </g>
        );
      })}

      <line
        x1={needlePivot.x} y1={needlePivot.y} x2={needleTip.x} y2={needleTip.y}
        stroke={needleColor} strokeWidth={3} strokeLinecap="round"
      />
      <circle cx={needlePivot.x} cy={needlePivot.y} r={NEEDLE_HUB_RADIUS} fill={needleColor} />

      <text x={CENTER} y={CENTER - 30} textAnchor="middle" className="fill-muted-foreground" fontSize={11} letterSpacing={0.5}>
        {label.toUpperCase()}
      </text>
      <text x={CENTER} y={CENTER - 6} textAnchor="middle" className="fill-foreground font-semibold" fontSize={26}>
        {displayValue}
      </text>
      {unit && (
        <text x={CENTER} y={CENTER + 16} textAnchor="middle" className="fill-muted-foreground" fontSize={11}>
          {unit}
        </text>
      )}
    </svg>
  );
}
