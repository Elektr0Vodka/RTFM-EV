/**
 * MeshFilterStatsTables.tsx
 *
 * The "Offenders" block of the Mesh Health "Spam & bots" tab: one switch
 * between three tables (senders, channels, source repeaters), each sortable by
 * a click on its header, paged with the shared Mesh Health page size, and with
 * a CSV download of the rows the server returned.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { MapPin } from 'lucide-react';
import type { Contact } from '../types';
import { useT } from '../i18n';
import { relTime } from './meshHealthShared';
import {
  channelsCsv,
  DIRECT_HOP,
  downloadText,
  filterStatsFilename,
  sendersCsv,
  sourcesCsv,
  type FilterCounts,
  type FilterStatsReport,
  type FilterStatsSender,
} from '../utils/filterStatsReport';

type TableKey = 'senders' | 'channels' | 'sources';

interface Column<T> {
  key: string;
  label: string;
  /** What the column sorts on. */
  sort: (row: T) => number | string;
  cell: (row: T) => ReactNode;
  numeric?: boolean;
}

interface Props {
  report: FilterStatsReport;
  contacts: Contact[];
  /** Rows per page; 0 shows all. */
  pageSize: number;
  scrambled: boolean;
  onOpenNode?: (publicKey: string, name: string | null) => void;
  onNavigateToMap?: (focusKey?: string) => void;
  onAddToBotList?: (sender: FilterStatsSender) => void;
}

function SortableTable<T>({
  columns,
  rows,
  rowKey,
  pageSize,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  pageSize: number;
}) {
  const t = useT();
  const [sortKey, setSortKey] = useState('flagged');
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sortKey);
    if (!column) return rows;
    const out = [...rows].sort((a, b) => {
      const x = column.sort(a);
      const y = column.sort(b);
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      return String(x).localeCompare(String(y));
    });
    return descending ? out.reverse() : out;
  }, [columns, rows, sortKey, descending]);

  const perPage = pageSize <= 0 ? Math.max(sorted.length, 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const current = Math.min(page, totalPages - 1);
  const visible = sorted.slice(current * perPage, (current + 1) * perPage);

  const sortBy = (column: Column<T>) => {
    if (column.key === sortKey) {
      setDescending((d) => !d);
    } else {
      setSortKey(column.key);
      setDescending(column.numeric === true);
    }
    setPage(0);
  };

  if (rows.length === 0) {
    return (
      <div className="px-4 py-5 text-center text-sm text-muted-foreground">
        {t('mesh_filter_no_rows')}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="filter-stats-table">
          <thead>
            <tr className="border-b border-border bg-background">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    column.key !== sortKey ? 'none' : descending ? 'descending' : 'ascending'
                  }
                  className={`px-2 py-1.5 font-semibold text-muted-foreground ${
                    column.numeric ? 'text-right' : 'text-left'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => sortBy(column)}
                    className="hover:text-foreground"
                  >
                    {column.label}
                    {column.key === sortKey ? (descending ? ' ↓' : ' ↑') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-border last:border-0 hover:bg-background transition-colors"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-2 py-1.5 ${
                      column.numeric
                        ? 'text-right tabular-nums text-muted-foreground'
                        : 'text-foreground'
                    }`}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
            className="rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40"
          >
            {t('mesh_filter_page_prev')}
          </button>
          <span>{t('mesh_filter_page_of', { page: current + 1, total: totalPages })}</span>
          <button
            type="button"
            disabled={current >= totalPages - 1}
            onClick={() => setPage(current + 1)}
            className="rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40"
          >
            {t('mesh_filter_page_next')}
          </button>
        </div>
      )}
    </>
  );
}

export function MeshFilterStatsTables({
  report,
  contacts,
  pageSize,
  scrambled,
  onOpenNode,
  onNavigateToMap,
  onAddToBotList,
}: Props) {
  const t = useT();
  // Kept across refreshes on purpose: a new report must not throw away the table the user chose.
  const [table, setTable] = useState<TableKey>('senders');

  const countColumns = <T extends FilterCounts>(): Column<T>[] => [
    numeric('messages', t('mesh_filter_col_messages'), (r) => r.messages),
    numeric('flagged', t('mesh_filter_col_flagged'), (r) => r.flagged),
    numeric('spam', t('mesh_filter_col_spam'), (r) => r.spam),
    numeric('malformed', t('mesh_filter_col_malformed'), (r) => r.malformed),
    numeric('duplicate', t('mesh_filter_col_duplicates'), (r) => r.duplicate),
    numeric('bot_now', t('mesh_filter_col_bots'), (r) => r.bot_now),
  ];

  /** The one contact whose key starts with this hop, if there is exactly one. */
  const contactForHop = (hop: string): Contact | null => {
    if (hop === DIRECT_HOP) return null;
    const needle = hop.toLowerCase();
    const matches = contacts.filter((c) => (c.public_key ?? '').toLowerCase().startsWith(needle));
    return matches.length === 1 ? matches[0] : null;
  };

  const senderColumns: Column<FilterStatsReport['senders'][number]>[] = [
    {
      key: 'name',
      label: t('mesh_filter_col_sender'),
      sort: (s) => s.name,
      cell: (s) => {
        const label = s.name || t('mesh_filter_sender_unknown');
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            {s.public_key && onOpenNode ? (
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => onOpenNode(s.public_key as string, s.name || null)}
              >
                {label}
              </button>
            ) : (
              <span>{label}</span>
            )}
            {s.bot_lists.length > 0 && (
              <span className="rounded bg-primary/15 px-1 text-[10px] text-primary">
                {t('mesh_filter_bot_badge')}
              </span>
            )}
            {s.bot_lists.map((list) => (
              <span key={list} className="text-[10px] text-muted-foreground">
                {list}
              </span>
            ))}
            {!scrambled && s.name && s.bot_lists.length === 0 && onAddToBotList && (
              <button
                type="button"
                className="rounded border border-border px-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => onAddToBotList(s)}
              >
                {t('mesh_filter_add_to_bot_list')}
              </button>
            )}
          </span>
        );
      },
    },
    ...countColumns<FilterStatsReport['senders'][number]>(),
    numeric('bot_flagged', t('mesh_filter_col_flagged_arrival'), (s) => s.bot_flagged),
    {
      key: 'last_seen',
      label: t('mesh_filter_col_last_seen'),
      sort: (s) => s.last_seen,
      cell: (s) => relTime(s.last_seen, t),
      numeric: true,
    },
  ];

  const channelColumns: Column<FilterStatsReport['channels'][number]>[] = [
    {
      key: 'name',
      label: t('mesh_filter_col_channel'),
      sort: (c) => c.name,
      cell: (c) => c.name || t('mesh_filter_channel_unknown'),
    },
    ...countColumns<FilterStatsReport['channels'][number]>(),
  ];

  const sourceColumns: Column<FilterStatsReport['sources'][number]>[] = [
    {
      key: 'hop',
      label: t('mesh_filter_col_source'),
      sort: (s) => s.hop,
      cell: (s) => {
        if (s.hop === DIRECT_HOP) return t('mesh_filter_source_direct');
        const contact = contactForHop(s.hop);
        if (!contact) return <span className="font-mono text-[11px]">{s.hop}</span>;
        const name = contact.name || s.hop;
        return (
          <span className="flex items-center gap-1.5">
            {onOpenNode ? (
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => onOpenNode(contact.public_key, contact.name ?? null)}
              >
                {name}
              </button>
            ) : (
              <span>{name}</span>
            )}
            <span className="font-mono text-[10px] text-muted-foreground">{s.hop}</span>
            {onNavigateToMap && (
              <button
                type="button"
                title={t('mesh_filter_show_on_map')}
                aria-label={t('mesh_filter_show_on_map')}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onNavigateToMap(contact.public_key)}
              >
                <MapPin className="h-3 w-3" />
              </button>
            )}
          </span>
        );
      },
    },
    ...countColumns<FilterStatsReport['sources'][number]>(),
    {
      key: 'last_seen',
      label: t('mesh_filter_col_last_seen'),
      sort: (s) => s.last_seen,
      cell: (s) => relTime(s.last_seen, t),
      numeric: true,
    },
  ];

  const tables: { key: TableKey; label: string }[] = [
    { key: 'senders', label: t('mesh_filter_table_senders') },
    { key: 'channels', label: t('mesh_filter_table_channels') },
    { key: 'sources', label: t('mesh_filter_table_sources') },
  ];

  const downloadCsv = () => {
    const csv =
      table === 'senders'
        ? sendersCsv(report, t)
        : table === 'channels'
          ? channelsCsv(report, t)
          : sourcesCsv(report, t);
    downloadText(filterStatsFilename(table, 'csv', new Date()), csv, 'text/csv', true);
  };

  const truncated =
    (table === 'senders' && report.senders_truncated) ||
    (table === 'sources' && report.sources_truncated);
  const shown = table === 'senders' ? report.senders.length : report.sources.length;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold text-foreground">
          {t('mesh_filter_offenders_heading')}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-md bg-muted p-0.5">
            {tables.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setTable(entry.key)}
                className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  table === entry.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={downloadCsv}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {t('mesh_filter_download_csv')}
          </button>
        </div>
      </div>
      {table === 'senders' && (
        <SortableTable
          columns={senderColumns}
          rows={report.senders}
          rowKey={(s) => s.name}
          pageSize={pageSize}
        />
      )}
      {table === 'channels' && (
        <SortableTable
          columns={channelColumns}
          rows={report.channels}
          rowKey={(c) => c.key}
          pageSize={pageSize}
        />
      )}
      {table === 'sources' && (
        <SortableTable
          columns={sourceColumns}
          rows={report.sources}
          rowKey={(s) => s.hop}
          pageSize={pageSize}
        />
      )}
      {truncated && (
        <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          {t('mesh_filter_truncated', { count: shown })}
        </div>
      )}
    </div>
  );
}

function numeric<T>(key: string, label: string, value: (row: T) => number): Column<T> {
  return { key, label, sort: value, cell: value, numeric: true };
}
