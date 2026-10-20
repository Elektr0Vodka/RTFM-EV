import { fireEvent, render, screen } from '@testing-library/react';
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
});
