import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '../../i18n';
import { MovablePanel } from '../../wardrive/screen/MovablePanel';

const KEY = 'rtfm-wardrive-log-pos';

function renderPanel() {
  return render(
    <I18nProvider>
      <MovablePanel storageKey={KEY} handleLabel="Move the log">
        <ul data-testid="content">
          <li>row</li>
        </ul>
      </MovablePanel>
    </I18nProvider>
  );
}

const offset = () => {
  const el = screen.getByTestId('movable-panel');
  return el.style.transform;
};

describe('movable panel', () => {
  beforeEach(() => localStorage.clear());

  it('moves with a drag on its handle and keeps the spot', () => {
    const { unmount } = renderPanel();
    expect(offset()).toBe('translate(0px, 0px)');
    const handle = screen.getByRole('button', { name: 'Move the log' });
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 130, clientY: 180, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 130, clientY: 180, pointerId: 1 });
    expect(offset()).toBe('translate(30px, 80px)');
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({ x: 30, y: 80 });
    unmount();
    renderPanel();
    expect(offset()).toBe('translate(30px, 80px)');
  });

  it('does not move on a drag that did not start on the handle', () => {
    renderPanel();
    const content = screen.getByTestId('content');
    fireEvent.pointerDown(content, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(content, { clientX: 160, clientY: 160, pointerId: 1 });
    fireEvent.pointerUp(content, { pointerId: 1 });
    expect(offset()).toBe('translate(0px, 0px)');
  });

  it('stays on screen however far it is dragged, and goes home on a double tap', () => {
    renderPanel();
    const handle = screen.getByRole('button', { name: 'Move the log' });
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 99999, clientY: 99999, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    const [x, y] = offset()
      .match(/-?\d+(\.\d+)?/g)!
      .map(Number);
    expect(x).toBeLessThanOrEqual(window.innerWidth);
    expect(y).toBeLessThanOrEqual(window.innerHeight);
    fireEvent.doubleClick(handle);
    expect(offset()).toBe('translate(0px, 0px)');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('ignores a stored spot it cannot read', () => {
    localStorage.setItem(KEY, '{"x":"far"}');
    renderPanel();
    expect(offset()).toBe('translate(0px, 0px)');
  });

  it('keeps its whole width on screen', () => {
    renderPanel();
    const panel = screen.getByTestId('movable-panel');
    Object.defineProperty(panel, 'offsetWidth', {
      configurable: true,
      value: window.innerWidth - 24,
    });
    const handle = screen.getByRole('button', { name: 'Move the log' });
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 0, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 0, clientY: 10, pointerId: 1 });
    expect(offset()).toBe('translate(-12px, 0px)');
  });

  describe('inside an area', () => {
    // The coverage map's list: home is bottom-left of the map, not centred
    // at the top of the window, and it grows upward as rows load.
    const AREA = { left: 240, top: 306, right: 1024, bottom: 767 };
    const HOME = { left: 248, bottom: 735, width: 320 };
    let height = 73;
    let resized: (() => void) | null = null;

    function renderInArea() {
      height = 73;
      resized = null;
      const area = document.createElement('div');
      area.getBoundingClientRect = () =>
        ({ ...AREA, width: AREA.right - AREA.left, height: AREA.bottom - AREA.top }) as DOMRect;
      const origRect = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
        if (this.dataset.testid !== 'movable-panel') return origRect.call(this);
        const [x, y] = (this.style.transform.match(/-?\d+(\.\d+)?/g) ?? ['0', '0']).map(Number);
        const left = HOME.left + x;
        const bottom = HOME.bottom + y;
        return {
          left,
          top: bottom - height,
          right: left + HOME.width,
          bottom,
          width: HOME.width,
          height,
        } as DOMRect;
      };
      const origRO = globalThis.ResizeObserver;
      globalThis.ResizeObserver = class {
        constructor(cb: () => void) {
          resized = cb;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
      // StrictMode runs the mount effects twice, as the dev build does.
      const view = render(
        <StrictMode>
          <I18nProvider>
            <MovablePanel storageKey={KEY} handleLabel="Move the list" bounds={() => area}>
              <ul>
                <li>row</li>
              </ul>
            </MovablePanel>
          </I18nProvider>
        </StrictMode>
      );
      return {
        ...view,
        restore: () => {
          HTMLElement.prototype.getBoundingClientRect = origRect;
          globalThis.ResizeObserver = origRO;
        },
      };
    }

    const drag = (fromX: number, fromY: number, toX: number, toY: number) => {
      const handle = screen.getByRole('button', { name: 'Move the list' });
      fireEvent.pointerDown(handle, { clientX: fromX, clientY: fromY, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: toX, clientY: toY, pointerId: 1 });
      fireEvent.pointerUp(handle, { clientX: toX, clientY: toY, pointerId: 1 });
    };

    it('moves up from a home at the bottom, and stops at the edges of the area', () => {
      const { restore } = renderInArea();
      try {
        drag(318, 662, 542, 438);
        expect(offset()).toBe('translate(224px, -224px)');
        drag(542, 438, 99999, -99999);
        expect(offset()).toBe('translate(456px, -356px)');
        drag(0, 0, -99999, 99999);
        expect(offset()).toBe('translate(-8px, 32px)');
        expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual({ x: -8, y: 32 });
      } finally {
        restore();
      }
    });

    it('pulls a stored spot outside the area back in', () => {
      localStorage.setItem(KEY, JSON.stringify({ x: -352, y: 100 }));
      const { restore } = renderInArea();
      try {
        expect(offset()).toBe('translate(-8px, 32px)');
      } finally {
        restore();
      }
    });

    it('stays inside when it grows after being moved to the top', () => {
      const { restore } = renderInArea();
      try {
        drag(318, 662, 318, -99999);
        expect(offset()).toBe('translate(0px, -356px)');
        height = 383;
        act(() => resized?.());
        expect(offset()).toBe('translate(0px, -46px)');
      } finally {
        restore();
      }
    });
  });
});
