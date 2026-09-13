import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsOpenHopSection } from '../components/settings/openhop/SettingsOpenHopSection';
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
const settings = { openhop_api_url: 'http://n:8000', openhop_api_token: 't' } as AppSettings;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopPolicy').mockResolvedValue({
    success: true,
    data: {
      policy_file: '/p',
      exists: false,
      policy_engine: {
        enabled: false,
        default_action: 'allow',
        rules: [],
        objects: { channel_hash_groups: {}, pubkey_groups: {} },
      },
      groups: { channel_hashes: [], pubkeys: [] },
    },
  });
  vi.spyOn(api, 'listOpenHopPlugins').mockResolvedValue({ success: true, plugins: [] });
  vi.spyOn(api, 'getOpenHopConfigExport').mockResolvedValue({
    success: true,
    data: { config: { repeater: { mode: 'forward' } } },
  });
  vi.spyOn(api, 'getOpenHopPresets').mockResolvedValue({ presets: [], source: 'local' });
});

describe('SettingsOpenHopSection sub-nav', () => {
  it('renders nothing for non-OpenHop', () => {
    const { container } = render(
      <SettingsOpenHopSection
        health={health(false)}
        appSettings={settings}
        onSaveAppSettings={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows Policy by default and switches to Plugins', async () => {
    render(
      <SettingsOpenHopSection
        health={health(true)}
        appSettings={settings}
        onSaveAppSettings={vi.fn()}
      />
    );
    expect(await screen.findByRole('heading', { name: /policy engine/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /plugins/i }));
    expect(await screen.findByText(/no plugins installed/i)).toBeInTheDocument();
  });

  it('shows the Config tab and switches to it', async () => {
    render(
      <SettingsOpenHopSection
        health={health(true)}
        appSettings={settings}
        onSaveAppSettings={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /^config$/i }));
    expect(await screen.findByText(/operating mode/i)).toBeInTheDocument();
  });

  it('renders Node and Mesh rows with all eight tabs for an OpenHop node', () => {
    render(
      <SettingsOpenHopSection
        health={health(true)}
        appSettings={settings}
        onSaveAppSettings={vi.fn()}
      />
    );
    for (const name of [
      /^config$/i,
      /^system$/i,
      /^update$/i,
      /^cad$/i,
      /^policy$/i,
      /^plugins$/i,
      /^transport$/i,
      /^mqtt$/i,
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('tablist', { name: /node/i })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: /mesh/i })).toBeInTheDocument();
  });
});
