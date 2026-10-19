// The DutchMeshCore wardrive messages, field for field and in the same order
// as core-hunter's wardrive.js (the shape the collectors and the analyzers
// behind them receive today):
//   obs    one reception with the position it was heard at
//   track  one listening interval; rx_count 0 while listening is silence
//          evidence a triangulator uses
import { bytesToHex, frameWalk, hashOfWalk } from './packet';

const ROUTE_TRANSPORT_FLOOD = 0;
const ROUTE_FLOOD = 1;
const ROUTE_DIRECT = 2;
const ROUTE_TRANSPORT_DIRECT = 3;
/** Where the position came from: the receiving device, as core-hunter sends it. */
const POSITION_SOURCE = 'phone';

export interface Fix {
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres, null when the source gives none. */
  accM: number | null;
  /** When the fix was taken, ms since the epoch. */
  at: number;
  /** Ground speed in m/s from the source, when it gives one (display only). */
  speedMps?: number | null;
  /** Course over ground in degrees from north, when the source gives one. */
  headingDeg?: number | null;
}

export interface Reception {
  rxAt: string;
  raw: Uint8Array;
  snr: number | null;
  rssi: number | null;
  fix: Fix;
}

export interface TrackRow {
  t0: string;
  t1: string;
  lat: number;
  lon: number;
  accM: number | null;
  rxCount: number;
  listening: boolean;
}

export interface ObsMessage {
  v: 1;
  origin_id: string;
  rx_at: string;
  pub_at?: string;
  hash: string;
  raw: string;
  len: number;
  packet_type: number;
  route?: 'F' | 'D';
  payload_len: number;
  path: string[];
  RSSI?: number;
  SNR?: number;
  pos: { lat: number; lon: number; accuracy?: number; src: string };
}

export interface TrackMessage {
  v: 1;
  origin_id: string;
  t0: string;
  t1: string;
  lat: number;
  lon: number;
  accuracy?: number;
  rx_count: number;
  listening: boolean;
  src: string;
}

// Six decimals is about 11 cm, more than a fix can justify.
const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
const finite = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** An obs, or null when the frame cannot be walked: without the hash a
 * consumer cannot join it to anything. Accuracy, RSSI, SNR and pub_at are
 * left out when unknown, never sent as 0. */
export async function buildObs(
  rec: Reception,
  originId: string,
  pubAt?: string
): Promise<ObsMessage | null> {
  const raw = rec.raw;
  const w = frameWalk(raw);
  if (!w) return null;
  const obs: Record<string, unknown> = { v: 1, origin_id: originId.toUpperCase(), rx_at: rec.rxAt };
  if (pubAt) obs.pub_at = pubAt;
  obs.hash = await hashOfWalk(raw, w);
  obs.raw = bytesToHex(raw);
  obs.len = raw.length;
  obs.packet_type = w.payloadType;
  if (w.routeType === ROUTE_FLOOD || w.routeType === ROUTE_TRANSPORT_FLOOD) obs.route = 'F';
  else if (w.routeType === ROUTE_DIRECT || w.routeType === ROUTE_TRANSPORT_DIRECT) obs.route = 'D';
  obs.payload_len = raw.length - w.payloadStart;
  obs.path = w.hops;
  if (finite(rec.rssi)) obs.RSSI = rec.rssi;
  if (finite(rec.snr)) obs.SNR = rec.snr;
  const pos: ObsMessage['pos'] = {
    lat: round(rec.fix.lat, 6),
    lon: round(rec.fix.lon, 6),
  } as ObsMessage['pos'];
  if (finite(rec.fix.accM)) pos.accuracy = round(rec.fix.accM, 1);
  pos.src = POSITION_SOURCE;
  obs.pos = pos;
  return obs as unknown as ObsMessage;
}

/** A track interval. `listening` is sent as true only when it is exactly true. */
export function buildTrack(row: TrackRow, originId: string): TrackMessage {
  const tk: Record<string, unknown> = {
    v: 1,
    origin_id: originId.toUpperCase(),
    t0: row.t0,
    t1: row.t1,
    lat: round(row.lat, 6),
    lon: round(row.lon, 6),
  };
  if (finite(row.accM)) tk.accuracy = round(row.accM, 1);
  tk.rx_count = finite(row.rxCount) ? row.rxCount : 0;
  tk.listening = row.listening === true;
  tk.src = POSITION_SOURCE;
  return tk as unknown as TrackMessage;
}
