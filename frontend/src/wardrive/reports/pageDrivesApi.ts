// The driver's drives and reports (/api/wardrive/, wardrive session cookie)
// as the DrivesApi the shared drive and report components take.
import { WardriveApiError, wardriveCall } from '../api';
import { saveExport } from './saveExport';
import { queryString, type DrivesApi, type WardriveDrive, type WardriveReport } from './types';

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

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
  groups: async () =>
    (await wardriveCall<{ groups: { id: number; name: string }[] }>('/groups')).groups,
  // Fetched with the session cookie, then saved under the server's file name.
  download: (kind, q) =>
    saveExport(
      `../api/wardrive/export/${kind}${queryString(q)}`,
      kind,
      (message, status) => new WardriveApiError(message, status)
    ),
};
