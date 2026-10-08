import { useEffect, useMemo, useState } from 'react';
import { api, isAbortError } from '../../api';
import { useT } from '../../i18n';
import type { SnmpHistoryEntry } from '../../types';
import { SnmpSeriesChart } from './SnmpSeriesChart';
import { SNMP_FIELDS, formatSnmpValue, type SnmpField } from './snmpFields';
import { toChartPoints } from './snmpSeries';

export { toChartPoints, type SnmpChartPoint } from './snmpSeries';

const CHART_COLOR = '#0ea5e9';

const RANGES: { hours: number; labelKey: string }[] = [
  { hours: 24, labelKey: 'snmp_range_24h' },
  { hours: 24 * 7, labelKey: 'snmp_range_7d' },
  { hours: 24 * 30, labelKey: 'snmp_range_30d' },
];

// The two names are text; everything else can be charted.
const CHART_FIELDS: SnmpField[] = SNMP_FIELDS.filter(
  (field) => field.key !== 'node_name' && field.key !== 'firmware_version'
);
const DEFAULT_METRIC = 'free_heap';

/**
 * Stored SNMP polls of one contact as a chart: pick a value and a range.
 * `version` changes after a poll, which reloads the history.
 */
export function SnmpHistoryChart({ publicKey, version }: { publicKey: string; version: number }) {
  const t = useT();
  const [hours, setHours] = useState(RANGES[0].hours);
  const [metric, setMetric] = useState(DEFAULT_METRIC);
  const [history, setHistory] = useState<SnmpHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .snmpHistory(publicKey, hours, controller.signal)
      .then((rows) => {
        setHistory(rows);
        setError(null);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [publicKey, hours, version]);

  const field = CHART_FIELDS.find((f) => f.key === metric) ?? CHART_FIELDS[0];
  const label = t(field.labelKey);
  const series = useMemo(
    () => [
      {
        key: field.key,
        label,
        color: CHART_COLOR,
        points: toChartPoints(history ?? [], field.key),
      },
    ],
    [history, field.key, label]
  );
  const pointCount = series[0].points.length;

  return (
    <div className="space-y-1" data-testid="snmp-history">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
          {t('snmp_history')}
        </span>
        <select
          aria-label={t('snmp_history_value')}
          value={field.key}
          onChange={(e) => setMetric(e.target.value)}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs"
        >
          {CHART_FIELDS.map((f) => (
            <option key={f.key} value={f.key}>
              {t(f.labelKey)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('snmp_history_range')}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs"
        >
          {RANGES.map((range) => (
            <option key={range.hours} value={range.hours}>
              {t(range.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {history !== null && pointCount < 2 && !error && (
        <p className="text-[0.6875rem] text-muted-foreground" data-testid="snmp-history-empty">
          {t('snmp_history_empty')}
        </p>
      )}
      {pointCount >= 2 && (
        <SnmpSeriesChart
          series={series}
          format={(value) => formatSnmpValue(field, { [field.key]: value })}
          ariaLabel={t('snmp_history_chart_label', { value: label })}
        />
      )}
    </div>
  );
}
