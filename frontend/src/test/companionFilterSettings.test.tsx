import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanionFilterSettings } from '../components/settings/CompanionFilterSettings';
import { api } from '../api';
import type { CompanionFilterState, HealthStatus } from '../types';

function health(supported: boolean): HealthStatus {
  return {
    status: 'ok',
    radio_connected: true,
    radio_initializing: false,
    connection_info: 'TCP',
    radio_device_info: {
      model: 'X',
      firmware_build: 'b',
      firmware_version: 'v1.18.0.1',
      max_contacts: 350,
      max_channels: 40,
      is_meshcomod: true,
      is_openhop: false,
      cli_supported: true,
      companion_filter_supported: supported,
    },
    database_size_mb: 1,
  } as HealthStatus;
}

function state(overrides: Partial<CompanionFilterState> = {}): CompanionFilterState {
  return {
    config: {
      enabled: true,
      malformed: false,
      age_mins: 60,
      paths: ['A1B2'],
      sender_rules: [{ pattern: 'Bot*', secs: 0, prob: 100 }],
      text_rules: [{ pattern: '^!ping', secs: 300, prob: 50 }],
    },
    counters: { malformed: 3, age: 1, path: 12, sender: 41, text: 7 },
    malformed_reasons: { short: 0, time: 2, empty: 0, utf8: 1 },
    age_clock_set: true,
    path_hits: [{ prefix: 'A1B2', hidden: 12 }],
    sender_rules: [{ pattern: 'Bot*', secs: 0, prob: 100, hidden: 41, passes: 0 }],
    text_rules: [{ pattern: '^!ping', secs: 300, prob: 50, hidden: 7, passes: 2 }],
    truncated: { path: false, sender: false, text: false },
    backup: null,
    ...overrides,
  };
}

const emptyHistory = {
  bins: [],
  totals: { malformed: 0, age: 0, path: 0, sender: 0, text: 0 },
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getCompanionFilterHistory').mockResolvedValue(emptyHistory);
});

describe('CompanionFilterSettings', () => {
  it('renders nothing when the radio has no filter', () => {
    const get = vi.spyOn(api, 'getCompanionFilter');
    const { container } = render(<CompanionFilterSettings health={health(false)} />);
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });

  it('shows settings, counters and rules read from the radio', async () => {
    vi.spyOn(api, 'getCompanionFilter').mockResolvedValue(state());
    render(<CompanionFilterSettings health={health(true)} />);

    expect(await screen.findByLabelText('Filter on')).toBeChecked();
    expect(screen.getByLabelText('Drop malformed group text')).not.toBeChecked();
    expect(screen.getByLabelText('Maximum message age (minutes)')).toHaveValue(60);
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText('A1B2')).toBeInTheDocument();
    expect(screen.getByText('Bot*')).toBeInTheDocument();
    expect(screen.getByText(/throttle 300s/)).toBeInTheDocument();
    expect(screen.getByText(/\(2 passed\)/)).toBeInTheDocument();
    expect(screen.getByText('No backup saved for this radio yet.')).toBeInTheDocument();
  });

  it('toggles the filter through the API and shows the state read back', async () => {
    vi.spyOn(api, 'getCompanionFilter').mockResolvedValue(state());
    const update = vi
      .spyOn(api, 'updateCompanionFilter')
      .mockResolvedValue(state({ config: { ...state().config, enabled: false } }));
    render(<CompanionFilterSettings health={health(true)} />);

    await userEvent.click(await screen.findByLabelText('Filter on'));
    expect(update).toHaveBeenCalledWith({ enabled: false });
    await waitFor(() => expect(screen.getByLabelText('Filter on')).not.toBeChecked());
  });

  it('adds a text rule with secs and prob', async () => {
    vi.spyOn(api, 'getCompanionFilter').mockResolvedValue(state());
    const add = vi.spyOn(api, 'addCompanionFilterRule').mockResolvedValue(state());
    render(<CompanionFilterSettings health={health(true)} />);

    const pattern = await screen.findByLabelText('Pattern (max 23 bytes, no spaces)');
    await userEvent.type(pattern, 'spam');
    const textSection = pattern.closest('div.space-y-2') as HTMLElement;
    const secs = within(textSection).getByLabelText('Secs');
    await userEvent.clear(secs);
    await userEvent.type(secs, '60');
    await userEvent.click(within(textSection).getByRole('button', { name: 'Add' }));

    expect(add).toHaveBeenCalledWith('text', { pattern: 'spam', secs: 60, prob: 100 });
  });

  it('rejects a pattern with spaces before calling the API', async () => {
    vi.spyOn(api, 'getCompanionFilter').mockResolvedValue(state());
    const add = vi.spyOn(api, 'addCompanionFilterRule');
    render(<CompanionFilterSettings health={health(true)} />);

    const name = await screen.findByLabelText('Name (max 15 bytes, no spaces)');
    await userEvent.type(name, 'two words');
    expect(screen.getByText('No spaces, at most 15 bytes.')).toBeInTheDocument();
    const section = name.closest('div.space-y-2') as HTMLElement;
    expect(within(section).getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(add).not.toHaveBeenCalled();
  });

  it('warns when a list was cut off and restores the backup after confirming', async () => {
    const withBackup = state({
      truncated: { path: false, sender: false, text: true },
      backup: { saved_at: 1_700_000_000, truncated: false, config: state().config },
    });
    vi.spyOn(api, 'getCompanionFilter').mockResolvedValue(withBackup);
    const restore = vi.spyOn(api, 'restoreCompanionFilter').mockResolvedValue(withBackup);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CompanionFilterSettings health={health(true)} />);

    expect(
      await screen.findByText(/could not fit this whole list in its reply/)
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore backup to radio' }));
    expect(restore).toHaveBeenCalled();
  });

  it('shows the read error', async () => {
    vi.spyOn(api, 'getCompanionFilter').mockRejectedValue(new Error('boom'));
    render(<CompanionFilterSettings health={health(true)} />);
    expect(
      await screen.findByText('Could not read the filter from the radio: boom')
    ).toBeInTheDocument();
  });
});
