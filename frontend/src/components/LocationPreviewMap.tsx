import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { themeRasterTile } from '../utils/mapTiles';
import { useIsDarkTheme } from '../hooks';

/** Watches the map container for size changes and tells Leaflet to re-tile. */
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

interface Props {
  lat: number;
  lon: number;
  /** Fixed map height in px. */
  height?: number;
  ariaLabel?: string;
}

/**
 * Compact, non-scroll-hijacking inline map preview centred on a single shared
 * location. Scroll-wheel zoom is disabled so it does not capture chat scrolling.
 */
export function LocationPreviewMap({ lat, lon, height = 140, ariaLabel }: Props) {
  const dark = useIsDarkTheme();
  const tile = themeRasterTile(dark);
  const center: [number, number] = [lat, lon];

  return (
    <div
      className="mt-1 rounded border border-border overflow-hidden"
      role="img"
      aria-label={ariaLabel}
      style={{ height }}
    >
      <MapContainer
        center={center}
        zoom={13}
        maxZoom={tile.maxZoom}
        scrollWheelZoom={false}
        className="h-full w-full"
        style={{ background: tile.background }}
      >
        <InvalidateOnResize />
        <TileLayer
          key={tile.id}
          attribution={tile.attribution}
          url={tile.url}
          maxZoom={tile.maxZoom}
        />
        <CircleMarker
          center={center}
          radius={7}
          pathOptions={{ color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 }}
        />
      </MapContainer>
    </div>
  );
}
