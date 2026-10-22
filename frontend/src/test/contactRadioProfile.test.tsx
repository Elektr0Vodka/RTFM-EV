import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactRadioProfile } from '../types';

const mocks = vi.hoisted(() => ({
  api: {
    switchToContactRadioProfile: vi.fn(),
    putContactRadioProfile: vi.fn(),
    deleteContactRadioProfile: vi.fn(),
    getRadioPresets: vi.fn(),
    getFanoutConfigs: vi.fn(),
  },
}));

vi.mock('../api', () => ({ api: mocks.api }));

import { ChatHeader } from '../components/ChatHeader';
import { ContactRadioProfileSection } from '../components/ContactRadioProfileSection';
import {
  INACTIVE_TEMP_RADIO,
  setContactProfiles,
  setContactSightings,
  setCurrentRadioStamp,
  setTempRadioState,
} from '../utils/tempRadio';
import { makeContactChatHeaderProps } from './helpers/chatHeaderProps';

const KEY = 'BB'.repeat(32);
const key = KEY.toLowerCase();

const PROFILE: ContactRadioProfile = {
  public_key: key,
  radio: { freq: 869.618, bw: 62.5, sf: 8, cr: 8 },
  region: '#be',
  duration_secs: 900,
  auto_switch: false,
  updated_at: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.switchToContactRadioProfile.mockResolvedValue({
    ...INACTIVE_TEMP_RADIO,
    active: true,
  });
  mocks.api.putContactRadioProfile.mockImplementation(async (_k: string, req) => ({
    ...PROFILE,
    ...req,
  }));
  mocks.api.deleteContactRadioProfile.mockResolvedValue({ deleted: true });
  act(() => {
    setTempRadioState(INACTIVE_TEMP_RADIO);
    setContactProfiles({});
    setContactSightings({});
    setCurrentRadioStamp({ freq: 869.618, bw: 62.5, sf: 7, cr: 8 });
  });
});

describe('DM header contact settings', () => {
  it('has no switch button without saved settings', () => {
    render(<ChatHeader {...makeContactChatHeaderProps({ radioConnected: true })} />);
    expect(screen.queryByRole('button', { name: /switch to .*settings/i })).toBeNull();
  });

  it("switches to the contact's saved settings", async () => {
    act(() => setContactProfiles({ [key]: PROFILE }));
    render(<ChatHeader {...makeContactChatHeaderProps({ radioConnected: true })} />);
    await userEvent.click(screen.getByRole('button', { name: /switch to .*settings/i }));
    await waitFor(() => expect(mocks.api.switchToContactRadioProfile).toHaveBeenCalledWith(key));
  });

  it('toggles auto switch', async () => {
    act(() => setContactProfiles({ [key]: PROFILE }));
    render(<ChatHeader {...makeContactChatHeaderProps({ radioConnected: true })} />);
    await userEvent.click(screen.getByRole('button', { name: /auto switch/i }));
    await waitFor(() => expect(mocks.api.putContactRadioProfile).toHaveBeenCalledTimes(1));
    expect(mocks.api.putContactRadioProfile.mock.calls[0][1]).toEqual({
      radio: PROFILE.radio,
      region: '#be',
      duration_secs: 900,
      auto_switch: true,
    });
  });
});

describe('ContactRadioProfileSection', () => {
  it('lists the SFs the contact was heard on', () => {
    act(() =>
      setContactSightings({
        [key]: [
          { freq: 869.618, bw: 62.5, sf: 7, cr: 8, first_seen: 1, last_seen: 2 },
          { freq: 869.618, bw: 62.5, sf: 8, cr: 8, first_seen: 3, last_seen: 4 },
        ],
      })
    );
    render(<ContactRadioProfileSection publicKey={KEY} />);
    expect(screen.getAllByText('SF8').length).toBeGreaterThan(0);
  });

  it('fills the form from a sighting and saves it', async () => {
    act(() =>
      setContactSightings({
        [key]: [{ freq: 869.525, bw: 250, sf: 11, cr: 5, first_seen: 1, last_seen: 2 }],
      })
    );
    render(<ContactRadioProfileSection publicKey={KEY} />);
    await userEvent.click(screen.getByRole('button', { name: /use sf11/i }));
    await userEvent.click(screen.getByLabelText(/auto switch before each dm/i));
    await userEvent.click(screen.getByRole('button', { name: /save radio settings/i }));
    await waitFor(() => expect(mocks.api.putContactRadioProfile).toHaveBeenCalledTimes(1));
    expect(mocks.api.putContactRadioProfile).toHaveBeenCalledWith(KEY, {
      radio: { freq: 869.525, bw: 250, sf: 11, cr: 5 },
      region: null,
      duration_secs: 1800,
      auto_switch: true,
    });
  });

  it('rejects invalid settings', async () => {
    render(<ContactRadioProfileSection publicKey={KEY} />);
    await userEvent.click(screen.getByRole('button', { name: /save radio settings/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(mocks.api.putContactRadioProfile).not.toHaveBeenCalled();
  });

  it('removes saved settings', async () => {
    act(() => setContactProfiles({ [key]: PROFILE }));
    render(<ContactRadioProfileSection publicKey={KEY} />);
    await userEvent.click(screen.getByRole('button', { name: /remove radio settings/i }));
    await waitFor(() => expect(mocks.api.deleteContactRadioProfile).toHaveBeenCalledWith(KEY));
  });

  it('switches to the saved settings from the section', async () => {
    act(() => setContactProfiles({ [key]: PROFILE }));
    render(<ContactRadioProfileSection publicKey={KEY} />);
    await userEvent.click(screen.getByRole('button', { name: /switch to these settings now/i }));
    await waitFor(() => expect(mocks.api.switchToContactRadioProfile).toHaveBeenCalledWith(KEY));
  });
});
