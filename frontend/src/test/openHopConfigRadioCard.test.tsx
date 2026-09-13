import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigRadioCard } from '../components/settings/openhop/config/ConfigRadioCard';
import { api } from '../api';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopPresets').mockResolvedValue({ presets: [], source: 'local' });
});

describe('ConfigRadioCard', () => {
  it('converts frequency MHz to Hz and posts only filled fields after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const spy = vi
      .spyOn(api, 'updateOpenHopRadio')
      .mockResolvedValue({ success: true, data: { applied: ['freq'], restart_required: true } });
    render(<ConfigRadioCard />);
    await userEvent.type(screen.getByLabelText(/frequency/i), '869.525');
    await userEvent.click(screen.getByRole('button', { name: /save radio settings/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ frequency: 869525000 }));
    expect(await screen.findByText(/restart is required/i)).toBeInTheDocument();
  });

  it('does not post when the confirm is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const spy = vi.spyOn(api, 'updateOpenHopRadio').mockResolvedValue({ success: true, data: {} });
    render(<ConfigRadioCard />);
    await userEvent.type(screen.getByLabelText(/frequency/i), '869.525');
    await userEvent.click(screen.getByRole('button', { name: /save radio settings/i }));
    expect(spy).not.toHaveBeenCalled();
  });
});
