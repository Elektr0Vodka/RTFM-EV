/**
 * Tools > SNMP: every node with SNMP set up, in one table.
 *
 * The overview reads stored data only (`GET /api/snmp/nodes`). "Poll now" and
 * "Poll all now" go through the per contact poll endpoint, which talks UDP on
 * the LAN. Nothing on this page uses the radio: the address lookup that does
 * (one CLI command over RF) stays on the contact page. A row opens the node's
 * own page (`SnmpNodeView`) with all values and graphs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, RefreshCw } from 'lucide-react';
import { api, isAbortError } from '../api';
import { useT } from '../i18n';
import { cn } from '@/lib/utils';
import type { SnmpNodeOverview } from '../types';
import { contactTypeLabel } from './ContactInfoBody';
import { Button } from './ui/button';
import { SnmpRefreshSelect, useSnmpRefreshSeconds } from './snmp/SnmpRefreshSelect';
import { SNMP_FIELDS, formatSnmpTime, formatSnmpValue, type SnmpField } from './snmp/snmpFields';
import {
  SnmpStatusBadge,
  applySnmpPoll,
  snmpNodeName,
  snmpNodeStatus,
  type SnmpNodeStatus,
} from './snmp/snmpNode';

const NO_VALUE = '-';

// The values shown side by side in the overview, in column order.
const OVERVIEW_VALUE_KEYS = [
  'firmware_version',
  'uptime_secs',
  'free_heap',
  'max_alloc',
  'mqtt_connected_slots',
  'mqtt_queue_depth',
  'wifi_rssi',
  'noise_floor',
  'recv_errors',
  'last_rssi',
  'last_snr',
];
const VALUE_COLUMNS: SnmpField[] = OVERVIEW_VALUE_KEYS.flatMap((key) =>
  SNMP_FIELDS.filter((field) => field.key === key)
);
// Text reads from the left; every other value is a number and lines up on the right.
const TEXT_VALUE_KEYS = new Set(['firmware_version']);

const BASE_COLUMNS: { key: string; labelKey: string }[] = [
  { key: 'status', labelKey: 'snmp_page_col_status' },
  { key: 'name', labelKey: 'snmp_page_col_node' },
  { key: 'address', labelKey: 'snmp_page_col_address' },
  { key: 'schedule', labelKey: 'snmp_page_col_schedule' },
  { key: 'last_ok', labelKey: 'snmp_page_col_last_ok' },
  { key: 'last_error', labelKey: 'snmp_page_col_last_error' },
];

type SortDir = 'asc' | 'desc';

// Failing nodes first: that is the default order.
const STATUS_RANK: Record<SnmpNodeStatus, number> = { failing: 0, never: 1, ok: 2 };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sortValue(node: SnmpNodeOverview, key: string): number | string | null {
  switch (key) {
    case 'status':
      return STATUS_RANK[snmpNodeStatus(node)];
    case 'name':
      return snmpNodeName(node).toLowerCase();
    case 'address':
      return `${node.host}:${node.port}`;
    case 'schedule':
      return node.poll_enabled ? node.poll_interval_minutes : null;
    case 'last_ok':
      return node.last_ok_at;
    case 'last_error':
      return node.last_error_at;
    default: {
      const value = node.latest?.values[key];
      if (value === null || value === undefined || value === '') return null;
      return typeof value === 'string' ? value.toLowerCase() : value;
    }
  }
}

/** Sorted copy. Nodes without a value for the column go last in both directions. */
export function sortSnmpNodes(
  nodes: SnmpNodeOverview[],
  key: string,
  dir: SortDir
): SnmpNodeOverview[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...nodes].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    let cmp = 0;
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
    } else if (typeof x === 'number' && typeof y === 'number') {
      cmp = (x - y) * sign;
    } else {
      cmp = String(x).localeCompare(String(y)) * sign;
    }
    return (
      cmp || snmpNodeName(a).localeCompare(snmpNodeName(b), undefined, { sensitivity: 'base' })
    );
  });
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-40" aria-hidden />;
  return dir === 'asc' ? (
    <ChevronUp className="ml-1 inline h-3 w-3" aria-hidden />
  ) : (
    <ChevronDown className="ml-1 inline h-3 w-3" aria-hidden />
  );
}

export function SnmpView({
  onOpenContactInfo,
  onOpenNode,
}: {
  /** Opens a contact's page, where its SNMP settings live. */
  onOpenContactInfo: (publicKey: string) => void;
  /** Opens the SNMP page of one node (all values and graphs). */
  onOpenNode: (publicKey: string) => void;
}) {
  const t = useT();
  const [nodes, setNodes] = useState<SnmpNodeOverview[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState('status');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [polling, setPolling] = useState<ReadonlySet<string>>(new Set());
  const [pollErrors, setPollErrors] = useState<Record<string, string>>({});
  const [pollAllProgress, setPollAllProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [refreshSeconds, setRefreshSeconds] = useSnmpRefreshSeconds();
  // Polls in flight. An auto refresh that started before a poll finished could
  // put older data back over the poll's result, so it waits for the next tick.
  const pollsInFlight = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const rows = await api.snmpNodes(signal);
      setNodes(rows);
      setLoadError(null);
    } catch (err) {
      if (isAbortError(err)) return;
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    if (refreshSeconds <= 0) return;
    const timer = window.setInterval(() => {
      if (pollsInFlight.current === 0) void load();
    }, refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [refreshSeconds, load]);

  const sorted = useMemo(
    () => sortSnmpNodes(nodes ?? [], sortKey, sortDir),
    [nodes, sortKey, sortDir]
  );

  const handleSort = (key: string) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const pollOne = useCallback(async (publicKey: string) => {
    pollsInFlight.current += 1;
    setPolling((prev) => new Set(prev).add(publicKey));
    setPollErrors((prev) => {
      const next = { ...prev };
      delete next[publicKey];
      return next;
    });
    try {
      const result = await api.pollSnmp(publicKey);
      setNodes(
        (prev) =>
          prev?.map((node) =>
            node.public_key === publicKey ? applySnmpPoll(node, result) : node
          ) ?? prev
      );
    } catch (err) {
      setPollErrors((prev) => ({ ...prev, [publicKey]: errorMessage(err) }));
    } finally {
      pollsInFlight.current -= 1;
      setPolling((prev) => {
        const next = new Set(prev);
        next.delete(publicKey);
        return next;
      });
    }
  }, []);

  // One node at a time, in the order shown when the button was pressed.
  const pollAll = async () => {
    const keys = sorted.map((node) => node.public_key);
    for (let index = 0; index < keys.length; index += 1) {
      if (!mounted.current) return;
      setPollAllProgress({ current: index + 1, total: keys.length });
      await pollOne(keys[index]);
    }
    if (mounted.current) setPollAllProgress(null);
  };

  const hasNodes = sorted.length > 0;
  // Long labels wrap, so eleven value columns do not push the table off screen.
  const headerCell = (key: string, label: string, align?: 'right') => (
    <th
      key={key}
      scope="col"
      aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-2 py-1.5 align-bottom font-medium', align === 'right' && 'text-right')}
    >
      <button
        type="button"
        onClick={() => handleSort(key)}
        className={cn(
          'inline-flex max-w-[7rem] items-end uppercase leading-tight tracking-wide hover:text-foreground',
          align === 'right' && 'text-right'
        )}
      >
        {label}
        <SortIcon active={sortKey === key} dir={sortDir} />
      </button>
    </th>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="mr-auto min-w-0">
          <h2 className="text-base font-semibold text-foreground">{t('nav_snmp')}</h2>
          <p className="text-xs text-muted-foreground">{t('snmp_page_intro')}</p>
        </div>
        <SnmpRefreshSelect value={refreshSeconds} onChange={setRefreshSeconds} />
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {t('snmp_page_refresh')}
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="snmp-poll-all"
          disabled={!hasNodes || pollAllProgress !== null || polling.size > 0}
          onClick={() => void pollAll()}
        >
          {pollAllProgress
            ? t('snmp_page_poll_all_progress', pollAllProgress)
            : t('snmp_page_poll_all')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {loadError && (
          <p className="text-sm text-destructive" role="alert">
            {t('snmp_page_load_failed', { error: loadError })}
          </p>
        )}

        {nodes === null && !loadError && (
          <p className="text-sm text-muted-foreground">{t('common_loading')}</p>
        )}

        {nodes !== null && !hasNodes && (
          <div
            className="space-y-2 rounded-lg border border-border bg-card px-4 py-6 text-sm"
            data-testid="snmp-empty"
          >
            <p className="font-medium text-foreground">{t('snmp_page_empty_title')}</p>
            <p className="text-muted-foreground">
              {t('snmp_page_empty_body', { card: t('snmp_title'), button: t('snmp_setup') })}
            </p>
            <p className="text-muted-foreground">
              {t('snmp_page_empty_schedule', { option: t('snmp_schedule') })}
            </p>
          </div>
        )}

        {hasNodes && (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[10px] text-muted-foreground">
                  <th scope="col" className="w-8 px-2 py-1.5">
                    <span className="sr-only">{t('snmp_page_col_details')}</span>
                  </th>
                  {BASE_COLUMNS.map((column) => headerCell(column.key, t(column.labelKey)))}
                  {VALUE_COLUMNS.map((field) =>
                    headerCell(
                      field.key,
                      t(field.labelKey),
                      TEXT_VALUE_KEYS.has(field.key) ? undefined : 'right'
                    )
                  )}
                  <th scope="col" className="sticky right-0 bg-card px-2 py-1.5">
                    <span className="sr-only">{t('snmp_page_col_actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((node) => {
                  const publicKey = node.public_key;
                  const status = snmpNodeStatus(node);
                  const failing = status === 'failing';
                  const name = snmpNodeName(node);
                  const busy = polling.has(publicKey);
                  const values = node.latest?.values ?? {};
                  return (
                    // A click anywhere on the row opens the node's page; the
                    // buttons in it stop the click so they keep their own job.
                    <tr
                      key={publicKey}
                      data-testid={`snmp-node-${publicKey}`}
                      data-status={status}
                      onClick={() => onOpenNode(publicKey)}
                      className={cn(
                        'group cursor-pointer border-b border-border transition-colors last:border-0',
                        failing ? 'bg-destructive/10' : 'hover:bg-background'
                      )}
                    >
                      <td
                        className={cn(
                          'border-l-4 px-2 py-1.5',
                          failing ? 'border-l-destructive' : 'border-l-transparent'
                        )}
                      >
                        <button
                          type="button"
                          aria-label={t('snmp_page_open_node', { name })}
                          title={t('snmp_page_open_node', { name })}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenNode(publicKey);
                          }}
                          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <SnmpStatusBadge status={status} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <button
                          type="button"
                          title={t('snmp_page_open_contact', { name })}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenContactInfo(publicKey);
                          }}
                          className="text-left text-primary hover:underline"
                        >
                          {name}
                        </button>
                        {node.type !== null && (
                          <span className="ml-1.5 text-muted-foreground">
                            {contactTypeLabel(node.type, t)}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                        {node.host}:{node.port}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {node.poll_enabled
                          ? t('snmp_page_schedule_minutes', {
                              minutes: node.poll_interval_minutes,
                            })
                          : t('snmp_page_schedule_off')}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {node.last_ok_at ? formatSnmpTime(node.last_ok_at) : NO_VALUE}
                      </td>
                      <td className="px-2 py-1.5">
                        {node.last_error ? (
                          <span className="flex flex-col text-destructive">
                            <span className="max-w-[18rem] truncate" title={node.last_error}>
                              {node.last_error}
                            </span>
                            {node.last_error_at && (
                              <span className="text-[10px] opacity-80">
                                {formatSnmpTime(node.last_error_at)}
                              </span>
                            )}
                          </span>
                        ) : (
                          NO_VALUE
                        )}
                      </td>
                      {VALUE_COLUMNS.map((field) => (
                        <td
                          key={field.key}
                          data-testid={`snmp-cell-${field.key}`}
                          className={cn(
                            'whitespace-nowrap px-2 py-1.5 font-mono',
                            !TEXT_VALUE_KEYS.has(field.key) && 'text-right',
                            failing && 'text-muted-foreground'
                          )}
                        >
                          {formatSnmpValue(field, values)}
                        </td>
                      ))}
                      <td
                        className={cn(
                          'sticky right-0 whitespace-nowrap px-2 py-1.5 text-right transition-colors',
                          failing
                            ? 'bg-[color-mix(in_srgb,hsl(var(--destructive))_10%,hsl(var(--card)))]'
                            : 'bg-card group-hover:bg-background'
                        )}
                      >
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={busy || pollAllProgress !== null}
                          onClick={(e) => {
                            e.stopPropagation();
                            void pollOne(publicKey);
                          }}
                        >
                          {busy ? t('snmp_polling') : t('snmp_poll_now')}
                        </Button>
                        {pollErrors[publicKey] && (
                          <p className="mt-1 text-destructive" role="alert">
                            {t('snmp_page_poll_failed', { error: pollErrors[publicKey] })}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
