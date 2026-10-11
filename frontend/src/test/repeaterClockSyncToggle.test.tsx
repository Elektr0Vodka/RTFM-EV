import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RepeaterClockSyncToggle } from '../components/repeater/RepeaterClockSyncToggle';
import type { AppSettings } from '../types';

const mocks = vi.hoisted(() => ({
  api: {
    getSettings: vi.fn(),
    toggleClockSyncRepeater: vi.fn(),
  },
  toast: { error: vi.fn() },
}));

vi.mock('../api', () => ({ api: mocks.api }));
vi.mock('../components/ui/sonner', () => ({ toast: mocks.toast }));

const KEY = 'AB'.repeat(32);
const LOWER = KEY.toLowerCase();

function settings(clockSync: string[] | undefined): AppSettings {
  return { clock_sync_repeaters: clockSync } as AppSettings;
}

describe('RepeaterClockSyncToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays hidden until the setting is known', async () => {
    let resolve: (value: AppSettings) => void = () => {};
    mocks.api.getSettings.mockReturnValue(new Promise<AppSettings>((r) => (resolve = r)));

    render(<RepeaterClockSyncToggle publicKey={KEY} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    resolve(settings([]));
    expect(await screen.findByRole('checkbox')).not.toBeChecked();
  });

  it('shows the stored state, whatever the case of the key', async () => {
    mocks.api.getSettings.mockResolvedValue(settings([LOWER]));

    render(<RepeaterClockSyncToggle publicKey={KEY} />);

    expect(
      await screen.findByRole('checkbox', {
        name: /Set this repeater's clock when it runs behind/,
      })
    ).toBeChecked();
  });

  it('is off on a server that does not report the setting', async () => {
    mocks.api.getSettings.mockResolvedValue(settings(undefined));

    render(<RepeaterClockSyncToggle publicKey={KEY} />);

    expect(await screen.findByRole('checkbox')).not.toBeChecked();
  });

  it('turns on through the API and shows what the server answered', async () => {
    mocks.api.getSettings.mockResolvedValue(settings([]));
    mocks.api.toggleClockSyncRepeater.mockResolvedValue({ clock_sync_repeaters: [LOWER] });

    render(<RepeaterClockSyncToggle publicKey={KEY} />);
    fireEvent.click(await screen.findByRole('checkbox'));

    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked());
    expect(mocks.api.toggleClockSyncRepeater).toHaveBeenCalledWith(LOWER);
  });

  it('keeps the old state and says why when the server refuses', async () => {
    mocks.api.getSettings.mockResolvedValue(settings([]));
    mocks.api.toggleClockSyncRepeater.mockRejectedValue(
      new Error('Turn on telemetry tracking for this repeater first')
    );

    render(<RepeaterClockSyncToggle publicKey={KEY} />);
    fireEvent.click(await screen.findByRole('checkbox'));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith('Could not change clock sync', {
        description: 'Turn on telemetry tracking for this repeater first',
      })
    );
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('checkbox')).toBeEnabled();
  });

  it('explains when a time command is sent', async () => {
    mocks.api.getSettings.mockResolvedValue(settings([]));

    render(<RepeaterClockSyncToggle publicKey={KEY} />);

    expect(await screen.findByText(/more than 2 minutes behind/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be set back this way/)).toBeInTheDocument();
  });
});
