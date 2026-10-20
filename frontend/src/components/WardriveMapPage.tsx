import { useEffect, useState } from 'react';
import { Crosshair } from 'lucide-react';

import { api } from '../api';
import { useT } from '../i18n';
import type { WardriveGroup, WardriveUser } from '../types';
import type { WardriveLiveDriver } from '../wardrive/api';
import { WardriveMapView } from '../wardrive/map/WardriveMapView';
import { formatAge } from '../wardrive/screen/Hud';

/** How often the drivers on the road now are asked for. */
const LIVE_REFRESH_MS = 30000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Tools > Wardrive, Map tab: the owner's coverage map of everything the
 * wardrive drivers stored, filtered by user, group, radio and time window.
 * Reads through /api/wardrive-admin.
 */
export function WardriveMapPage() {
  const t = useT();
  const [users, setUsers] = useState<WardriveUser[]>([]);
  const [groups, setGroups] = useState<WardriveGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapUser, setMapUser] = useState('');
  const [mapGroup, setMapGroup] = useState('');
  const [mapRadio, setMapRadio] = useState('');
  const [live, setLive] = useState<WardriveLiveDriver[]>([]);
  const [focus, setFocus] = useState<{ lat: number; lon: number; nonce: number } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Drivers on the road now: whose page uploaded lately, within the filters.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .getWardriveAdminLive({
          user_id: mapUser ? Number(mapUser) : undefined,
          group_id: mapGroup ? Number(mapGroup) : undefined,
        })
        .then(
          (res) => {
            if (cancelled) return;
            setLive(mapRadio ? res.drivers.filter((d) => d.radio_key === mapRadio) : res.drivers);
            setNowMs(Date.now());
          },
          () => {
            // The map itself still shows; the list waits for the next try.
          }
        );
    };
    load();
    const timer = setInterval(load, LIVE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [mapUser, mapGroup, mapRadio]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getWardriveUsers(), api.getWardriveGroups()]).then(
      ([nextUsers, nextGroups]) => {
        if (cancelled) return;
        setUsers(nextUsers);
        setGroups(nextGroups);
      },
      (err) => {
        if (!cancelled) setError(errorMessage(err));
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* A flex column, so the map takes the height below the filters. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <p className="text-xs text-muted-foreground">{t('wardrive_map_page_intro')}</p>
        {error && (
          <p className="text-xs text-destructive" role="status">
            {error}
          </p>
        )}
        <section aria-label={t('wardrive_live_heading')} className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{t('wardrive_live_heading')}</h3>
          {live.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('wardrive_live_none')}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {live.map((d) => {
                const who = d.username ?? d.radio_key.slice(0, 8);
                return (
                  <li
                    key={`${d.user_id}:${d.radio_key}`}
                    className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full bg-success"
                      aria-hidden
                    />
                    <span className="font-medium text-foreground">{who}</span>
                    <span className="text-muted-foreground">
                      {[
                        d.radio_name ?? d.radio_key.slice(0, 8),
                        d.drive_name,
                        d.last_rssi != null ? `${d.last_rssi} dBm` : null,
                        t('wardrive_live_seen', {
                          age: formatAge(Math.max(0, nowMs - d.last_ts * 1000), t),
                        }),
                        t('wardrive_live_receptions', { count: d.receptions }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-muted"
                      aria-label={t('wardrive_live_show', { name: who })}
                      title={t('wardrive_live_show', { name: who })}
                      onClick={() => setFocus({ lat: d.lat, lon: d.lon, nonce: Date.now() })}
                    >
                      <Crosshair className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <WardriveMapView
          fill
          live={live}
          focus={focus}
          reloadKey={`${mapUser}:${mapGroup}:${mapRadio}`}
          load={(range) =>
            api.getWardriveAdminData({
              ...range,
              user_id: mapUser ? Number(mapUser) : undefined,
              group_id: mapGroup ? Number(mapGroup) : undefined,
              radio_key: mapRadio || undefined,
            })
          }
          filters={
            <>
              <label className="space-y-1 text-sm">
                <span className="block text-xs text-muted-foreground">
                  {t('wardrive_map_user')}
                </span>
                <select
                  aria-label={t('wardrive_map_user')}
                  value={mapUser}
                  onChange={(e) => setMapUser(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">{t('wardrive_map_all_users')}</option>
                  {users.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {u.username}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="block text-xs text-muted-foreground">
                  {t('wardrive_map_group')}
                </span>
                <select
                  aria-label={t('wardrive_map_group')}
                  value={mapGroup}
                  onChange={(e) => setMapGroup(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">{t('wardrive_map_all_groups')}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="block text-xs text-muted-foreground">
                  {t('wardrive_map_radio')}
                </span>
                <select
                  aria-label={t('wardrive_map_radio')}
                  value={mapRadio}
                  onChange={(e) => setMapRadio(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">{t('wardrive_map_all_radios')}</option>
                  {users
                    .filter((u) => !mapUser || String(u.id) === mapUser)
                    .flatMap((u) =>
                      u.radios.map((r) => (
                        <option key={r.public_key} value={r.public_key}>
                          {`${r.name || r.public_key.slice(0, 8)} (${u.username})`}
                        </option>
                      ))
                    )}
                </select>
              </label>
            </>
          }
        />
      </div>
    </div>
  );
}
