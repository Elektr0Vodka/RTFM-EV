import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    advert_retention_days: 30,
    last_message_times: {},
    advert_interval: 0,
    last_advert_time: 0,
    flood_scope: '',
    known_regions: [],
    blocked_keys: [],
    blocked_names: [],
    sidebar_section_order: [],
    sidebar_tool_order: [],
    sidebar_favorites_order: [],
    sidebar_hidden: { sections: [], tools: [], favorites: [] },
    discovery_blocked_types: [],
    tracked_telemetry_repeaters: [],
    tracked_telemetry_contacts: [],
    auto_resend_channel: false,
    telemetry_interval_hours: 8,
    telemetry_routed_hourly: false,
    show_mention_ticker: true,
    mention_sound_enabled: false,
    mention_sound_choice: 'beep',
    mention_sound_volume: 80,
    mention_sound_custom: null,
    auto_add_mentioned_channels: false,
    chat_parse_pubkeys: false,
    chat_parse_coordinates: false,
    chat_url_previews: false,
    chat_linkify_urls: true,
    registry_sync_url: '',
    region_sync_url: '',
    wordlist_sync_url: '',
    analyzer_sites: [],
    handy_info: { overrides: {}, custom: [] },
    external_map_enabled: false,
    external_map_sync_url: '',
    external_map_sync_interval_hours: 0,
    backup_to_path_enabled: false,
    backup_destination_path: '',
    brand_name: '',
    brand_hidden: false,
    brand_icon: '',
    openhop_api_url: null,
    openhop_api_token: null,
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

  it('renders analyzer and sync entries on the Configure tab', () => {
    renderSection(makeSettings());
    expect(screen.getByText('Cornmeister')).toBeInTheDocument();
    expect(screen.getByText('MC-Radar')).toBeInTheDocument();
    expect(screen.getByText('Region scopes')).toBeInTheDocument();
    expect(screen.getByText('Channel registry')).toBeInTheDocument();
  });

  it('shows reference and new links on the Links tab', async () => {
    renderSection(makeSettings());
    await userEvent.click(screen.getByRole('tab', { name: 'Links' }));
    expect(screen.getByText('Dutch mesh settings')).toBeInTheDocument();
    expect(screen.getByText('DMC channel browser')).toBeInTheDocument();
    expect(screen.getByText('Region list (meshwiki)')).toBeInTheDocument();
    expect(screen.getByText('MeshCore.io')).toBeInTheDocument();
    expect(screen.getByText('Triangulator')).toBeInTheDocument();
    expect(screen.getByText('Zweerbericht')).toBeInTheDocument();
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

  it('hides a built-in entry through the overlay', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onSave } = renderSection(makeSettings());
    fireEvent.click(screen.getByRole('button', { name: 'Hide MC-Radar' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        handy_info: { overrides: { 'analyzer-mc-radar': { hidden: true } }, custom: [] },
      })
    );
  });

  it('does not render a hidden built-in entry', () => {
    renderSection(
      makeSettings({
        handy_info: { overrides: { 'analyzer-mc-radar': { hidden: true } }, custom: [] },
      })
    );
    expect(screen.queryByText('MC-Radar')).not.toBeInTheDocument();
    expect(screen.getByText('Cornmeister')).toBeInTheDocument();
  });

  it('adds a custom link through the dialog', async () => {
    const { onSave } = renderSection(makeSettings());
    await userEvent.click(screen.getByRole('tab', { name: 'Links' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'My Site' } });
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://my.example' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const arg = onSave.mock.calls[onSave.mock.calls.length - 1][0];
    expect(arg.handy_info.custom).toHaveLength(1);
    expect(arg.handy_info.custom[0]).toMatchObject({
      group: 'links',
      category: 'community',
      label: 'My Site',
      url: 'https://my.example',
      apply_kind: null,
    });
  });

  it('rejects a custom link with a non-http URL', async () => {
    const { onSave } = renderSection(makeSettings());
    await userEvent.click(screen.getByRole('tab', { name: 'Links' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Bad' } });
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'javascript:alert(1)' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it('resets the overlay to defaults', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onSave } = renderSection(
      makeSettings({
        handy_info: { overrides: { 'analyzer-mc-radar': { hidden: true } }, custom: [] },
      })
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Links' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ handy_info: { overrides: {}, custom: [] } })
    );
  });
});
