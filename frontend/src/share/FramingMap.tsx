// The map a card is framed on: the card's map area in its own shape. The
// driver pans and zooms; "Use this view" hands the centre and the zoom,
// scaled to the card's map width, to the dialog.
import { useCallback, useRef } from 'react';
import type { Map as MlMap } from 'maplibre-gl';

import { Button } from '../components/ui/button';
import { useT } from '../i18n';
import { MiniMap } from '../map/MiniMap';
import { VISUAL_RECT } from './cardChrome';
import type { LatLon } from './geo';
import type { CardFrame } from './ShareCardDialog';

export default function FramingMap({
  located,
  onUse,
  onCancel,
}: {
  located: LatLon[];
  onUse: (view: CardFrame) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const mapRef = useRef<MlMap | null>(null);
  const locatedRef = useRef(located);
  locatedRef.current = located;
  // The card's data, so the frame is chosen around what the card shows; added
  // again after a basemap style change, which drops it.
  const showPoints = useCallback((map: MlMap) => {
    if (!map.getSource('framing-points')) {
      map.addSource('framing-points', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: locatedRef.current.map((p) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
            properties: {},
          })),
        },
      });
      map.addLayer({
        id: 'framing-points',
        type: 'circle',
        source: 'framing-points',
        paint: {
          'circle-radius': 4,
          'circle-color': '#f59e0b',
          'circle-stroke-color': '#111827',
          'circle-stroke-width': 1,
        },
      });
    }
  }, []);
  const onReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      showPoints(map);
    },
    [showPoints]
  );

  const use = () => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const width = map.getContainer().clientWidth || VISUAL_RECT.w;
    // Same ground on the card: its map is wider than this one, so it zooms in.
    const zoom = map.getZoom() + Math.log2(VISUAL_RECT.w / width);
    onUse({ center: { lat: c.lat, lon: c.lng }, zoom: Math.round(zoom * 100) / 100 });
  };

  return (
    <div className="space-y-2">
      <div
        className="w-full overflow-hidden rounded border border-border"
        style={{ aspectRatio: `${VISUAL_RECT.w} / ${VISUAL_RECT.h}` }}
      >
        <MiniMap
          fitPoints={located.map((p) => [p.lon, p.lat] as [number, number])}
          fitMaxZoom={15}
          fabs={{}}
          onReady={onReady}
          onBasemapReapply={() => {
            if (mapRef.current) showPoints(mapRef.current);
          }}
          ariaLabel={t('share_frame_map_aria')}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={use}>
          {t('share_frame_use')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {t('share_frame_cancel')}
        </Button>
      </div>
    </div>
  );
}
