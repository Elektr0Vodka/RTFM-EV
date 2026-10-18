import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCardBrand } from '../../share/brand';

const BAD = 'data:image/png;base64,BAD';

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  get src() {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    queueMicrotask(() => (v === BAD ? this.onerror?.() : this.onload?.()));
  }
}

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadCardBrand', () => {
  it('falls back to RTFM-EV when no brand name is set', async () => {
    const brand = await loadCardBrand({ brand_name: '', brand_icon: '', brand_hidden: false });
    expect(brand.name).toBe('RTFM-EV');
  });

  it('uses the custom brand name', async () => {
    const brand = await loadCardBrand({
      brand_name: '  Mesh Utrecht ',
      brand_icon: '',
      brand_hidden: false,
    });
    expect(brand.name).toBe('Mesh Utrecht');
  });

  it('leaves the name out when the brand name is hidden', async () => {
    const brand = await loadCardBrand({
      brand_name: 'Mesh Utrecht',
      brand_icon: '',
      brand_hidden: true,
    });
    expect(brand.name).toBe('');
  });

  it('uses the custom icon when it loads', async () => {
    const icon = 'data:image/png;base64,OK';
    const brand = await loadCardBrand({ brand_name: '', brand_icon: icon, brand_hidden: false });
    expect(brand.icon?.src).toBe(icon);
  });

  it('falls back to the built-in logo when the custom icon does not load', async () => {
    const brand = await loadCardBrand({ brand_name: '', brand_icon: BAD, brand_hidden: false });
    expect(brand.icon?.src).toBe('./favicon.svg');
  });

  it('works without settings', async () => {
    const brand = await loadCardBrand(null);
    expect(brand.name).toBe('RTFM-EV');
    expect(brand.icon?.src).toBe('./favicon.svg');
  });
});
