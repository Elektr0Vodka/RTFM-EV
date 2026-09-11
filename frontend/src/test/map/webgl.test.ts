import { describe, it, expect, vi, afterEach } from 'vitest';
import { isWebglAvailable } from '../../map/engine/webgl';

afterEach(() => vi.restoreAllMocks());

describe('isWebglAvailable', () => {
  it('returns true when a webgl context is obtainable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    expect(isWebglAvailable()).toBe(true);
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
