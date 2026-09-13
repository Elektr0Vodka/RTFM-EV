import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CrtSettings } from '../components/settings/CrtSettings';

describe('CrtSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('enabling CRT sets the crt theme', () => {
    render(<CrtSettings />);
    const toggle = screen.getByLabelText(/enable crt/i);
    fireEvent.click(toggle);
    expect(document.documentElement.getAttribute('data-theme')).toBe('crt');
    expect(localStorage.getItem('remoteterm-theme')).toBe('crt');
  });

  it('choosing amber persists the phosphor and stamps the attribute', () => {
    render(<CrtSettings />);
    fireEvent.click(screen.getByLabelText(/enable crt/i));
    fireEvent.click(screen.getByLabelText(/amber/i));
    expect(localStorage.getItem('remoteterm-crt-phosphor')).toBe('amber');
    expect(document.documentElement.getAttribute('data-crt-phosphor')).toBe('amber');
  });

  it('disabling an effect writes 0', () => {
    render(<CrtSettings />);
    fireEvent.click(screen.getByLabelText(/enable crt/i));
    fireEvent.click(screen.getByLabelText(/flicker/i));
    expect(localStorage.getItem('remoteterm-crt-flicker')).toBe('0');
  });
});
