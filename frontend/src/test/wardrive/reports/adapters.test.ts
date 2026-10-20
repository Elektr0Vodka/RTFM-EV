import { afterEach, describe, expect, it, vi } from 'vitest';

import { adminDrivesApi } from '../../../components/wardriveAdminDrivesApi';
import { pageDrivesApi } from '../../../wardrive/reports/pageDrivesApi';

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('drive api adapters', () => {
  it('the page reads drives and reports from /api/wardrive with its session', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okJson({ drives: [], truncated: false }))
      .mockResolvedValueOnce(okJson({ summary: {} }));
    await pageDrivesApi.drives({ group_id: 3 });
    await pageDrivesApi.report({ drive: [1, 2], res: 10 });
    expect(fetchMock.mock.calls[0][0]).toBe('../api/wardrive/drives?group_id=3');
    expect(fetchMock.mock.calls[1][0]).toBe('../api/wardrive/report?drive=1&drive=2&res=10');
    expect((fetchMock.mock.calls[0][1] as RequestInit).credentials).toBe('same-origin');
  });

  it('the page sends changes as JSON', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => okJson({ id: 4, drive: {}, new_drive: {} }));
    await pageDrivesApi.update(4, { name: 'x' });
    await pageDrivesApi.merge([4, 5]);
    await pageDrivesApi.split(4, 99);
    await pageDrivesApi.remove(4);
    const calls = fetchMock.mock.calls.map((c) => [
      c[0],
      (c[1] as RequestInit).method,
      (c[1] as RequestInit).body,
    ]);
    expect(calls).toEqual([
      ['../api/wardrive/drives/4', 'PATCH', '{"name":"x"}'],
      ['../api/wardrive/drives/merge', 'POST', '{"ids":[4,5]}'],
      ['../api/wardrive/drives/4/split', 'POST', '{"at":99}'],
      ['../api/wardrive/drives/4', 'DELETE', undefined],
    ]);
  });

  it('the page saves an export under the server file name', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('a,b\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition':
            'attachment; filename="rtfm-ev-wardrive-receptions-2026-10-20.csv"',
        },
      })
    );
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicks.push(this.download);
    });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    await pageDrivesApi.download('receptions.csv', { drive: [1] });
    expect(clicks).toEqual(['rtfm-ev-wardrive-receptions-2026-10-20.csv']);
  });

  it('the page reports a refused export with the server message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'No such drive' }), { status: 404 })
    );
    await expect(pageDrivesApi.download('drives.gpx', { drive: [9] })).rejects.toThrow(
      'No such drive'
    );
  });

  it('the owner reads /api/wardrive-admin and downloads through a link', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(okJson({ drives: [], truncated: false }));
    await adminDrivesApi.drives({ user_id: 2, since: 5 });
    expect(fetchMock.mock.calls[0][0]).toBe('./api/wardrive-admin/drives?since=5&user_id=2');
    const hrefs: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      hrefs.push(this.getAttribute('href') ?? '');
    });
    await adminDrivesApi.download('cells.csv', { drive: [3], res: 9 });
    expect(hrefs).toEqual(['./api/wardrive-admin/export/cells.csv?drive=3&res=9']);
  });
});
