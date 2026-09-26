import type { Map as MlMap } from 'maplibre-gl';
import type { RelaySummary } from '../../components/MeshRelayReceptionPanel';
import type { Contact } from '../../types';
import { isValidLocation } from '../../utils/pathUtils';
import { formatSNR } from '../../utils/traceMapUtils';
import { snrColor } from '../packets/packetAnimMath';
import { NODE_LABEL_FONT } from './nodesLayer';

// Relay signal overlay (plan 21 S2): each relay that delivered copies to our
// radio in the map's window, drawn as a ring around its node, coloured by the
// average SNR our radio measured on those copies (same amber -> blue -> green
// ramp as the live packet arcs) and sized by how many copies it delivered.
// Rings sit below the node layer and have no click handler, so node clicks
// and popups behave as before.

const SOURCE_ID = 'rt-relay-signal';
const RING_LAYER_ID = 'rt-relay-signal-ring';
const LABEL_LAYER_ID = 'rt-relay-signal-label';
const LAYER_IDS = [RING_LAYER_ID, LABEL_LAYER_ID];
// Draw under the node circles so the node stays on top and clickable.
const NODES_LAYER_ID = 'rt-nodes';

const MIN_RADIUS = 11;
const MAX_RADIUS = 26;

export interface RelaySignalProps {
  public_key: string;
  name: string;
  avg_snr: number | null;
  receptions: number;
  color: string;
  radius: number;
  label: string;
}

/** Ring radius in px: grows with log2(receptions), clamped. Exported for tests. */
export function relayRingRadius(receptions: number): number {
  const r = MIN_RADIUS + 3 * Math.log2(Math.max(1, receptions));
  return Math.min(MAX_RADIUS, Math.round(r * 10) / 10);
}

/**
 * Place resolved relays at their contact's position. Relays without a unique
 * contact (unresolved or colliding hashes) or without a location are counted
 * in `unplaced`. `contacts` should already carry manual location overrides.
 */
export function buildRelaySignalFeatures(relays: RelaySummary[], contacts: Contact[]) {
  const byKey = new Map(contacts.map((c) => [c.public_key.toLowerCase(), c]));
  let unplaced = 0;
  const features = [];
  for (const relay of relays) {
    // The direct row (no relay) is our radio hearing the origin itself.
    if (relay.last_hop_hex === null) continue;
    const contact = relay.resolved_pubkey ? byKey.get(relay.resolved_pubkey.toLowerCase()) : null;
    if (!contact || !isValidLocation(contact.lat, contact.lon)) {
      unplaced += 1;
      continue;
    }
    const [r, g, b] = snrColor(relay.avg_snr);
    const snr = formatSNR(relay.avg_snr);
    features.push({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [contact.lon as number, contact.lat as number],
      },
      properties: {
        public_key: contact.public_key,
        name: relay.resolved_name || contact.name || contact.public_key.slice(0, 12),
        avg_snr: relay.avg_snr,
        receptions: relay.receptions,
        color: `rgb(${r}, ${g}, ${b})`,
        radius: relayRingRadius(relay.receptions),
        label: snr ? `${snr} · ${relay.receptions}×` : `${relay.receptions}×`,
      } satisfies RelaySignalProps,
    });
  }
  return {
    collection: { type: 'FeatureCollection' as const, features },
    placed: features.length,
    unplaced,
  };
}

export function createRelaySignalLayer(map: MlMap) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as any;
  let visible = false;
  let lastData: ReturnType<typeof buildRelaySignalFeatures>['collection'] = {
    type: 'FeatureCollection',
    features: [],
  };

  function addSourceAndLayer() {
    if (m.getSource(SOURCE_ID)) return;
    const visibility = visible ? 'visible' : 'none';
    const beforeId = m.getLayer(NODES_LAYER_ID) ? NODES_LAYER_ID : undefined;
    m.addSource(SOURCE_ID, { type: 'geojson', data: lastData });
    m.addLayer(
      {
        id: RING_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        layout: { visibility },
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.12,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 3,
          'circle-stroke-opacity': 0.9,
        },
      },
      beforeId
    );
    m.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        visibility,
        'text-field': ['get', 'label'],
        'text-size': 10,
        'text-anchor': 'bottom',
        'text-offset': [0, -1.8],
        'text-optional': true,
        // Single font: a multi-font stack 404s on the glyph servers (see
        // NODE_LABEL_FONT in nodesLayer.ts).
        'text-font': NODE_LABEL_FONT,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#0f172a',
        'text-halo-width': 1.2,
      },
    });
  }

  function setData(collection: ReturnType<typeof buildRelaySignalFeatures>['collection']) {
    lastData = collection;
    m.getSource(SOURCE_ID)?.setData(lastData);
  }

  function setVisible(on: boolean) {
    visible = on;
    for (const id of LAYER_IDS) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }
  }

  // A basemap setStyle drops custom sources/layers; ensure/reattach re-add them.
  return { ensure: addSourceAndLayer, reattach: addSourceAndLayer, setData, setVisible };
}
