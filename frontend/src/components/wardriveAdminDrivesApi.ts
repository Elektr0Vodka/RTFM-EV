// The owner's drives and reports (/api/wardrive-admin/, behind the main
// login) as the DrivesApi the shared drive and report components take.
import { api } from '../api';
import { saveExport } from '../wardrive/reports/saveExport';
import {
  queryString,
  type DrivesApi,
  type WardriveDrive,
  type WardriveReport,
} from '../wardrive/reports/types';

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const adminDrivesApi: DrivesApi = {
  drives: (q) =>
    api.wardriveAdmin<{ drives: WardriveDrive[]; truncated: boolean }>(`/drives${queryString(q)}`),
  update: (id, body) => api.wardriveAdmin<WardriveDrive>(`/drives/${id}`, json('PATCH', body)),
  remove: async (id) => {
    await api.wardriveAdmin(`/drives/${id}`, json('DELETE'));
  },
  merge: (ids) => api.wardriveAdmin<WardriveDrive>('/drives/merge', json('POST', { ids })),
  split: async (id, at) => {
    await api.wardriveAdmin(`/drives/${id}/split`, json('POST', { at }));
  },
  report: (q) => api.wardriveAdmin<WardriveReport>(`/report${queryString(q)}`),
  // Fetched with the main login, so a refusal shows the server's message.
  download: (kind, q) =>
    saveExport(
      `./api/wardrive-admin/export/${kind}${queryString(q)}`,
      kind,
      (message) => new Error(message)
    ),
};
