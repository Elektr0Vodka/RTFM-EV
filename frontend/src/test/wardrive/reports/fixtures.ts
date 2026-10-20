import { vi } from 'vitest';

import type {
  DrivesApi,
  ReportCell,
  WardriveDrive,
  WardriveReport,
} from '../../../wardrive/reports/types';

export const T0 = 1792404000;

export function drive(over: Partial<WardriveDrive> = {}): WardriveDrive {
  return {
    id: 1,
    user_id: 1,
    username: 'anna',
    radio_key: 'AA'.repeat(32),
    radio_name: 'car',
    name: null,
    notes: null,
    start_ts: T0,
    end_ts: T0 + 3900,
    obs: 42,
    tracks: 300,
    can_edit: true,
    ...over,
  };
}

export function cell(over: Partial<ReportCell> = {}): ReportCell {
  return {
    id: '9:-10595:25534',
    lat: 52.5168,
    lon: 6.083,
    receptions: 3,
    rssi_best: -80,
    rssi_median: -90,
    band: 'strong',
    track_s: 120,
    nodes: 1,
    best_node: { id: 'c3', name: 'Toren', guess: true, rssi: -85 },
    first_ts: T0,
    ...over,
  };
}

export function report(over: Partial<WardriveReport> = {}): WardriveReport {
  return {
    scope: {
      drive_ids: [1],
      since: null,
      until: null,
      user_id: null,
      group_id: null,
      radio_key: null,
      res: 9,
      cut_ts: null,
    },
    truncated: false,
    summary: {
      drives: 1,
      drivers: 1,
      radios: 1,
      first_ts: T0,
      last_ts: T0 + 3900,
      drive_seconds: 3900,
      distance_m: 12345,
      receptions: 42,
      attributed: 40,
      nodes_heard: 2,
      rssi_best: -71,
      rssi_median: -95.5,
      rssi_worst: -118,
      snr_median: 4.5,
      bands: { strong: 10, fair: 20, weak: 10, none: 2 },
    },
    coverage: {
      cells_driven: 50,
      cells_covered: 31,
      covered_share: 0.62,
      cell_bands: { strong: 10, fair: 15, weak: 6 },
      strongest: [cell()],
      weakest: [cell({ id: '9:1:2', rssi_best: -117, band: 'weak' })],
    },
    weak_spots: {
      gaps: 19,
      weak: 6,
      total: 25,
      cells: [
        {
          ...cell({ id: '9:3:4', receptions: 0, rssi_best: null, rssi_median: null, band: 'none' }),
          track_s: 600,
          best_node: null,
          nearby: [{ id: 'c3', name: 'Toren', guess: true, rssi_best: -101 }],
        },
      ],
    },
    nodes: [
      {
        id: 'c3',
        full_key: false,
        name: 'Toren',
        guess: true,
        role: 'Repeater',
        receptions: 30,
        rssi_best: -71,
        rssi_median: -92,
        rssi_worst: -112,
        snr_median: 5,
        cells: 20,
        first_ts: T0,
        last_ts: T0 + 3000,
        lat: 52.5,
        lon: 6.1,
        farthest_m: 8400,
      },
      {
        id: 'a1b2c3d4e5f6',
        full_key: false,
        name: null,
        guess: false,
        role: null,
        receptions: 10,
        rssi_best: -99,
        rssi_median: -105,
        rssi_worst: -118,
        snr_median: -2,
        cells: 5,
        first_ts: T0,
        last_ts: T0 + 100,
        lat: null,
        lon: null,
        farthest_m: null,
      },
    ],
    cells: [cell()],
    tracks: [
      {
        drive_id: 1,
        points: [
          [6.08, 52.51, T0],
          [6.09, 52.52, T0 + 600],
        ],
      },
    ],
    points: [
      { lat: 52.51, lon: 6.08, rssi: -80, ts: T0 },
      { lat: 52.52, lon: 6.09, rssi: -110, ts: T0 + 600 },
    ],
    ...over,
  };
}

export function emptyReport(): WardriveReport {
  return report({
    summary: {
      ...report().summary,
      drives: 0,
      drivers: 0,
      radios: 0,
      first_ts: null,
      last_ts: null,
      drive_seconds: 0,
      distance_m: 0,
      receptions: 0,
      attributed: 0,
      nodes_heard: 0,
      rssi_best: null,
      rssi_median: null,
      rssi_worst: null,
      snr_median: null,
      bands: { strong: 0, fair: 0, weak: 0, none: 0 },
    },
    coverage: {
      cells_driven: 0,
      cells_covered: 0,
      covered_share: null,
      cell_bands: { strong: 0, fair: 0, weak: 0 },
      strongest: [],
      weakest: [],
    },
    weak_spots: { gaps: 0, weak: 0, total: 0, cells: [] },
    nodes: [],
    cells: [],
    tracks: [],
    points: [],
  });
}

export function fakeApi(drives: WardriveDrive[] = [drive()], rep = report()) {
  return {
    drives: vi.fn(async () => ({ drives, truncated: false })),
    update: vi.fn(async (id: number, body: { name?: string | null; notes?: string | null }) => ({
      ...drives.find((d) => d.id === id)!,
      ...body,
    })),
    remove: vi.fn(async () => {}),
    merge: vi.fn(async (ids: number[]) => drives.find((d) => d.id === ids[0])!),
    split: vi.fn(async () => {}),
    report: vi.fn(async () => rep),
    download: vi.fn(async () => {}),
  } satisfies DrivesApi;
}
