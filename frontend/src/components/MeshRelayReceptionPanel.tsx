/**
 * MeshRelayReceptionPanel.tsx
 *
 * The "Relay reception" view of the Mesh Health page (plan 21 S1): for every
 * flooded packet this node heard more than once, which relay delivered each
 * copy and the SNR/RSSI our radio measured for it. A copy with no relay was
 * heard straight from the origin. Only flood-routed packets are recorded
 * (direct routes pop their path, so the last hop is not the deliverer).
 *
 * Rendered inside the MeshHealthView shell (header, tab pill, shared time
 * window, refresh); this panel returns only its content blocks.
 *
 * Short windows (30m/1h, `autoRefresh`) refresh live: a `raw_packet` WS event
 * with `relay_reception` (a copy was just stored) triggers a re-fetch, at most
 * once per LIVE_REFRESH_MS, and a 30 s poll covers a quiet or missed stream.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useT } from '../i18n';
import { getRawPackets, subscribeRawPackets } from '../stores/rawPacketStore';
import { formatDateTime } from '../utils/dateTimeFormat';
import { formatSNR } from '../utils/traceMapUtils';
import { type TimeWindow, relTime, StatTile } from './meshHealthShared';
import { MeshRelayDetail } from './MeshRelayDetail';

// ─── Types (mirror app/routers/packets.py) ──────────────────────────────────

export interface RelayCell {
  last_hop_hex: string | null;
  count: number;
  best_snr: number | null;
  last_snr: number | null;
  best_rssi: number | null;
  last_rssi: number | null;
  last_seen: number;
  resolved_pubkey: string | null;
  resolved_name: string | null;
  candidates: number;
}
export interface RelayPacket {
  payload_hash: string;
  payload_type: string;
  route_type: string;
  first_seen: number;
  last_seen: number;
  copies: number;
  relays: RelayCell[];
  preview: string | null;
  message_id: number | null;
}
export interface RelaySummary {
  last_hop_hex: string | null;
  /** Hashes merged into this row ('' = heard from the origin); keys for the detail call. */
  relay_hexes: string[];
  receptions: number;
  packets: number;
  first_arrivals: number;
  unique_packets: number;
  best_snr: number | null;
  avg_snr: number | null;
  last_snr: number | null;
  best_rssi: number | null;
  avg_rssi: number | null;
  last_rssi: number | null;
  last_seen: number;
  resolved_pubkey: string | null;
  resolved_name: string | null;
  candidates: number;
}
export interface RelayReceptionResponse {
  start_ts: number;
  end_ts: number;
  receptions: number;
  total_packets: number;
  multi_relay_packets: number;
  packets: RelayPacket[];
  packet_offset: number;
  packet_total: number;
  relays: RelaySummary[];
  /** Oldest stored copy; older parts of the window come from the hourly history. */
  raw_since: number | null;
  history_from: number | null;
}
export interface RelaySeriesPoint {
  ts: number;
  receptions: number;
  packets: number;
  first_arrivals: number;
  avg_snr: number | null;
  best_snr: number | null;
  avg_rssi: number | null;
  best_rssi: number | null;
}
export interface RelayRecentCopy {
  payload_hash: string;
  observed_at: number;
  payload_type: string;
  route_type: string;
  hop_count: number;
  snr: number | null;
  rssi: number | null;
  path_hex: string | null;
  first: boolean;
  relays: number;
  preview: string | null;
  message_id: number | null;
}
export interface RelayDetailResponse {
  start_ts: number;
  end_ts: number;
  relay_hexes: string[];
  bucket_seconds: number;
  totals: {
    receptions: number;
    packets: number;
    first_arrivals: number;
    unique_packets: number;
    window_packets: number;
    best_snr: number | null;
    avg_snr: number | null;
    best_rssi: number | null;
    avg_rssi: number | null;
    last_seen: number | null;
  };
  series: RelaySeriesPoint[];
  payload_types: { key: string; count: number }[];
  hop_counts: { key: string; count: number }[];
  recent: RelayRecentCopy[];
  raw_since: number | null;
  history_from: number | null;
}

interface Props {
  selectedWindow: TimeWindow;
  /** Incremented by the shell's refresh button to force a re-fetch. */
  refreshKey: number;
  /** Reports loading state up to the shell so the refresh spinner can reflect it. */
  onLoadingChange?: (loading: boolean) => void;
  /** Opens a contact's info page (resolved relays are clickable). */
  onOpenNode?: (publicKey: string, name: string | null) => void;
}

const MAX_RELAY_COLUMNS = 8;
/** Minimum spacing of live (WS-triggered) re-fetches. */
const LIVE_REFRESH_MS = 3_000;
/** Fallback poll for short windows when no live re-fetch happened meanwhile. */
const POLL_MS = 30_000;
/** Packets per page of the per-packet table (the backend caps a page at 200). */
const PAGE_SIZES = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_KEY = 'rtfm-relay-reception-page-size';
type SummarySort = 'receptions' | 'first_arrivals' | 'unique_packets' | 'best_snr' | 'last_seen';

function loadPageSize(): number {
  try {
    const v = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return PAGE_SIZES.includes(v) ? v : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

function fmtStamp(ts: number): string {
  return formatDateTime(new Date(ts * 1000), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Relay identity for a column/row: the resolved full key when unique, else the
 * raw hash. The same relay arrives as `6942` or `694203` depending on the
 * packet's path hash width; the backend merges the summary by full key, so
 * cells must match columns the same way.
 */
function relayKey(relay: { last_hop_hex: string | null; resolved_pubkey: string | null }): string {
  return relay.resolved_pubkey ?? relay.last_hop_hex ?? '__direct__';
}

function fmtRssi(rssi: number | null): string {
  return rssi === null ? '' : `${rssi} dBm`;
}

export function MeshRelayReceptionPanel({
  selectedWindow,
  refreshKey,
  onLoadingChange,
  onOpenNode,
}: Props) {
  const t = useT();
  const [data, setData] = useState<RelayReceptionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summarySort, setSummarySort] = useState<SummarySort>('receptions');
  const [liveTick, setLiveTick] = useState(0);
  const [pageSize, setPageSize] = useState(loadPageSize);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const lastFetchRef = useRef(0);

  // A new window starts on the first page (reset while rendering, so the
  // fetch effect never runs with the old window's page).
  const [pageWindow, setPageWindow] = useState(selectedWindow);
  if (pageWindow !== selectedWindow) {
    setPageWindow(selectedWindow);
    setPage(0);
  }

  const changePageSize = (size: number) => {
    setPageSize(size);
    setPage(0);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      /* ignore unavailable storage */
    }
  };

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    if (!selectedWindow.autoRefresh) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Stamp the request time here, not only when the fetch effect runs: a copy
    // arriving before that render would otherwise schedule a second fetch.
    const refresh = () => {
      lastFetchRef.current = Date.now();
      setLiveTick((n) => n + 1);
    };
    const initial = getRawPackets();
    let newest = initial[initial.length - 1];
    const unsubscribe = subscribeRawPackets(() => {
      const packets = getRawPackets();
      const latest = packets[packets.length - 1];
      if (!latest || latest === newest) return;
      newest = latest;
      if (!latest.relay_reception || timer) return;
      const wait = Math.max(0, lastFetchRef.current + LIVE_REFRESH_MS - Date.now());
      timer = setTimeout(() => {
        timer = null;
        refresh();
      }, wait);
    });
    const poll = setInterval(() => {
      if (Date.now() - lastFetchRef.current >= POLL_MS) refresh();
    }, POLL_MS);
    return () => {
      unsubscribe();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [selectedWindow]);

  useEffect(() => {
    lastFetchRef.current = Date.now();
    const endTs = Math.floor(Date.now() / 1000);
    const startTs = endTs - selectedWindow.hours * 3600;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/packets/relay-reception?start_ts=${startTs}&end_ts=${endTs}` +
        `&limit=${pageSize}&offset=${page * pageSize}`
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<RelayReceptionResponse>;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t('mesh_health_error_failed_to_load'));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWindow, refreshKey, liveTick, pageSize, page, t]);

  const relayLabel = (cell: { last_hop_hex: string | null; resolved_name: string | null }) => {
    if (cell.last_hop_hex === null) return t('relay_reception_direct');
    return cell.resolved_name || cell.last_hop_hex;
  };

  // Pivot columns: the most active relays (by receptions) across the window.
  const columns = useMemo(() => {
    if (!data) return [];
    return data.relays.slice(0, MAX_RELAY_COLUMNS);
  }, [data]);

  const sortedSummary = useMemo(() => {
    if (!data) return [];
    const rows = [...data.relays];
    rows.sort((a, b) => {
      if (summarySort === 'best_snr') return (b.best_snr ?? -999) - (a.best_snr ?? -999);
      if (summarySort === 'last_seen') return b.last_seen - a.last_seen;
      if (summarySort === 'first_arrivals') return b.first_arrivals - a.first_arrivals;
      if (summarySort === 'unique_packets') return b.unique_packets - a.unique_packets;
      return b.receptions - a.receptions;
    });
    return rows;
  }, [data, summarySort]);

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>;
  }
  if (!data) {
    return <div className="text-sm text-muted-foreground">{t('mesh_health_loading')}</div>;
  }

  const pageCount = Math.max(1, Math.ceil(data.packet_total / pageSize));
  const pageFrom = data.packet_total === 0 ? 0 : data.packet_offset + 1;
  const pageTo = data.packet_offset + data.packets.length;
  const summaryColumns = 8;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t('relay_reception_tile_receptions')} value={data.receptions} />
        <StatTile label={t('relay_reception_tile_packets')} value={data.total_packets} />
        <StatTile label={t('relay_reception_tile_multi')} value={data.multi_relay_packets} />
        <StatTile label={t('relay_reception_tile_relays')} value={data.relays.length} />
      </div>

      <p className="text-[0.8125rem] text-muted-foreground">{t('relay_reception_intro')}</p>
      {data.history_from != null && data.raw_since != null && (
        <p className="text-[0.8125rem] text-muted-foreground" data-testid="relay-history-note">
          {t('relay_reception_history_note', { since: fmtStamp(data.raw_since) })}
        </p>
      )}

      {data.relays.length === 0 && (
        <div className="text-sm text-muted-foreground">{t('relay_reception_empty')}</div>
      )}
      {data.packet_total > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="relay-reception-pivot">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2">{t('relay_reception_col_packet')}</th>
                <th className="py-1 pr-2 text-right">{t('relay_reception_col_copies')}</th>
                {columns.map((col) => (
                  <th key={relayKey(col)} className="py-1 px-2 text-right">
                    {col.resolved_pubkey && onOpenNode ? (
                      <button
                        type="button"
                        className="hover:text-primary hover:underline"
                        onClick={() => onOpenNode(col.resolved_pubkey as string, col.resolved_name)}
                      >
                        {relayLabel(col)}
                      </button>
                    ) : (
                      <span
                        className={col.last_hop_hex ? 'font-mono' : ''}
                        title={
                          col.candidates > 1
                            ? t('relay_reception_collision', { count: col.candidates })
                            : undefined
                        }
                      >
                        {relayLabel(col)}
                        {col.candidates > 1 ? ' ?' : ''}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.packets.map((p) => {
                const byHop = new Map(p.relays.map((c) => [relayKey(c), c]));
                const extra = p.relays.filter(
                  (c) => !columns.some((col) => relayKey(col) === relayKey(c))
                );
                return (
                  <tr key={p.payload_hash} className="border-t border-border/60 align-top">
                    <td className="py-1 pr-2">
                      <div className="font-medium">
                        {p.payload_type}
                        <span className="ml-1 text-muted-foreground">{p.route_type}</span>
                      </div>
                      <div className="text-muted-foreground">
                        {formatDateTime(new Date(p.last_seen * 1000), {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                        {p.preview ? ` · ${p.preview}` : ''}
                      </div>
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{p.copies}</td>
                    {columns.map((col) => {
                      const cell = byHop.get(relayKey(col));
                      return (
                        <td key={relayKey(col)} className="py-1 px-2 text-right tabular-nums">
                          {cell ? (
                            <span title={fmtRssi(cell.best_rssi)}>
                              {formatSNR(cell.best_snr) ?? '—'}
                              {cell.count > 1 ? ` ×${cell.count}` : ''}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">·</span>
                          )}
                        </td>
                      );
                    })}
                    {extra.length > 0 && (
                      <td className="py-1 px-2 text-muted-foreground">
                        {t('relay_reception_more_relays', { count: extra.length })}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div
            className="mt-2 flex flex-wrap items-center justify-end gap-2 text-[11px] text-muted-foreground"
            data-testid="relay-reception-pager"
          >
            <label className="flex items-center gap-1">
              {t('relay_reception_page_size')}
              <select
                value={pageSize}
                onChange={(e) => changePageSize(Number(e.target.value))}
                className="h-7 rounded-md border border-input bg-background px-1.5 text-[11px] text-foreground"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <span className="tabular-nums">
              {t('relay_reception_page_range', {
                from: pageFrom,
                to: pageTo,
                total: data.packet_total,
              })}
            </span>
            <button
              type="button"
              aria-label={t('relay_reception_page_prev')}
              title={t('relay_reception_page_prev')}
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="h-7 rounded-md border border-input px-1.5 text-foreground disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={t('relay_reception_page_next')}
              title={t('relay_reception_page_next')}
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="h-7 rounded-md border border-input px-1.5 text-foreground disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {data.relays.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">{t('relay_reception_summary_heading')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="relay-reception-summary">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-2">{t('relay_reception_col_relay')}</th>
                  {(
                    [
                      ['receptions', t('relay_reception_col_receptions'), undefined],
                      [
                        'first_arrivals',
                        t('relay_reception_col_first'),
                        t('relay_reception_col_first_title'),
                      ],
                      [
                        'unique_packets',
                        t('relay_reception_col_unique'),
                        t('relay_reception_col_unique_title'),
                      ],
                      ['best_snr', t('relay_reception_col_best_snr'), undefined],
                      ['last_seen', t('relay_reception_col_last_seen'), undefined],
                    ] as [SummarySort, string, string | undefined][]
                  ).map(([key, label, title]) => (
                    <th key={key} className="py-1 px-2 text-right">
                      <button
                        type="button"
                        title={title}
                        className={
                          summarySort === key ? 'text-foreground' : 'hover:text-foreground'
                        }
                        onClick={() => setSummarySort(key)}
                      >
                        {label}
                        {summarySort === key ? ' ▼' : ''}
                      </button>
                    </th>
                  ))}
                  <th className="py-1 px-2 text-right">{t('relay_reception_col_avg_snr')}</th>
                  <th className="py-1 px-2 text-right">{t('relay_reception_col_packets')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedSummary.map((r) => {
                  const key = relayKey(r);
                  const open = expanded.has(key);
                  const name = relayLabel(r);
                  return (
                    <Fragment key={key}>
                      <tr className="border-t border-border/60">
                        <td className="py-1 pr-2">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-label={t(
                                open ? 'relay_reception_collapse' : 'relay_reception_expand',
                                { name }
                              )}
                              title={t(
                                open ? 'relay_reception_collapse' : 'relay_reception_expand',
                                { name }
                              )}
                              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                              onClick={() => toggleExpanded(key)}
                            >
                              {open ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </button>
                            {r.resolved_pubkey && onOpenNode ? (
                              <button
                                type="button"
                                className="text-left hover:text-primary hover:underline"
                                onClick={() =>
                                  onOpenNode(r.resolved_pubkey as string, r.resolved_name)
                                }
                              >
                                {name}
                              </button>
                            ) : (
                              <span className={r.last_hop_hex ? 'font-mono' : ''}>
                                {name}
                                {r.candidates > 1 ? ' ?' : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-1 px-2 text-right tabular-nums">{r.receptions}</td>
                        <td className="py-1 px-2 text-right tabular-nums">
                          {r.first_arrivals}
                          <span className="ml-1 text-muted-foreground">
                            {r.packets > 0
                              ? `${Math.round((r.first_arrivals / r.packets) * 100)}%`
                              : ''}
                          </span>
                        </td>
                        <td className="py-1 px-2 text-right tabular-nums">{r.unique_packets}</td>
                        <td className="py-1 px-2 text-right tabular-nums">
                          {formatSNR(r.best_snr) ?? '—'}
                        </td>
                        <td className="py-1 px-2 text-right">{relTime(r.last_seen, t)}</td>
                        <td className="py-1 px-2 text-right tabular-nums">
                          {formatSNR(r.avg_snr) ?? '—'}
                        </td>
                        <td className="py-1 px-2 text-right tabular-nums">{r.packets}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={summaryColumns} className="bg-muted/20 p-2">
                            <MeshRelayDetail
                              startTs={data.start_ts}
                              endTs={data.end_ts}
                              relayHexes={r.relay_hexes}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
