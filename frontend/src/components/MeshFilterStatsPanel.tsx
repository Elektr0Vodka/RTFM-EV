/**
 * MeshFilterStatsPanel.tsx
 *
 * The "Spam & bots" view of the Mesh Health page: statistics about channel
 * messages flagged as spam, malformed or duplicate, and messages from listed
 * bots. Read-only: it counts stored messages and sends nothing.
 *
 * One report (`GET /api/filter-stats`) feeds the tiles, the trend chart, the
 * offender tables, the filter section and every export. With Scramble on, the
 * report is rewritten once (`scrambleReport`) before anything renders, so the
 * page and the exports show the same codes.
 *
 * Rendered inside the MeshHealthView shell, which owns the header, the tab
 * pill, the shared time-window selector and refresh.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Contact } from '../types';
import { useT } from '../i18n';
import { AddToBotListDialog, type BotListTarget } from './AddToBotListDialog';
import { ZoomableBinChart } from './charts/ZoomableBinChart';
import { MeshFilterStatsTables } from './MeshFilterStatsTables';
import { type TimeWindow, StatTile, fmtBucketTime } from './meshHealthShared';
import { toast } from './ui/sonner';
import {
  buildJsonReport,
  buildSummaryText,
  downloadText,
  filterStatsFilename,
  getSessionScrambler,
  percent,
  scrambleReport,
  type FilterStatsBucket,
  type FilterStatsChannel,
  type FilterStatsReport,
} from '../utils/filterStatsReport';

interface Props {
  selectedWindow: TimeWindow;
  /** Incremented by the shell's refresh button to force a re-fetch. */
  refreshKey: number;
  /** Reports loading state up to the shell so the refresh spinner can reflect it. */
  onLoadingChange?: (loading: boolean) => void;
  /** Resolves a source repeater's hop to a contact when exactly one matches. */
  contacts?: Contact[];
  onOpenNode?: (publicKey: string, name: string | null) => void;
  onNavigateToMap?: (focusKey?: string) => void;
  /** The shared Mesh Health page size; 0 shows all rows. */
  pageSize?: number;
}

const SERIES = [
  { key: 'spam', color: 'hsl(var(--destructive))', labelKey: 'mesh_filter_tile_spam' },
  { key: 'malformed', color: 'hsl(var(--warning))', labelKey: 'mesh_filter_tile_malformed' },
  { key: 'duplicate', color: 'hsl(var(--info))', labelKey: 'mesh_filter_tile_duplicates' },
  { key: 'bot_now', color: 'hsl(var(--primary))', labelKey: 'mesh_filter_tile_bots' },
] as const;

const BLOCK_LABEL_KEYS: Record<string, string> = {
  manual: 'mesh_filter_block_manual',
  hop: 'mesh_filter_block_hop',
  campaign: 'mesh_filter_block_campaign',
  dedupe: 'mesh_filter_block_dedupe',
  rotation: 'mesh_filter_block_rotation',
  links: 'mesh_filter_block_links',
  lockdown: 'mesh_filter_block_lockdown',
  expired: 'mesh_filter_block_expired',
};

type TrendMode = 'count' | 'share';

function statsUrl(selectedWindow: TimeWindow, channel: string): string {
  const endTs = Math.floor(Date.now() / 1000);
  const startTs = Math.floor(endTs - selectedWindow.hours * 3600);
  const base = `./api/filter-stats?start_ts=${startTs}&end_ts=${endTs}`;
  return channel ? `${base}&channel=${encodeURIComponent(channel)}` : base;
}

// ─── Trend chart ──────────────────────────────────────────────────────────────

function TrendChart({
  series,
  mode,
  label,
}: {
  series: FilterStatsBucket[];
  mode: TrendMode;
  label: string;
}) {
  const W = 360;
  const H = 140;
  const pad = { top: 8, right: 8, bottom: 18, left: 28 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;
  const n = series.length;

  const valueOf = (bucket: FilterStatsBucket, key: (typeof SERIES)[number]['key']) =>
    mode === 'share'
      ? bucket.messages > 0
        ? (bucket[key] / bucket.messages) * 100
        : 0
      : bucket[key];
  const maxVal = Math.max(1, ...series.flatMap((b) => SERIES.map((s) => valueOf(b, s.key))));
  const xOf = (i: number) => pad.left + (n > 1 ? (i / (n - 1)) * pw : pw / 2);
  const yOf = (v: number) => pad.top + ph - (v / maxVal) * ph;
  const ticks = [0, maxVal / 2, maxVal];
  const spanSeconds = n > 1 ? series[n - 1].bucket_ts - series[0].bucket_ts : 0;
  const tickText = (v: number) => (mode === 'share' ? `${Math.round(v)}%` : `${Math.round(v)}`);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={label}>
      {ticks.map((v) => (
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
            {tickText(v)}
          </text>
        </g>
      ))}
      {SERIES.map((s) => (
        <polyline
          key={s.key}
          points={series.map((b, i) => `${xOf(i)},${yOf(valueOf(b, s.key))}`).join(' ')}
          fill="none"
          stroke={s.color}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      ))}
      {n > 0 && (
        <>
          <text x={pad.left} y={H - 5} fontSize={8} fill="hsl(var(--muted-foreground))">
            {fmtBucketTime(series[0].bucket_ts * 1000, spanSeconds)}
          </text>
          <text
            x={W - pad.right}
            y={H - 5}
            textAnchor="end"
            fontSize={8}
            fill="hsl(var(--muted-foreground))"
          >
            {fmtBucketTime(series[n - 1].bucket_ts * 1000, spanSeconds)}
          </text>
        </>
      )}
    </svg>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function BarList({ items }: { items: { label: string; count: number; color: string }[] }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span
            className="w-36 shrink-0 truncate text-[10px] text-muted-foreground"
            title={item.label}
          >
            {item.label}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(item.count / max) * 100}%`, background: item.color }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
            {item.count}
          </span>
        </div>
      ))}
    </div>
  );
}

function Card({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-background p-2.5">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {heading}
      </div>
      {children}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function MeshFilterStatsPanel({
  selectedWindow,
  refreshKey,
  onLoadingChange,
  contacts = [],
  onOpenNode,
  onNavigateToMap,
  pageSize = 50,
}: Props) {
  const t = useT();
  const [raw, setRaw] = useState<FilterStatsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState('');
  // The channels of the last unfiltered answer, so the filter keeps its options.
  const [knownChannels, setKnownChannels] = useState<FilterStatsChannel[]>([]);
  const [scramble, setScramble] = useState(false);
  const [trendMode, setTrendMode] = useState<TrendMode>('count');
  const [botTarget, setBotTarget] = useState<BotListTarget | null>(null);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  const accept = useCallback((report: FilterStatsReport) => {
    setRaw(report);
    if (report.window.channel === null) setKnownChannels(report.channels);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(statsUrl(selectedWindow, channel))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<FilterStatsReport>;
      })
      .then((report) => {
        if (cancelled) return;
        accept(report);
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
  }, [selectedWindow, refreshKey, channel, accept, t]);

  // Auto-refresh: only for short windows, minimum 30s cadence.
  useEffect(() => {
    if (!selectedWindow.autoRefresh) return;
    const id = setInterval(() => {
      fetch(statsUrl(selectedWindow, channel))
        .then((r) => (r.ok ? (r.json() as Promise<FilterStatsReport>) : null))
        .then((report) => {
          if (report) accept(report);
        })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [selectedWindow, channel, accept]);

  const report = useMemo(
    () => (raw && scramble ? scrambleReport(raw, getSessionScrambler()) : raw),
    [raw, scramble]
  );

  // Same codes as scrambleReport gives: both ask the session table by channel key.
  const channelOptions = useMemo(
    () =>
      knownChannels.map((c) => ({
        key: c.key,
        label:
          scramble && !c.public
            ? getSessionScrambler().channel(c.key)
            : c.name || t('mesh_filter_channel_unknown'),
      })),
    [knownChannels, scramble, t]
  );

  const channelLabel =
    channelOptions.find((option) => option.key === channel)?.label ?? t('mesh_filter_channel_all');

  const copySummary = async () => {
    if (!report) return;
    const text = buildSummaryText(report, t, { windowLabel: selectedWindow.label, channelLabel });
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('mesh_filter_summary_copied'));
    } catch {
      toast.error(t('mesh_filter_copy_failed'));
    }
  };

  const downloadJson = () => {
    if (!report) return;
    const at = new Date();
    downloadText(
      filterStatsFilename('report', 'json', at),
      buildJsonReport(report, { generatedAt: at, channelLabel, scrambled: scramble }),
      'application/json'
    );
  };

  const totals = report?.totals;
  const filters = report?.filters;
  const hasData = totals != null && totals.messages > 0;
  const share = (count: number) =>
    t('mesh_filter_share_of_traffic', { percent: percent(count, totals?.messages ?? 0) });

  const controlClass =
    'rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40';

  return (
    <>
      <p className="text-xs text-muted-foreground">{t('mesh_filter_caption')}</p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('mesh_filter_channel_label')}
          <select
            aria-label={t('mesh_filter_channel_label')}
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            className="rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground"
          >
            <option value="">{t('mesh_filter_channel_all')}</option>
            {channelOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          title={t('mesh_filter_scramble_hint')}
        >
          <input
            type="checkbox"
            aria-label={t('mesh_filter_scramble')}
            checked={scramble}
            onChange={(event) => setScramble(event.target.checked)}
          />
          {t('mesh_filter_scramble')}
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={!hasData}
            onClick={() => void copySummary()}
            className={controlClass}
          >
            {t('mesh_filter_copy_summary')}
          </button>
          <button type="button" disabled={!hasData} onClick={downloadJson} className={controlClass}>
            {t('mesh_filter_download_json')}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && !report && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded border border-border bg-background"
            />
          ))}
        </div>
      )}

      {report && totals && hasData && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5" data-testid="filter-stats-tiles">
          <StatTile label={t('mesh_filter_tile_messages')} value={totals.messages} />
          <StatTile
            label={t('mesh_filter_tile_spam')}
            value={totals.spam}
            sub={share(totals.spam)}
          />
          <StatTile
            label={t('mesh_filter_tile_malformed')}
            value={totals.malformed}
            sub={share(totals.malformed)}
          />
          <StatTile
            label={t('mesh_filter_tile_duplicates')}
            value={totals.duplicate}
            sub={share(totals.duplicate)}
          />
          <StatTile
            label={t('mesh_filter_tile_bots')}
            value={totals.bot_now}
            sub={
              report.bot_lists_enabled
                ? t('mesh_filter_bots_flagged_sub', {
                    percent: percent(totals.bot_now, totals.messages),
                    count: totals.bot_flagged,
                  })
                : t('mesh_filter_bots_none_enabled')
            }
          />
        </div>
      )}

      {report && totals && hasData && totals.bot_listed_later + totals.bot_no_longer_listed > 0 && (
        <p className="text-[10px] text-muted-foreground">
          {t('mesh_filter_bots_difference', {
            later: totals.bot_listed_later,
            gone: totals.bot_no_longer_listed,
          })}
        </p>
      )}

      {report && hasData && (
        <div className="rounded border border-border bg-background p-2.5">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('mesh_filter_trend_heading')}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {SERIES.map((s) => (
                <span
                  key={s.key}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground"
                >
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ backgroundColor: s.color }}
                  />
                  {t(s.labelKey)}
                </span>
              ))}
              <div className="flex gap-1 rounded-md bg-muted p-0.5">
                {(['count', 'share'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTrendMode(mode)}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      trendMode === mode
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t(mode === 'count' ? 'mesh_filter_trend_counts' : 'mesh_filter_trend_share')}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <ZoomableBinChart items={report.series} plotLeftFrac={28 / 360}>
            {(visible) => (
              <TrendChart
                series={visible}
                mode={trendMode}
                label={t('mesh_filter_trend_heading')}
              />
            )}
          </ZoomableBinChart>
        </div>
      )}

      {report && hasData && (
        <MeshFilterStatsTables
          report={report}
          contacts={contacts}
          pageSize={pageSize}
          scrambled={scramble}
          onOpenNode={scramble ? undefined : onOpenNode}
          onNavigateToMap={onNavigateToMap}
          onAddToBotList={(sender) =>
            setBotTarget({
              id: Date.now(),
              type: 'CHAN',
              sender_name: sender.name,
              text: '',
              sender_key: sender.public_key,
            })
          }
        />
      )}

      {report && totals && filters && hasData && (
        <div className="space-y-3" data-testid="filter-stats-filters">
          <div className="text-sm font-semibold text-foreground">
            {t('mesh_filter_filters_heading')}
          </div>
          {!report.spam_guard_enabled && (
            <p className="text-xs text-muted-foreground">
              {t('mesh_filter_sg_off')}{' '}
              <a href="#spam-guard" className="underline hover:text-foreground">
                {t('mesh_filter_open_spam_guard')}
              </a>
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filters.analysed > 0 && (
              <Card heading={t('mesh_filter_outcome_heading')}>
                <BarList
                  items={[
                    {
                      label: t('mesh_filter_outcome_stopped'),
                      count: filters.enforced,
                      color: 'hsl(var(--success))',
                    },
                    {
                      label: t('mesh_filter_outcome_would_stop'),
                      count: filters.not_enforced,
                      color: 'hsl(var(--info))',
                    },
                    {
                      label: t('mesh_filter_outcome_let_through'),
                      count: filters.let_through,
                      color: 'hsl(var(--destructive))',
                    },
                    {
                      label: t('mesh_filter_outcome_held'),
                      count: filters.held,
                      color: 'hsl(var(--warning))',
                    },
                    {
                      label: t('mesh_filter_outcome_clean'),
                      count: filters.clean,
                      color: 'hsl(var(--muted-foreground))',
                    },
                  ]}
                />
                {filters.stop_rate !== null && (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {t('mesh_filter_stop_rate', { percent: filters.stop_rate })}
                  </p>
                )}
                {filters.flagged_later > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    {t('mesh_filter_flagged_later', { count: filters.flagged_later })}
                  </p>
                )}
              </Card>
            )}
            {filters.blocks.length > 0 && (
              <Card heading={t('mesh_filter_caught_by_heading')}>
                <BarList
                  items={filters.blocks.map((block) => ({
                    label: t(BLOCK_LABEL_KEYS[block.source] ?? 'mesh_filter_block_expired'),
                    count: block.count,
                    color: 'hsl(var(--primary))',
                  }))}
                />
              </Card>
            )}
            {filters.confirmed + filters.missed + filters.false_positive > 0 && (
              <Card heading={t('mesh_filter_labels_heading')}>
                <BarList
                  items={[
                    {
                      label: t('mesh_filter_label_confirmed'),
                      count: filters.confirmed,
                      color: 'hsl(var(--success))',
                    },
                    {
                      label: t('mesh_filter_label_missed'),
                      count: filters.missed,
                      color: 'hsl(var(--destructive))',
                    },
                    {
                      label: t('mesh_filter_label_false_positive'),
                      count: filters.false_positive,
                      color: 'hsl(var(--warning))',
                    },
                  ]}
                />
              </Card>
            )}
            {totals.malformed > 0 && (
              <Card heading={t('mesh_filter_cause_heading')}>
                <BarList
                  items={[
                    { label: t('mesh_filter_cause_text'), count: totals.malformed_text },
                    { label: t('mesh_filter_cause_clock'), count: totals.malformed_clock },
                    { label: t('mesh_filter_cause_both'), count: totals.malformed_both },
                    { label: t('mesh_filter_cause_unknown'), count: totals.malformed_unknown },
                  ]
                    .filter((item) => item.count > 0)
                    .map((item) => ({ ...item, color: 'hsl(var(--warning))' }))}
                />
              </Card>
            )}
          </div>
          {report.policy_rules.length > 0 && (
            <Card heading={t('mesh_filter_policy_heading')}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 font-semibold">{t('mesh_filter_col_rule')}</th>
                    <th className="py-1 font-semibold">{t('mesh_filter_col_action')}</th>
                    <th className="py-1 text-right font-semibold">
                      {t('mesh_filter_col_packets')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.policy_rules.map((rule) => (
                    <tr key={`${rule.action}-${rule.rule ?? ''}`}>
                      <td className="py-0.5 font-mono text-[11px] text-foreground">
                        {rule.rule ?? t('mesh_filter_policy_default')}
                      </td>
                      <td className="py-0.5 text-muted-foreground">{rule.action}</td>
                      <td className="py-0.5 text-right tabular-nums text-muted-foreground">
                        {rule.packets}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {filters.not_recorded > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {t('mesh_filter_not_recorded', { count: filters.not_recorded })}
            </p>
          )}
        </div>
      )}

      {report && !hasData && !loading && (
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {t('mesh_filter_empty', { window: selectedWindow.label })}
        </div>
      )}

      <AddToBotListDialog message={botTarget} onClose={() => setBotTarget(null)} />
    </>
  );
}
