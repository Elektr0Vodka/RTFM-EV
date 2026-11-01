import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  resetRememberedServerPasswordsForTests,
  useRememberedServerPassword,
} from '../hooks/useRememberedServerPassword';

const KEY = 'ab'.repeat(32);
const STORAGE = `remoteterm-server-password:room:${KEY}`;

afterEach(() => {
  localStorage.clear();
  resetRememberedServerPasswordsForTests();
});

describe('useRememberedServerPassword', () => {
  it('stores the password exactly as sent, spaces included', () => {
    const { result } = renderHook(() => useRememberedServerPassword('room', KEY));
    act(() => result.current.setRememberPassword(true));
    act(() => result.current.persistAfterLogin('  pass word '));

    expect(JSON.parse(localStorage.getItem(STORAGE) ?? '{}')).toEqual({
      password: '  pass word ',
    });
    expect(result.current.password).toBe('  pass word ');
  });

  it('ignores an empty or blank password', () => {
    const { result } = renderHook(() => useRememberedServerPassword('room', KEY));
    act(() => result.current.setRememberPassword(true));
    act(() => result.current.persistAfterLogin('   '));
    expect(localStorage.getItem(STORAGE)).toBeNull();
  });
});
