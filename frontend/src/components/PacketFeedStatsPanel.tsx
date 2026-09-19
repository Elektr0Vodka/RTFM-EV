import { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

import type { Contact, RawFeedHistoricalStats } from '../types';
import { api } from '../api';
import { TimeRangeSelector } from './TimeRangeSelector';
import {
  BASE_TIME_RANGES,
  CUSTOM_RANGE_ID,
  resolveRange,
  type TimeRange,
} from '../utils/timeRanges';
import { loadStoredTimeRange, saveStoredTimeRange } from '../utils/timeRangePreference';
import {
  KNOWN_PAYLOAD_TYPES,
  buildRawPacketStatsSnapshot,
  buildSnapshotFromHistorical,
  isRawFeedLiveWindow,
  type NeighborStat,
  type PacketTimelineBin,
  type RankedPacketStat,
  type RawPacketStatsSessionState,
  type RawPacketStatsWindow,
} from '../utils/rawPacketStats';
import { useRawPacketStatsSession } from '../stores/rawPacketStore';
import { getContactDisplayName } from '../utils/pubkey';
import { cn } from '@/lib/utils';
import { useT, type TFn } from '../i18n';

// The raw-packet stats surface. Reads the app-wide packet observation store
// (populated by useRealtimeAppState regardless of which view is mounted), so it
// renders the same live/historical breakdowns whether it is shown on the Mesh
// Trends "Live" tab or anywhere else.

const TIMELINE_FILL_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'];

/**
 * Build a stable name→color mapping so the same type always gets the same
 * color regardless of sort order or appearance order.
 */
function buildColorMap(names: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < names.length; i++) {
    map.set(names[i], TIMELINE_FILL_COLORS[i % TIMELINE_FILL_COLORS.length]);
  }
  return map;
}

function colorForIndex(index: number, colorMap?: Map<string, string>, name?: string): string {
  if (colorMap && name && colorMap.has(name)) {
    return colorMap.get(name)!;
  }
  return TIMELINE_FILL_COLORS[index % TIMELINE_FILL_COLORS.length];
}

const PAYLOAD_TYPE_COLOR_MAP = buildColorMap(KNOWN_PAYLOAD_TYPES);

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

// Raw feed keeps its short live windows as extras before the shared base set,
// and "session" as a special extra. Base windows are DB-backed.
const RAW_FEED_EXTRAS_BEFORE: TimeRange[] = [
  { id: '1m', labelKey: 'time_range_1m', seconds: 60 },
  { id: '5m', labelKey: 'time_range_5m', seconds: 5 * 60 },
  { id: '10m', labelKey: 'time_range_10m', seconds: 10 * 60 },
];
const RAW_FEED_EXTRAS_SPECIAL: TimeRange[] = [
  { id: 'session', labelKey: 'time_range_session', seconds: null },
];
const DEFAULT_RAW_FEED_ID = '10m';
const RAW_FEED_WINDOW_KEY = 'rtfm-rawfeed-window';

const _SHORT_LABELS: Record<string, string> = {
  '1m': 'time_range_1m',
  '5m': 'time_range_5m',
  '10m': 'time_range_10m',
};

function getWindowLabel(windowId: string, t: TFn): string {
  if (windowId === 'session') return t('time_range_session');
  if (windowId === CUSTOM_RANGE_ID) return t('time_range_custom');
  if (_SHORT_LABELS[windowId]) return t(_SHORT_LABELS[windowId]);
  const r = BASE_TIME_RANGES.find((x) => x.id === windowId);
  return r ? t(r.labelKey) : windowId;
}

const EMPTY_HISTORICAL: RawFeedHistoricalStats = {
  packet_count: 0,
  decrypted_count: 0,
  undecrypted_count: 0,
  decrypt_rate: 0,
  path_bearing_count: 0,
  path_bearing_rate: 0,
  distinct_paths: 0,
  average_rssi: null,
  best_rssi: null,
  payload_breakdown: [],
  route_breakdown: [],
  hop_profile: [],
  hop_byte_width_profile: [],
  rssi_buckets: [],
};

function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(seconds: number, t: TFn): string {
  if (seconds < 60) {
    return t('packet_duration_seconds', { count: Math.max(1, Math.round(seconds)) });
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    return remainder > 0
      ? t('packet_duration_minutes_seconds', { minutes, seconds: remainder })
      : t('packet_duration_minutes', { minutes });
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes > 0
    ? t('packet_duration_hours_minutes', { hours, minutes })
    : t('packet_duration_hours', { hours });
}

function formatRate(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatRssi(value: number | null): string {
  return value === null ? '-' : `${Math.round(value)} dBm`;
}

function normalizeResolvableSourceKey(sourceKey: string): string {
  return sourceKey.startsWith('hash1:') ? sourceKey.slice(6) : sourceKey;
}

function resolveContact(sourceKey: string | null, contacts: Contact[]): Contact | null {
  if (!sourceKey || sourceKey.startsWith('name:')) {
    return null;
  }

  const normalizedSourceKey = normalizeResolvableSourceKey(sourceKey).toLowerCase();
  const matches = contacts.filter((contact) =>
    contact.public_key.toLowerCase().startsWith(normalizedSourceKey)
  );
  if (matches.length !== 1) {
    return null;
  }

  return matches[0];
}

function resolveContactLabel(sourceKey: string | null, contacts: Contact[]): string | null {
  const contact = resolveContact(sourceKey, contacts);
  if (!contact) {
    return null;
  }
  return getContactDisplayName(contact.name, contact.public_key, contact.last_advert);
}

function resolveNeighbor(item: NeighborStat, contacts: Contact[]): NeighborStat {
  return {
    ...item,
    label: resolveContactLabel(item.key, contacts) ?? item.label,
  };
}

function mergeResolvedNeighbors(items: NeighborStat[], contacts: Contact[]): NeighborStat[] {
  const merged = new Map<string, NeighborStat>();

  for (const item of items) {
    const contact = resolveContact(item.key, contacts);
    const canonicalKey = contact?.public_key ?? item.key;
    const resolvedLabel =
      contact != null
        ? getContactDisplayName(contact.name, contact.public_key, contact.last_advert)
        : item.label;
    const existing = merged.get(canonicalKey);

    if (!existing) {
      merged.set(canonicalKey, {
        ...item,
        key: canonicalKey,
        label: resolvedLabel,
      });
      continue;
    }

    existing.count += item.count;
    existing.lastSeen = Math.max(existing.lastSeen, item.lastSeen);
    existing.bestRssi =
      existing.bestRssi === null
        ? item.bestRssi
        : item.bestRssi === null
          ? existing.bestRssi
          : Math.max(existing.bestRssi, item.bestRssi);
    existing.label = resolvedLabel;
  }

  return Array.from(merged.values());
}

function isNeighborIdentityResolvable(item: NeighborStat, contacts: Contact[]): boolean {
  if (item.key.startsWith('name:')) {
    return true;
  }
  return resolveContact(item.key, contacts) !== null;
}

function formatStrongestNeighborDetail(
  stats: ReturnType<typeof buildRawPacketStatsSnapshot>,
  contacts: Contact[],
  t: TFn
): string | undefined {
  const strongestNeighbor = stats.strongestNeighbors[0];
  if (!strongestNeighbor || strongestNeighbor.bestRssi === null) {
    return undefined;
  }

  const resolvedNeighbor = resolveNeighbor(strongestNeighbor, contacts);
  return t('packet_best_heard', { rssi: formatRssi(resolvedNeighbor.bestRssi) });
}

function getCoverageMessage(
  stats: ReturnType<typeof buildRawPacketStatsSnapshot>,
  session: RawPacketStatsSessionState,
  t: TFn
): { tone: 'default' | 'warning'; message: string } {
  if (session.trimmedObservationCount > 0 && stats.window === 'session') {
    return {
      tone: 'warning',
      message: t('packet_coverage_trimmed', {
        count: session.totalObservedPackets.toLocaleString(),
      }),
    };
  }

  if (!stats.windowFullyCovered) {
    return {
      tone: 'warning',
      message: t('packet_coverage_partial', {
        duration: formatDuration(stats.coverageSeconds, t),
      }),
    };
  }

  return {
    tone: 'default',
    message: t('packet_coverage_tracking', {
      count: session.observations.length,
      n: session.observations.length.toLocaleString(),
    }),
  };
}

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="break-inside-avoid rounded-lg border border-border/70 bg-card/80 p-3">
      <div className="text-[0.625rem] uppercase tracking-wider font-medium text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function RankedBars({
  title,
  items,
  emptyLabel,
  formatter,
  colorMap,
}: {
  title: string;
  items: RankedPacketStat[];
  emptyLabel: string;
  formatter?: (item: RankedPacketStat) => string;
  colorMap?: Map<string, string>;
}) {
  const data = items.map((item) => ({
    name: item.label,
    value: item.count,
    detail: formatter
      ? formatter(item)
      : `${item.count.toLocaleString()} · ${formatPercent(item.share)}`,
  }));

  return (
    <section className="mb-4 break-inside-avoid rounded-lg border border-border/70 bg-card/70 p-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-2">
          <ResponsiveContainer width="100%" height={items.length * 28 + 8}>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 0, right: 4, bottom: 0, left: 0 }}
              barCategoryGap="20%"
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={80}
              />
              <RechartsTooltip
                {...TOOLTIP_STYLE}
                cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(_v: any, _n: any, props: any) => [props.payload.detail, null]}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={16}>
                {data.map((entry, i) => (
                  <Cell key={i} fill={colorForIndex(i, colorMap, entry.name)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function NeighborList({
  title,
  items,
  emptyLabel,
  mode,
  contacts,
}: {
  title: string;
  items: NeighborStat[];
  emptyLabel: string;
  mode: 'heard' | 'signal' | 'recent';
  contacts: Contact[];
}) {
  const t = useT();
  const mergedItems = mergeResolvedNeighbors(items, contacts);
  const sortedItems = [...mergedItems].sort((a, b) => {
    if (mode === 'heard') {
      return b.count - a.count || b.lastSeen - a.lastSeen || a.label.localeCompare(b.label);
    }
    if (mode === 'signal') {
      return (
        (b.bestRssi ?? Number.NEGATIVE_INFINITY) - (a.bestRssi ?? Number.NEGATIVE_INFINITY) ||
        b.count - a.count ||
        a.label.localeCompare(b.label)
      );
    }
    return b.lastSeen - a.lastSeen || b.count - a.count || a.label.localeCompare(b.label);
  });

  return (
    <section className="mb-4 break-inside-avoid rounded-lg border border-border/70 bg-card/70 p-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {sortedItems.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {sortedItems.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between gap-3 rounded-md bg-background/70 px-2 py-1.5"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">{item.label}</div>
                <div className="text-xs text-muted-foreground">
                  {mode === 'heard'
                    ? t('packet_neighbor_packet_count', {
                        count: item.count,
                        n: item.count.toLocaleString(),
                      })
                    : mode === 'signal'
                      ? t('packet_neighbor_best_signal', { rssi: formatRssi(item.bestRssi) })
                      : t('packet_neighbor_last_seen', {
                          time: new Date(item.lastSeen * 1000).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          }),
                        })}
                </div>
                {!isNeighborIdentityResolvable(item, contacts) ? (
                  <div className="text-[0.6875rem] text-warning">
                    {t('packet_identity_not_resolvable')}
                  </div>
                ) : null}
              </div>
              {mode !== 'signal' ? (
                <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatRssi(item.bestRssi)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TimelineChart({
  bins,
  colorMap,
}: {
  bins: PacketTimelineBin[];
  colorMap: Map<string, string>;
}) {
  const t = useT();
  const typeOrder = Array.from(new Set(bins.flatMap((bin) => Object.keys(bin.countsByType)))).slice(
    0,
    TIMELINE_FILL_COLORS.length
  );

  const data = bins.map((bin) => {
    const entry: Record<string, string | number> = { label: bin.label };
    for (const type of typeOrder) {
      entry[type] = bin.countsByType[type] ?? 0;
    }
    return entry;
  });

  return (
    <section className="mb-4 break-inside-avoid rounded-lg border border-border/70 bg-card/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{t('packet_traffic_timeline')}</h3>
        <div className="flex flex-wrap justify-end gap-2 text-[0.6875rem] text-muted-foreground">
          {typeOrder.map((type) => (
            <span key={type} className="inline-flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: colorMap.get(type) ?? TIMELINE_FILL_COLORS[0] }}
              />
              <span>{type}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2">
        <ResponsiveContainer width="100%" height={110}>
          <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <RechartsTooltip
              {...TOOLTIP_STYLE}
              cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }}
            />
            {typeOrder.map((type, i) => (
              <Bar
                key={type}
                dataKey={type}
                stackId="packets"
                fill={colorMap.get(type) ?? TIMELINE_FILL_COLORS[0]}
                radius={i === typeOrder.length - 1 ? [2, 2, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function PacketFeedStatsPanel({ contacts }: { contacts: Contact[] }) {
  const t = useT();
  const rawPacketStatsSession = useRawPacketStatsSession();
  const [selectedWindow, setSelectedWindow] = useState<string>(
    () => loadStoredTimeRange(RAW_FEED_WINDOW_KEY, DEFAULT_RAW_FEED_ID).id
  );
  const [customStart, setCustomStart] = useState(
    () => loadStoredTimeRange(RAW_FEED_WINDOW_KEY, DEFAULT_RAW_FEED_ID).customStart
  );
  const [customEnd, setCustomEnd] = useState(
    () => loadStoredTimeRange(RAW_FEED_WINDOW_KEY, DEFAULT_RAW_FEED_ID).customEnd
  );
  const [dbStats, setDbStats] = useState<RawFeedHistoricalStats | null>(null);
  const isLiveWindow = isRawFeedLiveWindow(selectedWindow);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    saveStoredTimeRange(RAW_FEED_WINDOW_KEY, {
      id: selectedWindow,
      customStart,
      customEnd,
    });
  }, [selectedWindow, customStart, customEnd]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 30000);
    return () => window.clearInterval(interval);
  }, []);

  // Refresh "now" when new traffic is observed so live windows stay current.
  useEffect(() => {
    setNowSec(Math.floor(Date.now() / 1000));
  }, [rawPacketStatsSession]);

  // For DB-backed (base) windows, fetch historical breakdowns from the server.
  useEffect(() => {
    if (isLiveWindow) return;
    if (selectedWindow === CUSTOM_RANGE_ID) return; // custom fetches on Apply
    const resolved = resolveRange(selectedWindow, { nowSec });
    if (!resolved) return;
    setDbStats(null);
    let cancelled = false;
    api.getRawFeedStats(resolved.startTs, resolved.endTs).then(
      (data) => {
        if (!cancelled) setDbStats(data);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [isLiveWindow, selectedWindow, nowSec]);

  const stats = useMemo(() => {
    if (isLiveWindow) {
      return buildRawPacketStatsSnapshot(
        rawPacketStatsSession,
        selectedWindow as RawPacketStatsWindow,
        nowSec
      );
    }
    const resolved = resolveRange(selectedWindow, {
      nowSec,
      customStartSec: customStart ? Math.floor(new Date(customStart).getTime() / 1000) : null,
      customEndSec: customEnd ? Math.floor(new Date(customEnd).getTime() / 1000) : null,
    });
    const start = resolved?.startTs ?? nowSec;
    const end = resolved?.endTs ?? nowSec;
    return buildSnapshotFromHistorical(
      dbStats ?? EMPTY_HISTORICAL,
      selectedWindow,
      start,
      end,
      nowSec
    );
  }, [
    isLiveWindow,
    dbStats,
    nowSec,
    rawPacketStatsSession,
    selectedWindow,
    customStart,
    customEnd,
  ]);

  const coverageMessage = getCoverageMessage(stats, rawPacketStatsSession, t);
  const strongestNeighbor = useMemo(() => {
    const topNeighbor = stats.strongestNeighbors[0];
    return topNeighbor ? resolveNeighbor(topNeighbor, contacts) : null;
  }, [contacts, stats]);
  const strongestNeighborDetail = useMemo(
    () => formatStrongestNeighborDetail(stats, contacts, t),
    [contacts, stats, t]
  );
  const strongestNeighbors = useMemo(
    () => stats.strongestNeighbors.map((item) => resolveNeighbor(item, contacts)),
    [contacts, stats.strongestNeighbors]
  );
  const mostActiveNeighbors = useMemo(
    () => stats.mostActiveNeighbors.map((item) => resolveNeighbor(item, contacts)),
    [contacts, stats.mostActiveNeighbors]
  );
  const newestNeighbors = useMemo(
    () => stats.newestNeighbors.map((item) => resolveNeighbor(item, contacts)),
    [contacts, stats.newestNeighbors]
  );

  return (
    <div className="h-full overflow-y-auto bg-background p-4 [contain:layout_paint]">
      <p className="mb-3 text-xs text-muted-foreground">
        {t('packet_collecting_stats_since', {
          timestamp: formatTimestamp(rawPacketStatsSession.sessionStartedAt),
        })}
      </p>
      <div className="break-inside-avoid rounded-lg border border-border/70 bg-card/70 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[0.625rem] uppercase tracking-wider font-medium text-muted-foreground">
              {t('packet_coverage_label')}
            </div>
            <div
              className={cn(
                'mt-1 text-sm',
                coverageMessage.tone === 'warning' ? 'text-warning' : 'text-muted-foreground'
              )}
            >
              {coverageMessage.message}
            </div>
          </div>
          <TimeRangeSelector
            value={selectedWindow}
            onChange={setSelectedWindow}
            extrasBefore={RAW_FEED_EXTRAS_BEFORE}
            extrasSpecial={RAW_FEED_EXTRAS_SPECIAL}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
            onApplyCustom={(s, e) => {
              api.getRawFeedStats(s, e).then(
                (d) => setDbStats(d),
                () => {}
              );
            }}
          />
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          {t('packet_stats_summary', {
            count: stats.packetCount.toLocaleString(),
            window: getWindowLabel(selectedWindow, t).toLowerCase(),
            total: rawPacketStatsSession.totalObservedPackets.toLocaleString(),
          })}
        </div>
        {!isLiveWindow && (
          <div className="mt-1 text-[0.7rem] italic text-muted-foreground">
            {t('packet_stats_historical_note')}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile
          label={t('packet_stat_packets_per_min')}
          value={formatRate(stats.packetsPerMinute)}
          detail={t('packet_stat_total_in_window', {
            count: stats.packetCount.toLocaleString(),
          })}
        />
        <StatTile
          label={t('packet_stat_unique_sources')}
          value={isLiveWindow ? stats.uniqueSources.toLocaleString() : '-'}
          detail={t('packet_stat_distinct_senders')}
        />
        <StatTile
          label={t('packet_stat_decrypt_rate')}
          value={formatPercent(stats.decryptRate)}
          detail={t('packet_stat_decrypt_detail', {
            decrypted: stats.decryptedCount.toLocaleString(),
            undecrypted: stats.undecryptedCount.toLocaleString(),
          })}
        />
        <StatTile
          label={t('packet_stat_path_diversity')}
          value={stats.distinctPaths.toLocaleString()}
          detail={t('packet_stat_path_bearing', {
            percent: formatPercent(stats.pathBearingRate),
          })}
        />
        <StatTile
          label={t('packet_stat_strongest_neighbor')}
          value={strongestNeighbor?.label ?? '-'}
          detail={strongestNeighborDetail ?? t('packet_stat_no_neighbor_rssi')}
        />
        <StatTile
          label={t('packet_stat_median_rssi')}
          value={formatRssi(stats.medianRssi)}
          detail={
            stats.averageRssi === null
              ? t('packet_stat_no_signal_sample')
              : t('packet_stat_average_rssi', { value: formatRssi(stats.averageRssi) })
          }
        />
      </div>

      <div className="mt-4">
        <TimelineChart bins={stats.timeline} colorMap={PAYLOAD_TYPE_COLOR_MAP} />
      </div>

      <div className="md:columns-2 md:gap-4">
        <RankedBars
          title={t('packet_types_title')}
          items={stats.payloadBreakdown}
          emptyLabel={t('packet_empty_no_packets_window')}
          colorMap={PAYLOAD_TYPE_COLOR_MAP}
        />

        <RankedBars
          title={t('packet_route_mix_title')}
          items={stats.routeBreakdown}
          emptyLabel={t('packet_empty_no_packets_window')}
        />

        <RankedBars
          title={t('packet_hop_profile_title')}
          items={stats.hopProfile}
          emptyLabel={t('packet_empty_no_packets_window')}
        />

        <RankedBars
          title={t('packet_hop_byte_width_title')}
          items={stats.hopByteWidthProfile}
          emptyLabel={t('packet_empty_no_packets_window')}
        />

        <RankedBars
          title={t('packet_signal_distribution_title')}
          items={stats.rssiBuckets}
          emptyLabel={t('packet_empty_no_rssi_samples')}
        />

        <NeighborList
          title={t('packet_most_heard_neighbors_title')}
          items={mostActiveNeighbors}
          emptyLabel={t('packet_empty_no_sender_identities')}
          mode="heard"
          contacts={contacts}
        />

        <NeighborList
          title={t('packet_strongest_recent_neighbors_title')}
          items={strongestNeighbors}
          emptyLabel={t('packet_empty_no_rssi_tagged_neighbors')}
          mode="signal"
          contacts={contacts}
        />

        <NeighborList
          title={t('packet_newest_heard_neighbors_title')}
          items={newestNeighbors}
          emptyLabel={t('packet_empty_no_newly_identified_neighbors')}
          mode="recent"
          contacts={contacts}
        />
      </div>
    </div>
  );
}
