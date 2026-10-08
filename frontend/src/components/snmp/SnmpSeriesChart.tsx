import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDateTime } from '../../utils/dateTimeFormat';
import type { ChartWindow } from '../../lib/chartZoom';
import { ZoomableChart } from '../charts/ZoomableChart';
import type { SnmpChartPoint } from './snmpSeries';

const TIME_MIN_SPAN = 30; // smallest zoom window, in seconds
const DEFAULT_HEIGHT = 120;

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

export interface SnmpChartSeries {
  key: string;
  label: string;
  color: string;
  points: SnmpChartPoint[];
}

/** One row per timestamp with a column per series, as Recharts wants it. */
export function mergeSeries(series: SnmpChartSeries[]): Record<string, number>[] {
  const rows = new Map<number, Record<string, number>>();
  for (const s of series) {
    for (const point of s.points) {
      const row = rows.get(point.time) ?? { time: point.time };
      row[s.key] = point.value;
      rows.set(point.time, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.time - b.time);
}

/**
 * Time chart of one or more SNMP series with wheel zoom, drag pan and hover
 * values. A single series is drawn as a filled area, several as lines.
 * `full` sets the time extent; without it the chart spans its own data.
 * `tickFormat` shortens the numbers on the value axis (durations, sizes).
 */
export function SnmpSeriesChart({
  series,
  format,
  ariaLabel,
  full,
  tickFormat,
  height = DEFAULT_HEIGHT,
}: {
  series: SnmpChartSeries[];
  format: (value: number) => string;
  ariaLabel: string;
  full?: ChartWindow;
  tickFormat?: (value: number) => string;
  height?: number;
}) {
  const rows = useMemo(() => mergeSeries(series), [series]);
  const extent: ChartWindow =
    full ?? (rows.length > 0 ? [rows[0].time, rows[rows.length - 1].time] : [0, 0]);
  const single = series.length === 1;
  const labels = new Map(series.map((s) => [s.key, s.label]));

  return (
    <div role="img" aria-label={ariaLabel}>
      <ZoomableChart full={extent} minSpan={TIME_MIN_SPAN} inset={{ left: 48, right: 4 }}>
        {({ domain, isPanning }) => (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                allowDataOverflow
                domain={domain}
                tickFormatter={(timestamp: number) =>
                  formatDateTime(timestamp * 1000, {
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
                width={48}
                domain={['auto', 'auto']}
                tickFormatter={tickFormat}
              />
              {!isPanning && (
                <RechartsTooltip
                  {...TOOLTIP_STYLE}
                  labelFormatter={(timestamp) =>
                    formatDateTime(Number(timestamp) * 1000, {
                      year: 'numeric',
                      month: 'numeric',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      second: '2-digit',
                    })
                  }
                  formatter={(value, name) => [
                    format(Number(value)),
                    labels.get(String(name)) ?? String(name),
                  ]}
                />
              )}
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.key}
                  stroke={s.color}
                  fill={s.color}
                  fillOpacity={single ? 0.15 : 0}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ZoomableChart>
    </div>
  );
}
