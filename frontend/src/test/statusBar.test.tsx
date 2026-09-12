import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StatusBar } from '../components/StatusBar';
import type { HealthStatus, RadioConfig } from '../types';

const baseHealth: HealthStatus = {
  status: 'degraded',
  radio_connected: false,
  radio_initializing: false,
  connection_info: null,
  database_size_mb: 1.2,
  oldest_undecrypted_timestamp: null,
  fanout_statuses: {},
  bots_disabled: false,
};

const FULL_KEY = '0123456789abcdef'.repeat(4); // 64-char hex

const baseConfig: RadioConfig = {
  public_key: FULL_KEY,
  name: 'TestNode',
  lat: 0,
  lon: 0,
  tx_power: 17,
  max_tx_power: 22,
  radio: { freq: 910.525, bw: 62.5, sf: 7, cr: 5 },
  path_hash_mode: 0,
  path_hash_mode_supported: true,
};

describe('StatusBar', () => {
  it('shows Radio Initializing while setup is still running', () => {
    render(
      <StatusBar
        health={{ ...baseHealth, radio_connected: true, radio_initializing: true }}
        config={null}
        onSettingsClick={vi.fn()}
      />
    );

    expect(screen.getByRole('status', { name: 'Radio Initializing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
  });

  it('shows Radio OK when the radio is connected and ready', () => {
    render(
      <StatusBar
        health={{ ...baseHealth, status: 'ok', radio_connected: true }}
        config={null}
        onSettingsClick={vi.fn()}
      />
    );

    expect(screen.getByRole('status', { name: 'Radio OK' })).toBeInTheDocument();
  });

  it('shows Radio Disconnected when the radio is unavailable', () => {
    render(<StatusBar health={baseHealth} config={null} onSettingsClick={vi.fn()} />);

    expect(screen.getByRole('status', { name: 'Radio Disconnected' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });

  it('shows Radio Paused and a Connect action when reconnect attempts are paused', () => {
    render(
      <StatusBar
        health={{ ...baseHealth, radio_state: 'paused' }}
        config={null}
        onSettingsClick={vi.fn()}
      />
    );

    expect(screen.getByRole('status', { name: 'Radio Paused' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('truncates the navbar public key to the radio path-hash byte width', () => {
    const { rerender } = render(
      <StatusBar
        health={{ ...baseHealth, status: 'ok', radio_connected: true }}
        config={{ ...baseConfig, path_hash_mode: 0 }}
        onSettingsClick={vi.fn()}
      />
    );

    // 1 byte => 2 hex chars
    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.queryByText(FULL_KEY)).not.toBeInTheDocument();

    // 2 bytes => 4 hex chars
    rerender(
      <StatusBar
        health={{ ...baseHealth, status: 'ok', radio_connected: true }}
        config={{ ...baseConfig, path_hash_mode: 1 }}
        onSettingsClick={vi.fn()}
      />
    );
    expect(screen.getByText('0123')).toBeInTheDocument();

    // 3 bytes => 6 hex chars
    rerender(
      <StatusBar
        health={{ ...baseHealth, status: 'ok', radio_connected: true }}
        config={{ ...baseConfig, path_hash_mode: 2 }}
        onSettingsClick={vi.fn()}
      />
    );
    expect(screen.getByText('012345')).toBeInTheDocument();
  });

  it('shows the full public key on hover and copies the full key on click', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <StatusBar
        health={{ ...baseHealth, status: 'ok', radio_connected: true }}
        config={{ ...baseConfig, path_hash_mode: 1 }}
        onSettingsClick={vi.fn()}
      />
    );

    const keyEl = screen.getByText('0123');
    expect(keyEl).toHaveAttribute('title', FULL_KEY);

    fireEvent.click(keyEl);
    expect(writeText).toHaveBeenCalledWith(FULL_KEY);
  });

  it('exposes the header language switcher', () => {
    render(<StatusBar health={baseHealth} config={null} onSettingsClick={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Language' })).toBeInTheDocument();
  });

  it('opens the theme modal from the header button and applies a selected theme', () => {
    localStorage.setItem('remoteterm-theme', 'original');

    render(<StatusBar health={baseHealth} config={null} onSettingsClick={vi.fn()} />);

    // No modal until the button is clicked.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open theme settings' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Cyberpunk' }));

    expect(localStorage.getItem('remoteterm-theme')).toBe('cyberpunk');
    expect(document.documentElement.dataset.theme).toBe('cyberpunk');
  });
});
