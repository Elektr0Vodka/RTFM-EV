import { useEffect, useState } from 'react';

import { api } from '../api';
import { useT } from '../i18n';
import type { WardriveGroup, WardriveUser } from '../types';
import { WardriveMapView } from '../wardrive/map/WardriveMapView';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Tools > Wardrive map (shown only when MESHCORE_WARDRIVE is on): the owner's
 * coverage map of everything the wardrive drivers stored, filtered by user,
 * group, radio and time window. Reads through /api/wardrive-admin.
 */
export function WardriveMapPage() {
  const t = useT();
  const [users, setUsers] = useState<WardriveUser[]>([]);
  const [groups, setGroups] = useState<WardriveGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapUser, setMapUser] = useState('');
  const [mapGroup, setMapGroup] = useState('');
  const [mapRadio, setMapRadio] = useState('');

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
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="text-base font-semibold text-foreground">{t('nav_wardrive_map')}</h2>
        <p className="text-xs text-muted-foreground">{t('wardrive_map_page_intro')}</p>
      </div>
      {/* A flex column, so the map takes the height below the filters. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {error && (
          <p className="text-xs text-destructive" role="status">
            {error}
          </p>
        )}
        <WardriveMapView
          fill
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
