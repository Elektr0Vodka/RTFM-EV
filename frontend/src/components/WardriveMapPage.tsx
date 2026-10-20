import { Crosshair } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';

import { api } from '../api';
import { useT } from '../i18n';
import type { WardriveGroup, WardriveUser } from '../types';
import type { WardriveLiveDriver } from '../wardrive/api';
import { searchUrlState } from '../wardrive/coverage/urlState';
import { formatAge } from '../wardrive/screen/Hud';
import { loadShareBrand } from '../share/shareBrand';
import { adminCoverageApi } from './wardriveAdminCoverageApi';
import type { ViewAsChoice } from './WardriveDriversPanel';

// The map pulls in MapLibre: loaded when the tab opens.
const CoverageMap = lazy(() =>
  import('../wardrive/coverage/CoverageMap').then((m) => ({ default: m.CoverageMap }))
);

/** How often the drivers on the road now are asked for. */
const LIVE_REFRESH_MS = 30000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const SELECT = 'h-8 rounded-md border border-input bg-background px-2 text-sm';

/**
 * Tools > Wardrive, Map tab: the coverage map (map.mesh-hunter.eu parity) over
 * everything the wardrive drivers stored, with the drivers on the road now.
 * Reads through /api/wardrive-admin.
 */
export function WardriveMapPage({
  viewAs = null,
  onViewAs,
}: {
  /** Show exactly what one driver (or a group's members together) would see. */
  viewAs?: ViewAsChoice | null;
  onViewAs?: (v: ViewAsChoice | null) => void;
} = {}) {
  const t = useT();
  const [users, setUsers] = useState<WardriveUser[]>([]);
  const [groups, setGroups] = useState<WardriveGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapGroup, setMapGroup] = useState('');
  const [mapRadio, setMapRadio] = useState('');
  const [live, setLive] = useState<WardriveLiveDriver[]>([]);
  const [focus, setFocus] = useState<{ lat: number; lon: number; nonce: number } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const asUser = viewAs?.asUser;
  const asGroup = viewAs?.asGroup;
  const coverageApi = useMemo(() => adminCoverageApi({ asUser, asGroup }), [asUser, asGroup]);
  const urlState = useMemo(() => searchUrlState(), []);
  // The map's keys leave the address with the page.
  useEffect(() => () => urlState.clear(), [urlState]);

  // Drivers on the road now: whose page uploaded lately, within the filters.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.getWardriveAdminLive({ group_id: mapGroup ? Number(mapGroup) : undefined }).then(
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
  }, [mapGroup, mapRadio]);

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

  const extraParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (mapRadio) p.radio_key = mapRadio;
    if (mapGroup) p.group_id = mapGroup;
    return p;
  }, [mapGroup, mapRadio]);
  const liveOnMap = useMemo(
    () =>
      live.map((d) => ({ lat: d.lat, lon: d.lon, label: d.username ?? d.radio_key.slice(0, 8) })),
    [live]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border p-3">
        <p className="text-xs text-muted-foreground">{t('wardrive_map_page_intro')}</p>
        {error && (
          <p className="text-xs text-destructive" role="alert">
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
      </div>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <p className="p-3 text-sm text-muted-foreground">{t('wardrive_map_loading')}</p>
          }
        >
          <CoverageMap
            api={coverageApi}
            urlState={urlState}
            live={liveOnMap}
            focus={focus}
            extraParams={extraParams}
            brand={loadShareBrand}
            banner={(() => {
              if (!viewAs) return undefined;
              const user = asUser !== undefined ? users.find((u) => u.id === asUser) : undefined;
              const group =
                asGroup !== undefined ? groups.find((g) => g.id === asGroup) : undefined;
              const text = user
                ? t('wardrive_view_as_banner', {
                    name: user.username,
                    visibility: t(`settings_wardrive_visibility_${user.visibility}`),
                  })
                : group
                  ? t('wardrive_view_as_banner_group', { name: group.name })
                  : null;
              return (
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-warning/10 px-3 py-1.5 text-xs">
                  {text && <span>{text}</span>}
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-0.5 hover:bg-muted"
                    onClick={() => onViewAs?.(null)}
                  >
                    {t('wardrive_view_as_back')}
                  </button>
                </div>
              );
            })()}
            extraBar={
              <>
                {onViewAs && (
                  <select
                    aria-label={t('wardrive_view_as')}
                    title={t('wardrive_view_as')}
                    value={
                      asUser !== undefined
                        ? `u:${asUser}`
                        : asGroup !== undefined
                          ? `g:${asGroup}`
                          : ''
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) onViewAs(null);
                      else if (v.startsWith('u:')) onViewAs({ asUser: Number(v.slice(2)) });
                      else onViewAs({ asGroup: Number(v.slice(2)) });
                    }}
                    className={SELECT}
                  >
                    <option value="">{t('wardrive_view_as_all')}</option>
                    {users.map((u) => (
                      <option key={`u${u.id}`} value={`u:${u.id}`}>
                        {u.username}
                      </option>
                    ))}
                    {groups.map((g) => (
                      <option key={`g${g.id}`} value={`g:${g.id}`}>
                        {t('wardrive_view_as_group', { name: g.name })}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  aria-label={t('wardrive_map_group')}
                  title={t('wardrive_map_group')}
                  value={mapGroup}
                  onChange={(e) => setMapGroup(e.target.value)}
                  className={SELECT}
                >
                  <option value="">{t('wardrive_map_all_groups')}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t('wardrive_map_radio')}
                  title={t('wardrive_map_radio')}
                  value={mapRadio}
                  onChange={(e) => setMapRadio(e.target.value)}
                  className={SELECT}
                >
                  <option value="">{t('wardrive_map_all_radios')}</option>
                  {users.flatMap((u) =>
                    u.radios.map((r) => (
                      <option key={r.public_key} value={r.public_key}>
                        {`${r.name || r.public_key.slice(0, 8)} (${u.username})`}
                      </option>
                    ))
                  )}
                </select>
              </>
            }
          />
        </Suspense>
      </div>
    </div>
  );
}
