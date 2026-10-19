/**
 * Mesh Health "Firmware updates": meshcore_fuota traffic heard by this radio,
 * grouped by update campaign (GET /api/packets/fuota-traffic). Passive only.
 * FUOTA packets are never forwarded, so every sender is a direct neighbour.
 */
import { useEffect, useMemo, useState } from 'react';

import { useT } from '../i18n';
import type { Contact } from '../types';
import { type TimeWindow, StatTile, relTime } from './meshHealthShared';

interface FuotaSender {
  sender: string;
  count: number;
  best_rssi: number | null;
  best_snr: number | null;
  kinds: string[];
}

interface FuotaCampaign {
  campaign: string;
  first_seen: number;
  last_seen: number;
  build: number | null;
  target: number | null;
  patch_size: number | null;
  manifest_len: number | null;
  source_prefix: string | null;
  offers: number;
  requests: number;
  data: number;
  fragments_heard: number[];
  senders: FuotaSender[];
  providers_asked: string[];
  airtime_ms: number | null;
}

interface FuotaTrafficResponse {
  start_ts: number;
  end_ts: number;
  visibility_limit_bytes: number;
  totals: {
    offers: number;
    requests: number;
    data: number;
    retracts: number;
    senders: number;
    airtime_ms: number | null;
  };
  campaigns: FuotaCampaign[];
  retracts: { ts: number; sender: string; count: number }[];
}

interface Props {
  selectedWindow: TimeWindow;
  /** Incremented by the shell's refresh button to force a re-fetch. */
  refreshKey: number;
  /** Reports loading state up to the shell so the refresh spinner can reflect it. */
  onLoadingChange?: (loading: boolean) => void;
  /** Known contacts, used to name the 1-byte sender prefixes. */
  contacts: Contact[];
  onOpenNode?: (publicKey: string, name: string | null) => void;
}

const DASH = '-';

function fmtNumber(v: number | null): string {
  return v == null ? DASH : String(v);
}

function fmtSize(bytes: number | null): string {
  if (bytes == null) return DASH;
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

function fmtAirtime(ms: number | null): string {
  if (ms == null) return DASH;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function fetchUrl(window: TimeWindow): string {
  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - Math.round(window.hours * 3600);
  return `./api/packets/fuota-traffic?start_ts=${startTs}&end_ts=${endTs}`;
}

export function MeshFuotaPanel({
  selectedWindow,
  refreshKey,
  onLoadingChange,
  contacts,
  onOpenNode,
}: Props) {
  const t = useT();
  const [data, setData] = useState<FuotaTrafficResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(fetchUrl(selectedWindow))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<FuotaTrafficResponse>;
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

  // Auto-refresh: only for short windows, 30s cadence (same as Requests).
  useEffect(() => {
    if (!selectedWindow.autoRefresh) return;
    const id = setInterval(() => {
      fetch(fetchUrl(selectedWindow))
        .then((r) => (r.ok ? (r.json() as Promise<FuotaTrafficResponse>) : null))
        .then((d) => {
          if (d) setData(d);
        })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [selectedWindow]);

  // The sender is one public-key byte: list every contact it could be.
  const contactsByPrefix = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of contacts) {
      const prefix = c.public_key?.slice(0, 2).toLowerCase();
      if (!prefix) continue;
      const list = map.get(prefix) ?? [];
      list.push(c);
      map.set(prefix, list);
    }
    return map;
  }, [contacts]);

  const totals = data?.totals;
  const hasTraffic =
    totals != null && totals.offers + totals.requests + totals.data + totals.retracts > 0;

  return (
    <>
      <p className="text-xs text-muted-foreground">{t('fuota_caption')}</p>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded border border-border bg-background"
            />
          ))}
        </div>
      )}

      {totals && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <div data-testid="fuota-tile-offers">
            <StatTile label={t('fuota_tile_offers')} value={totals.offers} />
          </div>
          <div data-testid="fuota-tile-requests">
            <StatTile label={t('fuota_tile_requests')} value={totals.requests} />
          </div>
          <div data-testid="fuota-tile-data">
            <StatTile label={t('fuota_tile_data')} value={totals.data} />
          </div>
          <div data-testid="fuota-tile-retracts">
            <StatTile label={t('fuota_tile_retracts')} value={totals.retracts} />
          </div>
          <div data-testid="fuota-tile-senders">
            <StatTile label={t('fuota_tile_senders')} value={totals.senders} />
          </div>
          <div data-testid="fuota-tile-airtime">
            <StatTile label={t('fuota_tile_airtime')} value={fmtAirtime(totals.airtime_ms)} />
          </div>
        </div>
      )}

      {hasTraffic && <p className="text-[10px] text-muted-foreground">{t('fuota_unique_note')}</p>}

      {data && !hasTraffic && (
        <div className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
          {t('fuota_empty')}
        </div>
      )}

      {data && data.campaigns.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t('fuota_col_campaign')}</th>
                  <th className="px-3 py-2 font-medium">{t('fuota_col_build')}</th>
                  <th className="px-3 py-2 font-medium">{t('fuota_col_target')}</th>
                  <th className="px-3 py-2 font-medium">{t('fuota_col_patch_size')}</th>
                  <th className="px-3 py-2 font-medium">{t('fuota_col_seen')}</th>
                  <th className="px-3 py-2 font-medium">{t('fuota_col_senders')}</th>
                  <th className="px-3 py-2 font-medium">{t('fuota_col_fragments')}</th>
                  <th className="px-3 py-2 font-medium">{t('fuota_col_providers')}</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((c) => (
                  <tr
                    key={c.campaign}
                    data-testid={`fuota-campaign-${c.campaign}`}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2 font-mono">{c.campaign}</td>
                    <td
                      className="px-3 py-2 tabular-nums"
                      data-testid={`fuota-build-${c.campaign}`}
                    >
                      {fmtNumber(c.build)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmtNumber(c.target)}</td>
                    <td
                      className="px-3 py-2 tabular-nums"
                      data-testid={`fuota-patch-${c.campaign}`}
                    >
                      {fmtSize(c.patch_size)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {relTime(c.first_seen, t)} / {relTime(c.last_seen, t)}
                    </td>
                    <td className="px-3 py-2" data-testid={`fuota-senders-${c.campaign}`}>
                      {c.senders.map((s) => {
                        const matches = contactsByPrefix.get(s.sender) ?? [];
                        return (
                          <div key={s.sender}>
                            <span className="font-mono">{s.sender}</span>
                            {matches.length > 0 && (
                              <span className="text-muted-foreground">
                                {' ('}
                                {matches.map((m, i) => (
                                  <span key={m.public_key}>
                                    {i > 0 && ', '}
                                    {onOpenNode ? (
                                      <button
                                        type="button"
                                        className="underline-offset-2 hover:underline"
                                        onClick={() => onOpenNode(m.public_key, m.name ?? null)}
                                      >
                                        {m.name || m.public_key.slice(0, 12)}
                                      </button>
                                    ) : (
                                      m.name || m.public_key.slice(0, 12)
                                    )}
                                  </span>
                                ))}
                                {')'}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {t('fuota_fragments_heard', { count: c.fragments_heard.length })}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {c.providers_asked.length > 0 ? c.providers_asked.join(', ') : DASH}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && data.retracts.length > 0 && (
        <div className="rounded-lg border border-border bg-card px-3 py-2">
          <div className="mb-1 text-sm font-semibold text-foreground">
            {t('fuota_retracts_title')}
          </div>
          <ul className="space-y-0.5 text-xs">
            {data.retracts.map((r) => (
              <li key={`${r.ts}-${r.sender}`}>
                <span className="font-mono">{r.sender}</span>{' '}
                <span className="text-muted-foreground">{relTime(r.ts, t)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && (
        <p className="text-[10px] text-muted-foreground">
          {t('fuota_visibility_note', { bytes: data.visibility_limit_bytes })}
        </p>
      )}
    </>
  );
}
