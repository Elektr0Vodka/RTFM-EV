import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CrtEffects } from '../components/settings/CrtEffects';

describe('CrtEffects', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders the four effect toggles and the map tint toggle', () => {
    render(<CrtEffects />);
    expect(screen.getByLabelText(/scanlines/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phosphor glow/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/screen curvature/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/flicker/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tint the map/i)).toBeInTheDocument();
  });

  it('defaults effects off on a non-CRT theme; enabling one writes 1', () => {
    render(<CrtEffects />);
    const scanlines = screen.getByLabelText(/scanlines/i);
    expect(scanlines).not.toBeChecked();
    fireEvent.click(scanlines);
    expect(localStorage.getItem('remoteterm-crt-scanlines')).toBe('1');
    expect(scanlines).toBeChecked();
  });

  it('defaults effects on under a CRT theme; disabling one writes 0', () => {
    document.documentElement.dataset.theme = 'crt-amber';
    render(<CrtEffects />);
    const flicker = screen.getByLabelText(/flicker/i);
    expect(flicker).toBeChecked();
    fireEvent.click(flicker);
    expect(localStorage.getItem('remoteterm-crt-flicker')).toBe('0');
    expect(flicker).not.toBeChecked();
  });

  it('toggling the map tint persists it', () => {
    render(<CrtEffects />);
    const tint = screen.getByLabelText(/tint the map/i);
    expect(tint).not.toBeChecked();
    fireEvent.click(tint);
    expect(localStorage.getItem('remoteterm-crt-map-tint')).toBe('1');
  });
});
