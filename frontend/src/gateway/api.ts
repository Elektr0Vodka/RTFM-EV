// Client for the multi-radio gateway API (/gateway/api/radios). It is not part
// of the radio API in ../api.ts: the gateway is a separate server in front of
// one backend per radio.

import { getGatewayContext } from './context';

export type RadioState = 'stopped' | 'starting' | 'running' | 'crashed';

export type RadioTransport =
  | { type: 'serial'; port: string; baudrate?: number }
  | { type: 'tcp'; host: string; port?: number }
  // The gateway never returns the PIN, so it is absent when reading.
  | { type: 'ble'; address: string; pin?: string };

export interface GatewayRadioInfo {
  id: number;
  name: string;
  enabled: boolean;
  transport: RadioTransport;
  database_path: string;
  public_key: string | null;
  /** The <key> in /r/<key>/. Null until the radio has connected once. */
  url_key: string | null;
  /** Workspace URL relative to the gateway root, or null. */
  url: string | null;
  state: RadioState;
  restarts: number;
  radio_connected: boolean | null;
  radio_name: string | null;
}

export interface RadioInput {
  name: string;
  transport: RadioTransport;
}

export type RadioAction = 'start' | 'stop' | 'restart';

function gatewayBase(): string {
  return getGatewayContext()?.base ?? './';
}

/** Link to a radio's workspace from the current page, or null when it has none yet. */
export function radioHref(radio: Pick<GatewayRadioInfo, 'url'>): string | null {
  return radio.url ? `${gatewayBase()}../${radio.url}` : null;
}

/** Link to the radios page from the current page. */
export function radiosPageHref(): string {
  return gatewayBase();
}

async function errorDetail(res: Response): Promise<string> {
  const fallback = res.statusText || `HTTP ${res.status}`;
  try {
    const body: unknown = await res.json();
    const detail = (body as { detail?: unknown } | null)?.detail;
    if (typeof detail === 'string' && detail.length > 0) return detail;
    if (Array.isArray(detail)) {
      // FastAPI validation errors: [{ loc, msg, type }]
      const messages = detail
        .map((item) => (item as { msg?: unknown } | null)?.msg)
        .filter((msg): msg is string => typeof msg === 'string');
      if (messages.length > 0) return messages.join('; ');
    }
  } catch {
    // Not JSON: keep the status text.
  }
  return fallback;
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${gatewayBase()}api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorDetail(res));
  return (await res.json()) as T;
}

export const gatewayApi = {
  listRadios: () => request<GatewayRadioInfo[]>('/radios'),
  addRadio: (input: RadioInput) => request<GatewayRadioInfo>('/radios', 'POST', input),
  updateRadio: (id: number, input: Partial<RadioInput> & { enabled?: boolean }) =>
    request<GatewayRadioInfo>(`/radios/${id}`, 'PATCH', input),
  removeRadio: (id: number, deleteData: boolean) =>
    request<{ status: string }>(`/radios/${id}?delete_data=${deleteData}`, 'DELETE'),
  radioAction: (id: number, action: RadioAction) =>
    request<GatewayRadioInfo>(`/radios/${id}/${action}`, 'POST'),
  radioLog: (id: number, limit = 200) =>
    request<{ lines: string[] }>(`/radios/${id}/log?limit=${limit}`),
};
