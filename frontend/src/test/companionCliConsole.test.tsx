import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanionCliConsole } from '../components/CompanionCliConsole';
import { api } from '../api';

vi.mock('../api', () => ({
  api: { runRadioCli: vi.fn(), sendRepeaterCommand: vi.fn() },
}));

function send(text: string) {
  const input = screen.getByLabelText('Console command');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest('form')!);
}

describe('CompanionCliConsole', () => {
  beforeEach(() => vi.clearAllMocks());

  it('explains the firmware requirement on older radios', () => {
    render(<CompanionCliConsole target={{ kind: 'radio' }} cliSupported={false} />);
    expect(screen.getByText(/1\.18 or newer/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Console command')).toBeNull();
  });

  it('runs a command on the radio and shows the reply', async () => {
    vi.mocked(api.runRadioCli).mockResolvedValue({
      command: 'ver',
      reply: 'v1.18.0 (Build: 15 Oct 2026)',
    });
    render(<CompanionCliConsole target={{ kind: 'radio' }} cliSupported />);
    await act(async () => send('ver'));
    await waitFor(() => expect(screen.getByText(/v1\.18\.0/)).toBeInTheDocument());
    expect(api.runRadioCli).toHaveBeenCalledWith('ver');
  });

  it('sends to a contact through the contact command route', async () => {
    vi.mocked(api.sendRepeaterCommand).mockResolvedValue({
      command: 'get name',
      response: '> Bob',
      sender_timestamp: null,
    });
    render(
      <CompanionCliConsole target={{ kind: 'contact', publicKey: 'ab'.repeat(32) }} cliSupported />
    );
    expect(screen.getByText(/Remote CLI permission/)).toBeInTheDocument();
    await act(async () => send('get name'));
    expect(api.sendRepeaterCommand).toHaveBeenCalledWith('ab'.repeat(32), 'get name');
  });

  it('shows an error reply when the request fails', async () => {
    vi.mocked(api.runRadioCli).mockRejectedValue(new Error('Radio not connected'));
    render(<CompanionCliConsole target={{ kind: 'radio' }} cliSupported />);
    await act(async () => send('ver'));
    await waitFor(() => expect(screen.getByText(/Error: Radio not connected/)).toBeInTheDocument());
  });

  it('asks before a risky command and does nothing when declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<CompanionCliConsole target={{ kind: 'radio' }} cliSupported />);
    await act(async () => send('reboot'));
    expect(confirm).toHaveBeenCalled();
    expect(api.runRadioCli).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('runs a risky command after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.runRadioCli).mockResolvedValue({ command: 'reboot', reply: '' });
    render(<CompanionCliConsole target={{ kind: 'radio' }} cliSupported />);
    await act(async () => send('reboot'));
    expect(api.runRadioCli).toHaveBeenCalledWith('reboot');
    confirm.mockRestore();
  });

  function suggestionsFor(text: string) {
    fireEvent.change(screen.getByLabelText('Console command'), { target: { value: text } });
    return screen.queryAllByRole('option').map((el) => el.textContent ?? '');
  }

  it('offers the meshcomod commands on a meshcomod radio', () => {
    render(<CompanionCliConsole target={{ kind: 'radio' }} cliSupported meshcomod />);
    expect(suggestionsFor('ota c').some((s) => s.startsWith('ota check'))).toBe(true);
  });

  it('does not offer the meshcomod commands on stock firmware or for a contact', () => {
    const { unmount } = render(<CompanionCliConsole target={{ kind: 'radio' }} cliSupported />);
    expect(suggestionsFor('ota c')).toHaveLength(0);
    unmount();
    render(
      <CompanionCliConsole
        target={{ kind: 'contact', publicKey: 'ab'.repeat(32) }}
        cliSupported
        meshcomod
      />
    );
    expect(suggestionsFor('ota c')).toHaveLength(0);
  });

  it('starts a fresh history when the target contact changes', async () => {
    vi.mocked(api.sendRepeaterCommand).mockResolvedValue({
      command: 'get name',
      response: '> Alice-only reply',
      sender_timestamp: null,
    });
    const { rerender } = render(
      <CompanionCliConsole target={{ kind: 'contact', publicKey: 'aa'.repeat(32) }} cliSupported />
    );
    await act(async () => send('get name'));
    await waitFor(() => expect(screen.getByText(/Alice-only reply/)).toBeInTheDocument());
    rerender(
      <CompanionCliConsole target={{ kind: 'contact', publicKey: 'bb'.repeat(32) }} cliSupported />
    );
    expect(screen.queryByText(/Alice-only reply/)).toBeNull();
  });
});
