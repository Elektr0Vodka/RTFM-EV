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
import { emitTrackerEvent } from '../utils/trackerEvents';
import type { TrackerPosition, TrackersResponse } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const stub = (maplibre as any).__stub as {
  fire: (ev: string) => void;
  getSource: (id: string) => { setData: ReturnType<typeof vi.fn> } | undefined;
  on: ReturnType<typeof vi.fn>;
};

function position(identity: string, at: number): TrackerPosition {
  return {
    id: at,
    source: 'atak',
    identity,
    display_name: identity,
    team: 'Cyan',
    lat: 52.09,
    lon: 5.12,
    alt_m: null,
    speed_mps: 1.5,
    course_deg: 90,
    battery_pct: 80,
    channel_key: 'AB'.repeat(16),
    packet_id: null,
    path_len: 1,
    received_at: at,
  };
}

const response: TrackersResponse = {
  positions: [position('JESTER_25', 1_790_000_000)],
  objects: [],
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

describe('MapView Trackers layer', () => {
  it('does not fetch while the layer is off (default)', async () => {
    const fetchTrackers = vi.spyOn(api, 'getTrackers').mockResolvedValue(response);
    renderMap();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(fetchTrackers).not.toHaveBeenCalled();
  });

  it('fetches the newest fix per tracker and paints pins when switched on', async () => {
    localStorage.setItem('remoteterm-map-trackers', 'true');
    const fetchTrackers = vi.spyOn(api, 'getTrackers').mockResolvedValue(response);
    renderMap();
    await waitFor(() => expect(fetchTrackers).toHaveBeenCalled(), { timeout: 2000 });
    expect(fetchTrackers.mock.calls[0][0]).toEqual({
      since: undefined,
      until: undefined,
      latestPerIdentity: true,
    });
    await waitFor(() => {
      const pins = lastSetData('rt-trackers');
      expect(pins.features).toHaveLength(1);
      expect(pins.features[0].properties).toMatchObject({
        key: 'atak:JESTER_25',
        title: 'JESTER_25',
        latest: true,
      });
    });
    const clickBound = stub.on.mock.calls.some(
      (c: unknown[]) => c[0] === 'click' && c[1] === 'rt-trackers'
    );
    expect(clickBound).toBe(true);
  });

  it('asks for every fix when trails are on', async () => {
    localStorage.setItem('remoteterm-map-trackers', 'true');
    localStorage.setItem('remoteterm-map-trackers-trails', 'true');
    const fetchTrackers = vi.spyOn(api, 'getTrackers').mockResolvedValue(response);
    renderMap();
    await waitFor(() => expect(fetchTrackers).toHaveBeenCalled(), { timeout: 2000 });
    expect(fetchTrackers.mock.calls[0][0]).toMatchObject({ latestPerIdentity: false });
  });

  it('adds a live tracker event without refetching', async () => {
    localStorage.setItem('remoteterm-map-trackers', 'true');
    const fetchTrackers = vi.spyOn(api, 'getTrackers').mockResolvedValue(response);
    renderMap();
    await waitFor(() => expect(lastSetData('rt-trackers').features).toHaveLength(1), {
      timeout: 2000,
    });
    act(() => {
      emitTrackerEvent({ kind: 'position', data: position('NEW_1', 1_790_000_100) });
    });
    await waitFor(() => expect(lastSetData('rt-trackers').features).toHaveLength(2));
    expect(fetchTrackers).toHaveBeenCalledTimes(1);
  });
});
