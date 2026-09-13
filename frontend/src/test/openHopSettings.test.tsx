import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHopSettings } from '../components/settings/OpenHopSettings';
import { api } from '../api';
import type { AppSettings, HealthStatus } from '../types';

function health(is_openhop: boolean): HealthStatus {
  return {
    status: 'ok',
    radio_connected: true,
    radio_initializing: false,
    connection_info: 'TCP',
    radio_device_info: {
      model: is_openhop ? 'openHop-Repeater-Companion' : 'Heltec V3',
      firmware_build: 'b',
      firmware_version: '13.0',
      max_contacts: 510,
      max_channels: 40,
      is_meshcomod: false,
      is_openhop,
    },
    database_size_mb: 1,
  } as HealthStatus;
}

function appSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    openhop_api_url: null,
    openhop_api_token: null,
    ...overrides,
  } as AppSettings;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopStatus').mockResolvedValue({
    configured: false,
    is_openhop: true,
    base_url: null,
  });
});

describe('OpenHopSettings', () => {
  it('renders nothing when the node is not OpenHop', () => {
    const { container } = render(
      <OpenHopSettings
        health={health(false)}
        appSettings={appSettings()}
        onSaveAppSettings={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows url and token inputs when the node is OpenHop', () => {
    render(
      <OpenHopSettings
        health={health(true)}
        appSettings={appSettings()}
        onSaveAppSettings={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/token/i)).toBeInTheDocument();
  });

  it('does not prefill the token (write-only) but prefills the url', () => {
    render(
      <OpenHopSettings
        health={health(true)}
        appSettings={appSettings({
          openhop_api_url: 'http://node:8000',
          openhop_api_token: null,
          openhop_api_token_set: true,
        } as Partial<AppSettings>)}
        onSaveAppSettings={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/URL/i)).toHaveValue('http://node:8000');
    expect(screen.getByLabelText(/token/i)).toHaveValue('');
  });

  it('omits the token on save when left blank', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <OpenHopSettings
        health={health(true)}
        appSettings={appSettings({ openhop_api_url: 'http://node:8000' })}
        onSaveAppSettings={onSave}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ openhop_api_url: 'http://node:8000' })
    );
  });

  it('saves the entered url and token via onSaveAppSettings', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <OpenHopSettings
        health={health(true)}
        appSettings={appSettings()}
        onSaveAppSettings={onSave}
      />
    );
    await userEvent.type(screen.getByLabelText(/URL/i), 'http://127.0.0.1:8000');
    await userEvent.type(screen.getByLabelText(/token/i), 'tok123');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        openhop_api_url: 'http://127.0.0.1:8000',
        openhop_api_token: 'tok123',
      })
    );
  });
});
