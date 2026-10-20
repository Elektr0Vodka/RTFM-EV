import { describe, expect, it, vi } from 'vitest';

import { coverageApi, fetchAllPoints, toQuery } from '../../../wardrive/coverage/api';
import { point } from './fixtures';

describe('coverage API', () => {
  it('builds a query with repeated sender and ignore keys', () => {
    expect(
      toQuery({ since: '1', users: '3,1', sender: ['ab', 'c d'], ignore: ['ff'], bbox: '1,2,3,4' })
    ).toBe('?since=1&users=3%2C1&sender=ab&sender=c+d&ignore=ff&bbox=1%2C2%2C3%2C4');
    expect(toQuery({})).toBe('');
  });

  it('adds the view-as parameters to every call', async () => {
    const get = vi.fn().mockResolvedValue({ points: [], cells: [], drivers: [] });
    const capi = coverageApi(get, { as_user: '4' });
    await capi.points({ since: '1' });
    await capi.cells({ since: '1' }, 9);
    await capi.drivers({ since: '1' });
    expect(get.mock.calls.map((c) => c[0])).toEqual([
      '/map/points?since=1&as_user=4',
      '/map/cells?since=1&res=9&as_user=4',
      '/map/drivers?since=1&as_user=4',
    ]);
  });

  it('passes the abort signal on', async () => {
    const get = vi.fn().mockResolvedValue({ points: [] });
    const signal = new AbortController().signal;
    await coverageApi(get).points({}, signal);
    expect(get.mock.calls[0][1]).toEqual({ signal });
  });

  it('pages through the points until the server has no more', async () => {
    const pages = [
      { points: [point({ hash: '1' })], truncated: true, covers_from: null },
      { points: [point({ hash: '2' })], truncated: false, covers_from: null },
    ];
    const points = vi.fn((params: Record<string, unknown>) =>
      Promise.resolve(pages[Number(params.offset) / 5000])
    );
    const result = await fetchAllPoints(
      { nodes: vi.fn(), points, cells: vi.fn(), drivers: vi.fn() },
      { since: '1' }
    );
    expect(result.points.map((p) => p.hash)).toEqual(['1', '2']);
    expect(result.truncated).toBe(false);
    expect(points.mock.calls.map((c) => c[0])).toEqual([
      { since: '1', limit: '5000', offset: '0' },
      { since: '1', limit: '5000', offset: '5000' },
    ]);
  });

  it('stops at the cap and says the answer was cut short', async () => {
    const points = vi.fn().mockResolvedValue({
      points: [point()],
      truncated: true,
      covers_from: '2026-10-01T00:00:00Z',
    });
    const result = await fetchAllPoints(
      { nodes: vi.fn(), points, cells: vi.fn(), drivers: vi.fn() },
      {},
      10000
    );
    expect(points).toHaveBeenCalledTimes(2);
    expect(result.truncated).toBe(true);
    expect(result.covers_from).toBe('2026-10-01T00:00:00Z');
  });

  it('reads the node registry for a box, without the view-as parameters', async () => {
    const get = vi.fn().mockResolvedValue({ nodes: [], truncated: false });
    await coverageApi(get, { as_user: '4' }).nodes({ south: 52, west: 5, north: 53, east: 6 });
    expect(get.mock.calls[0][0]).toBe('/nodes?min_lat=52&max_lat=53&min_lon=5&max_lon=6');
  });
});
