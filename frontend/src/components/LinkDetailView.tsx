import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowLeft } from 'lucide-react';
import { api, isAbortError } from '../api';
import { useT } from '../i18n';
import { formatDateTime } from '../utils/dateTimeFormat';
import { ALL_TIME_RANGE, CUSTOM_RANGE_ID, resolveRange } from '../utils/timeRanges';
import { TimeRangeSelector } from './TimeRangeSelector';
import { ZoomableChart } from './charts/ZoomableChart';
import { RawPacketDetailModal } from './RawPacketDetailModal';
import { toast } from './ui/sonner';
import type { ChartWindow } from '../lib/chartZoom';
import type {
  Channel,
  LinkEndpoint,
  LinkPacketRow,
  LinkSummary,
  LinkTimeseries,
  RawPacket,
} from '../types';

const PAGE = 50;
// Windows up to this long default to hourly buckets, longer ones to daily.
const HOUR_BUCKET_MAX_SPAN = 3 * 24 * 3600;
const TYPE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16'];

interface LinkDetailViewProps {
  a: string;
  b: string;
  channels: Channel[];
  onBack: () => void;
  onOpenContactInfo?: (publicKey: string) => void;
}

interface TimeWindow {
  since: number | null;
  until: number | null;
}

function fmt(ts: number | null | undefined): string {
  if (ts == null) return '-';
  return formatDateTime(new Date(ts * 1000), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortTick(ts: number): string {
  return formatDateTime(new Date(ts * 1000), { month: 'short', day: 'numeric', hour: '2-digit' });
}

function extent(rows: { bucket: number }[]): ChartWindow {
  return rows.length === 0 ? [0, 0] : [rows[0].bucket, rows[rows.length - 1].bucket];
}

const tooltipStyle = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '6px',
  fontSize: '11px',
  color: 'hsl(var(--popover-foreground))',
};

const axisTick = { fontSize: 10, fill: 'hsl(var(--muted-foreground))' };

/** Full-page history for one map link (node pair): summary, traffic trend,
 *  signal trend (own-node links only) and the packets that used it. */
export function LinkDetailView({ a, b, channels, onBack, onOpenContactInfo }: LinkDetailViewProps) {
  const t = useT();
  const [rangeId, setRangeId] = useState<string>(ALL_TIME_RANGE.id);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [customWindow, setCustomWindow] = useState<{ start: number; end: number } | null>(null);
  const [bucket, setBucket] = useState<'hour' | 'day'>('day');
  const [summary, setSummary] = useState<LinkSummary | null>(null);
  const [series, setSeries] = useState<LinkTimeseries | null>(null);
  const [packets, setPackets] = useState<LinkPacketRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [openPacket, setOpenPacket] = useState<RawPacket | null>(null);

  const rangeWindow = useMemo<TimeWindow>(() => {
    if (rangeId === ALL_TIME_RANGE.id) return { since: null, until: null };
    const r = resolveRange(rangeId, {
      customStartSec: customWindow?.start ?? null,
      customEndSec: customWindow?.end ?? null,
    });
    if (!r) return { since: null, until: null };
    return { since: r.startTs, until: rangeId === CUSTOM_RANGE_ID ? r.endTs : null };
  }, [rangeId, customWindow]);

  // Hourly buckets for short windows, daily otherwise; the user can override.
  useEffect(() => {
    const span =
      rangeWindow.since == null
        ? Infinity
        : (rangeWindow.until ?? Date.now() / 1000) - rangeWindow.since;
    setBucket(span <= HOUR_BUCKET_MAX_SPAN ? 'hour' : 'day');
  }, [rangeWindow.since, rangeWindow.until]);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    Promise.all([
      api.getLinkSummary(a, b, rangeWindow, controller.signal),
      api.getLinkTimeseries(a, b, { ...rangeWindow, bucket }, controller.signal),
    ])
      .then(([s, ts]) => {
        setSummary(s);
        setSeries(ts);
      })
      .catch((err) => {
        if (!isAbortError(err)) setError(true);
      });
    return () => controller.abort();
  }, [a, b, rangeWindow, bucket]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .getLinkPackets(a, b, { limit: PAGE }, controller.signal)
      .then((rows) => {
        setPackets(rows);
        setHasMore(rows.length === PAGE);
      })
      .catch((err) => {
        if (!isAbortError(err)) setError(true);
      });
    return () => controller.abort();
  }, [a, b]);

  const loadMore = useCallback(() => {
    const last = packets[packets.length - 1];
    if (!last) return;
    api
      .getLinkPackets(a, b, { limit: PAGE, before: last.ts })
      .then((rows) => {
        setPackets((prev) => [...prev, ...rows]);
        setHasMore(rows.length === PAGE);
      })
      .catch(() => setError(true));
  }, [a, b, packets]);

  const openRow = useCallback(
    (id: number) => {
      api
        .getPacket(id)
        .then(setOpenPacket)
        .catch(() => toast.error(t('link_detail_packet_gone')));
    },
    [t]
  );

  // Stack traffic by payload type: one row per bucket, one key per type.
  const { trafficRows, types } = useMemo(() => {
    const byBucket = new Map<number, Record<string, number>>();
    const typeSet = new Set<string>();
    for (const p of series?.traffic ?? []) {
      typeSet.add(p.payload_type);
      const row = byBucket.get(p.bucket) ?? { bucket: p.bucket };
      row[p.payload_type] = (row[p.payload_type] ?? 0) + p.count;
      byBucket.set(p.bucket, row);
    }
    return {
      trafficRows: [...byBucket.values()].sort((x, y) => x.bucket - y.bucket) as {
        bucket: number;
      }[],
      types: [...typeSet].sort(),
    };
  }, [series]);

  const signal = series?.signal ?? [];
  const nameOf = (e: LinkEndpoint) => e.name ?? e.pubkey.slice(0, 8);

  const card = (label: string, value: string) => (
    <div className="rounded border border-border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <h2 className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-base font-semibold">
        <button type="button" onClick={onBack} aria-label={t('link_detail_back')}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        {summary
          ? t('link_detail_title', { a: nameOf(summary.a), b: nameOf(summary.b) })
          : t('common_loading_link_detail')}
      </h2>

      <div className="space-y-4 p-4">
        <TimeRangeSelector
          value={rangeId}
          onChange={setRangeId}
          extrasSpecial={[ALL_TIME_RANGE]}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
          onApplyCustom={(start, end) => {
            setCustomWindow({ start, end });
            setRangeId(CUSTOM_RANGE_ID);
          }}
        />

        {error && <p className="text-sm text-destructive">{t('link_detail_error')}</p>}

        {summary && (
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            {[summary.a, summary.b].map((e) => (
              <button
                key={e.pubkey}
                type="button"
                className="rounded border border-border p-2 text-left hover:bg-accent/40"
                onClick={() => e.kind === 'contact' && onOpenContactInfo?.(e.pubkey)}
              >
                <div className="font-medium">{nameOf(e)}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {e.pubkey.slice(0, 12)}
                </div>
              </button>
            ))}
            {card(t('link_detail_total_packets'), String(summary.total_packets))}
            {card(
              t('link_detail_distance'),
              summary.distance_km == null ? '-' : `${summary.distance_km.toFixed(1)} km`
            )}
            {card(t('link_detail_first_seen'), fmt(summary.first_seen))}
            {card(t('link_detail_last_seen'), fmt(summary.last_seen))}
            {card(
              t('link_detail_hop_widths'),
              Object.entries(summary.by_hop_width)
                .map(([w, n]) => `${w}b: ${n}`)
                .join(', ') || '-'
            )}
            {card(
              t('link_detail_confidence'),
              Object.entries(summary.by_confidence)
                .map(([c, n]) => `${t(`link_detail_confidence_${c}`)}: ${n}`)
                .join(', ') || '-'
            )}
            <div className="col-span-2 rounded border border-border p-2 md:col-span-4">
              <div className="text-xs text-muted-foreground">{t('link_detail_types')}</div>
              <div>
                {Object.entries(summary.by_payload_type)
                  .map(([p, n]) => `${p}: ${n}`)
                  .join(', ') || '-'}
              </div>
            </div>
          </div>
        )}

        <section className="rounded border border-border/70 bg-muted/10 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium">{t('link_detail_traffic_title')}</span>
            <div className="flex gap-1">
              {(['hour', 'day'] as const).map((bk) => (
                <button
                  key={bk}
                  type="button"
                  aria-pressed={bucket === bk}
                  className={
                    'rounded px-2 py-0.5 text-xs ' +
                    (bucket === bk
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-muted text-muted-foreground')
                  }
                  onClick={() => setBucket(bk)}
                >
                  {t(bk === 'hour' ? 'link_detail_bucket_hour' : 'link_detail_bucket_day')}
                </button>
              ))}
            </div>
          </div>
          {trafficRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('link_detail_empty')}</p>
          ) : (
            <ZoomableChart
              full={extent(trafficRows)}
              minSpan={series?.bucket_seconds ?? 3600}
              inset={{ left: 22, right: 8 }}
            >
              {({ domain, isPanning }) => (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={trafficRows} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="bucket"
                      type="number"
                      allowDataOverflow
                      domain={domain}
                      tickFormatter={shortTick}
                      tick={axisTick}
                    />
                    <YAxis allowDecimals={false} width={34} tick={axisTick} />
                    {!isPanning && (
                      <RechartsTooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(l) => fmt(Number(l))}
                      />
                    )}
                    <Legend wrapperStyle={{ fontSize: '10px' }} />
                    {types.map((ty, i) => (
                      <Bar
                        key={ty}
                        dataKey={ty}
                        stackId="t"
                        fill={TYPE_COLORS[i % TYPE_COLORS.length]}
                        isAnimationActive={false}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ZoomableChart>
          )}
        </section>

        <section className="rounded border border-border/70 bg-muted/10 p-2">
          <span className="text-xs font-medium">{t('link_detail_signal_title')}</span>
          {!summary?.involves_self || signal.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('link_detail_signal_none')}</p>
          ) : (
            <ZoomableChart
              full={extent(signal)}
              minSpan={series?.bucket_seconds ?? 3600}
              inset={{ left: 22, right: 8 }}
            >
              {({ domain, isPanning }) => (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={signal} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="bucket"
                      type="number"
                      allowDataOverflow
                      domain={domain}
                      tickFormatter={shortTick}
                      tick={axisTick}
                    />
                    <YAxis yAxisId="snr" width={34} tick={axisTick} />
                    <YAxis yAxisId="rssi" orientation="right" width={40} tick={axisTick} />
                    {!isPanning && (
                      <RechartsTooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(l) => fmt(Number(l))}
                      />
                    )}
                    <Legend wrapperStyle={{ fontSize: '10px' }} />
                    <Line
                      yAxisId="snr"
                      dataKey="snr_avg"
                      name={t('link_detail_col_snr')}
                      stroke="#3b82f6"
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      yAxisId="rssi"
                      dataKey="rssi_avg"
                      name={t('link_detail_col_rssi')}
                      stroke="#f59e0b"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ZoomableChart>
          )}
        </section>

        <section>
          <h3 className="mb-1 text-xs font-medium">{t('link_detail_packets_title')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th>{t('link_detail_col_time')}</th>
                  <th>{t('link_detail_col_type')}</th>
                  <th>{t('link_detail_col_route')}</th>
                  <th>{t('link_detail_col_hop')}</th>
                  <th>{t('link_detail_col_confidence')}</th>
                  <th>{t('link_detail_col_snr')}</th>
                  <th>{t('link_detail_col_rssi')}</th>
                </tr>
              </thead>
              <tbody>
                {packets.map((p) => (
                  <tr
                    key={`${p.raw_packet_id}-${p.hop_width}`}
                    data-testid={`link-packet-${p.raw_packet_id}`}
                    className="cursor-pointer hover:bg-accent/40"
                    onClick={() => openRow(p.raw_packet_id)}
                  >
                    <td>{fmt(p.ts)}</td>
                    <td>{p.payload_type ?? '-'}</td>
                    <td>{p.route_type ?? '-'}</td>
                    <td>{`${p.hop_width}b`}</td>
                    <td>{t(`link_detail_confidence_${p.confidence}`)}</td>
                    <td>{p.snr ?? '-'}</td>
                    <td>{p.rssi ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <button
              type="button"
              className="mt-2 text-xs text-primary hover:underline"
              onClick={loadMore}
            >
              {t('link_detail_load_more')}
            </button>
          )}
        </section>
      </div>

      <RawPacketDetailModal
        packet={openPacket}
        channels={channels}
        onClose={() => setOpenPacket(null)}
      />
    </div>
  );
}
