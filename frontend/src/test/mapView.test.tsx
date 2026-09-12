import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('maplibre-gl', async () => {
  const { mockMaplibreModule } = await import('./mocks/maplibre');
  return mockMaplibreModule();
});
vi.mock('../map/engine/webgl', () => ({ isWebglAvailable: () => true }));

import * as maplibre from 'maplibre-gl';
import { I18nProvider } from '../i18n/I18nProvider';
import { MapView } from '../components/MapView';
import { CONTACT_TYPE_CLIENT, CONTACT_TYPE_REPEATER, type Contact } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const stub = (maplibre as any).__stub as {
  fire: (ev: string) => void;
  getSource: (id: string) => { setData: ReturnType<typeof vi.fn> } | undefined;
  on: ReturnType<typeof vi.fn>;
};

const now = Math.floor(Date.now() / 1000);
const contact = (over: Partial<Contact>): Contact => ({
  public_key: 'aa',
  name: 'n',
  type: CONTACT_TYPE_CLIENT,
  flags: 0,
  direct_path: null,
  direct_path_len: 0,
  direct_path_hash_mode: 0,
  last_advert: null,
  lat: 52,
  lon: 5,
  last_seen: now,
  on_radio: true,
  favorite: false,
  last_contacted: null,
  last_read_at: null,
  first_seen: null,
  ...over,
});

function lastNodeFeatureCollection() {
  const src = stub.getSource('rt-nodes');
  const calls = (src!.setData as any).mock.calls;
  return calls[calls.length - 1][0] as { features: { properties: { id: string } }[] };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('remoteterm-map-layer', 'light');
  localStorage.setItem('remoteterm-map-since', 'all');
});

describe('MapView (MapLibre)', () => {
  it('feeds mappable contacts to the node layer after the map loads', async () => {
    render(
      <I18nProvider>
        <MapView
          contacts={[
            contact({ public_key: 'a', type: CONTACT_TYPE_REPEATER }),
            contact({ public_key: 'b' }),
            contact({ public_key: 'c', lat: null }),
          ]}
        />
      </I18nProvider>
    );
    stub.fire('load');
    await waitFor(() => {
      const fc = lastNodeFeatureCollection();
      const ids = fc.features.map((f) => f.properties.id).sort();
      expect(ids).toEqual(['a', 'b']); // 'c' has no GPS
    });
  });

  it('excludes blocked contacts', async () => {
    render(
      <I18nProvider>
        <MapView
          contacts={[contact({ public_key: 'a' }), contact({ public_key: 'bad', name: 'Bad' })]}
          blockedNames={['Bad']}
        />
      </I18nProvider>
    );
    stub.fire('load');
    await waitFor(() => {
      const ids = lastNodeFeatureCollection().features.map((f) => f.properties.id);
      expect(ids).toContain('a');
      expect(ids).not.toContain('bad');
    });
  });

  it('registers a click handler on the node layer for popups', async () => {
    render(
      <I18nProvider>
        <MapView contacts={[contact({ public_key: 'a' })]} onSelectContact={vi.fn()} />
      </I18nProvider>
    );
    stub.fire('load');
    await waitFor(() => {
      const clickBound = stub.on.mock.calls.some(
        (c: unknown[]) => c[0] === 'click' && c[1] === 'rt-nodes'
      );
      expect(clickBound).toBe(true);
    });
  });
});
