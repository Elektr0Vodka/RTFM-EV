import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHidePosition, setHidePosition } from '../../share/hidePosition';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('hidePosition preference', () => {
  it('defaults to showing the position', () => {
    expect(getHidePosition()).toBe(false);
  });

  it('remembers the choice', () => {
    setHidePosition(true);
    expect(getHidePosition()).toBe(true);
    setHidePosition(false);
    expect(getHidePosition()).toBe(false);
  });

  it('falls back to showing when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => setHidePosition(true)).not.toThrow();
    expect(getHidePosition()).toBe(false);
  });
});
