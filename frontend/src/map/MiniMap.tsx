import { useCallback, type ReactNode } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { cn } from '../lib/utils';
import { MapSurface } from './MapSurface';
import type { FabConfig } from './controls/MapControls';

export interface MiniMapProps {
  /** [lng, lat] initial centre (ignored when fitPoints has >= 2 points). */
  center?: [number, number];
  zoom?: number;
  /** [lng, lat] points to frame on ready (1 -> jumpTo, >1 -> fitBounds). */
  fitPoints?: [number, number][];
  fitMaxZoom?: number;
  fabs?: FabConfig;
  onReady?: (map: MlMap) => void;
  onBasemapReapply?: () => void;
  className?: string;
  ariaLabel?: string;
  children?: ReactNode;
}

/** Thin MapSurface preset for small embeds: fixed centre or fit-to-markers, no
 *  packet overlays, Layers FAB on by default. Consumers draw their own
 *  markers/lines as GL layers via onReady. */
export function MiniMap({
  center,
  zoom = 11,
  fitPoints,
  fitMaxZoom = 13,
  fabs = { layers: true },
  onReady,
  onBasemapReapply,
  className,
  ariaLabel,
  children,
}: MiniMapProps) {
  const handleReady = useCallback(
    (map: MlMap) => {
      const pts = (fitPoints ?? []).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (pts.length === 1) {
        map.jumpTo({ center: pts[0], zoom });
      } else if (pts.length > 1) {
        let minLng = Infinity;
        let minLat = Infinity;
        let maxLng = -Infinity;
        let maxLat = -Infinity;
        for (const [lng, lat] of pts) {
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
        }
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          { padding: 32, maxZoom: fitMaxZoom, duration: 0 },
        );
      }
      onReady?.(map);
    },
    [fitPoints, fitMaxZoom, zoom, onReady],
  );

  return (
    <div className={cn('h-full w-full', className)} aria-label={ariaLabel}>
      <MapSurface
        fabs={fabs}
        initialCenter={center}
        initialZoom={zoom}
        onReady={handleReady}
        onBasemapReapply={onBasemapReapply}
      >
        {children}
      </MapSurface>
    </div>
  );
}
