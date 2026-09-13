import { describe, it, expect } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { recolorNovaTinted, tintHex } from '../map/engine/novaRecolor';
import { novaBasemap } from '../map/engine/basemaps';

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const NAVY = '#0c1d33';

describe('tintHex', () => {
  it('re-hues a colour green so green is the dominant channel', () => {
    const [r, g, b] = rgb(tintHex(NAVY, 123, false));
    expect(g).toBeGreaterThanOrEqual(r);
    expect(g).toBeGreaterThanOrEqual(b);
  });

  it('re-hues a colour blue so blue is the dominant channel', () => {
    const [r, g, b] = rgb(tintHex(NAVY, 240, false));
    expect(b).toBeGreaterThanOrEqual(r);
    expect(b).toBeGreaterThanOrEqual(g);
  });

  it('desaturates to greyscale (all channels equal)', () => {
    const [r, g, b] = rgb(tintHex(NAVY, 0, true));
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('preserves lightness: a dark colour stays dark after tinting', () => {
    const [r, g, b] = rgb(tintHex(NAVY, 123, false));
    // navy is a dark colour; the tinted result must not blow out to a bright one
    expect(Math.max(r, g, b)).toBeLessThan(128);
  });
});

describe('recolorNovaTinted', () => {
  it('paints the background layer in the target hue', () => {
    const style = {
      version: 8,
      sources: {},
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#000000' } }],
    } as unknown as StyleSpecification;
    const out = recolorNovaTinted(123, false)(style);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bg = (out.layers as any[])[0].paint['background-color'] as string;
    const [r, g, b] = rgb(bg);
    expect(g).toBeGreaterThanOrEqual(r);
    expect(g).toBeGreaterThanOrEqual(b);
  });
});

describe('novaBasemap', () => {
  it('returns the plain Nova entry when no tint is given', () => {
    const entry = novaBasemap();
    expect(entry.id).toBe('nova');
    expect(entry.recolorId).toBe('nova');
  });

  it('folds the tint id into recolorId so the cache/signature differs per colour', () => {
    const green = novaBasemap({ id: 'green', hue: 123, desaturate: false });
    const blue = novaBasemap({ id: 'blue', hue: 240, desaturate: false });
    expect(green.recolorId).toBe('nova-green');
    expect(blue.recolorId).toBe('nova-blue');
    expect(green.recolorId).not.toBe(blue.recolorId);
    // still the Nova style/kind, just a different recolour
    expect(green.id).toBe('nova');
    expect(green.kind).toBe('vector-recolor');
    expect(green.styleUrl).toBe(novaBasemap().styleUrl);
  });
});
