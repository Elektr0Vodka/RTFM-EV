import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api';
import { ContactRemoteCliControl } from '../components/ContactRemoteCliControl';
import type { Contact } from '../types';

vi.mock('../api', () => ({ api: { setContactRemoteCli: vi.fn() } }));

const base = { public_key: 'ab'.repeat(32), type: 1, flags: 0 } as unknown as Contact;

describe('ContactRemoteCliControl', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('reads the radio bit when the app never set it', () => {
    render(<ContactRemoteCliControl contact={{ ...base, flags: 0x10 }} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('prefers the app value over the radio bit', () => {
    render(<ContactRemoteCliControl contact={{ ...base, flags: 0x10, remote_cli: false }} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('asks before enabling and does nothing when declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ContactRemoteCliControl contact={base} />);
    await act(async () => fireEvent.click(screen.getByRole('switch')));
    expect(api.setContactRemoteCli).not.toHaveBeenCalled();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('enables after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.setContactRemoteCli).mockResolvedValue({
      status: 'ok',
      public_key: base.public_key,
      remote_cli: true,
      applied_to_radio: true,
    });
    render(<ContactRemoteCliControl contact={base} />);
    await act(async () => fireEvent.click(screen.getByRole('switch')));
    expect(api.setContactRemoteCli).toHaveBeenCalledWith(base.public_key, true);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('disables without asking', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    vi.mocked(api.setContactRemoteCli).mockResolvedValue({
      status: 'ok',
      public_key: base.public_key,
      remote_cli: false,
      applied_to_radio: true,
    });
    render(<ContactRemoteCliControl contact={{ ...base, remote_cli: true }} />);
    await act(async () => fireEvent.click(screen.getByRole('switch')));
    expect(confirm).not.toHaveBeenCalled();
    expect(api.setContactRemoteCli).toHaveBeenCalledWith(base.public_key, false);
  });

  it('rolls back when saving fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.setContactRemoteCli).mockRejectedValue(new Error('boom'));
    render(<ContactRemoteCliControl contact={base} />);
    await act(async () => fireEvent.click(screen.getByRole('switch')));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });
});
