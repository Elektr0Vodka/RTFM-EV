import { describe, it, expect, vi } from 'vitest';
import { buildingsPaint, buildingsLayerSpec, setBuildings3D } from '../../map/engine/buildings3D';

describe('buildingsPaint', () => {
  it('uses light vs dark extrusion colour and coalesced height/base', () => {
    expect(buildingsPaint('light')['fill-extrusion-color']).toBe('#c9ccd1');
    expect(buildingsPaint('dark')['fill-extrusion-color']).toBe('#3a3f4a');
    expect(buildingsPaint('dark')['fill-extrusion-height']).toEqual([
      'coalesce',
      ['get', 'render_height'],
      0,
    ]);
    expect(buildingsPaint('dark')['fill-extrusion-opacity']).toBe(0.85);
  });
});

describe('buildingsLayerSpec', () => {
  it('is a fill-extrusion on the building source-layer at minzoom 12', () => {
    const s = buildingsLayerSpec('openmaptiles', 'dark');
    expect(s).toMatchObject({
      id: 'buildings-3d',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 12,
    });
  });
});

describe('setBuildings3D', () => {
  it('removes the layer when turned off', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = { getLayer: vi.fn(() => ({})), removeLayer: vi.fn() } as any;
    await setBuildings3D(map, false, 'dark');
    expect(map.removeLayer).toHaveBeenCalledWith('buildings-3d');
  });
});
