import { useEffect, useState } from 'react';

import { api } from '../api';
import type { PacketObserver, PacketWhoHeard as PacketWhoHeardData } from '../types';
import { formatDateTime } from '../utils/dateTimeFormat';
import { Button } from './ui/button';
import { useT } from '../i18n';

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function observerLabel(observer: PacketObserver, unknown: string): string {
  return observer.observer_name ?? observer.observer_id?.slice(0, 12) ?? unknown;
}

/**
 * "Who heard this": which observers of the external analyzer received the same
 * packet, for comparing your own reception with the rest of the mesh.
 *
 * Opening the inspector only hashes the packet on our own server (for the hash
 * and the links). The analyzer is asked only when the button is pressed, and
 * then it gets the hash, not the packet.
 */
export function PacketWhoHeard({ packetHex }: { packetHex: string }) {
  const t = useT();
  const [data, setData] = useState<PacketWhoHeardData | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setAsking(false);
    api
      .packetWhoHeard(packetHex)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        // Not a packet the server can hash: the section stays hidden.
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [packetHex]);

  if (!data) return null;
  const host = hostOf(data.analyzer_url);

  const ask = async () => {
    setAsking(true);
    setError(null);
    try {
      const result = await api.packetWhoHeard(packetHex, true);
      // Ignore an answer for a packet the panel has moved away from.
      if (result.packet_hash === data.packet_hash) setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAsking(false);
    }
  };

  const firstHeard = data.observers.find((o) => o.heard_at !== null)?.heard_at ?? null;

  return (
    <div
      className="mt-3 rounded-lg border border-border/70 bg-card/70 p-3"
      data-testid="packet-who-heard"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-xl font-semibold text-foreground">{t('packet_who_heard_heading')}</div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={asking}
          onClick={() => void ask()}
        >
          {asking ? t('packet_who_heard_asking') : t('packet_who_heard_ask', { host })}
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">
          {t('packet_who_heard_hash_label')}{' '}
          <span className="font-mono text-foreground">{data.packet_hash}</span>
        </span>
        {data.links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {t('packet_who_heard_open_in', { name: link.name })}
          </a>
        ))}
      </div>

      {!data.looked_up && !error ? (
        <p className="mt-2 text-xs text-muted-foreground">{t('packet_who_heard_hint', { host })}</p>
      ) : null}

      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {t('packet_who_heard_failed', { error })}
        </p>
      ) : null}

      {data.looked_up && !data.found ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t('packet_who_heard_not_found', { host })}
        </p>
      ) : null}

      {data.looked_up && data.found ? (
        <>
          <p className="mt-2 text-sm text-foreground">
            {t('packet_who_heard_summary', {
              observations: data.observation_count,
              observers: data.observer_count,
            })}
            {data.truncated ? (
              <span className="text-muted-foreground">
                {' '}
                {t('packet_who_heard_truncated', { count: data.observers.length })}
              </span>
            ) : null}
          </p>
          {data.observers.length > 0 ? (
            <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-border/60">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-card text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 font-medium">{t('packet_who_heard_col_observer')}</th>
                    <th className="px-2 py-1 font-medium">{t('packet_who_heard_col_region')}</th>
                    <th className="px-2 py-1 font-medium">{t('packet_who_heard_col_heard')}</th>
                    <th className="px-2 py-1 text-right font-medium">
                      {t('relay_detail_col_rssi')}
                    </th>
                    <th className="px-2 py-1 text-right font-medium">
                      {t('relay_detail_col_snr')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.observers.map((observer, index) => (
                    <tr
                      key={`${observer.observer_id ?? observer.observer_name}-${observer.heard_at}-${index}`}
                      className="border-t border-border/60"
                    >
                      <td className="px-2 py-1 text-foreground">
                        {observerLabel(observer, t('packet_who_heard_unknown_observer'))}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">{observer.region ?? ''}</td>
                      <td className="px-2 py-1 font-mono text-muted-foreground">
                        {observer.heard_at === null
                          ? ''
                          : `${formatDateTime(observer.heard_at * 1000, {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}${
                              firstHeard !== null
                                ? ` (+${(observer.heard_at - firstHeard).toFixed(1)} s)`
                                : ''
                            }`}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-foreground">
                        {observer.rssi ?? ''}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-foreground">
                        {observer.snr === null ? '' : observer.snr.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
