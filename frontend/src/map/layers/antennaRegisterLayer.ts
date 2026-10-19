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

/** Point features for sites already filtered with {@link sitesForBand}. */
export function buildAntennaFeatures(sites: AntennaRegisterSiteSummary[], band: AntennaBand) {
  return {
    type: 'FeatureCollection' as const,
    features: sites.map((s) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id,
        power: s.max_power_dbw ?? 20,
        // An amateur-only site on the 433 view has no registered antenna data.
        kind: band === '433' && !s.bands.includes('450') ? 'amateur' : band,
      },
    })),
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
  let lastData: ReturnType<typeof buildAntennaFeatures> = {
    type: 'FeatureCollection',
    features: [],
  };

  // Power-scaled radius: ~15 dBW small cell -> small dot, ~37 dBW macro -> large.
  // Amateur sites have no power, so they get a fixed mid size.
  const radiusAt = (min: number, max: number) => [
    'case',
    ['==', ['get', 'kind'], 'amateur'],
    (min + max) / 2,
    ['interpolate', ['linear'], ['get', 'power'], 15, min, 37, max],
  ];

  function addSourceAndLayer() {
    if (m.getSource(SOURCE_ID)) return;
    m.addSource(SOURCE_ID, { type: 'geojson', data: lastData });
    const before = BELOW_LAYER_IDS.find((id) => m.getLayer(id));
    m.addLayer(
      {
        id: LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            6,
            radiusAt(1.5, 3),
            12,
            radiusAt(3, 7),
          ],
          'circle-color': [
            'match',
            ['get', 'kind'],
            '433',
            ANTENNA_433_FILL,
            'amateur',
            'rgba(0,0,0,0)',
            ANTENNA_868_FILL,
          ],
          'circle-opacity': 0.6,
          'circle-stroke-color': [
            'match',
            ['get', 'kind'],
            '433',
            '#7c2d12',
            'amateur',
            ANTENNA_AMATEUR_STROKE,
            '#7f1d1d',
          ],
          'circle-stroke-width': ['match', ['get', 'kind'], 'amateur', 1.5, 1],
        },
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

  function setData(sites: AntennaRegisterSiteSummary[], band: AntennaBand) {
    lastData = buildAntennaFeatures(sites, band);
    m.getSource(SOURCE_ID)?.setData(lastData);
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

  return { ensure, reattach, setData, setVisible };
}
