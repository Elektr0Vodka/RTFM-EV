// The wardrive page's calls to RTFM-EV (/api/wardrive/, outside the main
// login; the session is a cookie scoped to that path).
import type { ObsMessage, TrackMessage } from './messages';

// Relative to the page (<prefix>/wardrive/), so a reverse-proxy sub-path keeps
// working; an absolute /api/ would leave it.
const BASE = '../api/wardrive';

export class WardriveApiError extends Error {
  /** HTTP status; 0 when the server could not be reached. */
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'WardriveApiError';
  }
}

export interface WardriveMe {
  user_id: number;
  username: string;
  visibility: 'own' | 'groups' | 'all';
  radios: { public_key: string; name: string | null }[];
}

export interface SignedRadio {
  public_key: string;
  nonce: string;
  signature: string;
}

export interface UploadResult {
  accepted_obs: number;
  duplicate_obs: number;
  accepted_tracks: number;
  duplicate_tracks: number;
}

export interface WardriveDataObs {
  user_id: number;
  username: string;
  radio_key: string;
  rx_at: string;
  hash: string;
  packet_type: number | null;
  route: string | null;
  path: string[];
  rssi: number | null;
  snr: number | null;
  lat: number;
  lon: number;
  accuracy: number | null;
}

export interface WardriveDataTrack {
  user_id: number;
  username: string;
  radio_key: string;
  t0: string;
  t1: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  rx_count: number;
  listening: boolean;
}

export interface WardriveData {
  obs: WardriveDataObs[];
  tracks: WardriveDataTrack[];
  truncated: boolean;
}

/** A node RTFM-EV knows (GET /api/wardrive/nodes): public advert data only. */
export interface ServedNode {
  public_key: string;
  name: string | null;
  role: string | null;
  lat: number | null;
  lon: number | null;
  seen: number | null;
}

/** GET /api/wardrive/config. Fields after the channels came later: an
 * older server leaves them out. */
export interface WardriveConfig {
  hashtag_channels: string[];
  rssi_calibration_db?: number;
  /** Checked by forward/brokers.ts parseBrokers before use. */
  brokers?: unknown;
}

export interface NodeBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** A call to the driver API (reports/pageDrivesApi.ts uses it for drives). */
export function wardriveCall<T>(path: string, init: RequestInit = {}): Promise<T> {
  return call<T>(path, init);
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch (e) {
    throw new WardriveApiError(e instanceof Error ? e.message : String(e), 0);
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') message = body.detail;
      else if (body.detail) message = JSON.stringify(body.detail);
    } catch {
      // Not JSON.
    }
    throw new WardriveApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const wardriveApi = {
  challenge: (publicKey: string) =>
    post<{ nonce: string; message_hex: string }>('/challenge', { public_key: publicKey }),
  register: (body: SignedRadio & { username: string; password: string; radio_name?: string }) =>
    post<WardriveMe>('/register', body),
  login: (username: string, password: string) => post<WardriveMe>('/login', { username, password }),
  logout: () => post<void>('/logout'),
  me: () => call<WardriveMe>('/me'),
  addRadio: (body: SignedRadio & { name?: string }) => post<WardriveMe>('/radios', body),
  /** `drive_uid` is RTFM-EV's own drive id (driveId.ts), never forwarded. */
  upload: (body: {
    radio_key: string;
    drive_uid?: string;
    obs: ObsMessage[];
    tracks: TrackMessage[];
  }) => post<UploadResult>('/upload', body),
  /** Owner settings for the page: the hashtag channel names to decode, the
   * RSSI calibration and the brokers. */
  config: () => call<WardriveConfig>('/config'),
  nodes: (box: NodeBox) =>
    call<{ nodes: ServedNode[]; truncated: boolean }>(
      `/nodes?min_lat=${box.minLat}&max_lat=${box.maxLat}&min_lon=${box.minLon}&max_lon=${box.maxLon}`
    ),
  data: (params: { since?: number; until?: number; radio_key?: string } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
    const qs = q.toString();
    return call<WardriveData>(`/data${qs ? `?${qs}` : ''}`);
  },
};
