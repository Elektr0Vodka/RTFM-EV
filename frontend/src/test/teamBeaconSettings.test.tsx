import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { I18nProvider } from '../i18n/I18nProvider';
import { TeamBeaconSettings } from '../components/settings/TeamBeaconSettings';
import { PUBLIC_CHANNEL_KEY } from '../utils/publicChannel';
import type { Channel, TeamBeaconSettings as TeamBeaconConfig } from '../types';

const PRIVATE = '7A'.repeat(16);

const channel = (over: Partial<Channel>): Channel => ({
  key: PRIVATE,
  name: 'team-tracking',
  is_hashtag: false,
  on_radio: true,
  last_read_at: null,
  favorite: false,
  muted: false,
  ...over,
});

const channels = [
  channel({}),
  channel({ key: PUBLIC_CHANNEL_KEY, name: 'Public' }),
  channel({ key: '5B'.repeat(16), name: '#test', is_hashtag: true }),
];

const OFF: TeamBeaconConfig = { enabled: false, channel_key: '', interval_seconds: 240 };

function renderSettings(
  config: TeamBeaconConfig = OFF,
  onSave = vi.fn().mockResolvedValue(undefined)
) {
  render(
    <I18nProvider>
      <TeamBeaconSettings config={config} channels={channels} onSaveAppSettings={onSave} />
    </I18nProvider>
  );
  return onSave;
}

describe('TeamBeaconSettings', () => {
  it('is off by default and offers only private channels', () => {
    renderSettings();

    expect(screen.getByRole('checkbox', { name: /send a position beacon/i })).not.toBeChecked();
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('team-tracking');
    expect(options).not.toContain('Public');
    expect(options).not.toContain('#test');
  });

  it('cannot be saved switched on without a channel', () => {
    renderSettings();

    fireEvent.click(screen.getByRole('checkbox', { name: /send a position beacon/i }));
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('saves the master toggle, channel and interval', async () => {
    const onSave = renderSettings();

    fireEvent.click(screen.getByRole('checkbox', { name: /send a position beacon/i }));
    fireEvent.change(screen.getByLabelText(/channel/i), { target: { value: PRIVATE } });
    fireEvent.change(screen.getByLabelText(/interval/i), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        team_beacon: { enabled: true, channel_key: PRIVATE, interval_seconds: 120 },
      })
    );
  });

  it('keeps the interval inside 60 to 3600 seconds', async () => {
    const onSave = renderSettings({ enabled: true, channel_key: PRIVATE, interval_seconds: 240 });

    fireEvent.change(screen.getByLabelText(/interval/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        team_beacon: { enabled: true, channel_key: PRIVATE, interval_seconds: 60 },
      })
    );
  });

  it('can be switched off again', async () => {
    const onSave = renderSettings({ enabled: true, channel_key: PRIVATE, interval_seconds: 240 });

    fireEvent.click(screen.getByRole('checkbox', { name: /send a position beacon/i }));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        team_beacon: { enabled: false, channel_key: PRIVATE, interval_seconds: 240 },
      })
    );
  });
});
