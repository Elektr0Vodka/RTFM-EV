/**
 * Tools > SNMP > one node (`#snmp/<public key>`): its state, the values of the
 * newest poll and graphs of the stored polls over a time range.
 *
 * Like the overview it reads stored data, and "Poll now" goes through the per
 * contact poll endpoint (UDP on the LAN). Nothing here uses the radio.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSeriesColor } from '../hooks/useCvdColors';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { api, isAbortError } from '../api';
import { useT, type TFn } from '../i18n';
import { cn } from '@/lib/utils';
import type { ChartWindow } from '../lib/chartZoom';
import type { SnmpHistoryEntry, SnmpNodeOverview } from '../types';
import { CUSTOM_RANGE_ID, resolveRange } from '../utils/timeRanges';
import { loadStoredTimeRange, saveStoredTimeRange } from '../utils/timeRangePreference';
import { contactTypeLabel } from './ContactInfoBody';
import { formatDuration } from './repeater/repeaterPaneShared';
import { TimeRangeSelector } from './TimeRangeSelector';
import { StatTile } from './meshHealthShared';
import { Button } from './ui/button';
import { SnmpRefreshSelect, useSnmpRefreshSeconds } from './snmp/SnmpRefreshSelect';
import { SnmpSeriesChart, type SnmpChartSeries } from './snmp/SnmpSeriesChart';
import { SnmpValueGroups } from './snmp/SnmpValueGroups';
import {
  COMPANION_FILTER_KEYS,
  FILTER_DROP_KEYS,
  SNMP_FIELDS,
  SNMP_GROUPS,
  formatResetReasonCode,
  formatSnmpTime,
  formatSnmpValue,
  type SnmpField,
  type SnmpGroup,
} from './snmp/snmpFields';
import { SnmpStatusBadge, applySnmpPoll, snmpNodeName, snmpNodeStatus } from './snmp/snmpNode';
import { listReboots, ratePoints, toChartPoints, type SnmpReboot } from './snmp/snmpSeries';

const WINDOW_STORAGE_KEY = 'rtfm-snmp-node-window';
const DEFAULT_WINDOW_ID = '24h';
const COUNTER_MODE_STORAGE_KEY = 'rtfm-snmp-node-counters';
const SERIES_COLORS = [
  '#0ea5e9',
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
  '#84cc16',
  '#6366f1',
  '#a16207',
];
const NO_VALUE = '-';

type CounterMode = 'rates' | 'totals';

/**
 * gauge: plotted as stored. counter: only goes up since boot, shown per minute
 * in rates mode. airtime: a seconds (or milliseconds) counter, shown as a
 * share of the time.
 */
type ChartKind = 'gauge' | 'counter' | 'airtime';

interface ChartDef {
  id: string;
  group: SnmpGroup;
  kind: ChartKind;
  keys: string[];
  /** Needed with more than one series; a single series takes its field label. */
  titleKey?: string;
  /** Left out when the node never reported more than zero (no PSRAM fitted). */
  hideWhenZero?: boolean;
  /**
   * Left out when no stored poll has a value for it: an OID added after the
   * first firmware release that this node does not serve.
   */
  optional?: boolean;
  /** Series that never went above zero are left out (filter rules that dropped nothing). */
  hideZeroSeries?: boolean;
}

const CHARTS: ChartDef[] = [
  { id: 'uptime', group: 'system', kind: 'gauge', keys: ['uptime_secs'] },
  { id: 'battery', group: 'system', kind: 'gauge', keys: ['battery_mv'], optional: true },
  { id: 'mcu_temp', group: 'system', kind: 'gauge', keys: ['mcu_temp_c'], optional: true },
  {
    id: 'packets',
    group: 'radio',
    kind: 'counter',
    keys: ['packets_recv', 'packets_sent'],
    titleKey: 'snmp_node_chart_packets',
  },
  {
    id: 'recv_route',
    group: 'radio',
    kind: 'counter',
    keys: ['recv_flood', 'recv_direct'],
    titleKey: 'snmp_node_chart_recv_route',
  },
  {
    id: 'sent_route',
    group: 'radio',
    kind: 'counter',
    keys: ['sent_flood', 'sent_direct'],
    titleKey: 'snmp_node_chart_sent_route',
  },
  { id: 'recv_errors', group: 'radio', kind: 'counter', keys: ['recv_errors'] },
  { id: 'air_time', group: 'radio', kind: 'airtime', keys: ['total_air_time_secs'] },
  {
    id: 'rx_air_time',
    group: 'radio',
    kind: 'airtime',
    keys: ['rx_air_time_secs'],
    optional: true,
  },
  { id: 'tx_duty', group: 'radio', kind: 'gauge', keys: ['tx_duty_percent'], optional: true },
  { id: 'tx_queue', group: 'radio', kind: 'gauge', keys: ['tx_queue_len'], optional: true },
  {
    id: 'dups',
    group: 'radio',
    kind: 'counter',
    keys: ['flood_dups', 'direct_dups'],
    titleKey: 'snmp_node_chart_dups',
    optional: true,
  },
  { id: 'noise_floor', group: 'radio', kind: 'gauge', keys: ['noise_floor'] },
  { id: 'last_rssi', group: 'radio', kind: 'gauge', keys: ['last_rssi'] },
  { id: 'last_snr', group: 'radio', kind: 'gauge', keys: ['last_snr'] },
  { id: 'mqtt_slots', group: 'mqtt', kind: 'gauge', keys: ['mqtt_connected_slots'] },
  { id: 'mqtt_queue', group: 'mqtt', kind: 'gauge', keys: ['mqtt_queue_depth'] },
  { id: 'mqtt_skipped', group: 'mqtt', kind: 'counter', keys: ['mqtt_skipped_publishes'] },
  {
    id: 'memory',
    group: 'memory',
    kind: 'gauge',
    keys: ['free_heap', 'max_alloc', 'internal_free'],
    titleKey: 'snmp_node_chart_memory',
  },
  { id: 'min_free_heap', group: 'memory', kind: 'gauge', keys: ['min_free_heap'], optional: true },
  { id: 'psram', group: 'memory', kind: 'gauge', keys: ['psram_free'], hideWhenZero: true },
  { id: 'wifi_rssi', group: 'network', kind: 'gauge', keys: ['wifi_rssi'] },
  {
    id: 'dc_gate_level',
    group: 'duty_gate',
    kind: 'gauge',
    keys: ['dc_gate_level'],
    optional: true,
  },
  {
    id: 'filter_drops',
    group: 'filter',
    kind: 'counter',
    keys: FILTER_DROP_KEYS,
    titleKey: 'snmp_node_chart_filter_drops',
    optional: true,
    hideZeroSeries: true,
  },
  {
    id: 'filter_air_saved',
    group: 'filter',
    kind: 'airtime',
    keys: ['filter_air_saved_ms'],
    optional: true,
  },
  {
    id: 'neighbours',
    group: 'neighbours',
    kind: 'gauge',
    keys: ['neighbour_count'],
    optional: true,
  },
  {
    id: 'companion_clients',
    group: 'companion',
    kind: 'gauge',
    keys: ['companion_tcp_clients', 'companion_ws_clients'],
    titleKey: 'snmp_node_chart_companion_clients',
    optional: true,
  },
  {
    id: 'companion_store',
    group: 'companion',
    kind: 'gauge',
    keys: ['companion_contacts', 'companion_channels'],
    titleKey: 'snmp_node_chart_companion_store',
    optional: true,
  },
  {
    id: 'cfilter',
    group: 'companion_filter',
    kind: 'counter',
    keys: COMPANION_FILTER_KEYS,
    titleKey: 'snmp_node_chart_cfilter',
    optional: true,
    hideZeroSeries: true,
  },
];

const TILE_KEYS = [
  'uptime_secs',
  'firmware_version',
  'free_heap',
  'wifi_rssi',
  'noise_floor',
  'mqtt_connected_slots',
];

const FIELD_BY_KEY = new Map<string, SnmpField>(SNMP_FIELDS.map((field) => [field.key, field]));

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function loadCounterMode(): CounterMode {
  try {
    return localStorage.getItem(COUNTER_MODE_STORAGE_KEY) === 'totals' ? 'totals' : 'rates';
  } catch {
    return 'rates';
  }
}

function saveCounterMode(mode: CounterMode): void {
  try {
    localStorage.setItem(COUNTER_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage write failures (private mode, disabled storage).
  }
}

/** `datetime-local` text to Unix seconds, or null when it is not a date. */
function toSeconds(text: string): number | null {
  if (!text) return null;
  const ms = new Date(text).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function formatRate(value: number): string {
  if (value < 10) return value.toFixed(2);
  return value < 100 ? value.toFixed(1) : String(Math.round(value));
}

interface BuiltChart {
  def: ChartDef;
  title: string;
  series: SnmpChartSeries[];
  format: (value: number) => string;
  /** Short axis labels where the raw number is hard to read (seconds, bytes). */
  tickFormat?: (value: number) => string;
}

function axisTickFormat(field: SnmpField): ((value: number) => string) | undefined {
  if (field.unit === 'seconds') return (value) => formatDuration(Math.max(0, Math.round(value)));
  if (field.unit === 'milliseconds') {
    return (value) => formatDuration(Math.max(0, Math.round(value / 1000)));
  }
  if (field.unit === 'bytes') return (value) => `${Math.round(value / 1024)}K`;
  if (field.unit === 'millivolts') return (value) => `${(value / 1000).toFixed(2)}V`;
  return undefined;
}

/** True when some poll has a real number for the field (not missing, not its sentinel). */
function hasData(history: SnmpHistoryEntry[], field: SnmpField): boolean {
  return history.some((entry) => {
    const value = entry.values[field.key];
    return typeof value === 'number' && value !== field.sentinel;
  });
}

function buildChart(
  def: ChartDef,
  history: SnmpHistoryEntry[],
  mode: CounterMode,
  t: TFn,
  seriesColor: (i: number, offColor: string) => string
): BuiltChart | null {
  let fields = def.keys.flatMap((key) => FIELD_BY_KEY.get(key) ?? []);
  if (def.optional) fields = fields.filter((field) => hasData(history, field));
  if (def.hideZeroSeries) {
    fields = fields.filter((field) =>
      history.some((entry) => Number(entry.values[field.key] ?? 0) > 0)
    );
  }
  if (fields.length === 0) return null;
  if (
    def.hideWhenZero &&
    !history.some((entry) => def.keys.some((key) => Number(entry.values[key] ?? 0) > 0))
  ) {
    return null;
  }
  const asRate = mode === 'rates' && def.kind !== 'gauge';
  // Seconds on air per 100 seconds is a percentage; for milliseconds that is
  // per 100 000 ms, so a tenth of the per-second rate.
  const airScale = fields[0].unit === 'milliseconds' ? 0.1 : 100;
  const scale = def.kind === 'airtime' ? airScale : 60;
  const series = fields.map((field, index) => ({
    key: field.key,
    label: t(field.labelKey),
    color: seriesColor(index, SERIES_COLORS[index % SERIES_COLORS.length]),
    points: asRate
      ? ratePoints(history, field.key, scale)
      : toChartPoints(history, field.key, field.sentinel),
  }));
  const baseTitle = def.titleKey ? t(def.titleKey) : t(fields[0].labelKey);
  let title = baseTitle;
  let format = (value: number) => formatSnmpValue(fields[0], { [fields[0].key]: value }, t);
  if (asRate && def.kind === 'airtime') {
    title = t('snmp_node_title_percent', { title: baseTitle });
    format = (value) => t('snmp_node_value_percent', { value: value.toFixed(2) });
  } else if (asRate) {
    title = t('snmp_node_title_per_minute', { title: baseTitle });
    format = (value) => t('snmp_node_value_per_minute', { value: formatRate(value) });
  }
  return { def, title, series, format, tickFormat: asRate ? undefined : axisTickFormat(fields[0]) };
}

function ChartCard({ chart, full }: { chart: BuiltChart; full: ChartWindow }) {
  const t = useT();
  const enough = chart.series.some((s) => s.points.length >= 2);
  const single = chart.series.length === 1;
  const latest = (s: SnmpChartSeries) =>
    s.points.length > 0 ? chart.format(s.points[s.points.length - 1].value) : NO_VALUE;
  return (
    <div
      data-testid={`snmp-chart-${chart.def.id}`}
      className="flex flex-col gap-1 overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex items-baseline justify-between gap-2 px-2.5 pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {chart.title}
        </span>
        {single && (
          <span className="text-[10px] tabular-nums text-foreground">
            {latest(chart.series[0])}
          </span>
        )}
      </div>
      {!single && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2.5 text-[10px] text-muted-foreground">
          {chart.series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: s.color }}
                aria-hidden
              />
              <span>{s.label}</span>
              <span className="tabular-nums text-foreground">{latest(s)}</span>
            </span>
          ))}
        </div>
      )}
      <div className="px-1 pb-1.5">
        {enough ? (
          <SnmpSeriesChart
            series={chart.series}
            format={chart.format}
            ariaLabel={t('snmp_history_chart_label', { value: chart.title })}
            full={full}
            tickFormat={chart.tickFormat}
          />
        ) : (
          <p className="px-1.5 py-6 text-center text-[0.6875rem] text-muted-foreground">
            {t('snmp_history_empty')}
          </p>
        )}
      </div>
    </div>
  );
}

/** The reset reason of a reboot: the node's text, else its decoded code. */
function rebootReason(reboot: SnmpReboot, t: TFn): string {
  if (reboot.reason) return reboot.reason;
  if (reboot.code !== null) return formatResetReasonCode(reboot.code, t);
  return t('snmp_node_reboot_reason_unknown');
}

/** Each reboot in the period (uptime went down), newest first, with its reset reason. */
function RebootList({ reboots }: { reboots: SnmpReboot[] }) {
  const t = useT();
  return (
    <section data-testid="snmp-node-reboots">
      <h3 className="mb-1 text-xs font-semibold text-foreground">{t('snmp_node_reboots')}</h3>
      <ul className="space-y-0.5 rounded-lg border border-border bg-card px-3 py-2 text-xs">
        {[...reboots].reverse().map((reboot) => (
          <li key={reboot.time} className="flex flex-wrap gap-x-3">
            <span className="tabular-nums text-muted-foreground">
              {formatSnmpTime(reboot.time)}
            </span>
            <span>{rebootReason(reboot, t)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SnmpNodeView({
  publicKey,
  onBack,
  onOpenContactInfo,
}: {
  publicKey: string;
  /** Back to the overview of all SNMP nodes. */
  onBack: () => void;
  /** Opens the contact's page, where its SNMP settings live. */
  onOpenContactInfo: (publicKey: string) => void;
}) {
  const t = useT();
  // undefined: still loading. null: this contact has no SNMP settings.
  const [node, setNode] = useState<SnmpNodeOverview | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<SnmpHistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [counterMode, setCounterMode] = useState<CounterMode>(loadCounterMode);
  const [refreshSeconds, setRefreshSeconds] = useSnmpRefreshSeconds();
  // Bumped to load the history again (refresh, auto refresh, after a poll).
  const [reload, setReload] = useState(0);

  const stored = useMemo(() => loadStoredTimeRange(WINDOW_STORAGE_KEY, DEFAULT_WINDOW_ID), []);
  const [windowId, setWindowId] = useState(stored.id);
  const [customStart, setCustomStart] = useState(stored.customStart);
  const [customEnd, setCustomEnd] = useState(stored.customEnd);
  // The custom period in use; typing in the date fields does not load anything
  // until Apply.
  const [appliedCustom, setAppliedCustom] = useState<{ start: number; end: number } | null>(() => {
    const start = toSeconds(stored.customStart);
    const end = toSeconds(stored.customEnd);
    return start !== null && end !== null && end > start ? { start, end } : null;
  });
  const pollInFlight = useRef(false);

  const loadNode = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const rows = await api.snmpNodes(signal);
        setNode(rows.find((row) => row.public_key === publicKey) ?? null);
        setLoadError(null);
      } catch (err) {
        if (isAbortError(err)) return;
        setLoadError(errorMessage(err));
      }
    },
    [publicKey]
  );

  useEffect(() => {
    const controller = new AbortController();
    setNode(undefined);
    setHistory(null);
    void loadNode(controller.signal);
    return () => controller.abort();
  }, [loadNode]);

  // Only for the node this page is about, never for one loaded under another key.
  const hasNode = node?.public_key === publicKey;
  const isCustom = windowId === CUSTOM_RANGE_ID;
  useEffect(() => {
    if (!hasNode) return;
    // A preset runs up to now, so only its start is sent; a custom period has both ends.
    const range = isCustom
      ? appliedCustom && { startTs: appliedCustom.start, endTs: appliedCustom.end }
      : resolveRange(windowId);
    if (!range) {
      // Custom without a period yet: nothing to load until Apply.
      setHistory([]);
      return;
    }
    const controller = new AbortController();
    api
      .snmpHistoryRange(
        publicKey,
        range.startTs,
        isCustom ? range.endTs : undefined,
        controller.signal
      )
      .then((rows) => {
        setHistory(rows);
        setHistoryError(null);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setHistoryError(errorMessage(err));
      });
    return () => controller.abort();
  }, [publicKey, hasNode, windowId, isCustom, appliedCustom, reload]);

  const refresh = useCallback(() => {
    void loadNode();
    setReload((tick) => tick + 1);
  }, [loadNode]);

  useEffect(() => {
    if (refreshSeconds <= 0) return;
    const timer = window.setInterval(() => {
      if (!pollInFlight.current) refresh();
    }, refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [refreshSeconds, refresh]);

  const changeWindow = (id: string) => {
    setWindowId(id);
    saveStoredTimeRange(WINDOW_STORAGE_KEY, { id, customStart, customEnd });
  };

  const applyCustom = (start: number, end: number) => {
    setAppliedCustom({ start, end });
    saveStoredTimeRange(WINDOW_STORAGE_KEY, { id: CUSTOM_RANGE_ID, customStart, customEnd });
  };

  const changeCounterMode = (mode: CounterMode) => {
    setCounterMode(mode);
    saveCounterMode(mode);
  };

  const pollNow = async () => {
    pollInFlight.current = true;
    setPolling(true);
    setPollError(null);
    try {
      const result = await api.pollSnmp(publicKey);
      setNode((prev) => (prev ? applySnmpPoll(prev, result) : prev));
      setReload((tick) => tick + 1);
    } catch (err) {
      setPollError(errorMessage(err));
    } finally {
      pollInFlight.current = false;
      setPolling(false);
    }
  };

  const rows = useMemo(() => history ?? [], [history]);
  // Several series per chart: colourblind palette when a mode is on.
  const seriesColor = useSeriesColor();
  const charts = useMemo(
    () => CHARTS.flatMap((def) => buildChart(def, rows, counterMode, t, seriesColor) ?? []),
    [rows, counterMode, t, seriesColor]
  );
  // One time extent for every chart, so they line up under each other.
  const full: ChartWindow =
    rows.length > 0 ? [rows[0].timestamp, rows[rows.length - 1].timestamp] : [0, 0];
  const reboots = useMemo(() => listReboots(rows), [rows]);

  const awaitingCustom = isCustom && appliedCustom === null;
  const status = node ? snmpNodeStatus(node) : null;
  const failing = status === 'failing';
  const latestValues = node?.latest?.values ?? {};

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          'space-y-2 border-b border-border border-l-4 px-4 py-2.5',
          failing ? 'border-l-destructive' : 'border-l-transparent'
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t('snmp_node_back')}
          </Button>
          {node && status && (
            <>
              <h2 className="text-base font-semibold text-foreground">{snmpNodeName(node)}</h2>
              {node.type !== null && (
                <span className="text-xs text-muted-foreground">
                  {contactTypeLabel(node.type, t)}
                </span>
              )}
              <span data-testid="snmp-node-status">
                <SnmpStatusBadge status={status} />
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {node.host}:{node.port}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenContactInfo(publicKey)}
                >
                  {t('snmp_node_open_contact')}
                </Button>
                <Button type="button" size="sm" disabled={polling} onClick={() => void pollNow()}>
                  {polling ? t('snmp_polling') : t('snmp_poll_now')}
                </Button>
              </div>
            </>
          )}
        </div>

        {node && (
          <p className="text-[0.6875rem] text-muted-foreground">
            {node.last_ok_at
              ? t('snmp_last_ok', { time: formatSnmpTime(node.last_ok_at) })
              : t('snmp_never_polled')}{' '}
            {node.poll_enabled
              ? t('snmp_schedule_on', { minutes: node.poll_interval_minutes })
              : t('snmp_schedule_off')}
            {node.community_is_default ? ` ${t('snmp_community_is_default')}` : ''}
          </p>
        )}
        {node?.last_error && (
          <p className="wrap-break-word text-xs text-destructive" data-testid="snmp-node-error">
            {t('snmp_last_error', {
              time: node.last_error_at ? formatSnmpTime(node.last_error_at) : NO_VALUE,
              error: node.last_error,
            })}
          </p>
        )}
        {pollError && (
          <p className="text-xs text-destructive" role="alert">
            {t('snmp_page_poll_failed', { error: pollError })}
          </p>
        )}

        {node && (
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <TimeRangeSelector
              value={windowId}
              onChange={changeWindow}
              customStart={customStart}
              customEnd={customEnd}
              onCustomStartChange={setCustomStart}
              onCustomEndChange={setCustomEnd}
              onApplyCustom={applyCustom}
            />
            <div
              className="flex items-center gap-1 text-xs text-muted-foreground"
              role="group"
              aria-label={t('snmp_node_counters')}
              title={t('snmp_node_counters_hint')}
            >
              <span>{t('snmp_node_counters')}</span>
              {(['rates', 'totals'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={counterMode === mode}
                  onClick={() => changeCounterMode(mode)}
                  className={cn(
                    'rounded px-2 py-0.5 text-xs transition',
                    counterMode === mode
                      ? 'bg-primary font-medium text-primary-foreground'
                      : 'border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  {t(mode === 'rates' ? 'snmp_node_counters_rates' : 'snmp_node_counters_totals')}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <SnmpRefreshSelect value={refreshSeconds} onChange={setRefreshSeconds} />
              <Button type="button" variant="outline" size="sm" onClick={refresh}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {t('snmp_page_refresh')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {loadError && (
          <p className="text-sm text-destructive" role="alert">
            {t('snmp_page_load_failed', { error: loadError })}
          </p>
        )}
        {node === undefined && !loadError && (
          <p className="text-sm text-muted-foreground">{t('common_loading')}</p>
        )}
        {node === null && (
          <div
            className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground"
            data-testid="snmp-node-missing"
          >
            {t('snmp_node_missing')}
          </div>
        )}

        {node && (
          <>
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7"
              data-testid="snmp-node-tiles"
            >
              {TILE_KEYS.flatMap((key) => FIELD_BY_KEY.get(key) ?? []).map((field) => (
                <StatTile
                  key={field.key}
                  label={t(field.labelKey)}
                  value={formatSnmpValue(field, latestValues, t)}
                />
              ))}
              <div data-testid="snmp-tile-reboots">
                <StatTile
                  label={t('snmp_node_tile_reboots')}
                  value={history === null ? NO_VALUE : reboots.length}
                  sub={t('snmp_node_tile_reboots_sub')}
                />
              </div>
            </div>

            {history !== null && reboots.length > 0 && <RebootList reboots={reboots} />}

            {historyError && (
              <p className="text-sm text-destructive" role="alert">
                {t('snmp_node_history_failed', { error: historyError })}
              </p>
            )}
            {history === null && !historyError && (
              <p className="text-sm text-muted-foreground">{t('common_loading')}</p>
            )}

            {awaitingCustom && (
              <p className="text-sm text-muted-foreground" data-testid="snmp-node-custom-hint">
                {t('snmp_node_custom_hint')}
              </p>
            )}
            {history !== null &&
              !awaitingCustom &&
              SNMP_GROUPS.map(({ group, labelKey }) => {
                const groupCharts = charts.filter((chart) => chart.def.group === group);
                if (groupCharts.length === 0) return null;
                return (
                  <section key={group}>
                    <h3 className="mb-2 text-xs font-semibold text-foreground">{t(labelKey)}</h3>
                    <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                      {groupCharts.map((chart) => (
                        <ChartCard key={chart.def.id} chart={chart} full={full} />
                      ))}
                    </div>
                  </section>
                );
              })}

            <section>
              <h3 className="mb-1 text-xs font-semibold text-foreground">
                {t('snmp_node_latest')}
              </h3>
              <p className="mb-2 text-[0.6875rem] text-muted-foreground">
                {node.latest
                  ? t('snmp_page_values_from', { time: formatSnmpTime(node.latest.timestamp) })
                  : t('snmp_page_no_values', { button: t('snmp_poll_now') })}
                {failing && node.latest ? ` ${t('snmp_page_stale_values')}` : ''}
              </p>
              {node.latest && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <SnmpValueGroups
                    values={node.latest.values}
                    className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3"
                  />
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
