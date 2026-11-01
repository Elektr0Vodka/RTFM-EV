// What a tap on the coverage map opens: a reception (who it was heard from,
// how well, by whom, what it carried) or a hex cell. A card at the bottom of
// the map rather than a map popup, so it reads on a phone. Text only: names
// and ids come from the mesh.
import { X } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

import { useT } from '../../i18n';
import { useCoordinateFormat } from '../../utils/coordinateFormat';
import { pointDetails } from './details';
import type { LocateResult } from './locate';
import type { NodeRow } from './nodePositions';
import { shownId } from './Pickers';
import type { MapCell, MapPoint } from './types';

function Card({
  title,
  onClose,
  children,
  actions,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const t = useT();
  return (
    <div
      role="dialog"
      aria-label={title}
      className="pointer-events-auto absolute inset-x-2 bottom-8 z-30 mx-auto max-w-sm rounded-md border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="min-w-0 break-words font-semibold">{title}</h3>
        <button
          type="button"
          className="rounded p-1 hover:bg-muted"
          aria-label={t('wardrive_cov_close')}
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">{children}</dl>
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all">{value}</dd>
    </>
  );
}

export function ReceptionCard({
  point,
  onClose,
  onIgnore,
  onLocate,
}: {
  point: MapPoint;
  onClose(): void;
  onIgnore(id: string): void;
  onLocate?(id: string): void;
}) {
  const t = useT();
  const coords = useCoordinateFormat();
  const s = point.sender;
  const title = point.name ?? (s.id ? shownId(s.kind, s.id) : t('wardrive_cov_popup_no_sender'));
  return (
    <Card
      title={title}
      onClose={onClose}
      actions={
        s.id ? (
          <>
            {onLocate && (
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                onClick={() => onLocate(s.id!.toLowerCase())}
              >
                {t('wardrive_cov_locate_sender')}
              </button>
            )}
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
              onClick={() => onIgnore(s.id!.toLowerCase())}
            >
              {t('wardrive_cov_ignore_id')}
            </button>
          </>
        ) : undefined
      }
    >
      {point.guess && <Row label="" value={t('wardrive_cov_popup_guess')} />}
      {s.id && <Row label={t('wardrive_cov_popup_id')} value={shownId(s.kind, s.id)} />}
      {s.role && <Row label={t('wardrive_cov_popup_role')} value={s.role} />}
      {pointDetails(point, t, coords).map((row) => (
        <Row key={row.label} label={row.label} value={row.value} />
      ))}
    </Card>
  );
}

export function CellCard({ cell, onClose }: { cell: MapCell; onClose(): void }) {
  const t = useT();
  return (
    <Card title={t('wardrive_cov_cell_title')} onClose={onClose}>
      <Row
        label={t('wardrive_cov_cell_best')}
        value={cell.best !== null ? `${cell.best} dBm` : '-'}
      />
      <Row label={t('wardrive_cov_cell_count')} value={String(cell.count)} />
      <Row label={t('wardrive_cov_cell_drivers')} value={String(cell.drivers)} />
    </Card>
  );
}

export function NodeCard({
  row,
  reachOn,
  selected,
  heard,
  onToggleReach,
  onClose,
}: {
  row: NodeRow;
  reachOn: boolean;
  selected: boolean;
  heard: boolean;
  onToggleReach(): void;
  onClose(): void;
}) {
  const t = useT();
  const p = row.p;
  return (
    <Card
      title={row.name || row.id.slice(0, 8)}
      onClose={onClose}
      actions={
        reachOn ? (
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
            aria-pressed={selected}
            onClick={onToggleReach}
          >
            {selected ? t('wardrive_cov_reach_hide') : t('wardrive_cov_reach_show')}
          </button>
        ) : undefined
      }
    >
      <Row label={t('wardrive_cov_popup_id')} value={row.id.slice(0, 16)} />
      <Row
        label=""
        value={
          p.kind === 'advertised-only'
            ? t('wardrive_cov_node_advertised')
            : t('wardrive_cov_node_both')
        }
      />
      {p.driftM !== undefined && (
        <Row
          label=""
          value={t('wardrive_cov_node_drift', { m: Math.round(p.driftM), count: row.est?.n ?? 0 })}
        />
      )}
      {p.circle && (
        <Row
          label=""
          value={
            p.circle.kind === 'search'
              ? t('wardrive_cov_node_search', { m: Math.round(p.circle.radiusM) })
              : t('wardrive_cov_node_one_sided')
          }
        />
      )}
      {reachOn && !heard && <Row label="" value={t('wardrive_cov_reach_none')} />}
    </Card>
  );
}

export function LocateBox({
  result,
  failed,
  isHash,
  legendOpen,
  onToggleLegend,
  onLeave,
}: {
  result: LocateResult | null;
  failed: boolean;
  isHash: boolean;
  legendOpen: boolean;
  onToggleLegend(): void;
  onLeave(): void;
}) {
  const t = useT();
  let body: ReactNode;
  if (failed) body = <p className="text-muted-foreground">{t('wardrive_cov_locate_failed')}</p>;
  else if (!result)
    body = <p className="text-muted-foreground">{t('wardrive_cov_locate_loading')}</p>;
  else if (!result.centroid) {
    body = (
      <p className="text-muted-foreground">
        {t('wardrive_cov_locate_few', { count: result.inliers.length })}
      </p>
    );
  } else {
    const s = result.stats;
    const radius = s.searchRadiusM !== null ? `${Math.round(s.searchRadiusM)} m` : '-';
    body = (
      <>
        <p>
          {t('wardrive_cov_locate_stats', {
            n: s.n,
            radius,
            pct: Math.round(s.encirclement * 100),
          })}
          {result.strongest?.rssi != null &&
            ` · ${t('wardrive_cov_locate_strongest', { rssi: result.strongest.rssi })}`}
        </p>
        {s.encirclement < 0.5 && (
          <p className="text-warning">{t('wardrive_cov_locate_one_sided')}</p>
        )}
        {isHash && (
          <p className="text-warning">
            {t('wardrive_cov_locate_hash', { count: result.outliers.length })}
          </p>
        )}
        <p className="text-muted-foreground">{t('wardrive_cov_locate_note')}</p>
      </>
    );
  }
  const legend: [string, string][] = [
    ['wardrive_cov_locate_l_points', 'wardrive_cov_locate_l_points_d'],
    ['wardrive_cov_locate_l_radius', 'wardrive_cov_locate_l_radius_d'],
    ['wardrive_cov_locate_l_encircle', 'wardrive_cov_locate_l_encircle_d'],
    ['wardrive_cov_locate_l_strongest', 'wardrive_cov_locate_l_strongest_d'],
  ];
  return (
    <section
      aria-label={t('wardrive_cov_locate')}
      className="pointer-events-auto absolute left-2 top-2 z-30 max-w-xs space-y-1 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-lg"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('wardrive_cov_locate')}</h3>
        <div className="flex gap-1">
          <button
            type="button"
            className="rounded border border-border px-1.5 hover:bg-muted"
            aria-label={t('wardrive_cov_locate_help')}
            aria-expanded={legendOpen}
            onClick={onToggleLegend}
          >
            ?
          </button>
          <button
            type="button"
            className="rounded border border-border px-1.5 hover:bg-muted"
            onClick={onLeave}
          >
            {t('wardrive_cov_locate_off')}
          </button>
        </div>
      </div>
      {body}
      {legendOpen && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          {legend.map(([term, desc]) => (
            <Fragment key={term}>
              <dt className="font-semibold">{t(term)}</dt>
              <dd>{t(desc)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </section>
  );
}
