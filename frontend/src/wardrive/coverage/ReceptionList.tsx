// The coverage map's receptions list (map.mesh-hunter.eu's ticker): the
// newest 200 of the window under the filters, two-way with the map. A row
// opens its reception; a reception or cell picked on the map marks its row.
// It folds to three lanes, one lane or away, and can be moved on a phone.
import { ChevronsDownUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useCvdMode } from '../../hooks/useCvdColors';
import { useT } from '../../i18n';
import { packetTypeLabel } from '../filters';
import { formatAge } from '../screen/Hud';
import { MovablePanel } from '../screen/MovablePanel';
import { rssiTier, tierColor } from '../signal';
import { shownId } from './Pickers';
import type { MapPoint } from './types';

export const LIST_CAP = 200;
const FOLDS = ['full', 'three', 'one'] as const;
type Fold = (typeof FOLDS)[number];
const HEIGHT: Record<Fold, string> = { full: 'max-h-80', three: 'max-h-24', one: 'max-h-8' };

/** The same reception, wherever it came from (rows carry no id). */
export const receptionKey = (p: MapPoint) => `${p.radio_key}|${p.rx_at}|${p.hash}`;

/** Point-in-polygon on a closed [lon, lat] ring. */
export function pointInRing(lat: number, lon: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function ReceptionList({
  rows,
  truncated,
  current,
  nowMs,
  storageKey,
  onPick,
  onClose,
}: {
  rows: MapPoint[];
  truncated: boolean;
  current: string | null;
  nowMs: number;
  storageKey: string;
  onPick(p: MapPoint): void;
  onClose(): void;
}) {
  const t = useT();
  const cvd = useCvdMode() !== 'off';
  const [fold, setFold] = useState<Fold>('full');
  const currentRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);
  return (
    <div className="pointer-events-auto absolute bottom-8 left-2 z-20 w-80 max-w-[calc(100%-4rem)]">
      <MovablePanel storageKey={`${storageKey}-list-pos`} handleLabel={t('wardrive_cov_list_move')}>
        <section
          aria-label={t('wardrive_cov_list')}
          className="rounded-md border border-border bg-popover/95 text-popover-foreground shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1 text-xs">
            <span className="font-semibold">
              {t('wardrive_cov_list_count', { count: rows.length })}
              {truncated && (
                <span className="font-normal text-muted-foreground">
                  {' '}
                  ({t('wardrive_cov_list_more')})
                </span>
              )}
            </span>
            <span className="flex gap-1">
              <button
                type="button"
                className="rounded p-0.5 hover:bg-muted"
                aria-label={t('wardrive_cov_list_fold')}
                onClick={() => setFold((f) => FOLDS[(FOLDS.indexOf(f) + 1) % FOLDS.length])}
              >
                <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                className="rounded p-0.5 hover:bg-muted"
                aria-label={t('wardrive_cov_list_close')}
                onClick={onClose}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          </div>
          <ul className={`${HEIGHT[fold]} overflow-y-auto text-xs`}>
            {rows.length === 0 && (
              <li className="px-2 py-1 text-muted-foreground">{t('wardrive_cov_list_empty')}</li>
            )}
            {rows.map((p) => {
              const key = receptionKey(p);
              const isCurrent = key === current;
              const id = p.sender.id;
              const who =
                p.name ?? (id ? shownId(p.sender.kind, id) : t('wardrive_cov_popup_no_sender'));
              return (
                <li key={key}>
                  <button
                    type="button"
                    ref={isCurrent ? currentRef : undefined}
                    aria-current={isCurrent ? 'true' : undefined}
                    className={`flex w-full items-center gap-2 px-2 py-0.5 text-left ${
                      isCurrent ? 'bg-primary/15' : 'hover:bg-muted'
                    }`}
                    onClick={() => onPick(p)}
                  >
                    <span className="w-10 shrink-0 tabular-nums text-muted-foreground">
                      {formatAge(Math.max(0, nowMs - p.rx_ts * 1000), t)}
                    </span>
                    <i
                      className="block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: tierColor(rssiTier(p.rssi), cvd) }}
                      aria-hidden
                    />
                    <span className="w-10 shrink-0 tabular-nums">{p.rssi ?? '-'}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {who}
                      {p.name && id && (
                        <span className="text-muted-foreground"> {shownId(p.sender.kind, id)}</span>
                      )}
                    </span>
                    <span className="hidden shrink-0 truncate text-muted-foreground sm:inline">
                      {p.channel ?? packetTypeLabel(p.packet_type_name, t)}
                    </span>
                    <span className="max-w-[4rem] shrink-0 truncate text-muted-foreground">
                      {p.driver}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </MovablePanel>
    </div>
  );
}
