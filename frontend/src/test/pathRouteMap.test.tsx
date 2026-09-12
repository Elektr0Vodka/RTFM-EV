import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('maplibre-gl', async () => {
  const { mockMaplibreModule } = await import('./mocks/maplibre');
  return mockMaplibreModule();
});
vi.mock('../map/engine/webgl', () => ({ isWebglAvailable: () => true }));

import * as maplibre from 'maplibre-gl';
import { I18nProvider } from '../i18n/I18nProvider';
import { PathRouteMap } from '../components/PathRouteMap';
import type { Contact } from '../types';
import type { ResolvedPath, SenderInfo } from '../utils/pathUtils';

/* eslint-disable @typescript-eslint/no-explicit-any */
const markerMock = maplibre.Marker as unknown as ReturnType<typeof vi.fn>;
const stub = (maplibre as any).__stub as {
  fire: (ev: string) => void;
  getSource: (id: string) => { setData: ReturnType<typeof vi.fn> } | undefined;
  addSource: ReturnType<typeof vi.fn>;
};

function makeContact(overrides: Partial<Contact>): Contact {
  return {
    public_key: 'ab'.repeat(32),
    name: 'Node',
    type: 1,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: -1,
    route_override_path: null,
    route_override_len: null,
    route_override_hash_mode: null,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
    ...overrides,
  };
}

const senderInfo: SenderInfo = {
  name: 'Sender',
  publicKeyOrPrefix: 'cd'.repeat(32),
  lat: 52.0,
  lon: 4.0,
};

// sender -> located hop -> unlocated hop -> receiver
const resolved: ResolvedPath = {
  sender: { name: 'Sender', prefix: 'CD', lat: 52.0, lon: 4.0 },
  hops: [
    { prefix: '1A', matches: [makeContact({ public_key: '11'.repeat(32), lat: 52.1, lon: 4.1 })], distanceFromPrev: null },
    { prefix: '2B', matches: [makeContact({ public_key: '22'.repeat(32), lat: null, lon: null })], distanceFromPrev: null },
  ],
  receiver: { name: 'Receiver', prefix: 'EF', lat: 52.3, lon: 4.3, publicKey: 'ef'.repeat(32) },
  totalDistances: null,
  hasGaps: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('remoteterm-map-layer', 'light');
});
afterEach(() => {
  document.documentElement.removeAttribute('style');
});

describe('PathRouteMap', () => {
  // Runs first: the shared mock stub retains 'load' handlers across renders, so
  // a later test would replay this render's handler too and inflate the count.
  it('adds one marker per located node (sender, located hop, receiver)', () => {
    render(
      <I18nProvider>
        <PathRouteMap resolved={resolved} senderInfo={senderInfo} />
      </I18nProvider>,
    );
    stub.fire('load');
    expect(markerMock).toHaveBeenCalledTimes(3);
  });

  it('draws a GL line through located route nodes (lng,lat), skipping unlocated hops', () => {
    render(
      <I18nProvider>
        <PathRouteMap resolved={resolved} senderInfo={senderInfo} />
      </I18nProvider>,
    );
    stub.fire('load');
    const src = stub.getSource('pr-line')!;
    expect(src.setData).toHaveBeenCalledWith(
      expect.objectContaining({
        geometry: {
          type: 'LineString',
          coordinates: [
            [4.0, 52.0], // sender
            [4.1, 52.1], // located hop 1
            [4.3, 52.3], // receiver (unlocated hop 2 skipped)
          ],
        },
      }),
    );
  });

  it('shows the no-GPS fallback when nothing is located', () => {
    const noGps: ResolvedPath = {
      sender: { name: 'S', prefix: 'CD', lat: null, lon: null },
      hops: [],
      receiver: { name: 'R', prefix: 'EF', lat: null, lon: null, publicKey: null },
      totalDistances: null,
      hasGaps: false,
    };
    const { container } = render(
      <I18nProvider>
        <PathRouteMap resolved={noGps} senderInfo={senderInfo} />
      </I18nProvider>,
    );
    expect(markerMock).not.toHaveBeenCalled();
    expect(container.textContent).toBeTruthy();
  });
});
