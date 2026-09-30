/**
 * MeshPowerOutagePanel.tsx
 *
 * The "Power Outage" view of the Mesh Health page. Classifies each node by its
 * power source (manual contact override, else DTIS prefix or power icon in the
 * name; see utils/powerSource.ts) and shows which nodes would
 * stay online when the grid goes down: Battery, Solar and Solar+battery nodes
 * survive, Mains and Unknown go dark. Surviving nodes are grouped into islands
 * (connected over advert-path links between two surviving nodes) so it is
 * visible where the mesh would split.
 *
 * The node table sorts by column header and paginates with the shared Mesh
 * Health page size (mesh_health_page_size, also used by the Adverts table).
 *
 * Uses its own scope and heard-within selectors, so the shell hides the shared
 * time-window selector on this tab. Rendered inside the MeshHealthView shell;
 * returns only its content blocks.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, MapPin } from 'lucide-react';
import { api, isAbortError } from '../api';
import { useT } from '../i18n';
import type { AdvertLinkEdge, AppSettingsUpdate, Contact } from '../types';
import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM } from '../types';
import {
  POWER_SOURCES,
  POWER_SOURCE_LABEL_KEY,
  survivesOutage,
  resolvePowerSource,
  type PowerSource,
} from '../utils/powerSource';
import { computeResilience } from '../utils/powerResilience';
import { contactTypeLabel } from './ContactInfoBody';
import { DistBars, StatTile, relTime } from './meshHealthShared';

type Scope = 'infra' | 'all';
type HeardWithin = '24h' | '7d' | '30d' | 'all';
type StatusFilter = 'all' | 'online' | 'dark';
type SortKey = 'name' | 'role' | 'power' | 'status' | 'island' | 'heard';
type SortDir = 'asc' | 'desc';

/** Allowed page sizes; 0 = show all. Mirrors the Adverts table options. */
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 0] as const;

const HEARD_WITHIN_SEC: Record<HeardWithin, number | null> = {
  '24h': 24 * 3600,
  '7d': 7 * 24 * 3600,
  '30d': 30 * 24 * 3600,
  all: null,
};

const POWER_COLOR: Record<PowerSource, string> = {
  Mains: 'hsl(var(--destructive))',
  Battery: 'hsl(var(--success))',
  Solar: 'hsl(var(--warning))',
  SolarBattery: 'hsl(var(--primary))',
  Unknown: 'hsl(var(--muted-foreground))',
};

interface Props {
  contacts: Contact[];
  /** Incremented by the shell's refresh button to force a re-fetch. */
  refreshKey: number;
  /** Reports loading state up to the shell so the refresh spinner can reflect it. */
  onLoadingChange?: (loading: boolean) => void;
  /** Opens a node's detail page (contact conversation) by public key. */
  onOpenNode?: (publicKey: string, name: string | null) => void;
  /** Opens the map focused on a node. */
  onNavigateToMap?: (focusKey?: string) => void;
  /** Server-persisted Mesh Health page size (shared with Adverts); 0 = show all. */
  pageSize?: number;
  onSaveAppSettings?: (update: AppSettingsUpdate) => Promise<void> | void;
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
  return sortDir === 'asc' ? (
    <ChevronUp className="ml-1 inline h-3 w-3" />
  ) : (
    <ChevronDown className="ml-1 inline h-3 w-3" />
  );
}

function Pill<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex w-fit gap-1 rounded-md bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            value === o.id
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MeshPowerOutagePanel({
  contacts,
  refreshKey,
  onLoadingChange,
  onOpenNode,
  onNavigateToMap,
  pageSize = 50,
  onSaveAppSettings,
}: Props) {
  const t = useT();
  const [scope, setScope] = useState<Scope>('infra');
  const [heardWithin, setHeardWithin] = useState<HeardWithin>('7d');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('island');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);
  const [edges, setEdges] = useState<AdvertLinkEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  // Advert-path links over the same heard window, resolved against heard
  // contacts only (matches the map's link layer).
  useEffect(() => {
    const controller = new AbortController();
    const windowSec = HEARD_WITHIN_SEC[heardWithin];
    setLoading(true);
    setError(null);
    api
      .getAdvertLinks(controller.signal, {
        heardOnly: true,
        since: windowSec == null ? null : Date.now() / 1000 - windowSec,
      })
      .then((data) => {
        setEdges(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setError(err instanceof Error ? err.message : t('mesh_health_error_failed_to_load'));
        setEdges([]);
        setLoading(false);
      });
    return () => controller.abort();
  }, [heardWithin, refreshKey, t]);

  const nodes = useMemo(() => {
    const windowSec = HEARD_WITHIN_SEC[heardWithin];
    const cutoff = windowSec == null ? null : Date.now() / 1000 - windowSec;
    return contacts
      .filter(
        (c) => scope === 'all' || c.type === CONTACT_TYPE_REPEATER || c.type === CONTACT_TYPE_ROOM
      )
      .filter((c) => cutoff == null || (c.last_seen != null && c.last_seen > cutoff))
      .map((c) => ({
        contact: c,
        key: c.public_key.toLowerCase(),
        power: resolvePowerSource(c),
      }));
    // refreshKey re-evaluates the heard cutoff against the current time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, scope, heardWithin, refreshKey]);

  const result = useMemo(
    () =>
      computeResilience(
        nodes,
        edges.map((e) => ({ a: e.a.pubkey.toLowerCase(), b: e.b.pubkey.toLowerCase() }))
      ),
    [nodes, edges]
  );

  const dist = useMemo(() => {
    const counts: Record<PowerSource, number> = {
      Mains: 0,
      Battery: 0,
      Solar: 0,
      SolarBattery: 0,
      Unknown: 0,
    };
    for (const n of nodes) counts[n.power] += 1;
    return counts;
  }, [nodes]);

  const rows = useMemo(() => {
    const filtered = nodes.filter((n) => {
      if (statusFilter === 'all') return true;
      return statusFilter === 'online' ? survivesOutage(n.power) : !survivesOutage(n.power);
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    const byName = (x: (typeof filtered)[number], y: (typeof filtered)[number]) =>
      (x.contact.name ?? x.key).localeCompare(y.contact.name ?? y.key);
    return filtered.sort((x, y) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = byName(x, y);
          break;
        case 'role':
          cmp = contactTypeLabel(x.contact.type, t).localeCompare(
            contactTypeLabel(y.contact.type, t)
          );
          break;
        case 'power':
          cmp = POWER_SOURCES.indexOf(x.power) - POWER_SOURCES.indexOf(y.power);
          break;
        case 'status':
          cmp = (survivesOutage(x.power) ? 0 : 1) - (survivesOutage(y.power) ? 0 : 1);
          break;
        case 'island': {
          // Nodes without an island (dark nodes) stay last in both directions.
          const ix = result.islandOf.get(x.key);
          const iy = result.islandOf.get(y.key);
          if (ix == null || iy == null) {
            if (ix != null) return -1;
            if (iy != null) return 1;
            break;
          }
          cmp = ix - iy;
          break;
        }
        case 'heard':
          cmp = (x.contact.last_seen ?? 0) - (y.contact.last_seen ?? 0);
          break;
      }
      return cmp !== 0 ? dir * cmp : byName(x, y);
    });
  }, [nodes, statusFilter, result, sortKey, sortDir, t]);

  // Back to the first page whenever the row set or its order changes.
  useEffect(() => {
    setPage(0);
  }, [scope, heardWithin, statusFilter, sortKey, sortDir, pageSize]);

  const handleSort = (col: SortKey) => {
    if (col === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col);
      setSortDir(col === 'heard' ? 'desc' : 'asc');
    }
  };

  // pageSize 0 means "show all": one page holding every row.
  const showAll = pageSize <= 0;
  const effectivePageSize = showAll ? Math.max(rows.length, 1) : pageSize;
  const totalPages = showAll ? 1 : Math.max(1, Math.ceil(rows.length / effectivePageSize));
  // Clamp in case the row count shrank (e.g. contacts refreshed) past the page.
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = showAll
    ? rows
    : rows.slice(currentPage * effectivePageSize, (currentPage + 1) * effectivePageSize);
  const thClass =
    'cursor-pointer select-none px-3 py-1.5 font-medium transition-colors hover:text-foreground';
  const pageBtnClass =
    'rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30';

  const total = nodes.length;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const largestIsland = result.islandSizes[0] ?? 0;
  const connectedIslands = result.islandSizes.filter((s) => s > 1).length;
  const isolated = result.islandSizes.filter((s) => s === 1).length;

  return (
    <>
      <p className="text-xs text-muted-foreground">{t('mesh_health_po_caption')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Pill<Scope>
          label={t('mesh_health_po_scope_label')}
          value={scope}
          onChange={setScope}
          options={[
            { id: 'infra', label: t('mesh_health_po_scope_infra') },
            { id: 'all', label: t('mesh_health_po_scope_all') },
          ]}
        />
        <Pill<HeardWithin>
          label={t('mesh_health_po_heard_label')}
          value={heardWithin}
          onChange={setHeardWithin}
          options={[
            { id: '24h', label: t('mesh_health_po_heard_24h') },
            { id: '7d', label: t('mesh_health_po_heard_7d') },
            { id: '30d', label: t('mesh_health_po_heard_30d') },
            { id: 'all', label: t('mesh_health_po_heard_all') },
          ]}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatTile label={t('mesh_health_po_stat_nodes')} value={total} />
        <StatTile
          label={t('mesh_health_po_stat_online')}
          value={`${pct(result.survivors)}%`}
          sub={t('mesh_health_po_stat_of', { count: result.survivors, total })}
        />
        <StatTile
          label={t('mesh_health_po_stat_dark')}
          value={result.dark}
          sub={t('mesh_health_po_stat_unknown_sub', { count: dist.Unknown })}
        />
        <StatTile
          label={t('mesh_health_po_stat_links')}
          value={result.survivingLinks}
          sub={t('mesh_health_po_stat_links_sub', { total: result.links })}
        />
        <StatTile
          label={t('mesh_health_po_stat_largest_island')}
          value={largestIsland}
          sub={t('mesh_health_po_stat_largest_island_sub')}
        />
        <StatTile label={t('mesh_health_po_stat_islands')} value={connectedIslands} />
        <StatTile label={t('mesh_health_po_stat_isolated')} value={isolated} />
      </div>

      <div className="rounded-lg border border-border bg-card p-2.5">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('mesh_health_po_dist_heading')}
        </div>
        <DistBars
          items={POWER_SOURCES.map((s) => ({
            label: t(POWER_SOURCE_LABEL_KEY[s]),
            count: dist[s],
            color: POWER_COLOR[s],
          }))}
        />
      </div>

      <p className="text-[10px] text-muted-foreground">{t('mesh_health_po_note')}</p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Pill<StatusFilter>
          label={t('mesh_health_po_status_label')}
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { id: 'all', label: t('mesh_health_po_filter_all') },
            { id: 'online', label: t('mesh_health_po_status_online') },
            { id: 'dark', label: t('mesh_health_po_status_dark') },
          ]}
        />
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {t('mesh_health_po_rows_summary', { count: rows.length })}
            {totalPages > 1 &&
              t('mesh_health_page_indicator', { page: currentPage + 1, total: totalPages })}
          </span>
          <select
            value={pageSize}
            onChange={(e) => onSaveAppSettings?.({ mesh_health_page_size: Number(e.target.value) })}
            aria-label={t('mesh_health_page_size_label')}
            title={t('mesh_health_page_size_label')}
            className="h-7 rounded-md border border-input bg-background px-1.5 text-[11px] text-foreground"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? t('mesh_health_page_size_all') : n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {t('mesh_health_po_empty')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th
                  className={thClass}
                  onClick={() => handleSort('name')}
                  aria-sort={
                    sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  {t('mesh_health_po_col_node')}
                  <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th
                  className={thClass}
                  onClick={() => handleSort('role')}
                  aria-sort={
                    sortKey === 'role' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  {t('mesh_health_po_col_role')}
                  <SortIcon col="role" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th
                  className={thClass}
                  onClick={() => handleSort('power')}
                  aria-sort={
                    sortKey === 'power' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  {t('mesh_health_po_col_power')}
                  <SortIcon col="power" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th
                  className={thClass}
                  onClick={() => handleSort('status')}
                  aria-sort={
                    sortKey === 'status' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  {t('mesh_health_po_col_status')}
                  <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th
                  className={thClass}
                  onClick={() => handleSort('island')}
                  aria-sort={
                    sortKey === 'island' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  {t('mesh_health_po_col_island')}
                  <SortIcon col="island" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th
                  className={thClass}
                  onClick={() => handleSort('heard')}
                  aria-sort={
                    sortKey === 'heard' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  {t('mesh_health_po_col_heard')}
                  <SortIcon col="heard" sortKey={sortKey} sortDir={sortDir} />
                </th>
                {onNavigateToMap && <th className="px-3 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((n) => {
                const online = survivesOutage(n.power);
                const island = result.islandOf.get(n.key);
                const islandSize = island ? result.islandSizes[island - 1] : 0;
                return (
                  <tr
                    key={n.key}
                    className="border-b border-border transition-colors last:border-0 hover:bg-background"
                  >
                    <td className="px-3 py-1.5">
                      {onOpenNode ? (
                        <button
                          type="button"
                          onClick={() => onOpenNode(n.contact.public_key, n.contact.name)}
                          className="text-left text-primary hover:underline"
                        >
                          {n.contact.name || `${n.contact.public_key.slice(0, 6)}…`}
                        </button>
                      ) : (
                        <span className="text-foreground">{n.contact.name}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {contactTypeLabel(n.contact.type, t)}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: POWER_COLOR[n.power] }}
                        />
                        {t(POWER_SOURCE_LABEL_KEY[n.power])}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          online
                            ? 'bg-success/20 text-success'
                            : 'bg-destructive/15 text-destructive'
                        }`}
                      >
                        {online
                          ? t('mesh_health_po_status_online')
                          : t('mesh_health_po_status_dark')}
                      </span>
                    </td>
                    <td
                      className="px-3 py-1.5 tabular-nums text-muted-foreground"
                      title={
                        island ? t('mesh_health_po_island_title', { count: islandSize }) : undefined
                      }
                    >
                      {island ? `#${island} (${islandSize})` : '-'}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {relTime(n.contact.last_seen, t)}
                    </td>
                    {onNavigateToMap && (
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => onNavigateToMap(n.contact.public_key)}
                          title={t('mesh_health_po_show_on_map')}
                          aria-label={t('mesh_health_po_show_on_map')}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <MapPin className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
              <span className="text-[10px] text-muted-foreground">
                {t('mesh_health_pagination_range', {
                  start: currentPage * effectivePageSize + 1,
                  end: Math.min((currentPage + 1) * effectivePageSize, rows.length),
                  total: rows.length,
                })}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(0)}
                  disabled={currentPage === 0}
                  className={pageBtnClass}
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage === 0}
                  className={pageBtnClass}
                >
                  {t('mesh_health_pagination_prev')}
                </button>
                {Array.from({ length: totalPages }, (_, i) => i)
                  .filter((i) => Math.abs(i - currentPage) <= 2)
                  .map((i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPage(i)}
                      aria-current={i === currentPage ? 'page' : undefined}
                      className={`rounded px-2 py-0.5 text-xs transition-colors ${
                        i === currentPage
                          ? 'bg-primary font-medium text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= totalPages - 1}
                  className={pageBtnClass}
                >
                  {t('mesh_health_pagination_next')}
                </button>
                <button
                  type="button"
                  onClick={() => setPage(totalPages - 1)}
                  disabled={currentPage >= totalPages - 1}
                  className={pageBtnClass}
                >
                  »
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
