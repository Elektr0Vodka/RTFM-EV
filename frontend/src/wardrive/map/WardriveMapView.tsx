// A wardrive data loader and window picker around WardriveMap, shared by the
// wardrive page and the owner's Settings section. The map itself is loaded
// lazily: it pulls in MapLibre, which the drive screen does not need.
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';

import { useT } from '../../i18n';
import type { WardriveData, WardriveLiveDriver } from '../api';
import { WINDOWS, windowRange, type WindowId } from './geo';

const WardriveMap = lazy(() => import('./WardriveMap').then((m) => ({ default: m.WardriveMap })));

export function WardriveMapView({
  load,
  filters,
  reloadKey = '',
  fill = false,
  live,
  focus,
}: {
  load: (range: { since: number; until: number }) => Promise<WardriveData>;
  /** Extra controls next to the window picker (the owner's user/group). */
  filters?: ReactNode;
  /** Changes when a filter changes, to load again. */
  reloadKey?: string;
  /** Let the map take the height left (the owner's full-page map). */
  fill?: boolean;
  /** Drivers on the road now and where to fly (the owner's map). */
  live?: WardriveLiveDriver[];
  focus?: { lat: number; lon: number; nonce: number } | null;
}) {
  const t = useT();
  const [windowId, setWindowId] = useState<WindowId>('24h');
  const [data, setData] = useState<WardriveData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    load(windowRange(windowId, Math.floor(Date.now() / 1000)))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
    // `load` is a fresh closure each render; the window and filters decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowId, reloadKey]);

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col gap-2' : 'space-y-2'}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">{t('wardrive_map_window')}</span>
          <select
            aria-label={t('wardrive_map_window')}
            value={windowId}
            onChange={(e) => setWindowId(e.target.value as WindowId)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            {WINDOWS.map((w) => (
              <option key={w.id} value={w.id}>
                {t(`wardrive_map_window_${w.id}`)}
              </option>
            ))}
          </select>
        </label>
        {filters}
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className="text-sm text-muted-foreground">{t('wardrive_map_loading')}</p>
      )}
      {data && (
        <>
          <p className="text-xs text-muted-foreground">
            {data.obs.length === 0 && data.tracks.length === 0
              ? t('wardrive_map_empty')
              : t('wardrive_map_counts', { obs: data.obs.length, tracks: data.tracks.length })}
          </p>
          {data.truncated && (
            <p className="text-xs text-muted-foreground">{t('wardrive_map_truncated')}</p>
          )}
          <Suspense fallback={<p className="text-sm">{t('wardrive_map_loading')}</p>}>
            <WardriveMap data={data} fill={fill} live={live} focus={focus} />
          </Suspense>
        </>
      )}
    </div>
  );
}
