// Drives and reports as RTFM-EV serves them (app/wardrive/drives.py and
// app/wardrive/report.py): the same shapes on the driver API (/api/wardrive/)
// and the owner's (/api/wardrive-admin/). The components take a DrivesApi, so
// the wardrive page and the main app's Tools page share them.

export interface WardriveDrive {
  id: number;
  user_id: number;
  username: string;
  radio_key: string;
  radio_name: string | null;
  name: string | null;
  notes: string | null;
  start_ts: number;
  end_ts: number;
  obs: number;
  tracks: number;
  /** The viewer may rename, annotate, split, merge or delete it. */
  can_edit: boolean;
}

export type Band = 'strong' | 'fair' | 'weak' | 'none';

export interface ReportCell {
  id: string;
  lat: number;
  lon: number;
  receptions: number;
  rssi_best: number | null;
  rssi_median: number | null;
  band: Band;
  track_s: number;
  nodes: number;
  /** The node heard best in the cell, with its own best signal. */
  best_node: { id: string; name: string | null; guess: boolean; rssi: number | null } | null;
  first_ts: number;
}

export interface ReportWeakCell extends ReportCell {
  nearby: { id: string; name: string | null; guess: boolean; rssi_best: number }[];
}

export interface ReportNode {
  id: string;
  full_key: boolean;
  name: string | null;
  guess: boolean;
  role: string | null;
  receptions: number;
  rssi_best: number | null;
  rssi_median: number | null;
  rssi_worst: number | null;
  snr_median: number | null;
  cells: number;
  first_ts: number;
  last_ts: number;
  lat: number | null;
  lon: number | null;
  farthest_m: number | null;
}

export interface WardriveReport {
  scope: {
    drive_ids: number[];
    since: number | null;
    until: number | null;
    user_id: number | null;
    group_id: number | null;
    radio_key: string | null;
    res: number;
    /** After a cut at 200 000 rows: the start of the time both kinds cover. */
    cut_ts: number | null;
  };
  truncated: boolean;
  summary: {
    drives: number;
    drivers: number;
    radios: number;
    first_ts: number | null;
    last_ts: number | null;
    drive_seconds: number;
    distance_m: number;
    receptions: number;
    attributed: number;
    nodes_heard: number;
    rssi_best: number | null;
    rssi_median: number | null;
    rssi_worst: number | null;
    snr_median: number | null;
    bands: Record<Band, number>;
  };
  coverage: {
    cells_driven: number;
    cells_covered: number;
    covered_share: number | null;
    cell_bands: { strong: number; fair: number; weak: number };
    strongest: ReportCell[];
    weakest: ReportCell[];
  };
  weak_spots: {
    gaps: number;
    weak: number;
    total: number;
    /** Seconds spent in every weak cell (cells lists only the first 200). */
    track_s: number;
    cells: ReportWeakCell[];
  };
  nodes: ReportNode[];
  cells: ReportCell[];
  tracks: { drive_id: number; points: [number, number, number][] }[];
  points: { lat: number; lon: number; rssi: number | null; ts: number }[];
}

export interface DriveFilter {
  since?: number;
  until?: number;
  user_id?: number;
  group_id?: number;
  radio_key?: string;
}

export interface ReportQuery extends DriveFilter {
  drive?: number[];
  res?: number;
}

export type ExportKind = 'receptions.csv' | 'cells.csv' | 'drives.geojson' | 'drives.gpx';
export const EXPORT_KINDS: ExportKind[] = [
  'receptions.csv',
  'cells.csv',
  'drives.geojson',
  'drives.gpx',
];

export interface DrivesApi {
  drives(q: DriveFilter): Promise<{ drives: WardriveDrive[]; truncated: boolean }>;
  update(id: number, body: { name?: string | null; notes?: string | null }): Promise<WardriveDrive>;
  remove(id: number): Promise<void>;
  merge(ids: number[]): Promise<WardriveDrive>;
  split(id: number, at: number): Promise<void>;
  report(q: ReportQuery): Promise<WardriveReport>;
  download(kind: ExportKind, q: ReportQuery): Promise<void>;
  /** The viewer's own groups (the page's report filter; the owner has a list of all). */
  groups?(): Promise<{ id: number; name: string }[]>;
}

/** The query string for /drives, /report and /export (`drive` repeated). */
export function queryString(q: ReportQuery): string {
  const p = new URLSearchParams();
  for (const id of q.drive ?? []) p.append('drive', String(id));
  for (const key of ['since', 'until', 'user_id', 'group_id', 'radio_key', 'res'] as const) {
    const v = q[key];
    if (v !== undefined && v !== null && v !== '') p.set(key, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Report cell sizes the user can pick: resolution and edge in metres. */
export const CELL_SIZES: { res: number; metres: number }[] = [
  { res: 7, metres: 720 },
  { res: 8, metres: 360 },
  { res: 9, metres: 180 },
  { res: 10, metres: 90 },
  { res: 11, metres: 40 },
];
export const DEFAULT_RES = 9;
