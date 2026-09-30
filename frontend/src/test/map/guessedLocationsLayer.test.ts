import { describe, it, expect } from 'vitest';
import {
  GUESSED_LOCATIONS_LABEL_LAYER_ID,
  buildGuessedLocationFeatures,
  createGuessedLocationsLayer,
} from '../../map/layers/guessedLocationsLayer';
import { LABEL_MIN_ZOOM } from '../../map/layers/nodesLayer';
import type { GuessedLocation } from '../../map/guessedLocations';
import { CONTACT_TYPE_CLIENT, type Contact } from '../../types';

const contact = (over: Partial<Contact>): Contact => ({
  public_key: 'aa',
  name: 'n',
  type: CONTACT_TYPE_CLIENT,
  flags: 0,
  direct_path: null,
  direct_path_len: 0,
  direct_path_hash_mode: 0,
  last_advert: null,
  lat: null,
  lon: null,
  last_seen: null,
  on_radio: true,
  favorite: false,
  radio_policy: 'auto',
  last_contacted: null,
  last_read_at: null,
  first_seen: null,
  ...over,
});

const guess: GuessedLocation = {
  public_key: 'abcdef1234567890',
  lat: 52,
  lon: 5,
  anchors: [],
  highConfidence: false,
};

const contacts = [
  contact({ public_key: 'abcdef1234567890', name: 'Guessy', direct_path_hash_mode: 1 }),
];

describe('buildGuessedLocationFeatures', () => {
  it('labels by node name in name mode, by observed ID tag in tag mode, and not at all when off', () => {
    const label = (mode: 'off' | 'name' | 'tag') =>
      buildGuessedLocationFeatures([guess], contacts, mode).features[0].properties.label;
    expect(label('name')).toBe('Guessy');
    expect(label('tag')).toBe('ABCD');
    expect(label('off')).toBe('');
  });

  it('defaults to no label and falls back to a key prefix for an unknown contact', () => {
    const props = buildGuessedLocationFeatures([guess], []).features[0].properties;
    expect(props.label).toBe('');
    expect(props.name).toBe('abcdef123456');
  });
});

describe('createGuessedLocationsLayer', () => {
  function fakeMap(existing: string[] = []) {
    const added: Array<{ spec: Record<string, unknown>; beforeId?: string }> = [];
    const layerIds = new Set(existing);
    const sources = new Map<string, { data: unknown }>();
    const map = {
      getSource: (id: string) => {
        const s = sources.get(id);
        return s ? { setData: (d: unknown) => (s.data = d) } : undefined;
      },
      addSource: (id: string, spec: { data: unknown }) => sources.set(id, { data: spec.data }),
      getLayer: (id: string) => (layerIds.has(id) ? {} : undefined),
      addLayer: (spec: Record<string, unknown>, beforeId?: string) => {
        layerIds.add(spec.id as string);
        added.push({ spec, beforeId });
      },
      setLayoutProperty: () => {},
      on: () => {},
      getCanvas: () => ({ style: {} }),
    };
    return { map, added, sources };
  }

  it('draws the markers at every zoom level (no minzoom)', () => {
    const { map, added } = fakeMap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createGuessedLocationsLayer(map as any).ensure();
    const markers = added.filter((a) => a.spec.id !== GUESSED_LOCATIONS_LABEL_LAYER_ID);
    expect(markers.length).toBe(2);
    for (const m of markers) expect(m.spec.minzoom).toBeUndefined();
  });

  it('adds a label layer from the node-label zoom, below the real node labels', () => {
    const { map, added } = fakeMap(['rt-node-labels']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createGuessedLocationsLayer(map as any).ensure();
    const label = added.find((a) => a.spec.id === GUESSED_LOCATIONS_LABEL_LAYER_ID);
    expect(label?.spec.minzoom).toBe(LABEL_MIN_ZOOM);
    expect(label?.beforeId).toBe('rt-node-labels');
  });

  it('re-labels the current data when the label mode changes', () => {
    const { map, sources } = fakeMap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layer = createGuessedLocationsLayer(map as any);
    layer.ensure();
    layer.setData([guess], contacts);
    const label = () =>
      (
        sources.get('rt-guessed-locations')?.data as {
          features: Array<{ properties: { label: string } }>;
        }
      ).features[0].properties.label;
    expect(label()).toBe('');
    layer.setLabelMode('name');
    expect(label()).toBe('Guessy');
  });
});
