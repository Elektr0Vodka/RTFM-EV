/**
 * meshHealthShared.tsx
 *
 * Shared primitives for the Mesh Health page: the time-window model and the
 * small presentational components (StatTile, DistBars) and relative-time
 * helper used by both the Adverts and Requests panels.
 */

import type { TFn } from '../i18n';
import { formatDateTime } from '../utils/dateTimeFormat';

// ─── Time windows ───────────────────────────────────────────────────────────

export interface TimeWindow {
  key: string;
  label: string;
  hours: number;
  autoRefresh: boolean; // true = refresh every 30s; false = manual only
}

export const TIME_WINDOWS: TimeWindow[] = [
  { key: '30m', label: '30m', hours: 0.5, autoRefresh: true },
  { key: '1h', label: '1h', hours: 1, autoRefresh: true },
  { key: '3h', label: '3h', hours: 3, autoRefresh: false },
  { key: '6h', label: '6h', hours: 6, autoRefresh: false },
  { key: '12h', label: '12h', hours: 12, autoRefresh: false },
  { key: '24h', label: '24h', hours: 24, autoRefresh: false },
  { key: '7d', label: '7d', hours: 168, autoRefresh: false },
];

export const DEFAULT_WINDOW = TIME_WINDOWS[0]; // 0 = 30m default

// ─── Helpers ────────────────────────────────────────────────────────────────

export function relTime(unixSec: number | null | undefined, t: TFn): string {
  if (unixSec == null) return t('mesh_health_time_never');
  const d = Date.now() - unixSec * 1000;
  if (d < 0) return t('channel_registry_just_now');
  const s = Math.floor(d / 1000);
  if (s < 60) return t('mesh_health_time_seconds_ago', { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('channel_registry_minutes_ago', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('channel_registry_hours_ago', { count: h });
  return t('channel_registry_days_ago', { count: Math.floor(h / 24) });
}

/**
 * Label for a chart bucket: time only, weekday and time, or date, depending on
 * the visible span, so a zoomed-in window shows finer labels.
 */
export function fmtBucketTime(ms: number, spanSeconds: number): string {
  const d = new Date(ms);
  if (spanSeconds <= 3600) return formatDateTime(d, { hour: '2-digit', minute: '2-digit' });
  if (spanSeconds <= 7 * 24 * 3600)
    return formatDateTime(d, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return formatDateTime(d, { month: 'short', day: 'numeric' });
}

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded border border-border bg-background p-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function DistBars({ items }: { items: { label: string; count: number; color: string }[] }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[10px] text-muted-foreground">{item.label}</span>
          <div className="flex-1 overflow-hidden rounded-full bg-muted h-1.5">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(item.count / max) * 100}%`, background: item.color }}
            />
          </div>
          <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
            {item.count}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Chart axes (My Node style) ──────────────────────────────────────────────

/**
 * Dashed grid lines with 0 / half / max labels on the left, the same look as
 * the My Node charts. `yOf` maps a value to its SVG y.
 */
export function ChartYGrid({
  max,
  left,
  right,
  yOf,
  format = (v) => String(Math.round(v)),
}: {
  max: number;
  left: number;
  right: number;
  yOf: (v: number) => number;
  format?: (v: number) => string;
}) {
  return (
    <>
      {[0, Math.round(max / 2), max].map((v, i) => (
        <g key={i} data-testid="chart-y-tick">
          <line
            x1={left}
            x2={right}
            y1={yOf(v)}
            y2={yOf(v)}
            stroke="hsl(var(--border))"
            strokeWidth={0.5}
            strokeDasharray={i === 0 ? undefined : '2,2'}
          />
          <text
            x={left - 3}
            y={yOf(v)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={8}
            fill="hsl(var(--muted-foreground))"
          >
            {format(v)}
          </text>
        </g>
      ))}
    </>
  );
}

/**
 * Start, middle and end time under a chart, the same look as the My Node
 * charts. `xOf` maps an index to its SVG x; `times` are unix seconds.
 */
export function ChartTimeAxis({
  times,
  xOf,
  y,
}: {
  times: number[];
  xOf: (i: number) => number;
  y: number;
}) {
  const n = times.length;
  if (n === 0) return null;
  const span = n > 1 ? times[n - 1] - times[0] : 0;
  const idx = n === 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 2), n - 1];
  return (
    <>
      {idx.map((i) => (
        <text
          key={i}
          data-testid="chart-time-label"
          x={xOf(i)}
          y={y}
          textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}
          fontSize={8}
          fill="hsl(var(--muted-foreground))"
        >
          {fmtBucketTime(times[i] * 1000, span)}
        </text>
      ))}
    </>
  );
}
