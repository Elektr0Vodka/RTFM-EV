import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../api';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api.saveBackup', () => {
  it('POSTs to /backup/save and returns the result', async () => {
    const payload = { path: '/mnt/x/meshcore-backup-x.db', size_bytes: 4096, timestamp: 't' };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const result = await api.saveBackup();
    expect(fetchMock).toHaveBeenCalledWith(
      './api/backup/save',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.size_bytes).toBe(4096);
  });
});

describe('api.downloadBackupUrl', () => {
  it('returns the download URL', () => {
    expect(api.downloadBackupUrl()).toBe('./api/backup/download');
  });
});
