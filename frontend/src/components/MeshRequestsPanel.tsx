/**
 * MeshRequestsPanel.tsx
 *
 * The "Requests" view of the Mesh Health page. Single-node view of REQUEST /
 * ANON_REQUEST / RESPONSE traffic this node has actually heard over RF. It makes
 * no answered/unanswered ("wasted") judgment, because a RESPONSE routed back
 * along a path this node is not on is never heard here.
 *
 * Mirrors the shape of the EU Meshcore Analyzer's request-health tab (stat
 * cards, a flood/direct split, a volume-over-time chart, and a src->dest pair
 * table) but reframed honestly for one connected node.
 *
 * Rendered inside the MeshHealthView shell, which owns the header, the
 * Adverts/Requests pill, the shared time-window selector, and refresh. This
 * panel returns only its content blocks.
 */

import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { type TimeWindow, relTime, StatTile, DistBars } from './meshHealthShared';

// ─── Types ──────────────────────────────────────────────────────────────────

interface RequestTrafficTotals {
  requests: number;
  anon_requests: number;
  responses: number;
  flood_requests: number;
  direct_requests: number;
}
interface RequestTrafficBucket {
  bucket_ts: number;
  flood: number;
  direct: number;
  responses: number;
}
interface RequestTrafficPair {
  src_hash: string;
  dest_hash: string;
  requests: number;
  flood: number;
  direct: number;
  last_ts: number;
}
interface RequestTrafficResponse {
  start_ts: number;
  end_ts: number;
  totals: RequestTrafficTotals;
  series: RequestTrafficBucket[];
  pairs: RequestTrafficPair[];
}

interface Props {
  selectedWindow: TimeWindow;
  /** Incremented by the shell's refresh button to force a re-fetch. */
  refreshKey: number;
  /** Reports loading state up to the shell so the refresh spinner can reflect it. */
  onLoadingChange?: (loading: boolean) => void;
}

const FLOOD_COLOR = 'hsl(var(--warning))';
const DIRECT_COLOR = 'hsl(var(--success))';
const RESPONSE_COLOR = 'hsl(var(--info))';

// ─── Volume over time (stacked flood/direct bars + responses line) ─────────────

function VolumeChart({ series }: { series: RequestTrafficBucket[] }) {
  const t = useT();
  const W = 360;
  const H = 140;
  const pad = { top: 8, right: 8, bottom: 18, left: 24 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;

  const maxStack = Math.max(...series.map((b) => b.flood + b.direct), 0);
  const maxResp = Math.max(...series.map((b) => b.responses), 0);
  const maxVal = Math.max(maxStack, maxResp, 1);

  const n = series.length;
  const slot = pw / Math.max(n, 1);
  const barW = Math.max(slot * 0.7, 1);

  const yOf = (v: number) => pad.top + ph - (v / maxVal) * ph;

  const respPoints = series
    .map((b, i) => `${pad.left + i * slot + slot / 2},${yOf(b.responses)}`)
    .join(' ');

  const yTicks = [0, Math.round(maxVal / 2), maxVal];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      role="img"
      aria-label={t('mesh_health_req_volume_heading')}
    >
      {yTicks.map((v) => (
        <g key={v}>
          <line
            x1={pad.left}
            x2={W - pad.right}
            y1={yOf(v)}
            y2={yOf(v)}
            stroke="hsl(var(--border))"
            strokeWidth={0.5}
          />
          <text
            x={pad.left - 3}
            y={yOf(v) + 3}
            textAnchor="end"
            fontSize={8}
            fill="hsl(var(--muted-foreground))"
          >
            {v}
          </text>
        </g>
      ))}
      {series.map((b, i) => {
        const x = pad.left + i * slot + (slot - barW) / 2;
        const floodH = (b.flood / maxVal) * ph;
        const directH = (b.direct / maxVal) * ph;
        const floodY = pad.top + ph - floodH;
        const directY = floodY - directH;
        return (
          <g key={i}>
            {b.flood > 0 && (
              <rect x={x} y={floodY} width={barW} height={floodH} fill={FLOOD_COLOR} />
            )}
            {b.direct > 0 && (
              <rect x={x} y={directY} width={barW} height={directH} fill={DIRECT_COLOR} />
            )}
          </g>
        );
      })}
      {maxResp > 0 && (
        <polyline
          points={respPoints}
          fill="none"
          stroke={RESPONSE_COLOR}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function MeshRequestsPanel({ selectedWindow, refreshKey, onLoadingChange }: Props) {
  const t = useT();
  const [data, setData] = useState<RequestTrafficResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    const endTs = Math.floor(Date.now() / 1000);
    const startTs = endTs - selectedWindow.hours * 3600;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/packets/request-traffic?start_ts=${startTs}&end_ts=${endTs}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<RequestTrafficResponse>;
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
  }, [selectedWindow, refreshKey, t]);

  // Auto-refresh: only for short windows, minimum 30s cadence.
  useEffect(() => {
    if (!selectedWindow.autoRefresh) return;
    const id = setInterval(() => {
      const endTs = Math.floor(Date.now() / 1000);
      const startTs = endTs - selectedWindow.hours * 3600;
      fetch(`/api/packets/request-traffic?start_ts=${startTs}&end_ts=${endTs}`)
        .then((r) => (r.ok ? (r.json() as Promise<RequestTrafficResponse>) : null))
        .then((d) => {
          if (d) setData(d);
        })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [selectedWindow]);

  const totals = data?.totals;
  const hasData = totals != null && (totals.requests > 0 || totals.responses > 0);

  const splitItems =
    totals != null
      ? [
          { label: t('mesh_health_col_flood'), count: totals.flood_requests, color: FLOOD_COLOR },
          {
            label: t('mesh_health_col_direct'),
            count: totals.direct_requests,
            color: DIRECT_COLOR,
          },
        ].filter((x) => x.count > 0)
      : [];

  const typeItems =
    totals != null
      ? [
          {
            label: t('mesh_health_req_type_standard'),
            count: totals.requests - totals.anon_requests,
            color: 'hsl(var(--primary))',
          },
          {
            label: t('mesh_health_req_type_anon'),
            count: totals.anon_requests,
            color: 'hsl(var(--muted-foreground))',
          },
        ].filter((x) => x.count > 0)
      : [];

  return (
    <>
      <p className="text-xs text-muted-foreground">{t('mesh_health_req_caption')}</p>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
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

      {totals && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile
            label={t('mesh_health_req_stat_total')}
            value={totals.requests}
            sub={t('mesh_health_req_stat_total_sub')}
          />
          <StatTile label={t('mesh_health_req_stat_flood')} value={totals.flood_requests} />
          <StatTile label={t('mesh_health_req_stat_direct')} value={totals.direct_requests} />
          <StatTile label={t('mesh_health_req_stat_responses')} value={totals.responses} />
        </div>
      )}

      {hasData && (splitItems.length > 0 || typeItems.length > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {splitItems.length > 0 && (
            <div className="rounded border border-border bg-background p-2.5">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('mesh_health_req_split_heading')}
              </div>
              <DistBars items={splitItems} />
            </div>
          )}
          {typeItems.length > 0 && (
            <div className="rounded border border-border bg-background p-2.5">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('mesh_health_req_type_heading')}
              </div>
              <DistBars items={typeItems} />
            </div>
          )}
        </div>
      )}

      {hasData && data && data.series.some((b) => b.flood || b.direct || b.responses) && (
        <div className="rounded border border-border bg-background p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('mesh_health_req_volume_heading')}
            </div>
            <div className="flex items-center gap-2">
              <LegendDot color={FLOOD_COLOR} label={t('mesh_health_col_flood')} />
              <LegendDot color={DIRECT_COLOR} label={t('mesh_health_col_direct')} />
              <LegendDot color={RESPONSE_COLOR} label={t('mesh_health_req_legend_responses')} />
            </div>
          </div>
          <VolumeChart series={data.series} />
        </div>
      )}

      {hasData && data && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-3 py-2">
            <span className="text-sm font-semibold text-foreground">
              {t('mesh_health_req_pairs_heading')}
            </span>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {t('mesh_health_req_pairs_note')}
            </p>
          </div>
          {data.pairs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-background">
                    <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">
                      {t('mesh_health_req_col_pair')}
                    </th>
                    <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground">
                      {t('mesh_health_req_col_requests')}
                    </th>
                    <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground hidden sm:table-cell">
                      {t('mesh_health_col_flood')}
                    </th>
                    <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground hidden sm:table-cell">
                      {t('mesh_health_col_direct')}
                    </th>
                    <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground">
                      {t('mesh_health_col_last_heard')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.pairs.map((p) => (
                    <tr
                      key={`${p.src_hash}-${p.dest_hash}`}
                      className="border-b border-border last:border-0 hover:bg-background transition-colors"
                    >
                      <td className="px-2 py-1.5 font-mono text-[11px] text-foreground">
                        {p.src_hash} → {p.dest_hash}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                        {p.requests}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground hidden sm:table-cell">
                        {p.flood}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground hidden sm:table-cell">
                        {p.direct}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {relTime(p.last_ts, t)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-5 text-center text-sm text-muted-foreground">
              {t('mesh_health_req_no_pairs')}
            </div>
          )}
        </div>
      )}

      {data && !hasData && !loading && (
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {t('mesh_health_req_empty', { window: selectedWindow.label })}
        </div>
      )}
    </>
  );
}
