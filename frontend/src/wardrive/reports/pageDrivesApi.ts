// The driver's drives and reports (/api/wardrive/, wardrive session cookie)
// as the DrivesApi the shared drive and report components take.
import { WardriveApiError, wardriveCall } from '../api';
import { queryString, type DrivesApi, type WardriveDrive, type WardriveReport } from './types';

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const FILENAME = /filename="([^"]+)"/;

export const pageDrivesApi: DrivesApi = {
  drives: (q) =>
    wardriveCall<{ drives: WardriveDrive[]; truncated: boolean }>(`/drives${queryString(q)}`),
  update: (id, body) => wardriveCall<WardriveDrive>(`/drives/${id}`, send('PATCH', body)),
  remove: async (id) => {
    await wardriveCall(`/drives/${id}`, send('DELETE'));
  },
  merge: (ids) => wardriveCall<WardriveDrive>('/drives/merge', send('POST', { ids })),
  split: async (id, at) => {
    await wardriveCall(`/drives/${id}/split`, send('POST', { at }));
  },
  report: (q) => wardriveCall<WardriveReport>(`/report${queryString(q)}`),
  // Fetched with the session cookie, then saved under the server's file name.
  download: async (kind, q) => {
    let res: Response;
    try {
      res = await fetch(`../api/wardrive/export/${kind}${queryString(q)}`, {
        credentials: 'same-origin',
      });
    } catch (e) {
      throw new WardriveApiError(e instanceof Error ? e.message : String(e), 0);
    }
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = await res.json();
        if (typeof body.detail === 'string') message = body.detail;
      } catch {
        // Not JSON.
      }
      throw new WardriveApiError(message, res.status);
    }
    const blob = await res.blob();
    const name =
      FILENAME.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
      `rtfm-ev-wardrive-${kind}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
