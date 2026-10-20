// The stored-data map's MapLibre glue against a fake map: the reception popup
// with every stored field, and the drivers on the road now.
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

interface FakeMap {
  sources: Map<string, { setData: Mock }>;
  layers: Map<string, unknown>;
  flyTo: Mock;
  fire(key: string, e?: unknown): void;
  [k: string]: unknown;
}

function fakeMap(): FakeMap {
  const sources = new Map<string, { setData: Mock }>();
  const layers = new Map<string, unknown>();
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  return {
    sources,
    layers,
    addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
    getSource: (id: string) => sources.get(id),
    addLayer: vi.fn((spec: { id: string }) => layers.set(spec.id, spec)),
    getLayer: (id: string) => layers.get(id),
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    getCanvas: () => ({ style: {} }),
    on: vi.fn((ev: string, a: unknown, b?: unknown) => {
      const fn = (b ?? a) as (e: unknown) => void;
      const key = b ? `${ev}:${String(a)}` : ev;
      (handlers[key] ??= []).push(fn);
    }),
    fire(key: string, e: unknown = {}) {
      for (const fn of handlers[key] ?? []) fn(e);
    },
  };
}

let map: FakeMap;
const popups: { content: HTMLElement | null }[] = [];
vi.mock('../../map/MiniMap', () => ({
  MiniMap: ({ onReady }: { onReady: (m: unknown) => void }) => {
    useEffect(() => onReady(map), [onReady]);
    return <div data-testid="mini-map" />;
  },
}));
vi.mock('maplibre-gl', () => ({
  Popup: class {
    record: { content: HTMLElement | null } = { content: null };
    constructor() {
      popups.push(this.record);
    }
    setLngLat() {
      return this;
    }
    setDOMContent(el: HTMLElement) {
      this.record.content = el;
      return this;
    }
    setText() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  },
}));

import { I18nProvider } from '../../i18n';
import type { WardriveData, WardriveLiveDriver } from '../../wardrive/api';
import { WardriveMap } from '../../wardrive/map/WardriveMap';

const DATA: WardriveData = {
  obs: [
    {
      user_id: 1,
      username: 'anna',
      radio_key: 'AB'.repeat(32),
      radio_name: 'car',
      rx_at: '2026-10-19T10:00:00.000Z',
      hash: '0123456789abcdef',
      packet_type: 5,
      route: 'F',
      path: ['a1', 'b2'],
      rssi: -92,
      snr: 6.5,
      lat: 52.1,
      lon: 5.1,
      accuracy: 4,
      heard_id: 'b2',
      heard_name: 'Toren',
      heard_guess: true,
    },
  ],
  tracks: [],
  truncated: false,
};

const LIVE: WardriveLiveDriver = {
  user_id: 1,
  username: 'anna',
  radio_key: 'AB'.repeat(32),
  radio_name: 'car',
  last_upload_at: 1792404000,
  last_ts: 1792403990,
  lat: 52.3,
  lon: 5.3,
  accuracy: 5,
  last_rssi: -97,
  last_snr: 3.5,
  drive_id: 7,
  drive_name: null,
  receptions: 12,
};

function mount(props: Partial<Parameters<typeof WardriveMap>[0]> = {}) {
  const r = render(
    <I18nProvider>
      <WardriveMap data={DATA} {...props} />
    </I18nProvider>
  );
  return {
    rerender: (p: Partial<Parameters<typeof WardriveMap>[0]>) =>
      r.rerender(
        <I18nProvider>
          <WardriveMap data={DATA} {...p} />
        </I18nProvider>
      ),
  };
}

beforeEach(() => {
  map = fakeMap();
  popups.length = 0;
});

describe('stored-data map glue', () => {
  it('shows every stored field of a tapped reception', async () => {
    mount();
    await act(async () => {});
    map.fire('click:wd-points', {
      features: [{ properties: { i: 0 }, geometry: { coordinates: [5.1, 52.1] } }],
    });
    const text = popups[popups.length - 1].content?.textContent ?? '';
    expect(text).toContain('Heard via');
    expect(text).toContain('~Toren (b2)');
    expect(text).toContain('-92 dBm, SNR 6.5 dB');
    expect(text).toContain('2 (a1 > b2)');
  });

  it('puts the drivers on the road now on the map and flies to one picked', async () => {
    const { rerender } = mount({ live: [LIVE] });
    await act(async () => {});
    const calls = map.sources.get('wd-live-drivers')!.setData.mock.calls;
    expect(calls[calls.length - 1][0].features[0].properties.label).toBe('anna');
    rerender({ live: [LIVE], focus: { lat: 52.3, lon: 5.3, nonce: 1 } });
    await act(async () => {});
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [5.3, 52.3] }));
  });
});
