import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ResponsiveContainer } from '../charts/ResponsiveContainer';
import { ZoomableChart } from '../charts/ZoomableChart';
import { formatDateTime } from '../../utils/dateTimeFormat';
import type { ChartWindow } from '../../lib/chartZoom';
import type { PerfPoint } from './perfTypes';

const TIME_MIN_SPAN = 30;

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '6px',
    fontSize: '11px',
    color: 'hsl(var(--popover-foreground))',
  },
  itemStyle: { color: 'hsl(var(--popover-foreground))' },
  labelStyle: { color: 'hsl(var(--muted-foreground))' },
} as const;

export type PerfPointKey = Exclude<keyof PerfPoint, 'ts'>;

export interface PerfSeries {
  key: PerfPointKey;
  label: string;
  color: string;
}

// Theme colours for series; status colours stay reserved for state.
export const SERIES_COLORS = {
  primary: 'hsl(var(--primary))',
  info: 'hsl(var(--info))',
  warning: 'hsl(var(--warning))',
  destructive: 'hsl(var(--destructive))',
  success: 'hsl(var(--success))',
  muted: 'hsl(var(--muted-foreground))',
} as const;

/**
 * Time chart of Performance history points, several series as lines, with the
 * shared wheel zoom / drag pan / "+" panel. `threshold` draws a dashed line
 * (the event-loop stall line). `full` is the time window to span (unix seconds);
 * without it the chart spans its own points.
 */
export function PerfSeriesChart({
  points,
  series,
  format,
  ariaLabel,
  height = 150,
  threshold,
  full,
}: {
  points: PerfPoint[];
  series: PerfSeries[];
  format: (value: number) => string;
  ariaLabel: string;
  height?: number;
  threshold?: number;
  full?: ChartWindow;
}) {
  const extent: ChartWindow =
    full ?? (points.length > 1 ? [points[0].ts, points[points.length - 1].ts] : [0, 0]);
  const labels = useMemo(() => new Map(series.map((s) => [s.key, s.label])), [series]);

  return (
    <div role="img" aria-label={ariaLabel}>
      <ZoomableChart
        full={extent}
        minSpan={TIME_MIN_SPAN}
        inset={{ left: 52, right: 4 }}
        title={ariaLabel}
      >
        {({ domain, isPanning }) => (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                allowDataOverflow
                domain={domain}
                tickFormatter={(ts: number) =>
                  formatDateTime(ts * 1000, {
                    month: 'numeric',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                }
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={52}
                domain={[0, 'auto']}
                tickFormatter={(v: number) => format(v)}
              />
              {threshold != null && (
                <ReferenceLine
                  y={threshold}
                  stroke="hsl(var(--destructive))"
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                />
              )}
              {!isPanning && (
                <RechartsTooltip
                  {...TOOLTIP_STYLE}
                  labelFormatter={(ts) =>
                    formatDateTime(Number(ts) * 1000, {
                      month: 'numeric',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      second: '2-digit',
                    })
                  }
                  formatter={(value, name) => [
                    format(Number(value)),
                    labels.get(name as PerfPointKey) ?? String(name),
                  ]}
                />
              )}
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.key}
                  stroke={s.color}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </ZoomableChart>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-3 rounded"
              style={{ backgroundColor: s.color }}
              aria-hidden="true"
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Small inline trend line for a KPI tile. Scaled to its own min..max. */
export function Sparkline({
  values,
  color,
  className = 'h-8 w-24',
}: {
  values: (number | null)[];
  color: string;
  className?: string;
}) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return <svg className={className} aria-hidden="true" />;
  const w = 96;
  const h = 32;
  const min = Math.min(...nums);
  const span = Math.max(...nums) - min || 1;
  const step = w / (values.length - 1);
  const pts: string[] = [];
  values.forEach((v, i) => {
    if (v == null) return;
    pts.push(`${(i * step).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 6)).toFixed(1)}`);
  });
  const last = pts[pts.length - 1].split(',');
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={color} fillOpacity={0.14} />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}
