import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WardriveScreen } from '../../wardrive/screen/WardriveScreen';

describe('wardrive screen layout', () => {
  it('puts every part in its own region over the map', () => {
    const { container } = render(
      <WardriveScreen
        map={<p>map</p>}
        topBar={<p>top</p>}
        banners={<p>banners</p>}
        log={<p>log</p>}
        hud={<p>hud</p>}
        rail={<p>rail</p>}
        start={<p>start</p>}
        menu={<p>menu</p>}
      />
    );
    for (const [region, text] of [
      ['map', 'map'],
      ['top', 'top'],
      ['top', 'banners'],
      ['top', 'log'],
      ['hud', 'hud'],
      ['rail', 'rail'],
    ]) {
      const el = container.querySelector(`[data-region="${region}"]`);
      expect(el?.textContent).toContain(text);
    }
    expect(container.textContent).toContain('start');
    expect(container.textContent).toContain('menu');
  });

  it('tells the map and the top stack how tall the HUD is', () => {
    let report: ResizeObserverCallback = () => {};
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        report = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    try {
      const { container } = render(
        <WardriveScreen
          map={null}
          topBar={null}
          banners={null}
          log={null}
          hud={<p>hud</p>}
          rail={null}
          start={null}
          menu={null}
        />
      );
      const hud = container.querySelector('[data-region="hud"]') as HTMLElement;
      Object.defineProperty(hud, 'offsetHeight', { configurable: true, value: 146 });
      // Rail and HUD together: what the top stack must stay clear of.
      const bottom = container.querySelector('[data-region="bottom"]') as HTMLElement;
      Object.defineProperty(bottom, 'offsetHeight', { configurable: true, value: 302 });
      act(() => report([], {} as ResizeObserver));
      const root = container.firstElementChild as HTMLElement;
      expect(root.style.getPropertyValue('--wd-hud-h')).toBe('146px');
      expect(root.style.getPropertyValue('--wd-bottom-h')).toBe('302px');
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it('leaves the start screen out when there is none', () => {
    const { container } = render(
      <WardriveScreen
        map={null}
        topBar={null}
        banners={null}
        log={null}
        hud={null}
        rail={null}
        start={null}
        menu={null}
      />
    );
    expect(container.querySelector('[data-region="map"]')).toBeTruthy();
  });
});
