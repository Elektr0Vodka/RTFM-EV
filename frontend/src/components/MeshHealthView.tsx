/**
 * MeshHealthView.tsx
 *
 * Mesh health monitoring page — shows advert frequency alerts for contacts
 * that are advertising too often, plus a sortable, paginated contacts table.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Map,
  RefreshCw,
} from 'lucide-react';
import type { RadioConfig } from '../types';

// ─── Extra analytics types ───────────────────────────────────────────────────

interface ScatterPoint {
  rssi: number;
  snr: number;
}
interface HeatmapCell {
  dow: number;
  hour: number;
  count: number;
}
interface HeatmapData {
  cells: HeatmapCell[];
  max_count: number;
  total: number;
}
interface RelayPair {
  hop_a: string;
  hop_b: string;
  count: number;
}
interface ReachabilityRing {
  hops: number | null;
  count: number;
  label: string;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface MeshHealthContact {
  public_key: string;
  name: string | null;
  advert_count: number;
  first_seen: number | null;
  last_seen: number | null;
  lat: number | null;
  lon: number | null;
  min_path_len: number | null;
  /** 0=1-byte hops, 1=2-byte hops, 2=3-byte hops, null=unknown/legacy */
  hash_mode: number | null;
}

interface MeshHealthAlert {
  level: 'HIGH' | 'MEDIUM';
  public_key: string;
  name: string | null;
  advert_count: number;
  adverts_per_hour: number;
}

interface MeshHealthResponse {
  start_ts: number;
  end_ts: number;
  window_hours: number;
  total_contacts: number;
  high_alert_count: number;
  medium_alert_count: number;
  high_advert_threshold: number;
  medium_advert_threshold: number;
  alerts: MeshHealthAlert[];
  contacts: MeshHealthContact[];
}

type SortKey =
  | 'name'
  | 'advert_count'
  | 'last_seen'
  | 'first_seen'
  | 'min_path_len'
  | 'distance'
  | 'status'
  | 'hash_mode';
type SortDir = 'asc' | 'desc';

// ─── Time windows ───────────────────────────────────────────────────────────

interface TimeWindow {
  key: string;
  label: string;
  hours: number;
  autoRefresh: boolean; // true = refresh every 30s; false = manual only
}

const TIME_WINDOWS: TimeWindow[] = [
  { key: '30m', label: '30m', hours: 0.5, autoRefresh: true },
  { key: '1h', label: '1h', hours: 1, autoRefresh: true },
  { key: '3h', label: '3h', hours: 3, autoRefresh: false },
  { key: '6h', label: '6h', hours: 6, autoRefresh: false },
  { key: '12h', label: '12h', hours: 12, autoRefresh: false },
  { key: '24h', label: '24h', hours: 24, autoRefresh: false },
  { key: '7d', label: '7d', hours: 168, autoRefresh: false },
];

const DEFAULT_WINDOW = TIME_WINDOWS[0]; // 0 = 30m default
const PAGE_SIZE = 50;

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  config: RadioConfig | null;
  onNavigateToMap?: (focusKey?: string) => void;
  /** Public key to scroll to and highlight when the view loads */
  focusKey?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function relTime(unixSec: number | null | undefined): string {
  if (unixSec == null) return 'Never';
  const d = Date.now() - unixSec * 1000;
  if (d < 0) return 'just now';
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
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

function DistBars({ items }: { items: { label: string; count: number; color: string }[] }) {
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

// ─── SNR vs RSSI scatter plot ─────────────────────────────────────────────────

function ScatterPlot({ points }: { points: ScatterPoint[] }) {
  if (!points.length) return null;
  const W = 360,
    H = 180;
  const pad = { top: 8, right: 10, bottom: 28, left: 34 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;

  const rssis = points.map((p) => p.rssi);
  const snrs = points.map((p) => p.snr);
  const minR = Math.min(...rssis),
    maxR = Math.max(...rssis, minR + 1);
  const minS = Math.min(...snrs),
    maxS = Math.max(...snrs, minS + 1);

  const xOf = (r: number) => pad.left + ((r - minR) / (maxR - minR)) * pw;
  const yOf = (s: number) => pad.top + ph - ((s - minS) / (maxS - minS)) * ph;

  // X-axis ticks
  const xTicks = [minR, Math.round((minR + maxR) / 2), maxR];
  const yTicks = [minS, Math.round((minS + maxS) / 2), maxS];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      role="img"
      aria-label="SNR vs RSSI scatter"
    >
      {/* Grid lines */}
      {yTicks.map((s) => (
        <g key={s}>
          <line
            x1={pad.left}
            x2={W - pad.right}
            y1={yOf(s)}
            y2={yOf(s)}
            stroke="hsl(var(--border))"
            strokeWidth={0.5}
          />
          <text
            x={pad.left - 3}
            y={yOf(s) + 3}
            textAnchor="end"
            fontSize={8}
            fill="hsl(var(--muted-foreground))"
          >
            {s}
          </text>
        </g>
      ))}
      {xTicks.map((r) => (
        <text
          key={r}
          x={xOf(r)}
          y={H - 4}
          textAnchor="middle"
          fontSize={8}
          fill="hsl(var(--muted-foreground))"
        >
          {r}
        </text>
      ))}
      {/* Axis labels */}
      <text
        x={W / 2}
        y={H - 1}
        textAnchor="middle"
        fontSize={7}
        fill="hsl(var(--muted-foreground))"
      >
        RSSI (dBm)
      </text>
      <text
        x={9}
        y={H / 2}
        textAnchor="middle"
        fontSize={7}
        fill="hsl(var(--muted-foreground))"
        transform={`rotate(-90, 9, ${H / 2})`}
      >
        SNR (dB)
      </text>
      {/* Points */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={xOf(p.rssi)}
          cy={yOf(p.snr)}
          r={1.8}
          fill="#2563eb"
          fillOpacity={0.45}
        />
      ))}
    </svg>
  );
}

// ─── 7×24 hourly heatmap ──────────────────────────────────────────────────────

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function HourlyHeatmap({ data }: { data: HeatmapData }) {
  const cellMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of data.cells) m[`${c.dow}:${c.hour}`] = c.count;
    return m;
  }, [data.cells]);

  const maxCount = Math.max(data.max_count, 1);

  const cellColor = (count: number) => {
    if (!count) return 'hsl(var(--muted))';
    const ratio = count / maxCount;
    if (ratio < 0.25) return '#1e40af';
    if (ratio < 0.5) return '#2563eb';
    if (ratio < 0.75) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-px"
        style={{ display: 'grid', gridTemplateColumns: '28px repeat(24, 1fr)', minWidth: 380 }}
      >
        {/* Empty corner + hour headers */}
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={h}
            className="text-center text-[8px] text-muted-foreground pb-0.5"
            style={{ lineHeight: 1 }}
          >
            {h % 6 === 0 ? `${h}h` : ''}
          </div>
        ))}
        {/* Rows: one per day */}
        {Array.from({ length: 7 }, (_, dow) => (
          <div key={dow} style={{ display: 'contents' }}>
            <div
              className="text-[8px] text-muted-foreground flex items-center pr-1"
              style={{ justifyContent: 'flex-end' }}
            >
              {DOW_LABELS[dow]}
            </div>
            {Array.from({ length: 24 }, (_, h) => {
              const count = cellMap[`${dow}:${h}`] ?? 0;
              return (
                <div
                  key={h}
                  title={`${DOW_LABELS[dow]} ${h}:00 — ${count} packets`}
                  className="rounded-sm"
                  style={{ backgroundColor: cellColor(count), height: 10 }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-[8px] text-muted-foreground">
        <span>Low</span>
        <div className="flex gap-px">
          {['#1e40af', '#2563eb', '#f59e0b', '#ef4444'].map((c) => (
            <div key={c} className="w-4 h-2 rounded-sm" style={{ backgroundColor: c }} />
          ))}
        </div>
        <span>High</span>
        <span className="ml-auto">{data.total.toLocaleString()} total packets</span>
      </div>
    </div>
  );
}

// ─── Relay pair bars ──────────────────────────────────────────────────────────

function RelayPairBars({ pairs }: { pairs: RelayPair[] }) {
  const max = Math.max(...pairs.map((p) => p.count), 1);
  return (
    <div className="space-y-1.5">
      {pairs.slice(0, 10).map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="w-32 flex-shrink-0 font-mono text-[9px] text-muted-foreground truncate"
            title={`${p.hop_a} → ${p.hop_b}`}
          >
            {p.hop_a}→{p.hop_b}
          </span>
          <div className="flex-1 overflow-hidden rounded-full bg-muted h-1.5">
            <div
              className="h-full rounded-full"
              style={{ width: `${(p.count / max) * 100}%`, background: 'hsl(var(--primary))' }}
            />
          </div>
          <span className="w-6 flex-shrink-0 text-right text-[9px] tabular-nums text-muted-foreground">
            {p.count}
          </span>
        </div>
      ))}
    </div>
  );
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
  return sortDir === 'asc' ? (
    <ChevronUp className="ml-1 inline h-3 w-3" />
  ) : (
    <ChevronDown className="ml-1 inline h-3 w-3" />
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function MeshHealthView({ config, onNavigateToMap, focusKey }: Props) {
  const [selectedWindow, setSelectedWindow] = useState<TimeWindow>(DEFAULT_WINDOW);
  const [data, setData] = useState<MeshHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  const [sortKey, setSortKey] = useState<SortKey>('advert_count');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);

  const lastFetchRef = useRef<number>(0);
  const focusRowRef = useRef<HTMLTableRowElement>(null);
  const focusDoneRef = useRef(false);

  // ── Extra analytics state ─────────────────────────────────────────────────
  const [scatter, setScatter] = useState<ScatterPoint[]>([]);
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);
  const [relayPairs, setRelayPairs] = useState<RelayPair[]>([]);
  const [reachability, setReachability] = useState<ReachabilityRing[]>([]);

  const fetchHealth = useCallback((win: TimeWindow) => {
    const endTs = Math.floor(Date.now() / 1000);
    const startTs = endTs - win.hours * 3600;
    lastFetchRef.current = endTs;
    setLoading(true);
    setError(null);
    setNowSec(endTs);
    fetch(`/api/packets/mesh-health?start_ts=${startTs}&end_ts=${endTs}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<MeshHealthResponse>;
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load');
        setLoading(false);
      });
  }, []);

  // Initial fetch and window-change fetch
  useEffect(() => {
    fetchHealth(selectedWindow);
    setPage(0);
  }, [selectedWindow, fetchHealth]);

  // Fetch extra analytics charts on window change
  useEffect(() => {
    const endTs = Math.floor(Date.now() / 1000);
    const startTs = endTs - selectedWindow.hours * 3600;

    fetch(`/api/packets/snr-rssi-scatter?start_ts=${startTs}&end_ts=${endTs}&limit=1500`)
      .then((r) => r.json() as Promise<ScatterPoint[]>)
      .then(setScatter)
      .catch(() => {});

    fetch(`/api/packets/hourly-heatmap?start_ts=${startTs}&end_ts=${endTs}`)
      .then((r) => r.json() as Promise<HeatmapData>)
      .then(setHeatmapData)
      .catch(() => {});

    fetch('/api/packets/relay-pairs?limit=10')
      .then((r) => r.json() as Promise<RelayPair[]>)
      .then(setRelayPairs)
      .catch(() => {});

    fetch(`/api/packets/reachability-rings?start_ts=${startTs}&end_ts=${endTs}`)
      .then((r) => r.json() as Promise<ReachabilityRing[]>)
      .then(setReachability)
      .catch(() => {});
  }, [selectedWindow]);

  // Auto-refresh: only for short windows (30m/1h), minimum 30s between refreshes
  useEffect(() => {
    if (!selectedWindow.autoRefresh) return;
    const id = setInterval(() => {
      const age = Math.floor(Date.now() / 1000) - lastFetchRef.current;
      if (age >= 30) fetchHealth(selectedWindow);
    }, 30_000);
    return () => clearInterval(id);
  }, [selectedWindow, fetchHealth]);

  // Reset page when sort changes
  useEffect(() => {
    setPage(0);
  }, [sortKey, sortDir]);

  // Scroll to focused node after data loads (only once per focusKey)
  useEffect(() => {
    if (!focusKey || !data || focusDoneRef.current) return;
    // Give the DOM a tick to render the rows
    const id = setTimeout(() => {
      focusRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      focusDoneRef.current = true;
    }, 100);
    return () => clearTimeout(id);
  }, [data, focusKey]);

  const handleSort = (col: SortKey) => {
    if (col === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col);
      setSortDir(col === 'name' ? 'asc' : 'desc');
    }
  };

  // Pre-compute distances once per data load
  const contactsWithDist = useMemo(() => {
    if (!data) return [];
    const nowSecLocal = Math.floor(Date.now() / 1000);
    return data.contacts.map((n) => ({
      ...n,
      distKm:
        config?.lat != null && config?.lon != null && n.lat != null && n.lon != null
          ? haversineKm(config.lat, config.lon, n.lat, n.lon)
          : null,
      isActive: n.last_seen != null && nowSecLocal - n.last_seen < selectedWindow.hours * 3600,
    }));
  }, [data, config, selectedWindow]);

  const sorted = useMemo(() => {
    const arr = [...contactsWithDist];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'name': {
          const na = (a.name ?? a.public_key).toLowerCase();
          const nb = (b.name ?? b.public_key).toLowerCase();
          return dir * na.localeCompare(nb);
        }
        case 'advert_count':
          return dir * (a.advert_count - b.advert_count);
        case 'last_seen':
          return dir * ((a.last_seen ?? 0) - (b.last_seen ?? 0));
        case 'first_seen':
          return dir * ((a.first_seen ?? 0) - (b.first_seen ?? 0));
        case 'min_path_len':
          return dir * ((a.min_path_len ?? 999) - (b.min_path_len ?? 999));
        case 'distance':
          return dir * ((a.distKm ?? Infinity) - (b.distKm ?? Infinity));
        case 'status':
          return dir * ((a.isActive ? 0 : 1) - (b.isActive ? 0 : 1));
        case 'hash_mode':
          return dir * ((a.hash_mode ?? -1) - (b.hash_mode ?? -1));
        default:
          return 0;
      }
    });
    return arr;
  }, [contactsWithDist, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const highAlerts = data?.alerts.filter((a) => a.level === 'HIGH') ?? [];
  const mediumAlerts = data?.alerts.filter((a) => a.level === 'MEDIUM') ?? [];

  const hopDist = useMemo(() => {
    if (!contactsWithDist.length) return [];
    const b = [
      { label: 'Direct', count: 0, color: 'hsl(var(--success))' },
      { label: '1 hop', count: 0, color: 'hsl(var(--primary))' },
      { label: '2 hops', count: 0, color: 'hsl(var(--info))' },
      { label: '3+ hops', count: 0, color: 'hsl(var(--warning))' },
      { label: 'Unknown', count: 0, color: 'hsl(var(--muted-foreground))' },
    ];
    for (const c of contactsWithDist) {
      const h = c.min_path_len;
      if (h === null) b[4].count++;
      else if (h === 0) b[0].count++;
      else if (h === 1) b[1].count++;
      else if (h === 2) b[2].count++;
      else b[3].count++;
    }
    return b.filter((x) => x.count > 0);
  }, [contactsWithDist]);

  const hashModeDist = useMemo(() => {
    if (!contactsWithDist.length) return [];
    const b = [
      { label: '1-byte', count: 0, color: 'hsl(var(--primary))' },
      { label: '2-byte', count: 0, color: 'hsl(var(--info))' },
      { label: '3-byte', count: 0, color: 'hsl(var(--success))' },
      { label: 'Unknown', count: 0, color: 'hsl(var(--muted-foreground))' },
    ];
    for (const c of contactsWithDist) {
      const m = c.hash_mode;
      if (m === null) b[3].count++;
      else if (m === 0) b[0].count++;
      else if (m === 1) b[1].count++;
      else b[2].count++;
    }
    return b.filter((x) => x.count > 0);
  }, [contactsWithDist]);

  const thClass =
    'px-2 py-1.5 font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors';

  return (
    <div className="flex h-full flex-col overflow-hidden mesh-health">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-base">Mesh Health</h2>
        </div>
        <div className="flex items-center gap-2">
          {selectedWindow.autoRefresh ? (
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              auto-refresh 30s
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              manual refresh only
            </span>
          )}
          <button
            onClick={() => fetchHealth(selectedWindow)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 p-4">
          {/* Time window selector */}
          <div className="flex gap-1">
            {TIME_WINDOWS.map((w) => (
              <button
                key={w.key}
                onClick={() => setSelectedWindow(w)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  selectedWindow.key === w.key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Summary tiles */}
          {data && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <StatTile
                label="Contacts Heard"
                value={data.total_contacts}
                sub={`last ${selectedWindow.label}`}
              />
              <StatTile
                label="HIGH Alerts"
                value={data.high_alert_count}
                sub={`> ${data.high_advert_threshold} adverts`}
              />
              <StatTile
                label="MEDIUM Alerts"
                value={data.medium_alert_count}
                sub={`> ${data.medium_advert_threshold} adverts`}
              />
              <StatTile
                label="Window"
                value={selectedWindow.label}
                sub={`${data.window_hours.toFixed(1)}h`}
              />
            </div>
          )}
          {loading && !data && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded border border-border bg-background"
                />
              ))}
            </div>
          )}

          {/* Hop distance + hash mode distributions */}
          {(hopDist.length > 0 || hashModeDist.length > 0) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {hopDist.length > 0 && (
                <div className="rounded border border-border bg-background p-2.5">
                  <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Hop Distance
                  </div>
                  <DistBars items={hopDist} />
                </div>
              )}
              {hashModeDist.length > 0 && (
                <div className="rounded border border-border bg-background p-2.5">
                  <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Hash Mode (bytes/hop)
                  </div>
                  <DistBars items={hashModeDist} />
                </div>
              )}
            </div>
          )}

          {/* Reachability rings */}
          {reachability.length > 0 && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {reachability.map((r) => (
                <StatTile key={String(r.hops)} label={r.label} value={r.count} sub="unique nodes" />
              ))}
            </div>
          )}

          {/* SNR vs RSSI scatter + hourly heatmap */}
          {(scatter.length > 0 || heatmapData) && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {scatter.length > 0 && (
                <div className="rounded border border-border bg-background p-2.5">
                  <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    SNR vs RSSI ({scatter.length.toLocaleString()} packets)
                  </div>
                  <ScatterPlot points={scatter} />
                </div>
              )}
              {heatmapData && heatmapData.total > 0 && (
                <div className="rounded border border-border bg-background p-2.5">
                  <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Activity by Day &amp; Hour
                  </div>
                  <HourlyHeatmap data={heatmapData} />
                </div>
              )}
            </div>
          )}

          {/* Relay pairs */}
          {relayPairs.length > 0 && (
            <div className="rounded border border-border bg-background p-2.5">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Top Relay Pairs (most frequent consecutive hops in advert paths)
              </div>
              <RelayPairBars pairs={relayPairs} />
            </div>
          )}

          {/* HIGH alerts */}
          {highAlerts.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-card overflow-hidden">
              <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                <span className="text-sm font-semibold text-destructive">
                  HIGH - Advertising Too Frequently
                </span>
                <span className="ml-auto text-[10px] text-destructive/70">
                  {highAlerts.length} node{highAlerts.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="divide-y divide-border">
                {highAlerts.map((a) => {
                  const contact = data?.contacts.find((c) => c.public_key === a.public_key);
                  return (
                    <AlertRow
                      key={a.public_key}
                      alert={a}
                      lat={contact?.lat}
                      lon={contact?.lon}
                      onNavigateToMap={onNavigateToMap}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* MEDIUM alerts */}
          {mediumAlerts.length > 0 && (
            <div className="rounded-lg border border-yellow-500/40 bg-card overflow-hidden">
              <div className="border-b border-yellow-500/30 bg-yellow-500/10 px-3 py-2 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />
                <span className="text-sm font-semibold text-yellow-700 dark:text-yellow-300">
                  MEDIUM - Above Normal Advert Rate
                </span>
                <span className="ml-auto text-[10px] text-yellow-600/70 dark:text-yellow-400/70">
                  {mediumAlerts.length} node{mediumAlerts.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="divide-y divide-border">
                {mediumAlerts.map((a) => {
                  const contact = data?.contacts.find((c) => c.public_key === a.public_key);
                  return (
                    <AlertRow
                      key={a.public_key}
                      alert={a}
                      lat={contact?.lat}
                      lon={contact?.lon}
                      onNavigateToMap={onNavigateToMap}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {data && data.alerts.length === 0 && (
            <div className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              No advert frequency alerts in the last {selectedWindow.label}. Mesh looks healthy.
            </div>
          )}

          {/* Full contacts table */}
          {data && data.contacts.length > 0 && (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="border-b border-border px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  All Advertised Contacts Heard (In Selected Time-Span)
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {sorted.length} nodes · last {selectedWindow.label}
                  {totalPages > 1 && ` · page ${page + 1} of ${totalPages}`}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-background">
                      <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground w-8">
                        ID
                      </th>
                      <th className={`${thClass} text-left`} onClick={() => handleSort('name')}>
                        Name <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                      </th>
                      <th
                        className={`${thClass} text-right`}
                        onClick={() => handleSort('advert_count')}
                      >
                        Adverts <SortIcon col="advert_count" sortKey={sortKey} sortDir={sortDir} />
                      </th>
                      <th
                        className={`${thClass} text-right`}
                        onClick={() => handleSort('last_seen')}
                      >
                        Last Heard <SortIcon col="last_seen" sortKey={sortKey} sortDir={sortDir} />
                      </th>
                      <th
                        className={`${thClass} text-right hidden sm:table-cell`}
                        onClick={() => handleSort('first_seen')}
                      >
                        First Heard{' '}
                        <SortIcon col="first_seen" sortKey={sortKey} sortDir={sortDir} />
                      </th>
                      <th
                        className={`${thClass} text-right hidden md:table-cell`}
                        onClick={() => handleSort('min_path_len')}
                      >
                        Hops <SortIcon col="min_path_len" sortKey={sortKey} sortDir={sortDir} />
                      </th>
                      <th
                        className={`${thClass} text-right hidden md:table-cell`}
                        onClick={() => handleSort('hash_mode')}
                        title="Address bytes per hop (1, 2, or 3)"
                      >
                        Mode <SortIcon col="hash_mode" sortKey={sortKey} sortDir={sortDir} />
                      </th>
                      <th
                        className={`${thClass} text-right hidden md:table-cell`}
                        onClick={() => handleSort('distance')}
                      >
                        Distance <SortIcon col="distance" sortKey={sortKey} sortDir={sortDir} />
                      </th>
                      <th className={`${thClass} text-right`} onClick={() => handleSort('status')}>
                        Status <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((n) => {
                      const shortId = n.public_key.slice(0, 4).toUpperCase();
                      const isHighAlert = n.advert_count > 8;
                      const isMedAlert = !isHighAlert && n.advert_count > 2;
                      const isFocused = focusKey === n.public_key;
                      return (
                        <tr
                          key={n.public_key}
                          ref={isFocused ? focusRowRef : undefined}
                          className={`border-b border-border last:border-0 hover:bg-background transition-colors ${
                            isFocused ? 'bg-primary/10 outline outline-1 outline-primary' : ''
                          }`}
                        >
                          <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                            {shortId}
                          </td>
                          <td className="px-2 py-1.5 font-medium text-foreground max-w-[180px] truncate">
                            {n.name ?? n.public_key.slice(0, 12)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            <span
                              className={
                                isHighAlert
                                  ? 'font-semibold text-destructive'
                                  : isMedAlert
                                    ? 'font-semibold text-yellow-600 dark:text-yellow-400'
                                    : 'text-muted-foreground'
                              }
                            >
                              {n.advert_count}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground tabular-nums">
                            {n.last_seen != null ? relTime(n.last_seen) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground tabular-nums hidden sm:table-cell">
                            {n.first_seen != null ? relTime(n.first_seen) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground tabular-nums hidden md:table-cell">
                            {n.min_path_len != null ? n.min_path_len : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums hidden md:table-cell">
                            <span
                              className="font-mono text-muted-foreground"
                              title={
                                n.hash_mode != null
                                  ? `${n.hash_mode + 1}-byte hop addresses`
                                  : 'Address width unknown (no data yet)'
                              }
                            >
                              {n.hash_mode != null ? n.hash_mode + 1 : '?'}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground tabular-nums hidden md:table-cell">
                            {n.distKm != null ? `${n.distKm.toFixed(0)} km` : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <span
                              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                n.isActive
                                  ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {n.isActive ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="border-t border-border px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of{' '}
                    {sorted.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(0)}
                      disabled={page === 0}
                      className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30"
                    >
                      «
                    </button>
                    <button
                      onClick={() => setPage((p) => p - 1)}
                      disabled={page === 0}
                      className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30"
                    >
                      ‹ Prev
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i)
                      .filter((i) => Math.abs(i - page) <= 2)
                      .map((i) => (
                        <button
                          key={i}
                          onClick={() => setPage(i)}
                          className={`rounded px-2 py-0.5 text-xs transition-colors ${
                            i === page
                              ? 'bg-primary text-primary-foreground font-medium'
                              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                          }`}
                        >
                          {i + 1}
                        </button>
                      ))}
                    <button
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page >= totalPages - 1}
                      className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30"
                    >
                      Next ›
                    </button>
                    <button
                      onClick={() => setPage(totalPages - 1)}
                      disabled={page >= totalPages - 1}
                      className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30"
                    >
                      »
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {data && data.contacts.length === 0 && !loading && (
            <div className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              No contacts heard in the last {selectedWindow.label}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Alert row sub-component ─────────────────────────────────────────────────

function AlertRow({
  alert,
  lat,
  lon,
  onNavigateToMap,
}: {
  alert: MeshHealthAlert;
  lat?: number | null;
  lon?: number | null;
  onNavigateToMap?: (focusKey?: string) => void;
}) {
  const shortId = alert.public_key.slice(0, 4).toUpperCase();
  const isHigh = alert.level === 'HIGH';
  const hasLocation = lat != null && lon != null && (lat !== 0 || lon !== 0);

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="font-mono text-[10px] text-muted-foreground w-8 flex-shrink-0">
        {shortId}
      </span>
      <span className="flex-1 truncate font-medium text-foreground text-xs">
        {alert.name ?? alert.public_key.slice(0, 12)}
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {alert.advert_count} adverts
      </span>
      <span className="text-xs tabular-nums text-muted-foreground hidden sm:inline">
        {alert.adverts_per_hour.toFixed(1)}/hr
      </span>
      {hasLocation && onNavigateToMap && (
        <button
          onClick={() => onNavigateToMap(alert.public_key)}
          title="Show on map"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Map className="h-3 w-3" />
          <span className="hidden sm:inline">Map</span>
        </button>
      )}
      <span
        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
          isHigh
            ? 'bg-destructive/15 text-destructive'
            : 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300'
        }`}
      >
        {alert.level}
      </span>
    </div>
  );
}
