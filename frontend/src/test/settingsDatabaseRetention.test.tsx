import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { api } from '../api';
import { SettingsDatabaseSection } from '../components/settings/SettingsDatabaseSection';
import {
  RETENTION_ANALYZER_VALUES,
  RETENTION_DEFAULT_VALUES,
} from '../components/settings/SettingsRetentionSection';
import type { RetentionStats } from '../types';

function makeSettings(overrides = {}) {
  return {
    // Minimal AppSettings covering the fields the component reads on mount.
    auto_decrypt_dm_on_advert: false,
    registry_sync_url: '',
    wordlist_sync_url: '',
    analyzer_sites: [],
    ...RETENTION_DEFAULT_VALUES,
    ...overrides,
  } as never;
}

const NOW = Math.floor(Date.now() / 1000);

function makeStats(overrides: Partial<RetentionStats> = {}): RetentionStats {
  return {
    classes: [
      { key: 'raw_packets', rows: 120, oldest_ts: NOW - 12 * 86400 },
      { key: 'messages', rows: 40, oldest_ts: NOW - 5 * 86400 },
      { key: 'repeater_telemetry', rows: 3, oldest_ts: NOW - 9 * 86400 },
      { key: 'contact_telemetry', rows: 4, oldest_ts: NOW - 2 * 86400 },
      { key: 'noise_floor', rows: 0, oldest_ts: null },
    ],
    interval_hours: 24,
    last_run_at: null,
    next_run_at: null,
    last_result: {},
    messages_would_delete: null,
    ...overrides,
  };
}

function renderSection(onSave = vi.fn().mockResolvedValue(undefined), settings = makeSettings()) {
  render(
    <SettingsDatabaseSection
      appSettings={settings}
      health={null}
      onSaveAppSettings={onSave}
      onHealthRefresh={vi.fn().mockResolvedValue(undefined)}
    />
  );
  return onSave;
}

describe('Database settings: data retention', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getRetentionStats').mockResolvedValue(makeStats());
    vi.spyOn(api, 'runRetentionPrune').mockResolvedValue({
      deleted: { advert_events: 2, link_signal: 1 },
      ran_at: NOW,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders every retention input with the current value', () => {
    renderSection();
    expect((screen.getByLabelText('Raw packets (days)') as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('Messages (days)') as HTMLInputElement).value).toBe('0');
    expect(
      (screen.getByLabelText('Advert events (Mesh Health) (days)') as HTMLInputElement).value
    ).toBe('30');
    expect(
      (screen.getByLabelText('Repeater and contact telemetry (days)') as HTMLInputElement).value
    ).toBe('30');
    expect(
      (screen.getByLabelText('Repeater and contact telemetry (rows per node)') as HTMLInputElement)
        .value
    ).toBe('1000');
    expect((screen.getByLabelText('Advert paths (per contact)') as HTMLInputElement).value).toBe(
      '10'
    );
    expect((screen.getByLabelText('Prune every') as HTMLInputElement).value).toBe('24');
  });

  it('renders the link traffic history retention input', () => {
    renderSection();
    expect(
      (screen.getByLabelText('Link traffic history (map) (days)') as HTMLInputElement).value
    ).toBe('365');
  });

  it('shows row counts and summed telemetry stats from the server', async () => {
    renderSection();
    expect(await screen.findByText('Rows: 120 · oldest: 12 days ago')).toBeInTheDocument();
    // Repeater + contact telemetry are one row: 3 + 4 rows, oldest of the two.
    expect(screen.getByText('Rows: 7 · oldest: 9 days ago')).toBeInTheDocument();
    expect(screen.getByText('Not run yet since the server started')).toBeInTheDocument();
  });

  it('persists a changed value on blur', async () => {
    const onSave = renderSection();
    const input = screen.getByLabelText('Repeater and contact telemetry (days)');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ telemetry_retention_days: 7 }));
  });

  it('reverts an out-of-range value without saving', async () => {
    const onSave = renderSection();
    const input = screen.getByLabelText('Advert paths (per contact)') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe('10'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('asks before enabling message retention and reverts on cancel', async () => {
    vi.mocked(api.getRetentionStats).mockResolvedValue(makeStats({ messages_would_delete: 12 }));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onSave = renderSection();
    const input = screen.getByLabelText('Messages (days)') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.blur(input);

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(confirmSpy.mock.calls[0][0]).toContain('12 messages older than 30 days');
    expect(api.getRetentionStats).toHaveBeenCalledWith(30);
    await waitFor(() => expect(input.value).toBe('0'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves message retention after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSave = renderSection();
    const input = screen.getByLabelText('Messages (days)');
    fireEvent.change(input, { target: { value: '365' } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ message_retention_days: 365 }));
  });

  it('does not ask when message retention is loosened', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSave = renderSection(
      vi.fn().mockResolvedValue(undefined),
      makeSettings({ message_retention_days: 30 })
    );
    const input = screen.getByLabelText('Messages (days)');
    fireEvent.change(input, { target: { value: '90' } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ message_retention_days: 90 }));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('applies the analyzer preset after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSave = renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Keep everything (analyzer)' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(RETENTION_ANALYZER_VALUES));
  });

  it('restores defaults after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSave = renderSection(
      vi.fn().mockResolvedValue(undefined),
      makeSettings(RETENTION_ANALYZER_VALUES)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(RETENTION_DEFAULT_VALUES));
  });

  it('does nothing when a preset is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onSave = renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Keep everything (analyzer)' }));
    await Promise.resolve();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('runs a prune on demand', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Prune now' }));
    await waitFor(() => expect(api.runRetentionPrune).toHaveBeenCalledTimes(1));
    // Stats reload after the run (mount + after prune).
    await waitFor(() => expect(api.getRetentionStats).toHaveBeenCalledTimes(2));
  });
});
