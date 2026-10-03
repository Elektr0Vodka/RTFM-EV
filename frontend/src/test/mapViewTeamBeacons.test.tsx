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
import type { TeamBeaconPoint, TeamBeaconsResponse, TeamWaypointPin } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const stub = (maplibre as any).__stub as {
  fire: (ev: string) => void;
  getSource: (id: string) => { setData: ReturnType<typeof vi.fn> } | undefined;
  on: ReturnType<typeof vi.fn>;
};

const beacon: TeamBeaconPoint = {
  message_id: 42,
  conversation_key: 'AB'.repeat(16),
  conversation_name: 'team',
  sender_key: null,
  sender_name: 'Alice',
  outgoing: false,
  received_at: 1_790_000_000,
  sender_timestamp: null,
  kind: 'tel',
  source: 'team',
  lat: 52.0907,
  lon: 5.1214,
  radio_battery_mv: 3998,
  phone_battery_mv: 3800,
  phone_battery_pct: null,
  autonomous: false,
  needs_forwarding: false,
  max_path_observed: 0,
  node_count: null,
  neighbor_count: null,
  paths: null,
};

const waypoint: TeamWaypointPin = {
  message_id: 43,
  conversation_key: 'AB'.repeat(16),
  conversation_name: 'team',
  sender_key: null,
  sender_name: 'Alice',
  outgoing: false,
  received_at: 1_790_000_000,
  sender_timestamp: null,
  mesh_id: 'ab12',
  name: 'Camp',
  description: '',
  waypoint_type: 'CAMP',
  color: null,
  lat: 52.1,
  lon: 5.2,
  route: [],
  route_complete: true,
  paths: null,
};

const response: TeamBeaconsResponse = {
  beacons: [beacon],
  waypoints: [waypoint],
  scanned: 2,
  truncated: false,
};

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

function renderMap() {
  render(
    <I18nProvider>
      <MapView contacts={[]} />
    </I18nProvider>
  );
  stub.fire('load');
}

describe('MapView Beacons layer', () => {
  it('does not fetch while the layer is off (default)', async () => {
    const fetchBeacons = vi.spyOn(api, 'getTeamBeacons').mockResolvedValue(response);
    renderMap();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(fetchBeacons).not.toHaveBeenCalled();
  });

  it('fetches beacons for the window and paints pins when switched on', async () => {
    localStorage.setItem('remoteterm-map-beacons', 'true');
    const fetchBeacons = vi.spyOn(api, 'getTeamBeacons').mockResolvedValue(response);
    renderMap();
    await waitFor(() => expect(fetchBeacons).toHaveBeenCalled(), { timeout: 2000 });
    // "All" window: no bounds; trails off, so newest per sender.
    expect(fetchBeacons.mock.calls[0][0]).toEqual({
      since: undefined,
      until: undefined,
      latestPerSender: true,
    });
    await waitFor(() => {
      const beacons = lastSetData('rt-team-beacons');
      expect(beacons.features).toHaveLength(1);
      expect(beacons.features[0].properties).toMatchObject({
        message_id: 42,
        title: 'Alice',
        latest: true,
      });
      const waypoints = lastSetData('rt-team-waypoints');
      expect(waypoints.features[0].properties).toMatchObject({
        message_id: 43,
        title: 'Camp',
        icon: 'rt-team-pin-way-camp',
      });
    });
    for (const layerId of ['rt-team-beacons', 'rt-team-trail-dots', 'rt-team-waypoints']) {
      const clickBound = stub.on.mock.calls.some(
        (c: unknown[]) => c[0] === 'click' && c[1] === layerId
      );
      expect(clickBound).toBe(true);
    }
  });

  it('asks for every beacon when trails are remembered on', async () => {
    localStorage.setItem('remoteterm-map-beacons', 'true');
    localStorage.setItem('remoteterm-map-beacons-trails', 'true');
    const fetchBeacons = vi.spyOn(api, 'getTeamBeacons').mockResolvedValue(response);
    renderMap();
    await waitFor(() => expect(fetchBeacons).toHaveBeenCalled(), { timeout: 2000 });
    expect(fetchBeacons.mock.calls[0][0]).toMatchObject({ latestPerSender: false });
  });
});
