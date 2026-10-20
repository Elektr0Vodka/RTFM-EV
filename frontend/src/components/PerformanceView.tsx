/**
 * PerformanceView.tsx
 *
 * Performance page: the backend watching itself. Polls GET /api/perf/snapshot
 * every 5 s and GET /api/perf/history for the charts (every 5 s up to an
 * hour, every minute for longer ranges); both pause while the tab is hidden.
 * Overview is the NOC view; the other tabs show the full version of one card.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cpu, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useT } from '../i18n';
import { PerfSeriesChart, SERIES_COLORS } from './performance/PerfCharts';
import {
  PerfAsyncioTasks,
  PerfCard,
  PerfDatabase,
  PerfHealthStrip,
  PerfLogs,
  PerfOutputs,
  PerfPacketTypes,
  PerfPipeline,
  PerfRadio,
  PerfRoutes,
  PerfStalls,
  PerfTasks,
  PerfTiles,
} from './performance/PerfSections';
import { fmtCount, fmtMb, fmtMs, fmtPct } from './performance/perfFormat';
import type { PerfHistory, PerfRange, PerfSnapshot } from './performance/perfTypes';

type PerfTab =
  | 'overview'
  | 'loop'
  | 'tasks'
  | 'pipeline'
  | 'database'
  | 'radio'
  | 'outputs'
  | 'requests'
  | 'logs';

const TABS: PerfTab[] = [
  'overview',
  'loop',
  'tasks',
  'pipeline',
  'database',
  'radio',
  'outputs',
  'requests',
  'logs',
];
const RANGES: { id: PerfRange; labelKey: string; seconds: number }[] = [
  { id: 'live', labelKey: 'perf_range_live', seconds: 300 },
  { id: '15m', labelKey: 'perf_range_15m', seconds: 900 },
  { id: '1h', labelKey: 'time_range_1h', seconds: 3600 },
  { id: '6h', labelKey: 'time_range_6h', seconds: 6 * 3600 },
  { id: '24h', labelKey: 'time_range_24h', seconds: 86400 },
  { id: '7d', labelKey: 'time_range_7d', seconds: 7 * 86400 },
  { id: '30d', labelKey: 'time_range_30d', seconds: 30 * 86400 },
];
const SNAPSHOT_EVERY_MS = 5000;
const TAB_KEY = 'rtfm-perf-tab';
const RANGE_KEY = 'rtfm-perf-range';
const LAG_STALL_MS = 100;

function loadStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** Calls `fn` now and every `ms` while the page is visible. */
function usePolling(fn: () => void, ms: number, deps: unknown[]) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer != null) return;
      fnRef.current();
      timer = setInterval(() => fnRef.current(), ms);
    };
    const stop = () => {
      if (timer != null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}

export function PerformanceView() {
  const t = useT();
  const [tab, setTab] = useState<PerfTab>(() => loadStored(TAB_KEY, TABS, 'overview'));
  const [range, setRange] = useState<PerfRange>(() =>
    loadStored(
      RANGE_KEY,
      RANGES.map((r) => r.id),
      '1h'
    )
  );
  const [snap, setSnap] = useState<PerfSnapshot | null>(null);
  const [history, setHistory] = useState<PerfHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => saveStored(TAB_KEY, tab), [tab]);
  useEffect(() => saveStored(RANGE_KEY, range), [range]);

  const loadSnapshot = useCallback(() => {
    setLoading(true);
    api
      .getPerfSnapshot()
      .then((s) => {
        setSnap(s);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const loadHistory = useCallback(() => {
    api
      .getPerfHistory(range)
      .then((h) => setHistory(h))
      .catch(() => {
        /* the snapshot error banner covers a backend that is down */
      });
  }, [range]);

  const rangeSeconds = RANGES.find((r) => r.id === range)?.seconds ?? 3600;
  usePolling(loadSnapshot, SNAPSHOT_EVERY_MS, [refreshKey]);
  usePolling(loadHistory, rangeSeconds <= 3600 ? SNAPSHOT_EVERY_MS : 60_000, [range, refreshKey]);

  // Points for the selected range; ignore a response for a range no longer selected.
  const points = useMemo(
    () => (history && history.range === range ? history.points : []),
    [history, range]
  );
  const overdue = snap?.tasks.filter((x) => x.state === 'overdue').length ?? 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t('perf_page_title')}</h2>
        </div>
        <div className="flex flex-wrap gap-1 rounded-md bg-muted p-0.5" role="tablist">
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                tab === key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(`perf_tab_${key}`)}
              {key === 'tasks' && overdue > 0 && (
                <span className="ml-1.5 rounded-full bg-warning px-1.5 text-[10px] font-bold text-warning-foreground">
                  {overdue}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[10px] text-muted-foreground sm:inline">
            {t('perf_auto_refresh')}
          </span>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {t('repeater_refresh')}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-3 p-4">
          <div
            className="flex flex-wrap items-center gap-1"
            role="group"
            aria-label={t('perf_range_label')}
          >
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.id)}
                aria-pressed={range === r.id}
                className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                  range === r.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(r.labelKey)}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-muted-foreground">
              {t('perf_sampling_note')}
            </span>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {t('perf_load_error', { error })}
            </div>
          )}

          {!snap ? (
            !error && <p className="text-sm text-muted-foreground">{t('perf_loading')}</p>
          ) : (
            <PerfTabBody tab={tab} snap={snap} points={points} rangeSeconds={rangeSeconds} />
          )}
        </div>
      </div>
    </div>
  );
}

function PerfTabBody({
  tab,
  snap,
  points,
  rangeSeconds,
}: {
  tab: PerfTab;
  snap: PerfSnapshot;
  points: PerfHistory['points'];
  rangeSeconds: number;
}) {
  const t = useT();
  // Charts span the selected window, ending at the snapshot time.
  const full: [number, number] = [snap.generated_at - rangeSeconds, snap.generated_at];
  const charts = {
    cpu: (
      <PerfCard title={t('perf_chart_cpu')} key="cpu">
        <PerfSeriesChart
          points={points}
          full={full}
          ariaLabel={t('perf_chart_cpu')}
          series={[{ key: 'cpu', label: t('perf_series_cpu'), color: SERIES_COLORS.primary }]}
          format={(v) => fmtPct(v)}
        />
      </PerfCard>
    ),
    memory: (
      <PerfCard title={t('perf_chart_memory')} key="memory">
        <PerfSeriesChart
          points={points}
          full={full}
          ariaLabel={t('perf_chart_memory')}
          series={[{ key: 'rss_mb', label: t('perf_series_rss'), color: SERIES_COLORS.info }]}
          format={(v) => fmtMb(v)}
        />
      </PerfCard>
    ),
    lag: (
      <PerfCard title={t('perf_chart_lag')} aside={t('perf_chart_lag_hint')} key="lag">
        <PerfSeriesChart
          points={points}
          full={full}
          ariaLabel={t('perf_chart_lag')}
          threshold={LAG_STALL_MS}
          series={[
            { key: 'lag_p50', label: 'p50', color: SERIES_COLORS.success },
            { key: 'lag_p95', label: 'p95', color: SERIES_COLORS.warning },
            { key: 'lag_max', label: t('perf_series_max'), color: SERIES_COLORS.destructive },
          ]}
          format={(v) => fmtMs(v)}
        />
      </PerfCard>
    ),
    latency: (
      <PerfCard title={t('perf_chart_latency')} key="latency">
        <PerfSeriesChart
          points={points}
          full={full}
          ariaLabel={t('perf_chart_latency')}
          series={[
            { key: 'db_p95', label: t('perf_series_db'), color: SERIES_COLORS.primary },
            { key: 'radio_p95', label: t('perf_series_radio'), color: SERIES_COLORS.warning },
            { key: 'http_p95', label: t('perf_series_http'), color: SERIES_COLORS.info },
          ]}
          format={(v) => fmtMs(v)}
        />
      </PerfCard>
    ),
    packets: (
      <PerfCard title={t('perf_chart_packets')} key="packets">
        <PerfSeriesChart
          points={points}
          full={full}
          ariaLabel={t('perf_chart_packets')}
          series={[{ key: 'pkts', label: t('perf_series_packets'), color: SERIES_COLORS.primary }]}
          format={(v) => fmtCount(v)}
        />
      </PerfCard>
    ),
    warnings: (
      <PerfCard title={t('perf_chart_warnings')} key="warnings">
        <PerfSeriesChart
          points={points}
          full={full}
          ariaLabel={t('perf_chart_warnings')}
          series={[
            { key: 'warnings', label: t('perf_series_warnings'), color: SERIES_COLORS.warning },
            { key: 'stalls', label: t('perf_series_stalls'), color: SERIES_COLORS.destructive },
          ]}
          format={(v) => fmtCount(v)}
        />
      </PerfCard>
    ),
  };
  const two = 'grid grid-cols-1 gap-3 lg:grid-cols-2';

  switch (tab) {
    case 'overview':
      return (
        <>
          <PerfHealthStrip snap={snap} />
          <PerfTiles snap={snap} points={points} />
          <div className={two}>
            {charts.cpu}
            {charts.memory}
          </div>
          <div className={two}>
            {charts.lag}
            {charts.latency}
          </div>
          <PerfPipeline snap={snap} />
          <PerfTasks snap={snap} />
          <div className={two}>
            <PerfDatabase snap={snap} limit={5} />
            <PerfOutputs snap={snap} />
          </div>
          <div className={two}>
            <PerfRoutes snap={snap} limit={6} />
            <PerfRadio snap={snap} limit={4} />
          </div>
          <PerfLogs snap={snap} limit={8} />
        </>
      );
    case 'loop':
      return (
        <>
          {charts.lag}
          <PerfStalls snap={snap} />
        </>
      );
    case 'tasks':
      return (
        <>
          <PerfTasks snap={snap} full />
          <PerfAsyncioTasks snap={snap} />
        </>
      );
    case 'pipeline':
      return (
        <>
          <PerfPipeline snap={snap} />
          {charts.packets}
          <PerfPacketTypes snap={snap} />
        </>
      );
    case 'database':
      return (
        <>
          {charts.latency}
          <PerfDatabase snap={snap} />
        </>
      );
    case 'radio':
      return (
        <>
          {charts.latency}
          <PerfRadio snap={snap} />
        </>
      );
    case 'outputs':
      return <PerfOutputs snap={snap} />;
    case 'requests':
      return (
        <>
          {charts.latency}
          <PerfRoutes snap={snap} />
        </>
      );
    case 'logs':
      return (
        <>
          {charts.warnings}
          <PerfLogs snap={snap} />
        </>
      );
  }
}
