// Leaflet tile-layer presets shared by MapView and LocationPickerModal.
//
// Every provider here is free and works without an API key. Attribution strings
// follow each provider's requirements; do not remove them. If you add a new
// provider, verify its terms of service (especially for Esri / Google-style
// satellite tiles) before committing.
export interface TileLayerPreset {
  id: string;
  label: string;
  url: string;
  attribution: string;
  background: string;
  /** Highest zoom the provider publishes tiles at. When the layer is active,
   *  the map's zoom ceiling is tightened to this value via
   *  `MaxZoomByActiveLayer` so the user cannot zoom into a grey void. */
  maxZoom?: number;
}

// Global zoom bounds for the MapContainer itself. These are pinned to the
// container so Leaflet's internal tile-range math never has to guess when
// layers swap in/out via LayersControl. Without this, an initial-mount race
// between MapContainer layout and LayersControl.BaseLayer addition has been
// observed to throw "Attempted to load an infinite number of tiles".
export const MAP_MIN_ZOOM = 2;
export const MAP_MAX_ZOOM = 19;

export const TILE_LAYERS: readonly TileLayerPreset[] = [
  {
    id: 'light',
    label: 'Light (OpenStreetMap)',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    background: '#1a1a2e',
    maxZoom: 19,
  },
  {
    // Keyless raster dark basemap, matching the raster options used by the
    // DutchMeshCore Observers map. Replaces the former CARTO dark_all layer,
    // whose basemaps.cartocdn.com endpoint now requires an API key.
    id: 'darkgray',
    label: 'Dark Gray (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS user community',
    background: '#2b2b2b',
    // Esri's Dark Gray Canvas publishes tiles to ~z16 over the Netherlands;
    // past that it returns a placeholder, so cap here and let Leaflet stop.
    maxZoom: 16,
  },
  {
    id: 'lightgray',
    label: 'Light Gray (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS user community',
    background: '#d6d6d6',
    maxZoom: 16,
  },
  {
    id: 'topographic',
    label: 'Topographic (OpenTopoMap)',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    background: '#a3b3bc',
    maxZoom: 17,
  },
  {
    id: 'natgeo',
    label: 'NatGeo (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; National Geographic, Esri, Garmin, HERE, UNEP-WCMC, USGS, NASA, ESA, METI, NRCAN, GEBCO, NOAA, iPC',
    background: '#aac6df',
    // NatGeo only covers the Netherlands to ~z12; z13+ is the placeholder tile.
    maxZoom: 12,
  },
  {
    id: 'satellite',
    label: 'Satellite (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    background: '#1a1f2e',
    // Esri's tile service advertises LODs up to 23 and returns HTTP 200 for
    // every tile request, but the underlying imagery is only high-resolution
    // up to ~18 in most developed areas and shallower in rural regions. We
    // cap at 18 rather than 19 so users don't zoom into visibly-empty or
    // severely-upscaled tiles. Remote regions may still be sparse at 18.
    maxZoom: 18,
  },
] as const;

// Keyless raster basemaps used by the auto-theming mini maps (route map,
// neighbors map, contact map). These follow the app theme rather than a user
// picker: dark themes get the Esri Dark Gray basemap, light themes get OSM.
const DARK_RASTER_TILE = TILE_LAYERS.find((l) => l.id === 'darkgray')!;
const LIGHT_RASTER_TILE = TILE_LAYERS.find((l) => l.id === 'light')!;

/** Returns the raster basemap preset matching the current theme brightness. */
export function themeRasterTile(dark: boolean): TileLayerPreset {
  return dark ? DARK_RASTER_TILE : LIGHT_RASTER_TILE;
}
