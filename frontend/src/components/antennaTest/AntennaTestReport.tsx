import { X } from 'lucide-react';

import type { AntennaTestNodeStats, AntennaTestRunDetail } from '../../types';
import { useT, type TFn } from '../../i18n';
import { useDistanceUnit } from '../../contexts/DistanceUnitContext';
import { formatDistance } from '../../utils/pathUtils';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

export function formatSnr(snr: number | null | undefined): string {
  if (typeof snr !== 'number' || Number.isNaN(snr)) return '-';
  return `${snr >= 0 ? '+' : ''}${snr.toFixed(1)} dB`;
}

export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function formatRunDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

function SnrCell({ stats }: { stats: AntennaTestNodeStats['remote_snr'] }) {
  if (stats.avg === null) return <span className="text-muted-foreground">-</span>;
  return (
    <span>
      {formatSnr(stats.avg)}
      <span className="ml-1 text-[11px] text-muted-foreground">
        ({formatSnr(stats.min)} .. {formatSnr(stats.max)})
      </span>
    </span>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function runMeta(t: TFn, run: AntennaTestRunDetail): string {
  return t('antenna_test_run_meta', {
    date: formatRunDate(run.started_at),
    radio: run.radio_name || t('trace_local_radio_default'),
    count: run.traces_per_node,
  });
}

export function AntennaTestReportView({
  run,
  onClose,
}: {
  run: AntennaTestRunDetail;
  onClose: () => void;
}) {
  const t = useT();
  const { distanceUnit } = useDistanceUnit();
  const { summary } = run;

  return (
    <section
      className="rounded-lg border border-border bg-card"
      aria-label={t('antenna_test_report_heading', { antenna: run.antenna })}
    >
      <div className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {t('antenna_test_report_heading', { antenna: run.antenna })}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{runMeta(t, run)}</p>
          {run.notes ? <p className="mt-1 text-xs">{run.notes}</p> : null}
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onClose}
          aria-label={t('antenna_test_close')}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
        <Tile
          label={t('antenna_test_tile_nodes')}
          value={`${summary.nodes_replied}/${summary.nodes}`}
        />
        <Tile label={t('antenna_test_tile_reply_rate')} value={formatRate(summary.reply_rate)} />
        <Tile label={t('antenna_test_tile_tx')} value={formatSnr(summary.remote_snr_avg)} />
        <Tile label={t('antenna_test_tile_rx')} value={formatSnr(summary.local_snr_avg)} />
      </div>

      <div className="overflow-x-auto px-4 pb-4">
        <table className="w-full min-w-[34rem] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-1.5 pr-3 font-medium">{t('antenna_test_col_node')}</th>
              <th className="py-1.5 pr-3 font-medium">{t('antenna_test_col_distance')}</th>
              <th className="py-1.5 pr-3 font-medium">{t('antenna_test_col_replies')}</th>
              <th className="py-1.5 pr-3 font-medium">{t('antenna_test_col_tx')}</th>
              <th className="py-1.5 font-medium">{t('antenna_test_col_rx')}</th>
            </tr>
          </thead>
          <tbody>
            {run.nodes.map((node) => (
              <tr key={node.public_key} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 pr-3">
                  <div className="font-medium">{node.name || node.public_key.slice(0, 12)}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {node.public_key.slice(0, 12)}
                  </div>
                </td>
                <td className="py-1.5 pr-3 tabular-nums">
                  {node.distance_km === null ? '-' : formatDistance(node.distance_km, distanceUnit)}
                </td>
                <td
                  className={cn(
                    'py-1.5 pr-3 tabular-nums',
                    node.replies === 0 && 'text-destructive'
                  )}
                >
                  {t('antenna_test_replies_value', {
                    replies: node.replies,
                    attempts: node.attempts,
                  })}
                </td>
                <td className="py-1.5 pr-3 tabular-nums">
                  <SnrCell stats={node.remote_snr} />
                </td>
                <td className="py-1.5 tabular-nums">
                  <SnrCell stats={node.local_snr} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface CompareRow {
  publicKey: string;
  name: string;
  perRun: (AntennaTestNodeStats | null)[];
}

/** Every node in any of the runs, in first-seen order, with that node's stats per run. */
export function compareRows(runs: AntennaTestRunDetail[]): CompareRow[] {
  const order: string[] = [];
  const names = new Map<string, string>();
  for (const run of runs) {
    for (const node of run.nodes) {
      if (!names.has(node.public_key)) {
        order.push(node.public_key);
        names.set(node.public_key, node.name || node.public_key.slice(0, 12));
      }
    }
  }
  return order.map((publicKey) => ({
    publicKey,
    name: names.get(publicKey) ?? publicKey.slice(0, 12),
    perRun: runs.map((run) => run.nodes.find((node) => node.public_key === publicKey) ?? null),
  }));
}

/**
 * Index of the single highest value. -1 when fewer than two runs have a value
 * (nothing to beat) or when the top value is shared (no winner).
 */
export function bestIndex(values: (number | null)[]): number {
  const present = values.filter((value): value is number => value !== null);
  if (present.length < 2) return -1;
  const top = Math.max(...present);
  const winners = values.flatMap((value, index) => (value === top ? [index] : []));
  return winners.length === 1 ? winners[0] : -1;
}

function CompareCell({ value, best, muted }: { value: string; best: boolean; muted?: boolean }) {
  return (
    <td
      className={cn(
        'py-1.5 pr-3 tabular-nums',
        best && 'font-semibold text-primary',
        muted && 'text-muted-foreground'
      )}
    >
      {value}
    </td>
  );
}

export function AntennaTestCompareView({ runs }: { runs: AntennaTestRunDetail[] }) {
  const t = useT();
  const rows = compareRows(runs);
  const metrics = [
    {
      key: 'rate',
      label: t('antenna_test_col_replies'),
      value: (n: AntennaTestNodeStats | null) => (n ? n.reply_rate : null),
      format: (n: AntennaTestNodeStats | null) =>
        n ? t('antenna_test_replies_value', { replies: n.replies, attempts: n.attempts }) : '-',
    },
    {
      key: 'tx',
      label: t('antenna_test_col_tx'),
      value: (n: AntennaTestNodeStats | null) => n?.remote_snr.avg ?? null,
      format: (n: AntennaTestNodeStats | null) => formatSnr(n?.remote_snr.avg),
    },
    {
      key: 'rx',
      label: t('antenna_test_col_rx'),
      value: (n: AntennaTestNodeStats | null) => n?.local_snr.avg ?? null,
      format: (n: AntennaTestNodeStats | null) => formatSnr(n?.local_snr.avg),
    },
  ] as const;

  const summaryValues = {
    rate: runs.map((run) => run.summary.reply_rate),
    tx: runs.map((run) => run.summary.remote_snr_avg),
    rx: runs.map((run) => run.summary.local_snr_avg),
  };

  return (
    <section
      className="rounded-lg border border-border bg-card"
      aria-label={t('antenna_test_compare_heading')}
    >
      <div className="border-b border-border p-4">
        <h3 className="text-sm font-semibold">{t('antenna_test_compare_heading')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('antenna_test_compare_note')}</p>
      </div>
      <div className="overflow-x-auto p-4">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-1.5 pr-3 font-medium">{t('antenna_test_col_node')}</th>
              <th className="py-1.5 pr-3 font-medium" />
              {runs.map((run) => (
                <th key={run.id} className="py-1.5 pr-3 font-medium">
                  <div className="text-foreground">{run.antenna}</div>
                  <div className="font-normal">{formatRunDate(run.started_at)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric, metricIndex) => {
              const values = summaryValues[metric.key];
              const best = bestIndex(values);
              return (
                <tr
                  key={`summary-${metric.key}`}
                  className={cn(metricIndex === metrics.length - 1 && 'border-b border-border')}
                >
                  {metricIndex === 0 ? (
                    <td rowSpan={metrics.length} className="py-1.5 pr-3 align-top font-medium">
                      {t('antenna_test_compare_all')}
                    </td>
                  ) : null}
                  <td className="py-1.5 pr-3 text-muted-foreground">{metric.label}</td>
                  {runs.map((run, index) => (
                    <CompareCell
                      key={run.id}
                      best={index === best}
                      value={
                        metric.key === 'rate'
                          ? formatRate(run.summary.reply_rate)
                          : formatSnr(values[index])
                      }
                    />
                  ))}
                </tr>
              );
            })}
            {rows.map((row) =>
              metrics.map((metric, metricIndex) => {
                const best = bestIndex(row.perRun.map(metric.value));
                return (
                  <tr
                    key={`${row.publicKey}-${metric.key}`}
                    className={cn(
                      metricIndex === metrics.length - 1 && 'border-b border-border/60'
                    )}
                  >
                    {metricIndex === 0 ? (
                      <td rowSpan={metrics.length} className="py-1.5 pr-3 align-top font-medium">
                        {row.name}
                      </td>
                    ) : null}
                    <td className="py-1.5 pr-3 text-muted-foreground">{metric.label}</td>
                    {row.perRun.map((node, index) => (
                      <CompareCell
                        key={runs[index].id}
                        best={index === best}
                        muted={node === null}
                        value={metric.format(node)}
                      />
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
