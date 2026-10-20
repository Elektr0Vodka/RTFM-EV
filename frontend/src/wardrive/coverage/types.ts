// The coverage map's data as the server sends it (app/wardrive/map.py).

export interface MapSender {
  kind: string | null;
  id: string | null;
  label: string | null;
  role: string | null;
}

export interface MapPoint {
  rx_at: string;
  rx_ts: number;
  rssi: number | null;
  snr: number | null;
  lat: number;
  lon: number;
  accuracy: number | null;
  user_id: number;
  driver: string;
  radio_key: string;
  radio_name: string | null;
  packet_type: number | null;
  packet_type_name: string;
  route: string | null;
  path: string[];
  hops: number;
  sender: MapSender;
  /** The sender's name by RTFM-EV's nodes (or a channel sender's own). */
  name: string | null;
  /** True when the name comes from a short id. */
  guess: boolean;
  channel: string | null;
  drive_id: number | null;
  drive_name: string | null;
  hash: string;
  pub_at: string | null;
  uploaded_at: number | null;
  len: number | null;
  payload_len: number | null;
  src: string | null;
}

export interface MapCell {
  cell: string;
  best: number | null;
  count: number;
  drivers: number;
  /** Corners as [lon, lat], closed. */
  ring: [number, number][];
}

export interface MapDriver {
  user_id: number;
  username: string;
  count: number;
  last_ts: number;
  last_rx_at: string | null;
  last_lat: number | null;
  last_lon: number | null;
}

export interface PointsPage {
  points: MapPoint[];
  truncated: boolean;
  covers_from: string | null;
}

export interface CellsPage {
  cells: MapCell[];
  truncated: boolean;
  covers_from: string | null;
}
