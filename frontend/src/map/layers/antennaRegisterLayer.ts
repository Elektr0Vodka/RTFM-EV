import type { Map as MlMap } from 'maplibre-gl';
import type { AntennaRegisterSiteSummary } from '../../types';

// Antenna register layer: registered transmitters from the Dutch Antenneregister
// next to one of the two LoRa mesh bands, picked in the map panel:
//   868 -> mobile-network masts in the 700/800/900 MHz bands (red)
//   433 -> PAMR / base stations at 400-470 MHz (orange), plus licensed amateur
//          stations (hollow purple ring: the register lists no band or power
//          for them, so they are only "a transmitter is here")
// Drawn UNDER every node layer, so they never hide or steal clicks from mesh
// nodes. Dot size follows the site's strongest antenna (dBW as registered) and
// grows with zoom.
//
// Speed: the source gets every cached site once. Switching the band is a
// filter + paint change and toggling is a visibility change, so neither sends
// data to the GeoJSON worker again.

const SOURCE_ID = 'rt-antenna-register';
const LAYER_ID = 'rt-antenna-register';
// Lowest custom layers it must stay under, in order of preference.
const BELOW_LAYER_IDS = ['rt-external', 'rt-nodes'];

export const ANTENNA_BANDS = ['868', '433'] as const;
export type AntennaBand = (typeof ANTENNA_BANDS)[number];

/** Backend band labels (`app/services/antenna_register.py` BANDS + AMATEUR) per mesh band. */
export const ANTENNA_BAND_GROUPS: Record<AntennaBand, readonly string[]> = {
  '868': ['700', '800', '900'],
  '433': ['450', 'amateur'],
};

export const ANTENNA_868_FILL = '#dc2626';
export const ANTENNA_433_FILL = '#f97316';
export const ANTENNA_AMATEUR_STROKE = '#9333ea';

/** Sites carrying at least one band of the chosen mesh band's group. */
export function sitesForBand(
  sites: AntennaRegisterSiteSummary[],
  band: AntennaBand
): AntennaRegisterSiteSummary[] {
  const group = ANTENNA_BAND_GROUPS[band];
  return sites.filter((s) => s.bands.some((b) => group.includes(b)));
}

export interface AntennaSiteProps {
  id: number;
}

/**
 * Point features for every cached site, band-independent. `b868` marks a site
 * on the 868 view; `k433` is "pamr" (has 400-470 MHz data), "amateur" (amateur
 * station only) or "" (not on the 433 view).
 */
export function buildAntennaFeatures(sites: AntennaRegisterSiteSummary[]) {
  const g868 = ANTENNA_BAND_GROUPS['868'];
  return {
    type: 'FeatureCollection' as const,
    features: sites.map((s) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id,
        power: s.max_power_dbw ?? 20,
        b868: s.bands.some((b) => g868.includes(b)),
        k433: s.bands.includes('450') ? 'pamr' : s.bands.includes('amateur') ? 'amateur' : '',
      },
    })),
  };
}

/** MapLibre filter showing the chosen band's sites. */
export function antennaBandFilter(band: AntennaBand): unknown[] {
  return band === '868' ? ['==', ['get', 'b868'], true] : ['!=', ['get', 'k433'], ''];
}

// Power-scaled radius: ~15 dBW small cell -> small dot, ~37 dBW macro -> large.
const powerRadius = (min: number, max: number) => [
  'interpolate',
  ['linear'],
  ['get', 'power'],
  15,
  min,
  37,
  max,
];

/** Paint for the chosen band. Amateur-only sites (no power) get a fixed mid size. */
export function antennaBandPaint(band: AntennaBand): Record<string, unknown> {
  const amateur = ['==', ['get', 'k433'], 'amateur'];
  const radiusAt = (min: number, max: number) =>
    band === '433'
      ? ['case', amateur, (min + max) / 2, powerRadius(min, max)]
      : powerRadius(min, max);
  return {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, radiusAt(1.5, 3), 12, radiusAt(3, 7)],
    'circle-color':
      band === '433' ? ['case', amateur, 'rgba(0,0,0,0)', ANTENNA_433_FILL] : ANTENNA_868_FILL,
    'circle-opacity': 0.6,
    'circle-stroke-color':
      band === '433' ? ['case', amateur, ANTENNA_AMATEUR_STROKE, '#7c2d12'] : '#7f1d1d',
    'circle-stroke-width': band === '433' ? ['case', amateur, 1.5, 1] : 1,
  };
}

export interface AntennaRegisterLayerOptions {
  onClick?: (props: AntennaSiteProps, lngLat: [number, number]) => void;
}

export function createAntennaRegisterLayer(map: MlMap, opts: AntennaRegisterLayerOptions = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as any;
  let listenersBound = false;
  let visible = false;
  let band: AntennaBand = '868';
  let lastData: ReturnType<typeof buildAntennaFeatures> = {
    type: 'FeatureCollection',
    features: [],
  };

  function addSourceAndLayer() {
    if (m.getSource(SOURCE_ID)) return;
    // Points need no deep tiles: z12 tiles overzoom fine and index much faster.
    m.addSource(SOURCE_ID, { type: 'geojson', data: lastData, maxzoom: 12, buffer: 32 });
    const before = BELOW_LAYER_IDS.find((id) => m.getLayer(id));
    m.addLayer(
      {
        id: LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        layout: { visibility: visible ? 'visible' : 'none' },
        filter: antennaBandFilter(band),
        paint: antennaBandPaint(band),
      },
      before
    );
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.on('click', LAYER_ID, (e: any) => {
      const feature = e.features?.[0];
      const id = Number(feature?.properties?.id);
      if (!Number.isFinite(id) || !opts.onClick) return;
      const [lon, lat] = feature.geometry.coordinates as [number, number];
      opts.onClick({ id }, [lon, lat]);
    });
    m.on('mouseenter', LAYER_ID, () => {
      m.getCanvas().style.cursor = 'pointer';
    });
    m.on('mouseleave', LAYER_ID, () => {
      m.getCanvas().style.cursor = '';
    });
  }

  /** Replace the whole site set (only after a fetch). */
  function setData(sites: AntennaRegisterSiteSummary[]) {
    lastData = buildAntennaFeatures(sites);
    m.getSource(SOURCE_ID)?.setData(lastData);
  }

  function setBand(next: AntennaBand) {
    band = next;
    if (!m.getLayer(LAYER_ID)) return;
    m.setFilter(LAYER_ID, antennaBandFilter(band));
    for (const [prop, value] of Object.entries(antennaBandPaint(band))) {
      m.setPaintProperty(LAYER_ID, prop, value);
    }
  }

  function setVisible(on: boolean) {
    visible = on;
    if (m.getLayer(LAYER_ID)) m.setLayoutProperty(LAYER_ID, 'visibility', on ? 'visible' : 'none');
  }

  function ensure() {
    addSourceAndLayer();
    bindListeners();
  }
  function reattach() {
    // A basemap setStyle drops custom sources/layers; re-add them with the last data.
    addSourceAndLayer();
  }

  return { ensure, reattach, setData, setBand, setVisible };
}
