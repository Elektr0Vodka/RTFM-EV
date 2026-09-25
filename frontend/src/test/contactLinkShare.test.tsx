import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactLinkShare } from '../components/ContactLinkShare';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));

vi.mock('../components/ui/sonner', () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}));

const URI = 'meshcore://1100ae92564c5c98';

describe('ContactLinkShare', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
  });

  it('loads the link on demand, shows it, and copies it', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const load = vi.fn().mockResolvedValue({ uri: URI, public_key: 'ae' });
    render(<ContactLinkShare load={load} />);

    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show contact link' }));

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(URI));
    expect(load).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(URI);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('shows the error when the radio cannot export the link', async () => {
    const user = userEvent.setup();
    const load = vi.fn().mockRejectedValue(new Error('The radio has no stored advert'));
    render(<ContactLinkShare load={load} />);

    await user.click(screen.getByRole('button', { name: 'Show contact link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The radio has no stored advert');
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('ContactLinkShare share tag', () => {
  it('copies the inline share tag when one is given', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const tag = `<${'ab'.repeat(32)}:1:Fl1p>`;
    render(<ContactLinkShare load={vi.fn()} shareTag={tag} />);

    await user.click(screen.getByRole('button', { name: 'Copy share tag' }));
    expect(writeText).toHaveBeenCalledWith(tag);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('shows no tag button without a tag', () => {
    render(<ContactLinkShare load={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Copy share tag' })).toBeNull();
  });
});
