import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsAboutSection } from '../components/settings/SettingsAboutSection';

const useUpdateStatusMock = vi.fn();
vi.mock('../hooks/useUpdateStatus', () => ({
  useUpdateStatus: () => useUpdateStatusMock(),
}));

const health = {
  status: 'ok',
  radio_connected: true,
  radio_initializing: false,
  connection_info: 'Serial: /dev/ttyUSB0',
  app_info: { version: '3.2.0-test', commit_hash: 'deadbeef' },
  database_size_mb: 1.2,
  oldest_undecrypted_timestamp: null,
  fanout_statuses: {},
  bots_disabled: false,
} as const;

describe('SettingsAboutSection', () => {
  beforeEach(() => {
    useUpdateStatusMock.mockReset();
  });

  it('renders the debug support snapshot link', () => {
    useUpdateStatusMock.mockReturnValue(null);
    render(<SettingsAboutSection health={health} />);
    const link = screen.getByRole('link', { name: /Open debug support snapshot/i });
    expect(link).toHaveAttribute('href', './api/debug');
  });

  it('shows the update indicator with a button to the compare url', () => {
    useUpdateStatusMock.mockReturnValue({
      check_enabled: true,
      update_available: true,
      current_commit: 'dc11fbe0',
      latest_commit: 'a1b2c3d4',
      commits_behind: 7,
      compare_url: 'https://github.com/Elektr0Vodka/RTFM-EV/compare/dc11fbe0...main',
      checked_at: 1757600000,
    });
    render(<SettingsAboutSection health={health} />);
    expect(screen.getByText(/Update available/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /View changes/i });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/Elektr0Vodka/RTFM-EV/compare/dc11fbe0...main'
    );
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders no update indicator when up to date', () => {
    useUpdateStatusMock.mockReturnValue({
      check_enabled: true,
      update_available: false,
      current_commit: 'dc11fbe0',
      latest_commit: null,
      commits_behind: 0,
      compare_url: null,
      checked_at: 1757600000,
    });
    render(<SettingsAboutSection health={health} />);
    expect(screen.queryByText(/Update available/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /View changes/i })).not.toBeInTheDocument();
  });
});
