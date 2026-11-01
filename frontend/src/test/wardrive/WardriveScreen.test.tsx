import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
      ['log', 'log'],
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

  it('keeps the log out of the top bar, so scrolling it never moves the buttons', () => {
    const { container } = render(
      <WardriveScreen
        map={null}
        topBar={<p>bar</p>}
        banners={null}
        log={<p>log</p>}
        hud={null}
        rail={null}
        start={null}
        menu={null}
      />
    );
    const top = container.querySelector('[data-region="top"]') as HTMLElement;
    expect(top.textContent).not.toContain('log');
    expect(container.querySelector('[data-region="log"]')?.textContent).toBe('log');
  });

  it('tells the page how much of the map the top bar and the HUD cover', () => {
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
    const onInsets = vi.fn();
    try {
      const { container } = render(
        <WardriveScreen
          map={null}
          topBar={<p>bar</p>}
          banners={null}
          log={null}
          hud={<p>hud</p>}
          rail={null}
          start={null}
          menu={null}
          onInsets={onInsets}
        />
      );
      const bar = container.querySelector('[data-region="topbar"]') as HTMLElement;
      Object.defineProperty(bar, 'offsetHeight', { configurable: true, value: 56 });
      Object.defineProperty(bar, 'offsetTop', { configurable: true, value: 12 });
      const hud = container.querySelector('[data-region="hud"]') as HTMLElement;
      Object.defineProperty(hud, 'offsetHeight', { configurable: true, value: 300 });
      act(() => report([], {} as ResizeObserver));
      expect(onInsets).toHaveBeenLastCalledWith({ top: 68, bottom: 300 });
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});
