import { describe, expect, it } from 'vitest';

import {
  buildTrackerFeatures,
  buildTrackerObjectFeatures,
  buildTrackerTrailFeatures,
  trackerColor,
  trackerId,
} from '../map/layers/trackersLayer';
import { mergeTrackerPosition } from '../map/useTrackers';
import type { TrackerObject, TrackerPosition } from '../types';

function pos(identity: string, at: number, extra: Partial<TrackerPosition> = {}): TrackerPosition {
  return {
    id: at,
    source: 'atak',
    identity,
    display_name: identity,
    team: null,
    lat: 52 + at / 1000,
    lon: 5,
    alt_m: null,
    speed_mps: null,
    course_deg: null,
    battery_pct: null,
    cot_uid: null,
    channel_key: null,
    packet_id: null,
    path_len: null,
    received_at: at,
    ...extra,
  };
}

describe('trackersLayer features', () => {
  it('marks only the newest fix per tracker as latest', () => {
    const fc = buildTrackerFeatures([pos('A', 3), pos('B', 2), pos('A', 1)]);
    expect(fc.features.map((f) => [f.properties.key, f.properties.latest])).toEqual([
      ['atak:A', true],
      ['atak:B', true],
      ['atak:A', false],
    ]);
    expect(fc.features[0].geometry.coordinates).toEqual([5, 52.003]);
    expect(fc.features[0].properties.title).toBe('A');
  });

  it('keeps the same name from two sources apart', () => {
    const fc = buildTrackerFeatures([pos('X', 2), pos('X', 1, { source: 'sar_fast_gps' })]);
    expect(fc.features.every((f) => f.properties.latest)).toBe(true);
  });

  it('draws one trail per tracker with two or more fixes, oldest first', () => {
    const fc = buildTrackerTrailFeatures([pos('A', 3), pos('B', 2), pos('A', 1)]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.coordinates).toEqual([
      [5, 52.001],
      [5, 52.003],
    ]);
  });

  it('colours ATAK users by team and SAR beacons apart', () => {
    expect(trackerColor(pos('A', 1, { team: 'Cyan' }))).toBe('#00ffff');
    expect(trackerColor(pos('A', 1, { team: 'Dark Blue' }))).toBe('#00008b');
    const noTeam = trackerColor(pos('A', 1));
    const sar = trackerColor(pos('A', 1, { source: 'sar_fast_gps' }));
    expect(noTeam).not.toBe(sar);
    expect(trackerId(pos('A', 1, { source: 'sar_fast_gps' }))).toBe('sar_fast_gps:A');
  });

  it('builds object pins with their uid', () => {
    const obj: TrackerObject = {
      uid: 'u-1',
      cot_type: 'a-h-G',
      callsign: 'OP',
      lat: 52,
      lon: 5,
      remarks: null,
      stale_at: null,
      sender: 'JSTR25',
      channel_key: null,
      received_at: 1,
    };
    const fc = buildTrackerObjectFeatures([obj]);
    expect(fc.features[0].properties).toMatchObject({ uid: 'u-1', title: 'OP' });
  });
});

describe('mergeTrackerPosition', () => {
  it('replaces the newest fix per tracker when trails are off', () => {
    const merged = mergeTrackerPosition([pos('A', 1), pos('B', 1)], pos('A', 2), false, null);
    expect(merged.map((p) => [p.identity, p.received_at])).toEqual([
      ['A', 2],
      ['B', 1],
    ]);
  });

  it('drops fixes that left the window and caps the list with trails on', () => {
    const current = [pos('A', 50), pos('A', 40), pos('A', 5)];
    const merged = mergeTrackerPosition(current, pos('A', 60), true, 10, 3);
    expect(merged.map((p) => p.received_at)).toEqual([60, 50, 40]);
    const capped = mergeTrackerPosition(merged, pos('A', 70), true, null, 3);
    expect(capped.map((p) => p.received_at)).toEqual([70, 60, 50]);
  });
});
