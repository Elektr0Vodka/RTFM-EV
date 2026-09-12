import { describe, it, expect } from 'vitest';
import { recolorNovaDark, NOVA_PALETTE } from '../../map/engine/novaRecolor';

/* eslint-disable @typescript-eslint/no-explicit-any */
const style = {
  version: 8,
  sources: {},
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
    { id: 'water', type: 'fill', 'source-layer': 'water', paint: { 'fill-color': '#00f' } },
    { id: 'road_motorway', type: 'line', 'source-layer': 'transportation', paint: {} },
    {
      id: 'mystery',
      type: 'line',
      'source-layer': 'unknownlayer',
      paint: { 'line-color': '#123' },
    },
  ],
} as any;

describe('recolorNovaDark', () => {
  it('recolours background, water and roads to the Nova palette', () => {
    const out = recolorNovaDark(style);
    const by = (id: string) => (out.layers as any[]).find((l) => l.id === id);
    expect(by('background').paint['background-color']).toBe(NOVA_PALETTE.land);
    expect(by('water').paint['fill-color']).toBe(NOVA_PALETTE.water);
    expect(by('road_motorway').paint['line-color']).toBe(NOVA_PALETTE.road_bright);
  });
  it('passes unknown layers through unchanged and does not mutate input', () => {
    const out = recolorNovaDark(style);
    expect((out.layers as any[]).find((l) => l.id === 'mystery').paint['line-color']).toBe('#123');
    expect((style.layers as any[])[0].paint['background-color']).toBe('#fff');
    expect(out).not.toBe(style);
  });
});
