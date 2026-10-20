// The coverage map's two pickers (map.mesh-hunter.eu's hunter and target
// pickers): drivers, and the senders heard in view.
import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useCvdMode } from '../../hooks/useCvdColors';
import { useT } from '../../i18n';
import { rssiTier, tierColor } from '../signal';
import { BAR_BUTTON, Dropdown } from './Dropdown';
import type { MapDriver, MapPoint } from './types';

/** Above this many rows a short top list is shown first. */
const TOP_FROM = 8;
const TOP_COUNT = 5;

export function DriverPicker({
  drivers,
  selected,
  onChange,
}: {
  drivers: MapDriver[];
  selected: number[];
  onChange(ids: number[]): void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const byName = useMemo(
    () => [...drivers].sort((a, b) => a.username.localeCompare(b.username)),
    [drivers]
  );
  const top = drivers.length > TOP_FROM ? drivers.slice(0, TOP_COUNT) : [];
  const picked = drivers.filter((d) => selected.includes(d.user_id));
  const everyone = drivers.length > 0 && picked.length === drivers.length;
  const label =
    picked.length === 0 || everyone
      ? t('wardrive_cov_drivers_all')
      : picked.length === 1
        ? picked[0].username
        : t('wardrive_cov_drivers_some', { count: picked.length });
  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const row = (d: MapDriver) => (
    <label
      key={d.user_id}
      className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
    >
      <input
        type="checkbox"
        checked={selected.includes(d.user_id)}
        onChange={() => toggle(d.user_id)}
      />
      <span className="min-w-0 flex-1 truncate">{d.username}</span>
      <span className="text-xs text-muted-foreground">
        {t('wardrive_cov_receptions', { count: d.count })}
      </span>
    </label>
  );
  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      button={
        <button
          type="button"
          className={BAR_BUTTON}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="max-w-[10rem] truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      }
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">
          {t('wardrive_cov_drivers_title')}
        </span>
        {drivers.length > 0 && (
          <button
            type="button"
            className="rounded px-2 py-0.5 text-xs hover:bg-muted"
            onClick={() => onChange(everyone || picked.length ? [] : drivers.map((d) => d.user_id))}
          >
            {everyone || picked.length
              ? t('wardrive_cov_drivers_clear')
              : t('wardrive_cov_drivers_select_all')}
          </button>
        )}
      </div>
      {drivers.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('wardrive_cov_drivers_none')}</p>
      )}
      {top.length > 0 && (
        <>
          <p className="mt-1 text-xs text-muted-foreground">{t('wardrive_cov_drivers_top')}</p>
          {top.map(row)}
          <p className="mt-2 text-xs text-muted-foreground">{t('wardrive_cov_drivers_every')}</p>
        </>
      )}
      {byName.filter((d) => !top.includes(d)).map(row)}
    </Dropdown>
  );
}

export interface SenderRow {
  id: string;
  kind: string | null;
  name: string | null;
  count: number;
  best: number | null;
}

/** One row per sender id among the points, most heard first. */
export function senderRows(points: MapPoint[]): SenderRow[] {
  const rows = new Map<string, SenderRow>();
  for (const p of points) {
    const id = p.sender.id?.toLowerCase();
    if (!id) continue;
    const row = rows.get(id) ?? { id, kind: p.sender.kind, name: p.name, count: 0, best: null };
    row.count += 1;
    row.name = row.name ?? p.name;
    if (p.rssi !== null && (row.best === null || p.rssi > row.best)) row.best = p.rssi;
    rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

const HASH_KINDS = ['path_hash', 'direct_hash'];
export const shownId = (kind: string | null, id: string) =>
  HASH_KINDS.includes(kind ?? '') ? `#${id}` : kind === 'channel_name' ? id : id.slice(0, 8);

export function TargetPicker({
  rows,
  loading,
  selected,
  prefix,
  onOpen,
  onToggle,
  onPrefix,
  onClear,
}: {
  rows: SenderRow[];
  loading: boolean;
  selected: string[];
  prefix: string;
  onOpen(): void;
  onToggle(id: string): void;
  onPrefix(prefix: string): void;
  onClear(): void;
}) {
  const t = useT();
  const cvd = useCvdMode() !== 'off';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q
    ? rows.filter((r) => r.id.startsWith(q) || (r.name ?? '').toLowerCase().includes(q))
    : rows;
  const top = !q && rows.length > TOP_FROM ? rows.slice(0, TOP_COUNT) : [];
  const label = selected.length
    ? t('wardrive_cov_target_some', { count: selected.length })
    : prefix
      ? t('wardrive_cov_target_prefix', { prefix })
      : t('wardrive_cov_target_select');
  const row = (r: SenderRow) => (
    <label key={r.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
      <input type="checkbox" checked={selected.includes(r.id)} onChange={() => onToggle(r.id)} />
      <i
        className="block h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: tierColor(rssiTier(r.best), cvd) }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          {r.name ?? t('wardrive_page_targets_unnamed', { id: shownId(r.kind, r.id) })}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {shownId(r.kind, r.id)}
        </span>
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">{r.count}</span>
    </label>
  );
  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      wide
      button={
        <button
          type="button"
          className={BAR_BUTTON}
          aria-expanded={open}
          onClick={() => {
            if (!open) onOpen();
            setOpen((v) => !v);
          }}
        >
          <span className="max-w-[10rem] truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      }
    >
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('wardrive_page_targets_search')}
        aria-label={t('wardrive_page_targets_search')}
        className="mb-2 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
      />
      {q && (
        <button
          type="button"
          className="mb-1 w-full rounded px-1 py-1 text-left text-sm hover:bg-muted"
          onClick={() => onPrefix(q)}
        >
          {t('wardrive_cov_target_use_prefix', { prefix: q })}
        </button>
      )}
      {(selected.length > 0 || prefix) && (
        <button
          type="button"
          className="mb-1 rounded px-2 py-0.5 text-xs hover:bg-muted"
          onClick={onClear}
        >
          {t('wardrive_page_targets_clear')}
        </button>
      )}
      {loading && (
        <p className="text-xs text-muted-foreground">{t('wardrive_cov_target_loading')}</p>
      )}
      {!loading && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('wardrive_page_targets_empty')}</p>
      )}
      {!loading && rows.length > 0 && shown.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('wardrive_page_targets_none')}</p>
      )}
      {top.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">{t('wardrive_page_targets_top')}</p>
          {top.map(row)}
          <p className="mt-2 text-xs text-muted-foreground">{t('wardrive_page_targets_list')}</p>
        </>
      )}
      {shown.filter((r) => !top.includes(r)).map(row)}
    </Dropdown>
  );
}
