import { useEffect, useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import { api } from '../api';
import { useT } from '../i18n';
import { formatLppLabel } from './repeater/repeaterPaneShared';
import { formatTime } from '../utils/messageParser';
import type { TelemetryHistoryEntry, TelemetryLppSensor } from '../types';

// Kept in step with the ContactInfoPane telemetry chart palette so the two read
// as one system.
const CHART_COLORS = ['#22c55e', '#8b5cf6', '#0ea5e9', '#ef4444', '#f59e0b', '#ec4899'];

/** Compact telemetry history line chart for the map node-click popup. Fetches
 *  the node's stored telemetry (read-only, no radio), lets the reader pick a
 *  metric, and draws it with the same look as the detail-pane chart. Mounted
 *  imperatively into the MapLibre popup via createRoot. */
export function TelemetryPopupChart({ publicKey }: { publicKey: string }) {
  const t = useT();
  const [history, setHistory] = useState<TelemetryHistoryEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .contactTelemetryHistory(publicKey)
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  const series = useMemo(() => {
    const seen = new Map<string, { type_name: string; channel: number }>();
    for (const entry of history ?? []) {
      for (const s of entry.data?.lpp_sensors ?? []) {
        if (typeof s.value !== 'number') continue;
        const key = `${s.type_name}_ch${s.channel}`;
        if (!seen.has(key)) seen.set(key, { type_name: s.type_name, channel: s.channel });
      }
    }
    return Array.from(seen.entries()).map(([key, info], i) => ({
      key,
      label: formatLppLabel(info.type_name),
      color: CHART_COLORS[i % CHART_COLORS.length],
      ...info,
    }));
  }, [history]);

  const active = selected ?? series[0]?.key ?? null;
  const activeSeries = series.find((s) => s.key === active);

  const data = useMemo(() => {
    if (!active || !activeSeries) return [];
    return (history ?? [])
      .map((entry) => {
        const sensor = (entry.data?.lpp_sensors ?? []).find(
          (s: TelemetryLppSensor) =>
            s.type_name === activeSeries.type_name && s.channel === activeSeries.channel
        );
        return {
          time: entry.timestamp,
          value: sensor && typeof sensor.value === 'number' ? sensor.value : null,
        };
      })
      .filter((d) => d.value !== null);
  }, [history, active, activeSeries]);

  if (error)
    return (
      <div className="mt-1 text-xs text-muted-foreground">{t('map_telemetry_history_error')}</div>
    );
  if (history === null)
    return (
      <div className="mt-1 text-xs text-muted-foreground">{t('map_telemetry_history_loading')}</div>
    );
  if (series.length === 0 || data.length < 2)
    return (
      <div className="mt-1 text-xs text-muted-foreground">{t('map_telemetry_history_none')}</div>
    );

  return (
    <div className="mt-1" style={{ width: 240 }}>
      <div className="mb-1 flex flex-wrap gap-1">
        {series.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSelected(s.key)}
            className={`rounded px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider transition-colors ${
              active === s.key
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={110}>
        <AreaChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v) => formatTime(Number(v))}
            tick={{ fontSize: 9 }}
            stroke="hsl(var(--muted-foreground))"
          />
          <YAxis
            width={32}
            tick={{ fontSize: 9 }}
            stroke="hsl(var(--muted-foreground))"
            domain={['auto', 'auto']}
          />
          <RechartsTooltip
            labelFormatter={(v) => formatTime(Number(v))}
            contentStyle={{ fontSize: 11 }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={activeSeries!.color}
            fill={activeSeries!.color}
            fillOpacity={0.15}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
