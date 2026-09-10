import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PathRouteMap } from '../components/PathRouteMap';
import type { Contact } from '../types';
import type { ResolvedPath, SenderInfo } from '../utils/pathUtils';

// Capture props passed to the mocked leaflet primitives.
const tileProps: { url?: string }[] = [];
const polylineProps: { positions?: [number, number][] }[] = [];

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TileLayer: (p: { url: string }) => {
    tileProps.push(p);
    return null;
  },
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Polyline: (p: { positions: [number, number][] }) => {
    polylineProps.push(p);
    return null;
  },
  useMap: () => ({
    setView: vi.fn(),
    fitBounds: vi.fn(),
    getContainer: () => document.createElement('div'),
  }),
}));

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
    {
      prefix: '1A',
      matches: [makeContact({ public_key: '11'.repeat(32), lat: 52.1, lon: 4.1 })],
      distanceFromPrev: null,
    },
    {
      prefix: '2B',
      matches: [makeContact({ public_key: '22'.repeat(32), lat: null, lon: null })],
      distanceFromPrev: null,
    },
  ],
  receiver: { name: 'Receiver', prefix: 'EF', lat: 52.3, lon: 4.3, publicKey: 'ef'.repeat(32) },
  totalDistances: null,
  hasGaps: true,
};

function setBackgroundLightness(triplet: string) {
  document.documentElement.setAttribute('style', `--background: ${triplet}`);
}

afterEach(() => {
  tileProps.length = 0;
  polylineProps.length = 0;
  document.documentElement.removeAttribute('style');
});

describe('PathRouteMap', () => {
  it('draws a connecting line through located route nodes, skipping unlocated hops', () => {
    render(<PathRouteMap resolved={resolved} senderInfo={senderInfo} />);
    expect(polylineProps).toHaveLength(1);
    expect(polylineProps[0].positions).toEqual([
      [52.0, 4.0], // sender
      [52.1, 4.1], // located hop 1
      [52.3, 4.3], // receiver (unlocated hop 2 skipped)
    ]);
  });

  it('uses the OSM (light) basemap when the theme is light', () => {
    setBackgroundLightness('40 18% 97%');
    render(<PathRouteMap resolved={resolved} senderInfo={senderInfo} />);
    expect(tileProps[tileProps.length - 1]?.url).toContain('openstreetmap.org');
  });

  it('uses the Esri dark basemap when the theme is dark', () => {
    setBackgroundLightness('224 14% 8%');
    render(<PathRouteMap resolved={resolved} senderInfo={senderInfo} />);
    expect(tileProps[tileProps.length - 1]?.url).toContain('World_Dark_Gray_Base');
  });
});
