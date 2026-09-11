import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsDatabaseSection } from '../components/settings/SettingsDatabaseSection';
import type { AppSettings } from '../types';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock('../api', () => ({ api: { runMaintenance: vi.fn() } }));
vi.mock('../components/ui/sonner', () => ({
  toast: { error: toastError, success: vi.fn() },
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
    ...overrides,
  };
}

function renderSection(appSettings: AppSettings, onSave = vi.fn().mockResolvedValue(undefined)) {
  render(
    <SettingsDatabaseSection
      appSettings={appSettings}
      health={null}
      onSaveAppSettings={onSave}
      onHealthRefresh={vi.fn().mockResolvedValue(undefined)}
    />
  );
  return { onSave };
}

describe('SettingsDatabaseSection analyzer sites editor', () => {
  beforeEach(() => {
    toastError.mockReset();
  });

  it('adds a valid analyzer site and persists it', async () => {
    const { onSave } = renderSection(makeSettings());

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'mc-radar' } });
    fireEvent.change(screen.getByLabelText('Node URL template'), {
      target: { value: 'https://mc-radar.woodwar.com/node/{pubkey}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add analyzer site' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        analyzer_sites: [
          {
            name: 'mc-radar',
            node_url_template: 'https://mc-radar.woodwar.com/node/{pubkey}',
            packet_url_template: null,
          },
        ],
      })
    );
    expect(screen.getByText('mc-radar')).toBeInTheDocument();
  });

  it('rejects a node template missing the {pubkey} placeholder', () => {
    const { onSave } = renderSection(makeSettings());

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'bad' } });
    fireEvent.change(screen.getByLabelText('Node URL template'), {
      target: { value: 'https://example.com/node' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add analyzer site' }));

    expect(toastError).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects a non-http node template', () => {
    const { onSave } = renderSection(makeSettings());

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'bad' } });
    fireEvent.change(screen.getByLabelText('Node URL template'), {
      target: { value: 'javascript:alert({pubkey})' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add analyzer site' }));

    expect(toastError).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('edits a configured analyzer site inline and persists the change', async () => {
    const { onSave } = renderSection(
      makeSettings({
        analyzer_sites: [
          {
            name: 'cornmeister',
            node_url_template: 'https://cornmeister.nl/#node?id={pubkey}',
            packet_url_template: null,
          },
        ],
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit analyzer site cornmeister' }));
    fireEvent.change(screen.getByLabelText('Edit name for cornmeister'), {
      target: { value: 'cornmeister-nl' },
    });
    fireEvent.change(screen.getByLabelText('Edit node URL for cornmeister'), {
      target: { value: 'https://cornmeister.nl/#node?id={pubkey}&tab=details' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save analyzer site cornmeister' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        analyzer_sites: [
          {
            name: 'cornmeister-nl',
            node_url_template: 'https://cornmeister.nl/#node?id={pubkey}&tab=details',
            packet_url_template: null,
          },
        ],
      })
    );
    expect(screen.getByText('cornmeister-nl')).toBeInTheDocument();
  });

  it('rejects an inline edit whose node template drops the {pubkey} placeholder', () => {
    const { onSave } = renderSection(
      makeSettings({
        analyzer_sites: [
          {
            name: 'cornmeister',
            node_url_template: 'https://cornmeister.nl/#node?id={pubkey}',
            packet_url_template: null,
          },
        ],
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit analyzer site cornmeister' }));
    fireEvent.change(screen.getByLabelText('Edit node URL for cornmeister'), {
      target: { value: 'https://cornmeister.nl/#node' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save analyzer site cornmeister' }));

    expect(toastError).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('cancels an inline edit without persisting', () => {
    const { onSave } = renderSection(
      makeSettings({
        analyzer_sites: [
          {
            name: 'cornmeister',
            node_url_template: 'https://cornmeister.nl/#node?id={pubkey}',
            packet_url_template: null,
          },
        ],
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit analyzer site cornmeister' }));
    fireEvent.change(screen.getByLabelText('Edit name for cornmeister'), {
      target: { value: 'changed' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel editing analyzer site cornmeister' })
    );

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('cornmeister')).toBeInTheDocument();
    expect(screen.queryByText('changed')).not.toBeInTheDocument();
  });

  it('removes a configured analyzer site', async () => {
    const { onSave } = renderSection(
      makeSettings({
        analyzer_sites: [
          {
            name: 'cornmeister',
            node_url_template: 'https://cornmeister.nl/#node?id={pubkey}',
            packet_url_template: null,
          },
        ],
      })
    );

    expect(screen.getByText('cornmeister')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove analyzer site cornmeister' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ analyzer_sites: [] }));
  });
});
