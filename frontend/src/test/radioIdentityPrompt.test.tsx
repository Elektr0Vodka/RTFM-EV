import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRadioIdentities: vi.fn(),
  confirmNewRadio: vi.fn(),
  replaceRadio: vi.fn(),
  answerLegacyHistory: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../api', () => ({
  api: {
    getRadioIdentities: mocks.getRadioIdentities,
    confirmNewRadio: mocks.confirmNewRadio,
    replaceRadio: mocks.replaceRadio,
    answerLegacyHistory: mocks.answerLegacyHistory,
  },
}));

vi.mock('../components/ui/sonner', () => ({ toast: mocks.toast }));

import { RadioIdentityPrompt } from '../components/RadioIdentityPrompt';
import type { HealthStatus, RadioIdentity, RadioIdentityHealth } from '../types';

const KEY_OLD = 'aa'.repeat(32);
const KEY_NEW = 'bb'.repeat(32);

const radio = (over: Partial<RadioIdentity>): RadioIdentity => ({
  id: 1,
  public_key: KEY_OLD,
  name: 'Alpha',
  notes: null,
  first_connected: 1000,
  last_connected: 1000,
  status: 'confirmed',
  pending_reason: null,
  replaced_by: null,
  carry_stats: false,
  carry_owned: false,
  is_active: false,
  ...over,
});

const OLD = radio({});
const NEW = radio({
  id: 2,
  public_key: KEY_NEW,
  name: 'Bravo',
  status: 'pending',
  pending_reason: 'new_key',
  is_active: true,
});

const health = (identity: RadioIdentityHealth | null): HealthStatus => ({
  status: 'ok',
  radio_connected: true,
  radio_initializing: false,
  connection_info: null,
  database_size_mb: 1,
  oldest_undecrypted_timestamp: null,
  fanout_statuses: {},
  radio_identity: identity,
});

const pendingNew: RadioIdentityHealth = {
  id: 2,
  public_key: KEY_NEW,
  name: 'Bravo',
  status: 'pending',
  pending_reason: 'new_key',
  owned_keys: [KEY_NEW],
};

describe('RadioIdentityPrompt (plan 18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mocks.getRadioIdentities.mockResolvedValue({
      radios: [NEW, OLD],
      has_unassigned_history: false,
    });
    mocks.confirmNewRadio.mockResolvedValue({ ...NEW, status: 'confirmed' });
    mocks.replaceRadio.mockResolvedValue({ ...NEW, status: 'confirmed' });
    mocks.answerLegacyHistory.mockResolvedValue({ ...NEW, status: 'confirmed' });
  });

  it('stays hidden for a confirmed radio or no radio', () => {
    const { rerender } = render(<RadioIdentityPrompt health={health(null)} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(
      <RadioIdentityPrompt
        health={health({ ...pendingNew, status: 'confirmed', pending_reason: null })}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('answers "new radio"', async () => {
    const user = userEvent.setup();
    render(<RadioIdentityPrompt health={health(pendingNew)} />);

    expect(await screen.findByText('A different radio is connected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.confirmNewRadio).toHaveBeenCalledWith(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('answers "replaces" with the carry-over choices', async () => {
    const user = userEvent.setup();
    render(<RadioIdentityPrompt health={health(pendingNew)} />);

    await user.click(await screen.findByLabelText('This replaces an earlier radio'));
    expect(screen.getByLabelText('Replaces')).toHaveValue('1');
    await user.click(screen.getByLabelText('Note'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mocks.replaceRadio).toHaveBeenCalledWith(2, {
        old_id: 1,
        carry_stats: true,
        carry_owned: true,
        carry_note: false,
      })
    );
  });

  it('does not offer "replaces" when no earlier radio is free', async () => {
    mocks.getRadioIdentities.mockResolvedValue({
      radios: [NEW, radio({ replaced_by: 3 })],
      has_unassigned_history: false,
    });
    render(<RadioIdentityPrompt health={health(pendingNew)} />);

    expect(await screen.findByLabelText('This is a new radio')).toBeInTheDocument();
    expect(screen.queryByLabelText('This replaces an earlier radio')).not.toBeInTheDocument();
  });

  it('asks about pre-tracking history and sends the answer', async () => {
    const user = userEvent.setup();
    render(
      <RadioIdentityPrompt health={health({ ...pendingNew, pending_reason: 'legacy_history' })} />
    );

    expect(await screen.findByText('Whose history is this?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'No, keep it separate' }));

    await waitFor(() => expect(mocks.answerLegacyHistory).toHaveBeenCalledWith(2, false));
  });

  it('"Decide later" hides it for this session only', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<RadioIdentityPrompt health={health(pendingNew)} />);

    await user.click(await screen.findByRole('button', { name: 'Decide later' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.confirmNewRadio).not.toHaveBeenCalled();

    unmount();
    render(<RadioIdentityPrompt health={health(pendingNew)} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an error toast and stays open when saving fails', async () => {
    const user = userEvent.setup();
    mocks.confirmNewRadio.mockRejectedValue(new Error('conflict'));
    render(<RadioIdentityPrompt health={health(pendingNew)} />);

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
