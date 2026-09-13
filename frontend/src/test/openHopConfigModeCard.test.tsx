import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigModeCard } from '../components/settings/openhop/config/ConfigModeCard';
import { api } from '../api';

beforeEach(() => vi.restoreAllMocks());

describe('ConfigModeCard', () => {
  it('sets the mode when a mode button is clicked', async () => {
    const spy = vi
      .spyOn(api, 'setOpenHopMode')
      .mockResolvedValue({ success: true, mode: 'monitor' });
    render(<ConfigModeCard currentMode="forward" />);
    await userEvent.click(screen.getByRole('button', { name: /monitor/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('monitor'));
  });
});
