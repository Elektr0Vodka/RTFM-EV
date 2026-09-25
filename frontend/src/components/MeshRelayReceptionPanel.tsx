/**
 * MeshRelayReceptionPanel.tsx
 *
 * The "Relay reception" view of the Mesh Health page (plan 21 S1): for every
 * flooded packet this node heard more than once, which relay delivered each
 * copy and the SNR/RSSI our radio measured for it. A copy with no relay was
 * heard straight from the origin. Only flood-routed packets are recorded
 * (direct routes pop their path, so the last hop is not the deliverer).
 *
 * Rendered inside the MeshHealthView shell (header, tab pill, shared time
 * window, refresh); this panel returns only its content blocks.
 */

import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { formatDateTime } from '../utils/dateTimeFormat';
import { formatSNR } from '../utils/traceMapUtils';
import { type TimeWindow, relTime, StatTile } from './meshHealthShared';

// ─── Types (mirror app/routers/packets.py) ──────────────────────────────────

export interface RelayCell {
  last_hop_hex: string | null;
  count: number;
  best_snr: number | null;
  last_snr: number | null;
  best_rssi: number | null;
  last_rssi: number | null;
  last_seen: number;
  resolved_pubkey: string | null;
  resolved_name: string | null;
  candidates: number;
}
export interface RelayPacket {
  payload_hash: string;
  payload_type: string;
  route_type: string;
  first_seen: number;
  last_seen: number;
  copies: number;
  relays: RelayCell[];
  preview: string | null;
  message_id: number | null;
}
export interface RelaySummary {
  last_hop_hex: string | null;
  receptions: number;
  packets: number;
  best_snr: number | null;
  avg_snr: number | null;
  last_snr: number | null;
  best_rssi: number | null;
  last_seen: number;
  resolved_pubkey: string | null;
  resolved_name: string | null;
  candidates: number;
}
export interface RelayReceptionResponse {
  start_ts: number;
  end_ts: number;
  receptions: number;
  packets: RelayPacket[];
  relays: RelaySummary[];
}

interface Props {
  selectedWindow: TimeWindow;
  /** Incremented by the shell's refresh button to force a re-fetch. */
  refreshKey: number;
  /** Reports loading state up to the shell so the refresh spinner can reflect it. */
  onLoadingChange?: (loading: boolean) => void;
  /** Opens a contact's info page (resolved relays are clickable). */
  onOpenNode?: (publicKey: string, name: string | null) => void;
}

const MAX_RELAY_COLUMNS = 8;
type SummarySort = 'receptions' | 'best_snr' | 'last_seen';

/**
 * Relay identity for a column/row: the resolved full key when unique, else the
 * raw hash. The same relay arrives as `6942` or `694203` depending on the
 * packet's path hash width; the backend merges the summary by full key, so
 * cells must match columns the same way.
 */
function relayKey(relay: { last_hop_hex: string | null; resolved_pubkey: string | null }): string {
  return relay.resolved_pubkey ?? relay.last_hop_hex ?? '__direct__';
}

function fmtRssi(rssi: number | null): string {
  return rssi === null ? '' : `${rssi} dBm`;
}

export function MeshRelayReceptionPanel({
  selectedWindow,
  refreshKey,
  onLoadingChange,
  onOpenNode,
}: Props) {
  const t = useT();
  const [data, setData] = useState<RelayReceptionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summarySort, setSummarySort] = useState<SummarySort>('receptions');

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    const endTs = Math.floor(Date.now() / 1000);
    const startTs = endTs - selectedWindow.hours * 3600;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/packets/relay-reception?start_ts=${startTs}&end_ts=${endTs}&limit=50`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<RelayReceptionResponse>;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t('mesh_health_error_failed_to_load'));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWindow, refreshKey, t]);

  const relayLabel = (cell: { last_hop_hex: string | null; resolved_name: string | null }) => {
    if (cell.last_hop_hex === null) return t('relay_reception_direct');
    return cell.resolved_name || cell.last_hop_hex;
  };

  // Pivot columns: the most active relays (by receptions) across the window.
  const columns = useMemo(() => {
    if (!data) return [];
    return data.relays.slice(0, MAX_RELAY_COLUMNS);
  }, [data]);

  const sortedSummary = useMemo(() => {
    if (!data) return [];
    const rows = [...data.relays];
    rows.sort((a, b) => {
      if (summarySort === 'best_snr') return (b.best_snr ?? -999) - (a.best_snr ?? -999);
      if (summarySort === 'last_seen') return b.last_seen - a.last_seen;
      return b.receptions - a.receptions;
    });
    return rows;
  }, [data, summarySort]);

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>;
  }
  if (!data) {
    return <div className="text-sm text-muted-foreground">{t('mesh_health_loading')}</div>;
  }

  const multiRelayPackets = data.packets.filter((p) => p.relays.length > 1).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label={t('relay_reception_tile_receptions')} value={data.receptions} />
        <StatTile label={t('relay_reception_tile_multi')} value={multiRelayPackets} />
        <StatTile label={t('relay_reception_tile_relays')} value={data.relays.length} />
      </div>

      <p className="text-[0.8125rem] text-muted-foreground">{t('relay_reception_intro')}</p>

      {data.packets.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t('relay_reception_empty')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="relay-reception-pivot">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2">{t('relay_reception_col_packet')}</th>
                <th className="py-1 pr-2 text-right">{t('relay_reception_col_copies')}</th>
                {columns.map((col) => (
                  <th key={relayKey(col)} className="py-1 px-2 text-right">
                    {col.resolved_pubkey && onOpenNode ? (
                      <button
                        type="button"
                        className="hover:text-primary hover:underline"
                        onClick={() => onOpenNode(col.resolved_pubkey as string, col.resolved_name)}
                      >
                        {relayLabel(col)}
                      </button>
                    ) : (
                      <span
                        className={col.last_hop_hex ? 'font-mono' : ''}
                        title={
                          col.candidates > 1
                            ? t('relay_reception_collision', { count: col.candidates })
                            : undefined
                        }
                      >
                        {relayLabel(col)}
                        {col.candidates > 1 ? ' ?' : ''}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.packets.map((p) => {
                const byHop = new Map(p.relays.map((c) => [relayKey(c), c]));
                const extra = p.relays.filter(
                  (c) => !columns.some((col) => relayKey(col) === relayKey(c))
                );
                return (
                  <tr key={p.payload_hash} className="border-t border-border/60 align-top">
                    <td className="py-1 pr-2">
                      <div className="font-medium">
                        {p.payload_type}
                        <span className="ml-1 text-muted-foreground">{p.route_type}</span>
                      </div>
                      <div className="text-muted-foreground">
                        {formatDateTime(new Date(p.last_seen * 1000), {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                        {p.preview ? ` · ${p.preview}` : ''}
                      </div>
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{p.copies}</td>
                    {columns.map((col) => {
                      const cell = byHop.get(relayKey(col));
                      return (
                        <td key={relayKey(col)} className="py-1 px-2 text-right tabular-nums">
                          {cell ? (
                            <span title={fmtRssi(cell.best_rssi)}>
                              {formatSNR(cell.best_snr) ?? '—'}
                              {cell.count > 1 ? ` ×${cell.count}` : ''}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">·</span>
                          )}
                        </td>
                      );
                    })}
                    {extra.length > 0 && (
                      <td className="py-1 px-2 text-muted-foreground">
                        {t('relay_reception_more_relays', { count: extra.length })}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data.relays.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">{t('relay_reception_summary_heading')}</h3>
          <table className="w-full text-xs" data-testid="relay-reception-summary">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2">{t('relay_reception_col_relay')}</th>
                {(
                  [
                    ['receptions', t('relay_reception_col_receptions')],
                    ['best_snr', t('relay_reception_col_best_snr')],
                    ['last_seen', t('relay_reception_col_last_seen')],
                  ] as [SummarySort, string][]
                ).map(([key, label]) => (
                  <th key={key} className="py-1 px-2 text-right">
                    <button
                      type="button"
                      className={summarySort === key ? 'text-foreground' : 'hover:text-foreground'}
                      onClick={() => setSummarySort(key)}
                    >
                      {label}
                      {summarySort === key ? ' ▼' : ''}
                    </button>
                  </th>
                ))}
                <th className="py-1 px-2 text-right">{t('relay_reception_col_avg_snr')}</th>
                <th className="py-1 px-2 text-right">{t('relay_reception_col_packets')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedSummary.map((r) => (
                <tr key={relayKey(r)} className="border-t border-border/60">
                  <td className="py-1 pr-2">
                    {r.resolved_pubkey && onOpenNode ? (
                      <button
                        type="button"
                        className="hover:text-primary hover:underline"
                        onClick={() => onOpenNode(r.resolved_pubkey as string, r.resolved_name)}
                      >
                        {relayLabel(r)}
                      </button>
                    ) : (
                      <span className={r.last_hop_hex ? 'font-mono' : ''}>
                        {relayLabel(r)}
                        {r.candidates > 1 ? ' ?' : ''}
                      </span>
                    )}
                  </td>
                  <td className="py-1 px-2 text-right tabular-nums">{r.receptions}</td>
                  <td className="py-1 px-2 text-right tabular-nums">
                    {formatSNR(r.best_snr) ?? '—'}
                  </td>
                  <td className="py-1 px-2 text-right">{relTime(r.last_seen, t)}</td>
                  <td className="py-1 px-2 text-right tabular-nums">
                    {formatSNR(r.avg_snr) ?? '—'}
                  </td>
                  <td className="py-1 px-2 text-right tabular-nums">{r.packets}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
