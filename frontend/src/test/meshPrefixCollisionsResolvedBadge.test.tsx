import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { MeshPrefixCollisionsPanel } from '../components/MeshPrefixCollisionsPanel';

const { listPartialResolutions } = vi.hoisted(() => ({
  listPartialResolutions: vi.fn(),
}));

vi.mock('../api', () => ({
  api: { listPartialResolutions },
}));

const collisionsResponse = {
  widths: [
    {
      width: 1,
      total_nodes: 3,
      distinct_prefixes: 2,
      colliding_prefixes: 1,
      colliding_nodes: 2,
      matrix: Array.from({ length: 256 }, () => 0),
      groups: [
        {
          prefix: 'aa',
          count: 2,
          max_distance_km: 5,
          located_count: 2,
          assessment: 'local',
          nodes: [
            { name: 'One', public_key: 'aa' + '11'.repeat(31), lat: 52, lon: 4 },
            { name: 'Two', public_key: 'aa' + '22'.repeat(31), lat: 52.1, lon: 4.1 },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => collisionsResponse })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MeshPrefixCollisionsPanel soft-resolution badge', () => {
  it('badges a collision group whose prefix has a soft resolution', async () => {
    listPartialResolutions.mockResolvedValue([
      { prefix_hex: 'aa', resolved_pubkey: 'aa' + '11'.repeat(31), resolved_name: 'One' },
    ]);
    render(<MeshPrefixCollisionsPanel refreshKey={0} />);
    expect(await screen.findByText('soft-resolved')).toBeInTheDocument();
  });

  it('shows no badge when the prefix has no soft resolution', async () => {
    listPartialResolutions.mockResolvedValue([]);
    render(<MeshPrefixCollisionsPanel refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('aa')).toBeInTheDocument());
    expect(screen.queryByText('soft-resolved')).not.toBeInTheDocument();
  });
});
