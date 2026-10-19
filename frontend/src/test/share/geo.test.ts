import { describe, expect, it } from 'vitest';
import { attributionText, fitProjector, mercatorProjector } from '../../share/geo';
import { OFM_ATTRIBUTION } from '../../map/engine/basemaps';

describe('fitProjector', () => {
  it('keeps every point inside the padded rect', () => {
    const rect = { x: 0, y: 0, w: 690, h: 630 };
    const pts = [
      { lat: 52.0, lon: 4.3 },
      { lat: 52.4, lon: 5.1 },
      { lat: 51.9, lon: 5.0 },
    ];
    const proj = fitProjector(pts, rect, 40)!;
    for (const p of pts) {
      const { x, y } = proj(p);
      expect(x).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(x).toBeLessThanOrEqual(650 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(y).toBeLessThanOrEqual(590 + 1e-6);
    }
  });

  it('puts north up and east right', () => {
    const proj = fitProjector(
      [
        { lat: 52, lon: 4 },
        { lat: 53, lon: 5 },
      ],
      { x: 0, y: 0, w: 600, h: 600 },
      20
    )!;
    expect(proj({ lat: 53, lon: 4 }).y).toBeLessThan(proj({ lat: 52, lon: 4 }).y);
    expect(proj({ lat: 52, lon: 5 }).x).toBeGreaterThan(proj({ lat: 52, lon: 4 }).x);
  });

  it('centres a single point', () => {
    const proj = fitProjector([{ lat: 52, lon: 5 }], { x: 10, y: 0, w: 100, h: 50 }, 5)!;
    expect(proj({ lat: 52, lon: 5 })).toEqual({ x: 60, y: 25 });
  });

  it('returns null for no points', () => {
    expect(fitProjector([], { x: 0, y: 0, w: 1, h: 1 }, 0)).toBeNull();
  });
});

describe('mercatorProjector', () => {
  it('puts the centre in the middle and matches a known zoom-0 value', () => {
    const proj = mercatorProjector({ lat: 0, lon: 0 }, 0, { w: 512, h: 512 });
    expect(proj({ lat: 0, lon: 0 })).toEqual({ x: 256, y: 256 });
    expect(proj({ lat: 0, lon: 90 }).x).toBeCloseTo(384);
    expect(proj({ lat: 45, lon: 0 }).y).toBeLessThan(256);
  });
});

describe('attributionText', () => {
  it('strips the OFM attribution html', () => {
    expect(attributionText(OFM_ATTRIBUTION)).toBe(
      '© OpenFreeMap © OpenMapTiles Data from OpenStreetMap'
    );
  });

  it('decodes dashes and ampersands', () => {
    expect(attributionText('Esri &mdash; A &amp; B&nbsp;C')).toBe('Esri — A & B C');
  });

  it('leaves no tag behind, closed or not', () => {
    expect(attributionText('A <b>x</b> B <script')).toBe('A x B');
  });
});
