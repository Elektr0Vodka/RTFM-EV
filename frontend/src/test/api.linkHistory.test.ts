import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';

let mockFetch: ReturnType<typeof vi.fn>;
const originalFetch = global.fetch;

beforeEach(() => {
  mockFetch = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
    );
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('link history api', () => {
  it('builds traffic-links query with window, heard-only and max km', async () => {
    await api.getTrafficLinks(undefined, { heardOnly: true, maxKm: 40, since: 100, until: 200 });
    expect(String(mockFetch.mock.calls[0][0])).toContain(
      '/packets/traffic-links?heard_only=true&max_km=40&since=100&until=200'
    );
  });

  it('adds since/until to advert-links', async () => {
    await api.getAdvertLinks(undefined, { since: 5 });
    expect(String(mockFetch.mock.calls[0][0])).toContain('/packets/advert-links?since=5');
  });

  it('builds link detail urls', async () => {
    await api.getLinkTimeseries('aa', 'bb', { since: 1, bucket: 'hour' });
    await api.getLinkPackets('aa', 'bb', { limit: 20, before: 99 });
    expect(String(mockFetch.mock.calls[0][0])).toContain(
      '/links/aa/bb/timeseries?since=1&bucket=hour'
    );
    expect(String(mockFetch.mock.calls[1][0])).toContain('/links/aa/bb/packets?limit=20&before=99');
  });
});
