import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Volume2, VolumeX, X } from 'lucide-react';
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

import { MeshCoreDecoder, Utils } from '@michaelhart/meshcore-decoder';

import { RawPacketList } from './RawPacketList';
import { RawPacketInspectorDialog } from './RawPacketDetailModal';
import { usePacketFilters } from '../hooks/usePacketFilters';
import { PacketFilterModal } from './PacketFilterModal';
import { getRawPacketObservationKey } from '../utils/rawPacketIdentity';
import { Button } from './ui/button';
import type { Channel, Contact, RawFeedHistoricalStats, RawPacket } from '../types';
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
  classifyDecodedHopByteWidth,
  isRawFeedLiveWindow,
  type HopByteWidthBucket,
  type NeighborStat,
  type PacketTimelineBin,
  type RankedPacketStat,
  type RawPacketStatsSessionState,
  type RawPacketStatsWindow,
} from '../utils/rawPacketStats';
import { createDecoderOptions } from '../utils/rawPacketInspector';
import { useRawPacketStatsSession, useRawPackets } from '../stores/rawPacketStore';
import { useSignalAudio } from '../hooks/useSignalAudio';
import type { SignalAudioTheme } from '../lib/signalAudioEngine';
import {
  getSavedSignalAudioOn,
  getSavedSignalAudioTheme,
  getSavedSignalAudioVolume,
  setSavedSignalAudioOn,
  setSavedSignalAudioTheme,
  setSavedSignalAudioVolume,
} from '../utils/signalAudioPreference';
import { getContactDisplayName } from '../utils/pubkey';
import { cn } from '@/lib/utils';
import { useT, type TFn } from '../i18n';

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

const KNOWN_PAYLOAD_TYPE_SET = new Set<string>(KNOWN_PAYLOAD_TYPES);
const PAYLOAD_TYPE_COLOR_MAP = buildColorMap(KNOWN_PAYLOAD_TYPES);

/**
 * Classify a packet for the feed filters in a single decode pass: its payload
 * type and its hop-byte-width bucket. Sharing one decode avoids a second pass
 * per packet on a buffer that can update several times a second.
 */
function summarizePacketForFeed(
  packet: RawPacket,
  decoderOptions?: ReturnType<typeof createDecoderOptions>
): { payloadType: string; hopWidth: HopByteWidthBucket; isDirect: boolean } {
  try {
    const decoded = MeshCoreDecoder.decode(packet.data, decoderOptions);
    const name = decoded.isValid ? Utils.getPayloadTypeName(decoded.payloadType) : 'Unknown';
    const hopWidth = classifyDecodedHopByteWidth(decoded);
    return {
      payloadType: KNOWN_PAYLOAD_TYPE_SET.has(name) ? name : 'Unknown',
      hopWidth,
      // Direct = decoded successfully and carries no path (0 hops), i.e. heard
      // directly from a neighbour. `No path` alone also covers undecodable
      // packets, so gate on isValid to avoid over-claiming.
      isDirect: decoded.isValid && hopWidth === 'No path',
    };
  } catch {
    return { payloadType: 'Unknown', hopWidth: 'No path', isDirect: false };
  }
}

interface RawPacketFeedViewProps {
  contacts: Contact[];
  channels: Channel[];
}

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
                  {mode === 'recent' ? formatRssi(item.bestRssi) : formatRssi(item.bestRssi)}
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

export function RawPacketFeedView({ contacts, channels }: RawPacketFeedViewProps) {
  const t = useT();
  const packets = useRawPackets();
  const rawPacketStatsSession = useRawPacketStatsSession();
  const [statsOpen, setStatsOpen] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 768px)').matches
      : false
  );
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
  const [selectedPacket, setSelectedPacket] = useState<RawPacket | null>(null);
  const [analyzeModalOpen, setAnalyzeModalOpen] = useState(false);
  // Payload-type / hop-width / hex / group filter state (session-only).
  const filters = usePacketFilters();
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  // Autoscroll defaults on; intentionally not persisted across refreshes.
  const [autoScroll, setAutoScroll] = useState(true);
  // Per-packet signal audio (Geiger / sonar). Persisted per-browser; off by default.
  const [soundOn, setSoundOn] = useState(getSavedSignalAudioOn);
  const [soundVolume, setSoundVolume] = useState(getSavedSignalAudioVolume);
  const [soundTheme, setSoundTheme] = useState<SignalAudioTheme>(getSavedSignalAudioTheme);
  useSignalAudio({ enabled: soundOn, volume: soundVolume, theme: soundTheme });

  const handleToggleSound = () => {
    setSoundOn((prev) => {
      const next = !prev;
      setSavedSignalAudioOn(next);
      return next;
    });
  };
  const handleSoundVolumeChange = (value: number) => {
    setSoundVolume(value);
    setSavedSignalAudioVolume(value);
  };
  const handleSoundThemeChange = (theme: SignalAudioTheme) => {
    setSoundTheme(theme);
    setSavedSignalAudioTheme(theme);
  };

  const decoderOptions = useMemo(() => createDecoderOptions(channels), [channels]);

  const packetsWithTypes = useMemo(
    () =>
      packets.map((packet) => ({
        packet,
        ...summarizePacketForFeed(packet, decoderOptions),
      })),
    [packets, decoderOptions]
  );

  const directPacketKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const { packet, isDirect } of packetsWithTypes) {
      if (isDirect) keys.add(getRawPacketObservationKey(packet));
    }
    return keys;
  }, [packetsWithTypes]);

  const filteredPackets = useMemo(() => {
    // A non-hex query matches nothing; the input surfaces a hint instead.
    if (filters.hexInvalid) return [];
    // Fast path: no filters active.
    if (filters.allTypesEnabled && filters.allHopWidthsEnabled && filters.hexQuery === '') {
      return packets;
    }
    return packetsWithTypes
      .filter(
        ({ packet, payloadType, hopWidth }) =>
          (filters.allTypesEnabled || filters.enabledTypes.has(payloadType)) &&
          (filters.allHopWidthsEnabled || filters.enabledHopWidths.has(hopWidth)) &&
          (filters.hexQuery === '' || packet.data.toLowerCase().includes(filters.hexQuery))
      )
      .map(({ packet }) => packet);
  }, [
    packetsWithTypes,
    packets,
    filters.allTypesEnabled,
    filters.allHopWidthsEnabled,
    filters.enabledTypes,
    filters.enabledHopWidths,
    filters.hexQuery,
    filters.hexInvalid,
  ]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setNowSec(Math.floor(Date.now() / 1000));
  }, [packets, rawPacketStatsSession]);

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
    <>
      <div className="border-b border-border px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-base text-foreground">
              {t('nav_raw_packet_feed_name')}
            </h2>
            <p className="hidden md:block text-xs text-muted-foreground">
              {t('packet_collecting_stats_since', {
                timestamp: formatTimestamp(rawPacketStatsSession.sessionStartedAt),
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={soundOn ? 'default' : 'outline'}
              size="sm"
              onClick={handleToggleSound}
              aria-pressed={soundOn}
              title={t('packet_sound_tip')}
            >
              {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              <span className="hidden sm:inline">{t('packet_sound')}</span>
            </Button>
            {soundOn && (
              <>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={soundVolume}
                  onChange={(event) => handleSoundVolumeChange(Number(event.target.value))}
                  aria-label={t('packet_sound_volume')}
                  className="w-20 accent-primary"
                />
                <select
                  value={soundTheme}
                  onChange={(event) =>
                    handleSoundThemeChange(event.target.value as SignalAudioTheme)
                  }
                  aria-label={t('packet_sound_theme')}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                >
                  <option value="geiger">{t('packet_sound_theme_geiger')}</option>
                  <option value="sonar">{t('packet_sound_theme_sonar')}</option>
                  <option value="waterdrip">{t('packet_sound_theme_waterdrip')}</option>
                </select>
              </>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAnalyzeModalOpen(true)}
            >
              {t('chat_analyze_packet_title')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStatsOpen((current) => !current)}
              aria-expanded={statsOpen}
            >
              {statsOpen ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
              {statsOpen ? t('packet_hide_stats_button') : t('packet_show_stats_button')}
            </Button>
          </div>
        </div>
        <p className="md:hidden text-xs text-muted-foreground">
          {t('packet_collecting_stats_since', {
            timestamp: formatTimestamp(rawPacketStatsSession.sessionStartedAt),
          })}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="relative">
            <input
              type="text"
              value={filters.hexFilter}
              onChange={(event) => filters.setHexFilter(event.target.value)}
              placeholder={t('packet_filter_hex_placeholder')}
              aria-label={t('packet_filter_hex_aria')}
              className="w-44 rounded border border-input bg-background px-2 py-0.5 pr-6 text-xs"
            />
            {filters.hexFilter !== '' && (
              <button
                type="button"
                onClick={() => filters.setHexFilter('')}
                aria-label={t('packet_clear_hex_filter_aria')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {filters.hexFilter.trim() !== '' &&
            (filters.hexInvalid ? (
              <span className="text-[0.6875rem] text-warning">
                {t('packet_hex_filter_invalid')}
              </span>
            ) : (
              <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
                {filteredPackets.length.toLocaleString()} / {packets.length.toLocaleString()}
              </span>
            ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFilterModalOpen(true)}
            aria-expanded={filterModalOpen}
          >
            {t('packet_filters_button')}
            {filters.activeFilterCount > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 text-[0.625rem] font-semibold text-primary-foreground tabular-nums">
                {filters.activeFilterCount}
              </span>
            )}
          </Button>
          <label className="ml-auto flex items-center gap-1 text-xs text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(event) => setAutoScroll(event.target.checked)}
              className="rounded"
            />
            {t('packet_autoscroll_label')}
          </label>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className={cn('min-h-0 min-w-0 flex-1', statsOpen && 'md:border-r md:border-border')}>
          <RawPacketList
            packets={filteredPackets}
            channels={channels}
            onPacketClick={setSelectedPacket}
            autoScroll={autoScroll}
            directPacketKeys={directPacketKeys}
          />
        </div>

        <aside
          className={cn(
            'shrink-0 overflow-hidden border-t border-border transition-all duration-300 md:border-l md:border-t-0',
            statsOpen
              ? 'max-h-[42rem] md:max-h-none md:w-1/2 md:min-w-[30rem]'
              : 'max-h-0 md:w-0 md:min-w-0 border-transparent'
          )}
        >
          {statsOpen ? (
            <div className="h-full overflow-y-auto bg-background p-4 [contain:layout_paint]">
              <div className="break-inside-avoid rounded-lg border border-border/70 bg-card/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[0.625rem] uppercase tracking-wider font-medium text-muted-foreground">
                      {t('packet_coverage_label')}
                    </div>
                    <div
                      className={cn(
                        'mt-1 text-sm',
                        coverageMessage.tone === 'warning'
                          ? 'text-warning'
                          : 'text-muted-foreground'
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
          ) : null}
        </aside>
      </div>

      <RawPacketInspectorDialog
        open={selectedPacket !== null}
        onOpenChange={(isOpen) => !isOpen && setSelectedPacket(null)}
        channels={channels}
        source={
          selectedPacket
            ? { kind: 'packet', packet: selectedPacket }
            : { kind: 'loading', message: t('packet_loading_message') }
        }
        title={t('packet_details_title')}
        description={t('packet_details_description')}
      />

      <RawPacketInspectorDialog
        open={analyzeModalOpen}
        onOpenChange={setAnalyzeModalOpen}
        channels={channels}
        source={{ kind: 'paste' }}
        title={t('chat_analyze_packet_title')}
        description={t('packet_analyze_description')}
      />

      <PacketFilterModal
        open={filterModalOpen}
        onOpenChange={setFilterModalOpen}
        enabledTypes={filters.enabledTypes}
        enabledHopWidths={filters.enabledHopWidths}
        allTypesEnabled={filters.allTypesEnabled}
        allHopWidthsEnabled={filters.allHopWidthsEnabled}
        groupByHash={filters.groupByHash}
        onToggleAll={filters.toggleAll}
        onToggleType={filters.toggleType}
        onOnlyType={filters.onlyType}
        onToggleAllHopWidths={filters.toggleAllHopWidths}
        onToggleHopWidth={filters.toggleHopWidth}
        onOnlyHopWidth={filters.onlyHopWidth}
        onGroupByHashChange={filters.setGroupByHash}
        onReset={filters.reset}
        matchCount={filteredPackets.length}
        totalCount={packets.length}
      />
    </>
  );
}
