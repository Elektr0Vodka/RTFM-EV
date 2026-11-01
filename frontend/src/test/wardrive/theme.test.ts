import { afterEach, describe, expect, it } from 'vitest';

import { bootWardriveTheme } from '../../wardrive/theme';

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('wardrive page theme', () => {
  it('applies the theme the main app saved', () => {
    localStorage.setItem('remoteterm-theme', 'light');
    const stop = bootWardriveTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
    stop();
  });

  it('follows a theme change made in another tab', () => {
    localStorage.setItem('remoteterm-theme', 'light');
    const stop = bootWardriveTheme();
    localStorage.setItem('remoteterm-theme', 'crt-green');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'remoteterm-theme', newValue: 'crt-green' })
    );
    expect(document.documentElement.dataset.theme).toBe('crt-green');
    stop();
  });

  it('stops following after the returned stop runs', () => {
    localStorage.setItem('remoteterm-theme', 'light');
    const stop = bootWardriveTheme();
    stop();
    localStorage.setItem('remoteterm-theme', 'crt-green');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'remoteterm-theme', newValue: 'crt-green' })
    );
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
