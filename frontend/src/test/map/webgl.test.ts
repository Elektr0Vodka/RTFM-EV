import { describe, it, expect, vi, afterEach } from 'vitest';
import { isWebglAvailable } from '../../map/engine/webgl';

afterEach(() => vi.restoreAllMocks());

describe('isWebglAvailable', () => {
  it('returns true when a webgl context is obtainable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    expect(isWebglAvailable()).toBe(true);
  });

  it('releases the probe context instead of leaving it for GC', () => {
    const loseContext = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null),
    } as never);
    expect(isWebglAvailable()).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('returns false when no context is obtainable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(isWebglAvailable()).toBe(false);
  });

  it('returns false when getContext throws', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('no gl');
    });
    expect(isWebglAvailable()).toBe(false);
  });
});
