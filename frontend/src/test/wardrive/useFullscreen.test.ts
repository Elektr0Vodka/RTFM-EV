import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFullscreen } from '../../wardrive/useFullscreen';

const root = document.documentElement as HTMLElement & { requestFullscreen?: unknown };

afterEach(() => {
  Reflect.deleteProperty(root, 'requestFullscreen');
  Reflect.deleteProperty(document, 'exitFullscreen');
  Reflect.deleteProperty(document, 'fullscreenElement');
});

describe('useFullscreen', () => {
  it('is unsupported without the Fullscreen API (an iPhone)', () => {
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.state).toBe('unsupported');
  });

  it('puts the whole page in full screen and takes it out again', async () => {
    let element: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => element,
    });
    const request = vi.fn(async () => {
      element = root;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    const exit = vi.fn(async () => {
      element = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    Object.defineProperty(root, 'requestFullscreen', { configurable: true, value: request });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.state).toBe('off');
    await act(async () => result.current.toggle());
    expect(request).toHaveBeenCalled();
    expect(result.current.state).toBe('on');
    await act(async () => result.current.toggle());
    expect(exit).toHaveBeenCalled();
    expect(result.current.state).toBe('off');
  });
});
