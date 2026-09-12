import { useCallback, useEffect, useRef } from 'react';
import { Marker as MlMarker, type Map as MlMap } from 'maplibre-gl';
import { MiniMap } from '../map/MiniMap';

interface Props {
  lat: number;
  lon: number;
  /** Fixed map height in px. */
  height?: number;
  ariaLabel?: string;
}

/**
 * Compact inline map preview centred on a single shared location. Renders a
 * single blue marker on a MiniMap (MapLibre); the MiniMap keeps interactions
 * lightweight so it does not hijack chat scrolling.
 */
export function LocationPreviewMap({ lat, lon, height = 140, ariaLabel }: Props) {
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<MlMarker | null>(null);

  const addMarker = useCallback(
    (map: MlMap) => {
      markerRef.current?.remove();
      markerRef.current = new MlMarker({ color: '#3b82f6' }).setLngLat([lon, lat]).addTo(map);
    },
    [lat, lon]
  );

  const onReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      addMarker(map);
    },
    [addMarker]
  );

  useEffect(() => {
    if (mapRef.current) addMarker(mapRef.current);
  }, [addMarker]);
  useEffect(
    () => () => {
      markerRef.current?.remove();
      markerRef.current = null;
    },
    []
  );

  return (
    <div
      className="mt-1 overflow-hidden rounded border border-border"
      role="img"
      aria-label={ariaLabel}
      style={{ height }}
    >
      <MiniMap
        center={[lon, lat]}
        zoom={13}
        onReady={onReady}
        onBasemapReapply={() => {
          if (mapRef.current) addMarker(mapRef.current);
        }}
      />
    </div>
  );
}
