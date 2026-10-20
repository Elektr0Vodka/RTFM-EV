// A wardrive report over the picked drives or a filter: four sections, each
// answering one question (what was driven; how well the area is covered;
// where coverage is weak or missing; which nodes are heard where and how
// well), the exports, and a slot for the share cards. Shared by the wardrive
// page and the main app's Tools page.
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '../../components/ui/button';
import { useLocale, useT } from '../../i18n';
import { getSavedDistanceUnit } from '../../utils/distanceUnits';
import { formatDistance } from '../../utils/pathUtils';
import { formatDb, formatDbm, formatDuration, formatShare, formatWhen, nodeLabel } from './format';
import {
  CELL_SIZES,
  DEFAULT_RES,
  EXPORT_KINDS,
  type DrivesApi,
  type ExportKind,
  type ReportCell,
  type ReportQuery,
  type WardriveReport,
} from './types';

const EXPORT_LABEL: Record<ExportKind, string> = {
  'receptions.csv': 'wardrive_report_export_receptions',
  'cells.csv': 'wardrive_report_export_cells',
  'drives.geojson': 'wardrive_report_export_geojson',
  'drives.gpx': 'wardrive_report_export_gpx',
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-2 py-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {children}
    </section>
  );
}

function CellList({ cells, t }: { cells: ReportCell[]; t: ReturnType<typeof useT> }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {cells.map((c) => (
        <li key={c.id} className="flex justify-between gap-2">
          <span className="tabular-nums text-muted-foreground">
            {c.lat.toFixed(4)}, {c.lon.toFixed(4)}
          </span>
          <span>
            {c.best_node
              ? t('wardrive_report_cell_line', {
                  rssi: formatDbm(c.best_node.rssi),
                  node: nodeLabel(c.best_node),
                })
              : formatDbm(c.rssi_best)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ReportPanel({
  api,
  query,
  reloadKey = '',
  cards,
}: {
  api: DrivesApi;
  /** The picked drives or the filter; the cell size is picked here. */
  query: Omit<ReportQuery, 'res'>;
  /** Changes when the query changes, to load again. */
  reloadKey?: string;
  /** Share card buttons for the loaded report. */
  cards?: (report: WardriveReport) => ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [res, setRes] = useState(DEFAULT_RES);
  const [report, setReport] = useState<WardriveReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unit = getSavedDistanceUnit();
  const full: ReportQuery = { ...query, res };

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setReport(null);
    api.report(full).then(
      (r) => {
        if (!cancelled) setReport(r);
      },
      (e) => {
        if (!cancelled) setError(errorText(e));
      }
    );
    return () => {
      cancelled = true;
    };
    // `api` and `query` are fresh objects per render; reloadKey and res decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, res]);

  const download = (kind: ExportKind) => {
    setError(null);
    api.download(kind, full).catch((e) => setError(errorText(e)));
  };

  const s = report?.summary;
  const empty = report !== null && s !== undefined && s.receptions === 0 && s.drives === 0;

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-xs text-muted-foreground">{t('wardrive_report_cell_size')}</span>
        <select
          aria-label={t('wardrive_report_cell_size')}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={res}
          onChange={(e) => setRes(Number(e.target.value))}
        >
          {CELL_SIZES.map((c) => (
            <option key={c.res} value={c.res}>
              {t('wardrive_report_cell_size_m', { m: c.metres })}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {report === null && !error && (
        <p className="text-sm text-muted-foreground">{t('wardrive_report_loading')}</p>
      )}
      {empty && <p className="text-sm text-muted-foreground">{t('wardrive_report_empty')}</p>}
      {report && s && !empty && (
        <>
          {report.truncated && (
            <p className="text-xs text-muted-foreground">{t('wardrive_report_truncated')}</p>
          )}
          {cards?.(report)}
          <Section
            title={t('wardrive_report_sec_summary')}
            hint={t('wardrive_report_sec_summary_hint')}
          >
            <p className="text-xs text-muted-foreground">
              {t('wardrive_report_period')}:{' '}
              {t('wardrive_report_from_to', {
                from: formatWhen(s.first_ts, locale),
                to: formatWhen(s.last_ts, locale),
              })}
            </p>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Figure label={t('wardrive_report_drives')} value={String(s.drives)} />
              <Figure label={t('wardrive_report_drivers')} value={String(s.drivers)} />
              <Figure label={t('wardrive_report_radios')} value={String(s.radios)} />
              <Figure
                label={t('wardrive_report_time')}
                value={formatDuration(s.drive_seconds, t)}
              />
              <Figure
                label={t('wardrive_report_distance')}
                value={formatDistance(s.distance_m / 1000, unit)}
              />
              <Figure label={t('wardrive_report_receptions')} value={String(s.receptions)} />
              <Figure label={t('wardrive_report_nodes_heard')} value={String(s.nodes_heard)} />
              <Figure label={t('wardrive_report_rssi_best')} value={formatDbm(s.rssi_best)} />
              <Figure label={t('wardrive_report_rssi_median')} value={formatDbm(s.rssi_median)} />
              <Figure label={t('wardrive_report_rssi_worst')} value={formatDbm(s.rssi_worst)} />
              <Figure label={t('wardrive_report_snr_median')} value={formatDb(s.snr_median)} />
            </dl>
            <p className="text-xs text-muted-foreground">{t('wardrive_report_bands')}</p>
            <ul className="text-xs">
              {(['strong', 'fair', 'weak', 'none'] as const).map((b) => (
                <li key={b} className="flex justify-between">
                  <span>{t(`wardrive_report_band_${b}`)}</span>
                  <span className="tabular-nums">{s.bands[b]}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t('wardrive_report_sec_coverage')}
            hint={t('wardrive_report_sec_coverage_hint')}
          >
            <dl className="grid grid-cols-3 gap-2">
              <Figure
                label={t('wardrive_report_cells_driven')}
                value={String(report.coverage.cells_driven)}
              />
              <Figure
                label={t('wardrive_report_cells_covered')}
                value={String(report.coverage.cells_covered)}
              />
              <Figure
                label={t('wardrive_report_covered_share')}
                value={formatShare(report.coverage.covered_share)}
              />
            </dl>
            <p className="text-xs text-muted-foreground">{t('wardrive_report_cell_bands')}</p>
            <ul className="text-xs">
              {(['strong', 'fair', 'weak'] as const).map((b) => (
                <li key={b} className="flex justify-between">
                  <span>{t(`wardrive_report_band_${b}`)}</span>
                  <span className="tabular-nums">{report.coverage.cell_bands[b]}</span>
                </li>
              ))}
            </ul>
            {report.coverage.strongest.length > 0 && (
              <>
                <p className="text-xs font-medium">{t('wardrive_report_strongest')}</p>
                <CellList cells={report.coverage.strongest} t={t} />
                <p className="text-xs font-medium">{t('wardrive_report_weakest')}</p>
                <CellList cells={report.coverage.weakest} t={t} />
              </>
            )}
          </Section>

          <Section title={t('wardrive_report_sec_weak')} hint={t('wardrive_report_sec_weak_hint')}>
            <dl className="grid grid-cols-2 gap-2">
              <Figure label={t('wardrive_report_gaps')} value={String(report.weak_spots.gaps)} />
              <Figure
                label={t('wardrive_report_weak_cells')}
                value={String(report.weak_spots.weak)}
              />
            </dl>
            <ul className="space-y-1 text-xs">
              {report.weak_spots.cells.map((c) => (
                <li key={c.id} className="rounded-md border border-border px-2 py-1">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">
                      {c.receptions === 0 ? t('wardrive_report_gap') : t('wardrive_report_weak')}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {c.lat.toFixed(4)}, {c.lon.toFixed(4)}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    {t('wardrive_report_time_there', { time: formatDuration(c.track_s, t) })}
                    {c.receptions > 0 && ` · ${formatDbm(c.rssi_best)}`}
                  </div>
                  <div className="text-muted-foreground">
                    {c.nearby.length > 0
                      ? t('wardrive_report_nearby', {
                          nodes: c.nearby
                            .map((n) => `${nodeLabel(n)} ${formatDbm(n.rssi_best)}`)
                            .join(', '),
                        })
                      : t('wardrive_report_none_nearby')}
                  </div>
                </li>
              ))}
            </ul>
            {report.weak_spots.total > report.weak_spots.cells.length && (
              <p className="text-xs text-muted-foreground">
                {t('wardrive_report_weak_more', {
                  shown: report.weak_spots.cells.length,
                  total: report.weak_spots.total,
                })}
              </p>
            )}
          </Section>

          <Section
            title={t('wardrive_report_sec_nodes')}
            hint={t('wardrive_report_sec_nodes_hint')}
          >
            {report.nodes.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('wardrive_report_no_nodes')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="pr-2 font-normal">{t('wardrive_report_col_node')}</th>
                      <th className="pr-2 font-normal">{t('wardrive_report_col_heard')}</th>
                      <th className="pr-2 font-normal">{t('wardrive_report_col_best')}</th>
                      <th className="pr-2 font-normal">{t('wardrive_report_col_median')}</th>
                      <th className="pr-2 font-normal">{t('wardrive_report_col_cells')}</th>
                      <th className="font-normal">{t('wardrive_report_col_farthest')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.nodes.map((n) => (
                      <tr key={n.id}>
                        <td className="max-w-[10rem] truncate pr-2" title={n.id}>
                          {nodeLabel(n)}
                        </td>
                        <td className="pr-2 tabular-nums">{n.receptions}</td>
                        <td className="pr-2 tabular-nums">{formatDbm(n.rssi_best)}</td>
                        <td className="pr-2 tabular-nums">{formatDbm(n.rssi_median)}</td>
                        <td className="pr-2 tabular-nums">{n.cells}</td>
                        <td className="tabular-nums">
                          {n.farthest_m === null ? '-' : formatDistance(n.farthest_m / 1000, unit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {s.receptions > s.attributed && (
              <p className="text-xs text-muted-foreground">
                {t('wardrive_report_not_attributed', { n: s.receptions - s.attributed })}
              </p>
            )}
          </Section>
        </>
      )}
      {report && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t('wardrive_report_exports')}</h3>
          <div className="flex flex-wrap gap-2">
            {EXPORT_KINDS.map((kind) => (
              <Button
                key={kind}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => download(kind)}
              >
                {t(EXPORT_LABEL[kind])}
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
