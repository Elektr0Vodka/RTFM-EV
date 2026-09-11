import { describe, it, expect, vi } from 'vitest';
import { projectParticlePath } from '../../map/layers/particleOverlay';

describe('projectParticlePath', () => {
  it('maps each [lng,lat] via the map projector to container points', () => {
    const project = vi.fn(([lng, lat]: [number, number]) => ({ x: lng * 2, y: lat * 2 }));
    const pts = projectParticlePath(
      [
        [5, 52],
        [6, 53],
      ],
      project as never,
    );
    expect(pts).toEqual([
      { x: 10, y: 104 },
      { x: 12, y: 106 },
    ]);
  });
});
