import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHopMqttPane } from '../components/settings/openhop/mqtt/OpenHopMqttPane';
import { api } from '../api';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopMqttStatus').mockResolvedValue({
    success: true,
    data: { handler_active: false },
  });
});

describe('OpenHopMqttPane', () => {
  it('saves only the whitelisted fields the user set, behind a confirm', async () => {
    const save = vi.spyOn(api, 'openHopUpdateMqttConfig').mockResolvedValue({ success: true });
    render(<OpenHopMqttPane />);
    await waitFor(() => expect(screen.getByLabelText(/owner/i)).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText(/owner/i), 'Callsign');
    // First save button opens the confirm; a second identical button confirms.
    await userEvent.click(screen.getByRole('button', { name: /save mqtt/i }));
    expect(save).not.toHaveBeenCalled();
    const saveButtons = screen.getAllByRole('button', { name: /save mqtt/i });
    await userEvent.click(saveButtons[saveButtons.length - 1]);
    await waitFor(() => expect(save).toHaveBeenCalledWith({ owner: 'Callsign' }));
  });

  it('requires confirm before publishing neighbours', async () => {
    const pub = vi.spyOn(api, 'openHopPublishNeighbors').mockResolvedValue({ success: true });
    render(<OpenHopMqttPane />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole('button', { name: /publish/i }));
    expect(pub).not.toHaveBeenCalled();
    const pubButtons = screen.getAllByRole('button', { name: /publish/i });
    await userEvent.click(pubButtons[pubButtons.length - 1]);
    await waitFor(() => expect(pub).toHaveBeenCalled());
  });
});
