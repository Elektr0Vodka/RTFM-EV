import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRadioIdentities: vi.fn(),
  updateRadioLink: vi.fn(),
  removeRadioLink: vi.fn(),
  updateRadioNotes: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../api', () => ({
  api: {
    getRadioIdentities: mocks.getRadioIdentities,
    updateRadioLink: mocks.updateRadioLink,
    removeRadioLink: mocks.removeRadioLink,
    updateRadioNotes: mocks.updateRadioNotes,
  },
}));

vi.mock('../components/ui/sonner', () => ({ toast: mocks.toast }));

import { RadioIdentitiesSettings } from '../components/settings/RadioIdentitiesSettings';
import type { RadioIdentity } from '../types';

const base: RadioIdentity = {
  id: 1,
  public_key: 'aa'.repeat(32),
  name: 'Alpha',
  notes: null,
  first_connected: 1_700_000_000,
  last_connected: 1_700_000_000,
  status: 'confirmed',
  pending_reason: null,
  replaced_by: 2,
  carry_stats: true,
  carry_owned: false,
  is_active: false,
};
const successor: RadioIdentity = {
  ...base,
  id: 2,
  public_key: 'bb'.repeat(32),
  name: 'Bravo',
  replaced_by: null,
  carry_stats: false,
  is_active: true,
};

describe('RadioIdentitiesSettings (plan 18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRadioIdentities.mockResolvedValue({
      radios: [successor, base],
      has_unassigned_history: true,
    });
    mocks.updateRadioLink.mockResolvedValue(base);
    mocks.removeRadioLink.mockResolvedValue(base);
    mocks.updateRadioNotes.mockResolvedValue(base);
  });

  it('lists radios with the replacement link and unassigned-history note', async () => {
    render(<RadioIdentitiesSettings health={null} />);

    expect(await screen.findByText('Alpha (aaaaaaaaaaaa)')).toBeInTheDocument();
    expect(screen.getByText('Bravo (bbbbbbbbbbbb)')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Replaced by Bravo (bbbbbbbbbbbb). It inherits:')).toBeInTheDocument();
    expect(screen.getByText(/Before radio tracking/)).toBeInTheDocument();
  });

  it('edits and removes the link', async () => {
    const user = userEvent.setup();
    render(<RadioIdentitiesSettings health={null} />);

    await user.click(await screen.findByLabelText('Owned nodes'));
    await waitFor(() =>
      expect(mocks.updateRadioLink).toHaveBeenCalledWith(1, {
        carry_stats: true,
        carry_owned: true,
      })
    );

    await user.click(screen.getByRole('button', { name: 'Remove replacement link' }));
    await waitFor(() => expect(mocks.removeRadioLink).toHaveBeenCalledWith(1));
  });

  it('saves a note', async () => {
    const user = userEvent.setup();
    render(<RadioIdentitiesSettings health={null} />);

    const inputs = await screen.findAllByLabelText('Radio note');
    await user.type(inputs[1], 'Lost at the fair');
    const saves = screen.getAllByRole('button', { name: 'Save note' });
    await user.click(saves[1]);

    await waitFor(() => expect(mocks.updateRadioNotes).toHaveBeenCalledWith(1, 'Lost at the fair'));
  });
});
