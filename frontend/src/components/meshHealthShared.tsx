/**
 * meshHealthShared.tsx
 *
 * Shared primitives for the Mesh Health page: the time-window model and the
 * small presentational components (StatTile, DistBars) and relative-time
 * helper used by both the Adverts and Requests panels.
 */

import type { TFn } from '../i18n';

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
          <span className="w-14 flex-shrink-0 text-[10px] text-muted-foreground">{item.label}</span>
          <div className="flex-1 overflow-hidden rounded-full bg-muted h-1.5">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(item.count / max) * 100}%`, background: item.color }}
            />
          </div>
          <span className="w-5 flex-shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
            {item.count}
          </span>
        </div>
      ))}
    </div>
  );
}
