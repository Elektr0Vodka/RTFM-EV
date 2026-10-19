import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWakeLock } from '../../wardrive/wakeLock';

function fakeWakeLock() {
  const release = vi.fn(async () => {});
  const request = vi.fn(async () => ({ release, released: false }));
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
  return { request, release };
}

afterEach(() => {
  delete (navigator as { wakeLock?: unknown }).wakeLock;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('screen wake lock during a drive', () => {
  it('holds the screen on while driving and lets go when the drive stops', async () => {
    const { request, release } = fakeWakeLock();
    const { rerender } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: false } });
    expect(request).not.toHaveBeenCalled();
    rerender({ on: true });
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
    rerender({ on: false });
    await vi.waitFor(() => expect(release).toHaveBeenCalled());
  });

  it('asks again when the page comes back to the front', async () => {
    const { request } = fakeWakeLock();
    renderHook(() => useWakeLock(true));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it('does nothing where the browser has no wake lock', () => {
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  });
});
