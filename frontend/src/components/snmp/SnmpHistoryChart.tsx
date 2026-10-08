import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, isAbortError } from '../../api';
import { useT } from '../../i18n';
import { formatDateTime } from '../../utils/dateTimeFormat';
import type { ChartWindow } from '../../lib/chartZoom';
import type { SnmpHistoryEntry } from '../../types';
import { ZoomableChart } from '../charts/ZoomableChart';
import { SNMP_FIELDS, formatSnmpValue, type SnmpField } from './snmpFields';

const TIME_MIN_SPAN = 30; // smallest zoom window, in seconds
const CHART_HEIGHT = 120;
const CHART_COLOR = '#0ea5e9';

const RANGES: { hours: number; labelKey: string }[] = [
  { hours: 24, labelKey: 'snmp_range_24h' },
  { hours: 24 * 7, labelKey: 'snmp_range_7d' },
  { hours: 24 * 30, labelKey: 'snmp_range_30d' },
];

// The two names are text; everything else can be charted.
const CHART_FIELDS: SnmpField[] = SNMP_FIELDS.filter(
  (field) => field.key !== 'node_name' && field.key !== 'firmware_version'
);
const DEFAULT_METRIC = 'free_heap';

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

export interface SnmpChartPoint {
  time: number;
  value: number;
}

/** History rows to chart points for one value; rows without a number are skipped. */
export function toChartPoints(history: SnmpHistoryEntry[], key: string): SnmpChartPoint[] {
  const points: SnmpChartPoint[] = [];
  for (const entry of history) {
    const value = entry.values[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      points.push({ time: entry.timestamp, value });
    }
  }
  return points;
}

/**
 * Stored SNMP polls of one contact as a chart: pick a value and a range.
 * `version` changes after a poll, which reloads the history.
 */
export function SnmpHistoryChart({ publicKey, version }: { publicKey: string; version: number }) {
  const t = useT();
  const [hours, setHours] = useState(RANGES[0].hours);
  const [metric, setMetric] = useState(DEFAULT_METRIC);
  const [history, setHistory] = useState<SnmpHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .snmpHistory(publicKey, hours, controller.signal)
      .then((rows) => {
        setHistory(rows);
        setError(null);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [publicKey, hours, version]);

  const field = CHART_FIELDS.find((f) => f.key === metric) ?? CHART_FIELDS[0];
  const points = useMemo(() => toChartPoints(history ?? [], field.key), [history, field.key]);
  const full: ChartWindow =
    points.length > 0 ? [points[0].time, points[points.length - 1].time] : [0, 0];
  const format = (value: number) => formatSnmpValue(field, { [field.key]: value });

  return (
    <div className="space-y-1" data-testid="snmp-history">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
          {t('snmp_history')}
        </span>
        <select
          aria-label={t('snmp_history_value')}
          value={field.key}
          onChange={(e) => setMetric(e.target.value)}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs"
        >
          {CHART_FIELDS.map((f) => (
            <option key={f.key} value={f.key}>
              {t(f.labelKey)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('snmp_history_range')}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs"
        >
          {RANGES.map((range) => (
            <option key={range.hours} value={range.hours}>
              {t(range.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {history !== null && points.length < 2 && !error && (
        <p className="text-[0.6875rem] text-muted-foreground" data-testid="snmp-history-empty">
          {t('snmp_history_empty')}
        </p>
      )}
      {points.length >= 2 && (
        <div role="img" aria-label={t('snmp_history_chart_label', { value: t(field.labelKey) })}>
          <ZoomableChart full={full} minSpan={TIME_MIN_SPAN} inset={{ left: 48, right: 4 }}>
            {({ domain, isPanning }) => (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <AreaChart data={points}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
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
                      formatter={(value) => [format(Number(value)), t(field.labelKey)]}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="value"
                    name={t(field.labelKey)}
                    stroke={CHART_COLOR}
                    fill={CHART_COLOR}
                    fillOpacity={0.15}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ZoomableChart>
        </div>
      )}
    </div>
  );
}
