/**
 * MeshRelayDetail.tsx
 *
 * Expanded row of the Relay reception summary: the history of one relay over
 * the panel's window (GET /api/packets/relay-reception/relay). Totals and the
 * activity / signal charts cover the whole window (stored copies plus the
 * hourly history); packet types, hop counts and recent copies come from the
 * stored copies only (`raw_since`).
 */

import { useEffect, useMemo, useState } from 'react';
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
import { api, isAbortError } from '../api';
import { useT } from '../i18n';
import { formatDateTime } from '../utils/dateTimeFormat';
import { formatSNR } from '../utils/traceMapUtils';
import { ZoomableChart } from './charts/ZoomableChart';
import type { ChartWindow } from '../lib/chartZoom';
import { DistBars, StatTile } from './meshHealthShared';
import type { RelayDetailResponse } from './MeshRelayReceptionPanel';

interface Props {
  startTs: number;
  endTs: number;
  relayHexes: string[];
}

const TYPE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16'];

const tooltipStyle = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '6px',
  fontSize: '11px',
  color: 'hsl(var(--popover-foreground))',
};

const axisTick = { fontSize: 10, fill: 'hsl(var(--muted-foreground))' };

function pct(part: number, whole: number): string {
  return whole > 0 ? String(Math.round((part / whole) * 100)) : '0';
}

function fmtTs(ts: number, span: number): string {
  return formatDateTime(
    new Date(ts * 1000),
    span > 2 * 86400
      ? { month: 'short', day: 'numeric', hour: '2-digit' }
      : { hour: '2-digit', minute: '2-digit' }
  );
}

export function MeshRelayDetail({ startTs, endTs, relayHexes }: Props) {
  const t = useT();
  const [data, setData] = useState<RelayDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hexKey = relayHexes.join(',');

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api
      .getRelayReceptionDetail(startTs, endTs, hexKey.split(','), controller.signal)
      .then(setData)
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setError(err instanceof Error ? err.message : t('mesh_health_error_failed_to_load'));
      });
    return () => controller.abort();
  }, [startTs, endTs, hexKey, t]);

  const full: ChartWindow = useMemo(() => {
    const s = data?.series ?? [];
    return s.length === 0 ? [0, 0] : [s[0].ts, s[s.length - 1].ts];
  }, [data]);

  if (error) return <div className="text-xs text-destructive">{error}</div>;
  if (!data) return <div className="text-xs text-muted-foreground">{t('mesh_health_loading')}</div>;

  const { totals } = data;
  if (totals.receptions === 0) {
    return <div className="text-xs text-muted-foreground">{t('relay_detail_empty')}</div>;
  }
  const span = data.end_ts - data.start_ts;
  const tick = (ts: number) => fmtTs(ts, span);
  const labelFull = (ts: unknown) =>
    formatDateTime(new Date(Number(ts) * 1000), {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="space-y-3" data-testid="relay-detail">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label={t('relay_detail_tile_copies')} value={totals.receptions} />
        <StatTile
          label={t('relay_detail_tile_packets')}
          value={totals.packets}
          sub={t('relay_detail_tile_packets_sub', {
            pct: pct(totals.packets, totals.window_packets),
          })}
        />
        <StatTile
          label={t('relay_detail_tile_first')}
          value={totals.first_arrivals}
          sub={t('relay_detail_tile_first_sub', {
            pct: pct(totals.first_arrivals, totals.packets),
          })}
        />
        <StatTile
          label={t('relay_detail_tile_unique')}
          value={totals.unique_packets}
          sub={t('relay_detail_tile_unique_sub', {
            pct: pct(totals.unique_packets, totals.packets),
          })}
        />
        <StatTile
          label={t('relay_detail_tile_snr')}
          value={formatSNR(totals.avg_snr) ?? '-'}
          sub={
            totals.best_snr === null
              ? undefined
              : t('relay_detail_tile_best', { value: formatSNR(totals.best_snr) ?? '' })
          }
        />
        <StatTile
          label={t('relay_detail_tile_rssi')}
          value={totals.avg_rssi === null ? '-' : `${Math.round(totals.avg_rssi)} dBm`}
          sub={
            totals.best_rssi === null
              ? undefined
              : t('relay_detail_tile_best', { value: `${totals.best_rssi} dBm` })
          }
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded border border-border/70 bg-muted/10 p-2">
          <span className="text-xs font-medium">{t('relay_detail_activity_title')}</span>
          <ZoomableChart full={full} minSpan={data.bucket_seconds} inset={{ left: 40, right: 8 }}>
            {({ domain, isPanning }) => (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data.series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="ts"
                    type="number"
                    allowDataOverflow
                    domain={domain}
                    tickFormatter={tick}
                    tick={axisTick}
                  />
                  <YAxis allowDecimals={false} width={40} tick={axisTick} />
                  {!isPanning && (
                    <RechartsTooltip contentStyle={tooltipStyle} labelFormatter={labelFull} />
                  )}
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Bar
                    dataKey="receptions"
                    name={t('relay_detail_series_copies')}
                    fill="#3b82f6"
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="first_arrivals"
                    name={t('relay_detail_series_first')}
                    fill="#10b981"
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ZoomableChart>
        </section>

        <section className="rounded border border-border/70 bg-muted/10 p-2">
          <span className="text-xs font-medium">{t('relay_detail_signal_title')}</span>
          <ZoomableChart full={full} minSpan={data.bucket_seconds} inset={{ left: 22, right: 8 }}>
            {({ domain, isPanning }) => (
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={data.series} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="ts"
                    type="number"
                    allowDataOverflow
                    domain={domain}
                    tickFormatter={tick}
                    tick={axisTick}
                  />
                  <YAxis yAxisId="snr" width={34} tick={axisTick} />
                  <YAxis yAxisId="rssi" orientation="right" width={40} tick={axisTick} />
                  {!isPanning && (
                    <RechartsTooltip contentStyle={tooltipStyle} labelFormatter={labelFull} />
                  )}
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Line
                    yAxisId="snr"
                    dataKey="avg_snr"
                    name={t('relay_detail_series_snr')}
                    stroke="#3b82f6"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="rssi"
                    dataKey="avg_rssi"
                    name={t('relay_detail_series_rssi')}
                    stroke="#f59e0b"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ZoomableChart>
        </section>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <section>
          <h4 className="mb-1 text-xs font-medium">{t('relay_detail_types_title')}</h4>
          <DistBars
            items={data.payload_types.map((c, i) => ({
              label: c.key,
              count: c.count,
              color: TYPE_COLORS[i % TYPE_COLORS.length],
            }))}
          />
        </section>
        <section>
          <h4 className="mb-1 text-xs font-medium">{t('relay_detail_hops_title')}</h4>
          {/* Hop counts run up to 60+, so a compact column chart instead of one bar per row. */}
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={data.hop_counts} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="key" tick={axisTick} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} width={40} tick={axisTick} />
              <RechartsTooltip
                contentStyle={tooltipStyle}
                labelFormatter={(hops) => `${t('relay_detail_col_hops')}: ${hops}`}
              />
              <Bar
                dataKey="count"
                name={t('relay_detail_series_copies')}
                fill="#8b5cf6"
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      {data.recent.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs font-medium">{t('relay_detail_recent_title')}</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="relay-detail-recent">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-2">{t('relay_detail_col_time')}</th>
                  <th className="py-1 pr-2">{t('relay_detail_col_type')}</th>
                  <th className="py-1 px-2 text-right">{t('relay_detail_col_hops')}</th>
                  <th className="py-1 px-2 text-right">{t('relay_detail_col_snr')}</th>
                  <th className="py-1 px-2 text-right">{t('relay_detail_col_rssi')}</th>
                  <th className="py-1 px-2 text-right">{t('relay_detail_col_relays')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr
                    key={`${r.payload_hash}-${r.observed_at}-${r.snr}`}
                    className="border-t border-border/60 align-top"
                  >
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {formatDateTime(new Date(r.observed_at * 1000), {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="py-1 pr-2">
                      {r.payload_type}
                      {r.first && (
                        <span
                          className="ml-1 rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-600 dark:text-emerald-400"
                          title={t('relay_detail_first_badge_title')}
                        >
                          {t('relay_detail_first_badge')}
                        </span>
                      )}
                      {r.preview && (
                        <div className="text-muted-foreground wrap-break-word">{r.preview}</div>
                      )}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.hop_count}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{formatSNR(r.snr) ?? '-'}</td>
                    <td className="py-1 px-2 text-right tabular-nums">
                      {r.rssi === null ? '-' : r.rssi}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.relays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data.raw_since !== null && data.raw_since > data.start_ts && (
        <p className="text-[0.75rem] text-muted-foreground">
          {t('relay_detail_raw_note', { since: labelFull(data.raw_since) })}
        </p>
      )}
    </div>
  );
}
