import type { Map as MlMap } from 'maplibre-gl';
import type { AntennaRegisterSiteSummary } from '../../types';

// Antenna register layer: mobile-network masts from the Dutch Antenneregister
// that transmit in the 700/800/900 MHz bands either side of the 868 MHz mesh
// band. Drawn as small red dots UNDER every node layer, so they never hide or
// steal clicks from mesh nodes. Dot size follows the site's strongest antenna
// (dBW as registered) and grows with zoom.

const SOURCE_ID = 'rt-antenna-register';
const LAYER_ID = 'rt-antenna-register';
// Lowest custom layers it must stay under, in order of preference.
const BELOW_LAYER_IDS = ['rt-external', 'rt-nodes'];

export const ANTENNA_FILL = '#dc2626';
export const ANTENNA_STROKE = '#7f1d1d';

export interface AntennaSiteProps {
  id: number;
}

export function buildAntennaFeatures(sites: AntennaRegisterSiteSummary[]) {
  return {
    type: 'FeatureCollection' as const,
    features: sites.map((s) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
      properties: { id: s.id, power: s.max_power_dbw ?? 20 },
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
  const radiusAt = (min: number, max: number) => [
    'interpolate',
    ['linear'],
    ['get', 'power'],
    15,
    min,
    37,
    max,
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
          'circle-color': ANTENNA_FILL,
          'circle-opacity': 0.6,
          'circle-stroke-color': ANTENNA_STROKE,
          'circle-stroke-width': 1,
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

  function setData(sites: AntennaRegisterSiteSummary[]) {
    lastData = buildAntennaFeatures(sites);
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
