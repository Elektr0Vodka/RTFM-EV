import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useUpdateStatusMock = vi.fn();
vi.mock('../hooks/useUpdateStatus', () => ({
  useUpdateStatus: () => useUpdateStatusMock(),
}));

import { StatusBar } from '../components/StatusBar';

const baseProps = {
  health: null,
  config: null,
  settingsMode: false,
  onSettingsClick: () => {},
};

describe('StatusBar update dot', () => {
  beforeEach(() => useUpdateStatusMock.mockReset());

  it('shows the update dot when an update is available', () => {
    useUpdateStatusMock.mockReturnValue({ update_available: true });
    render(<StatusBar {...baseProps} />);
    expect(screen.getByLabelText(/update is available/i)).toBeInTheDocument();
  });

  it('hides the update dot when up to date', () => {
    useUpdateStatusMock.mockReturnValue({ update_available: false });
    render(<StatusBar {...baseProps} />);
    expect(screen.queryByLabelText(/update is available/i)).not.toBeInTheDocument();
  });
});
