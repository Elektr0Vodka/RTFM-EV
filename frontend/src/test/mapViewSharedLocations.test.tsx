import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

vi.mock('maplibre-gl', async () => {
  const { mockMaplibreModule } = await import('./mocks/maplibre');
  return mockMaplibreModule();
});
vi.mock('../map/engine/webgl', () => ({ isWebglAvailable: () => true }));

import * as maplibre from 'maplibre-gl';
import { api } from '../api';
import { I18nProvider } from '../i18n/I18nProvider';
import { MapView } from '../components/MapView';
import type { SharedLocation, SharedLocationsResponse } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const stub = (maplibre as any).__stub as {
  fire: (ev: string) => void;
  getSource: (id: string) => { setData: ReturnType<typeof vi.fn> } | undefined;
  on: ReturnType<typeof vi.fn>;
  setLayoutProperty: ReturnType<typeof vi.fn>;
};

const share: SharedLocation = {
  message_id: 42,
  type: 'CHAN',
  conversation_key: 'AB'.repeat(16),
  conversation_name: '#dmc',
  sender_key: null,
  sender_name: 'Alice',
  outgoing: false,
  received_at: 1_790_000_000,
  sender_timestamp: null,
  lat: 52.0907,
  lon: 5.1214,
  format: 'marker',
  raw: 'm:52.090700,5.121400|Dom|poi',
  label: 'Dom',
  flags: 'poi',
  precision_m: null,
  paths: null,
};

const response: SharedLocationsResponse = { locations: [share], scanned: 10, truncated: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  localStorage.clear();
  localStorage.setItem('remoteterm-map-layer', 'light');
  localStorage.setItem('remoteterm-map-since', 'all');
});

function lastSetData(sourceId: string) {
  const calls = (stub.getSource(sourceId)!.setData as any).mock.calls;
  return calls[calls.length - 1][0] as { features: { properties: Record<string, unknown> }[] };
}

describe('MapView shared-locations layer', () => {
  it('does not fetch while the layer is off (default)', async () => {
    const fetchShares = vi.spyOn(api, 'getSharedLocations').mockResolvedValue(response);
    render(
      <I18nProvider>
        <MapView contacts={[]} />
      </I18nProvider>
    );
    stub.fire('load');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(fetchShares).not.toHaveBeenCalled();
  });

  it('fetches shares for the window and paints them when switched on', async () => {
    localStorage.setItem('remoteterm-map-shared-locations', 'true');
    const fetchShares = vi.spyOn(api, 'getSharedLocations').mockResolvedValue(response);
    render(
      <I18nProvider>
        <MapView contacts={[]} />
      </I18nProvider>
    );
    stub.fire('load');
    await waitFor(() => expect(fetchShares).toHaveBeenCalled(), { timeout: 2000 });
    // "All" window: no bounds; newest per sender by default.
    expect(fetchShares.mock.calls[0][0]).toEqual({
      since: undefined,
      until: undefined,
      latestPerSender: true,
    });
    await waitFor(() => {
      const fc = lastSetData('rt-shared-locations');
      expect(fc.features).toHaveLength(1);
      expect(fc.features[0].properties).toMatchObject({ message_id: 42, title: 'Dom', poi: true });
    });
    const clickBound = stub.on.mock.calls.some(
      (c: unknown[]) => c[0] === 'click' && c[1] === 'rt-shared-locations'
    );
    expect(clickBound).toBe(true);
  });

  it('sends whole-second bounds for a relative preset window', async () => {
    // Relative presets derive the cutoff from Date.now()/1000 (fractional);
    // the API rejects non-integer since/until with 422.
    localStorage.setItem('remoteterm-map-since', '1h');
    localStorage.setItem('remoteterm-map-shared-locations', 'true');
    const fetchShares = vi.spyOn(api, 'getSharedLocations').mockResolvedValue(response);
    render(
      <I18nProvider>
        <MapView contacts={[]} />
      </I18nProvider>
    );
    stub.fire('load');
    await waitFor(() => expect(fetchShares).toHaveBeenCalled(), { timeout: 2000 });
    const { since } = fetchShares.mock.calls[0][0];
    expect(Number.isInteger(since)).toBe(true);
    expect(Math.abs((since as number) - (Date.now() / 1000 - 3600))).toBeLessThan(120);
  });

  it('asks for every share when "all shares" is remembered on', async () => {
    localStorage.setItem('remoteterm-map-shared-locations', 'true');
    localStorage.setItem('remoteterm-map-shared-locations-all', 'true');
    const fetchShares = vi.spyOn(api, 'getSharedLocations').mockResolvedValue(response);
    render(
      <I18nProvider>
        <MapView contacts={[]} />
      </I18nProvider>
    );
    stub.fire('load');
    await waitFor(() => expect(fetchShares).toHaveBeenCalled(), { timeout: 2000 });
    expect(fetchShares.mock.calls[0][0]).toMatchObject({ latestPerSender: false });
  });
});
