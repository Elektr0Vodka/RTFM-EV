import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  isBool,
  isNumberIn,
  isOneOf,
  readMapSetting,
  usePersistedMapSetting,
} from '../../map/usePersistedMapSetting';

beforeEach(() => localStorage.clear());

describe('usePersistedMapSetting', () => {
  it('writes changes and restores them on the next mount', () => {
    const first = renderHook(() => usePersistedMapSetting('k-bool', false, isBool));
    act(() => first.result.current[1](true));
    first.unmount();
    const second = renderHook(() => usePersistedMapSetting('k-bool', false, isBool));
    expect(second.result.current[0]).toBe(true);
  });

  it('falls back when the stored value is invalid or unparseable', () => {
    localStorage.setItem('k-num', JSON.stringify(99));
    expect(readMapSetting('k-num', 0.3, isNumberIn(0, 1))).toBe(0.3);
    localStorage.setItem('k-num', '{not json');
    expect(readMapSetting('k-num', 0.3, isNumberIn(0, 1))).toBe(0.3);
    localStorage.setItem('k-mode', JSON.stringify('bogus'));
    expect(readMapSetting('k-mode', 'liveness', isOneOf(['liveness', 'advert'] as const))).toBe(
      'liveness'
    );
  });
});
