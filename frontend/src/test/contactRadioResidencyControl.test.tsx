import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ContactRadioResidencyControl } from '../components/ContactRadioResidencyControl';
import type { Contact } from '../types';

const { getRadioResidency, setContactRadioPolicy } = vi.hoisted(() => ({
  getRadioResidency: vi.fn(),
  setContactRadioPolicy: vi.fn(),
}));

vi.mock('../api', () => ({
  api: { getRadioResidency, setContactRadioPolicy },
  isAbortError: () => false,
}));

vi.mock('../components/ui/sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const KEY = 'AA'.repeat(32);

function createContact(overrides: Partial<Contact> = {}): Contact {
  return {
    public_key: KEY,
    name: 'Alice',
    type: 1,
    flags: 0,
    direct_path: null,
    direct_path_len: 0,
    direct_path_hash_mode: 0,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: 1700000000,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: 1699990000,
    ...overrides,
  };
}

describe('ContactRadioResidencyControl', () => {
  beforeEach(() => {
    getRadioResidency.mockReset();
    setContactRadioPolicy.mockReset();
    getRadioResidency.mockResolvedValue([]);
    setContactRadioPolicy.mockResolvedValue({});
  });

  it('shows "not on radio" when the contact is absent from residency', async () => {
    render(<ContactRadioResidencyControl contact={createContact()} />);
    await waitFor(() => expect(getRadioResidency).toHaveBeenCalled());
    expect(screen.getByText('Not on radio')).toBeInTheDocument();
  });

  it('shows on-radio status with the reason when present', async () => {
    getRadioResidency.mockResolvedValue([{ public_key: KEY.toLowerCase(), reason: 'pinned' }]);
    render(<ContactRadioResidencyControl contact={createContact({ radio_policy: 'pinned' })} />);
    await waitFor(() => expect(screen.getByText(/On radio/)).toBeInTheDocument());
  });

  it('calls setContactRadioPolicy when a policy button is clicked', async () => {
    render(<ContactRadioResidencyControl contact={createContact()} />);
    await waitFor(() => expect(getRadioResidency).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Pin'));

    await waitFor(() => expect(setContactRadioPolicy).toHaveBeenCalledWith(KEY, 'pinned'));
  });

  it('does not call the API when clicking the already-active policy', async () => {
    render(<ContactRadioResidencyControl contact={createContact({ radio_policy: 'auto' })} />);
    await waitFor(() => expect(getRadioResidency).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Auto'));

    expect(setContactRadioPolicy).not.toHaveBeenCalled();
  });
});
