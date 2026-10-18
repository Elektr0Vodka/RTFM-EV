import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const renderMeshSummaryCard = vi.fn();
vi.mock('../../share/cards/meshSummaryRender', () => ({
  renderMeshSummaryCard: (...args: unknown[]) => renderMeshSummaryCard(...args),
}));
vi.mock('../../share/shareBrand', () => ({
  loadShareBrand: vi.fn().mockResolvedValue({ name: 'RTFM-EV', icon: null }),
}));
const api = vi.hoisted(() => ({
  getAirtimeRange: vi.fn(),
  getMeshHealthHeardBins: vi.fn(),
}));
vi.mock('../../api', () => ({ api }));

import { useMeshSummaryBuild } from '../../share/cards/useMeshSummaryShare';
import type { CardText } from '../../share/cardChrome';

const json = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  renderMeshSummaryCard.mockResolvedValue({ png: new Blob(['p'], { type: 'image/png' }) });
  api.getAirtimeRange.mockResolvedValue([{ timestamp: 1, tx_pct: 2, rx_pct: 10 }]);
  api.getMeshHealthHeardBins.mockResolvedValue({ bins: [{ start_ts: 0, keys: ['a'] }] });
  fetchMock = vi.fn((url: string) => {
    if (url.startsWith('./api/packets/mesh-health?'))
      return json({
        total_contacts: 2,
        contacts: [
          { public_key: 'a', lat: 52, lon: 5, flood_count: 3 },
          { public_key: 'b', lat: null, lon: null, flood_count: 1 },
        ],
      });
    if (url.startsWith('./api/packets/historical-stats')) return json({ total_packets: 1234 });
    if (url.startsWith('./api/packets/timeseries')) return json({ bins: [{ packet_count: 7 }] });
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('useMeshSummaryBuild', () => {
  it('fetches the window and builds the card text', async () => {
    const { result } = renderHook(() => useMeshSummaryBuild({ hours: 24, label: '24h' }, 'Base'));
    const res = await result.current({ hidePosition: false, noMap: false, flags: {} });
    const text = renderMeshSummaryCard.mock.calls[0][1] as CardText;
    expect(text.title).toBe('The mesh around Base');
    expect(text.kicker).toBe('Last 24h, as heard by my radio');
    expect(text.figures.map((f) => [f.value, f.label])).toEqual([
      ['2', 'nodes heard advertising'],
      ['1,234', 'packets heard'],
      ['12.0 %', 'airtime used'],
      ['4', 'flood adverts'],
    ]);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith('./api/packets/mesh-health?start_ts='))).toBe(true);
    expect(api.getMeshHealthHeardBins).toHaveBeenCalled();
    expect(res.filenameBase).toMatch(/^rtfm-ev-mesh-/);
  });

  it('leaves out the advert figures when Mesh Health could not be read', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith('./api/packets/mesh-health?'))
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
        } as Response);
      if (url.startsWith('./api/packets/historical-stats')) return json({ total_packets: 5 });
      return json({ bins: [] });
    });
    const { result } = renderHook(() => useMeshSummaryBuild({ hours: 24, label: '24h' }, 'Base'));
    await result.current({ hidePosition: false, noMap: false, flags: {} });
    const text = renderMeshSummaryCard.mock.calls[0][1] as CardText;
    const labels = text.figures.map((f) => f.label);
    expect(labels).not.toContain('nodes heard advertising');
    expect(labels).not.toContain('flood adverts');
    expect(labels).toContain('packets heard');
  });

  it('leaves out airtime without samples', async () => {
    api.getAirtimeRange.mockResolvedValue([]);
    const { result } = renderHook(() => useMeshSummaryBuild({ hours: 1, label: '1h' }, 'Base'));
    await result.current({ hidePosition: false, noMap: false, flags: {} });
    const text = renderMeshSummaryCard.mock.calls[0][1] as CardText;
    expect(text.figures.map((f) => f.label)).not.toContain('airtime used');
  });
});
