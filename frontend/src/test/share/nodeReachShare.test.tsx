import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const renderNodeReachCard = vi.fn();
vi.mock('../../share/cards/nodeReachRender', () => ({
  renderNodeReachCard: (...args: unknown[]) => renderNodeReachCard(...args),
}));
vi.mock('../../share/shareBrand', () => ({
  loadShareBrand: vi.fn().mockResolvedValue({ name: 'RTFM-EV', icon: null }),
}));

import { useNodeReachBuild } from '../../share/cards/useNodeReachShare';
import type { ReachNeighbor } from '../../share/cards/nodeReach';
import type { CardText } from '../../share/cardChrome';

const config = { name: 'Base Radio', lat: 52, lon: 5 };
const neighbors: ReachNeighbor[] = [
  { public_key: 'a', name: 'Alpha', first_seen: 1, lat: 52.1, lon: 5, best_snr: 8 },
  { public_key: 'b', name: 'Bravo', first_seen: 2, lat: null, lon: null, best_snr: -2 },
];

beforeEach(() => {
  vi.clearAllMocks();
  renderNodeReachCard.mockResolvedValue({ png: new Blob(['p'], { type: 'image/png' }) });
});

describe('useNodeReachBuild', () => {
  it('builds the card text', async () => {
    const { result } = renderHook(() => useNodeReachBuild(neighbors, config, [], 'Last 7d'));
    const res = await result.current!({ hidePosition: false, noMap: false, flags: {} });
    const text = renderNodeReachCard.mock.calls[0][1] as CardText;
    expect(text.title).toBe('Who Base Radio hears directly');
    expect(text.kicker).toBe('Heard directly, Last 7d');
    expect(text.figures.map((f) => f.label)).toEqual([
      'nodes heard directly',
      'furthest',
      'repeaters',
      'median SNR',
    ]);
    expect(text.figures[0].value).toBe('2');
    expect(text.figures[3].value).toBe('3.0 dB');
    expect(res.filenameBase).toMatch(/^rtfm-ev-reach-/);
  });

  it('shows the count as 50+ at the cap', async () => {
    const many: ReachNeighbor[] = Array.from({ length: 50 }, (_, i) => ({
      public_key: `k${i}`,
      name: null,
      first_seen: i,
      lat: null,
      lon: null,
    }));
    const { result } = renderHook(() => useNodeReachBuild(many, config, [], 'Last 7d'));
    await result.current!({ hidePosition: false, noMap: false, flags: {} });
    const text = renderNodeReachCard.mock.calls[0][1] as CardText;
    expect(text.figures[0].value).toBe('50+');
  });

  it('names no node in the title when the position is hidden', async () => {
    const { result } = renderHook(() => useNodeReachBuild(neighbors, config, [], 'Last 7d'));
    const res = await result.current!({ hidePosition: true, noMap: false, flags: {} });
    const text = renderNodeReachCard.mock.calls[0][1] as CardText;
    expect(text.title).toBe('Who my radio hears directly');
    expect(res.alt).not.toContain('Base Radio');
  });

  it('returns null without neighbours', () => {
    const { result } = renderHook(() => useNodeReachBuild([], config, [], 'Last 7d'));
    expect(result.current).toBeNull();
  });
});
