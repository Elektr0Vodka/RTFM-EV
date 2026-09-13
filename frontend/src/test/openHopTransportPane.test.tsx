import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHopTransportPane } from '../components/settings/openhop/transport/OpenHopTransportPane';
import { api } from '../api';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopTransportKeys').mockResolvedValue({
    success: true,
    data: [{ id: 'k1', name: 'home' }],
  });
  vi.spyOn(api, 'getOpenHopNeighborScopes').mockResolvedValue({
    success: true,
    count: 1,
    served: { scopes: 'nl' },
    data: { ['ab'.repeat(32)]: { scopes: 'nl', status: 'responded' } },
  });
});

describe('OpenHopTransportPane', () => {
  it('lists keys and requires confirm to delete', async () => {
    const del = vi.spyOn(api, 'openHopDeleteTransportKey').mockResolvedValue({ success: true });
    render(<OpenHopTransportPane />);
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(del).not.toHaveBeenCalled();
    // A confirm delete button now appears; the last matching button is the confirm.
    const deletes = screen.getAllByRole('button', { name: /delete/i });
    await userEvent.click(deletes[deletes.length - 1]);
    await waitFor(() => expect(del).toHaveBeenCalledWith('k1'));
  });

  it('shows served scopes and a neighbour row', async () => {
    render(<OpenHopTransportPane />);
    // 'nl' appears both as served scopes and in the neighbour row.
    await waitFor(() => expect(screen.getAllByText('nl').length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText(/responded/)).toBeInTheDocument();
  });
});
