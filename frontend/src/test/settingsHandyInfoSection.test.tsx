import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsHandyInfoSection } from '../components/settings/SettingsHandyInfoSection';
import type { AppSettings } from '../types';

const { toastSuccess, toastError, toastInfo } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('../components/ui/sonner', () => ({
  toast: { success: toastSuccess, error: toastError, info: toastInfo },
}));

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    max_radio_contacts: 200,
    auto_decrypt_dm_on_advert: false,
    last_message_times: {},
    advert_interval: 0,
    last_advert_time: 0,
    flood_scope: '',
    known_regions: [],
    blocked_keys: [],
    blocked_names: [],
    discovery_blocked_types: [],
    tracked_telemetry_repeaters: [],
    tracked_telemetry_contacts: [],
    auto_resend_channel: false,
    telemetry_interval_hours: 8,
    telemetry_routed_hourly: false,
    show_mention_ticker: true,
    registry_sync_url: '',
    region_sync_url: '',
    wordlist_sync_url: '',
    analyzer_sites: [],
    external_map_enabled: false,
    external_map_sync_url: '',
    external_map_sync_interval_hours: 0,
    ...overrides,
  };
}

const writeText = vi.fn();

function renderSection(
  appSettings: AppSettings | null,
  onSave = vi.fn().mockResolvedValue(undefined)
) {
  render(<SettingsHandyInfoSection appSettings={appSettings} onSaveAppSettings={onSave} />);
  return { onSave };
}

describe('SettingsHandyInfoSection', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
    writeText.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders analyzer, sync, and reference entries', () => {
    renderSection(makeSettings());
    expect(screen.getByText('Cornmeister')).toBeInTheDocument();
    expect(screen.getByText('MC-Radar')).toBeInTheDocument();
    expect(screen.getByText('Region scopes')).toBeInTheDocument();
    expect(screen.getByText('Channel registry')).toBeInTheDocument();
    expect(screen.getByText('Dutch mesh settings')).toBeInTheDocument();
    expect(screen.getByText('DMC channel browser')).toBeInTheDocument();
    expect(screen.getByText('Region list (meshwiki)')).toBeInTheDocument();
  });

  it('copies an analyzer node template to the clipboard', () => {
    renderSection(makeSettings());
    fireEvent.click(screen.getByRole('button', { name: 'Copy Cornmeister URL' }));
    expect(writeText).toHaveBeenCalledWith('https://cornmeister.nl/#node?id={pubkey}');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('applies an analyzer preset by appending to analyzer_sites', async () => {
    const { onSave } = renderSection(makeSettings());
    fireEvent.click(screen.getByRole('button', { name: 'Apply MC-Radar' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        analyzer_sites: [
          {
            name: 'MC-Radar',
            node_url_template: 'https://mc-radar.woodwar.com/node/{pubkey}',
            packet_url_template: null,
          },
        ],
      })
    );
  });

  it('applies the on8ar preset with both node and packet templates', async () => {
    const { onSave } = renderSection(makeSettings());
    fireEvent.click(screen.getByRole('button', { name: 'Apply on8ar' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        analyzer_sites: [
          {
            name: 'on8ar',
            node_url_template: 'https://analyzer.on8ar.eu/#/nodes/{pubkey}',
            packet_url_template: 'https://analyzer.on8ar.eu/#/packets/{hash}',
          },
        ],
      })
    );
  });

  it('marks an already-configured analyzer as added and disabled', () => {
    const { onSave } = renderSection(
      makeSettings({
        analyzer_sites: [
          {
            name: 'Cornmeister',
            node_url_template: 'https://cornmeister.nl/#node?id={pubkey}',
            packet_url_template: null,
          },
        ],
      })
    );
    const applyButton = screen.getByRole('button', { name: 'Apply Cornmeister' });
    expect(applyButton).toBeDisabled();
    expect(applyButton).toHaveTextContent('Added');
    fireEvent.click(applyButton);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('applies a sync URL into an empty field', async () => {
    const { onSave } = renderSection(makeSettings({ region_sync_url: '' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply Region scopes' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        region_sync_url: 'https://meshcore-analyzer.eu/api/regions/scopes',
      })
    );
  });

  it('confirms before overwriting a different existing sync URL', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onSave } = renderSection(
      makeSettings({ registry_sync_url: 'https://example.com/other.json' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply Channel registry' }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        registry_sync_url: 'https://meshcore-analyzer.eu/api/channels',
      })
    );
  });

  it('does not overwrite when the confirm is cancelled', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onSave } = renderSection(
      makeSettings({ registry_sync_url: 'https://example.com/other.json' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply Channel registry' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
