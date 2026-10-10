import { useCallback } from 'react';
import { Marker as MlMarker, Popup as MlPopup, type Map as MlMap } from 'maplibre-gl';

import { MiniMap } from '../../map/MiniMap';

export interface SpamSourcePoint {
  key: string;
  lat: number;
  lon: number;
  label: string;
  blocked: boolean;
}

/**
 * Repeaters spam arrives through, on a small map. DOM markers survive basemap
 * switches, so nothing has to be re-attached. Kept in its own module so the
 * tab (and its tests) do not pull in MapLibre until a location exists to show.
 */
export function SpamSourcesMap({
  points,
  ariaLabel,
}: {
  points: SpamSourcePoint[];
  ariaLabel: string;
}) {
  const onReady = useCallback(
    (map: MlMap) => {
      for (const point of points) {
        const el = document.createElement('div');
        const colour = point.blocked ? '#dc2626' : '#f59e0b';
        el.style.cssText = `width:14px;height:14px;border-radius:9999px;background:${colour};border:2px solid rgba(0,0,0,0.45);box-shadow:0 0 0 1px rgba(255,255,255,0.5)`;
        new MlMarker({ element: el })
          .setLngLat([point.lon, point.lat])
          .setPopup(new MlPopup({ offset: 12 }).setText(point.label))
          .addTo(map);
      }
    },
    [points]
  );
  return (
    <MiniMap
      key={points.map((p) => `${p.key}:${p.blocked}`).join('|')}
      fitPoints={points.map((p) => [p.lon, p.lat] as [number, number])}
      fitMaxZoom={11}
      onReady={onReady}
      ariaLabel={ariaLabel}
      className="h-72 w-full overflow-hidden rounded-md border border-border/60"
    />
  );
}
