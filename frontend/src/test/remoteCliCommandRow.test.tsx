import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RemoteCliCommandRow } from '../components/RemoteCliCommandRow';
import type { Message } from '../types';

const msg = (cli_permitted: boolean | null) =>
  ({
    id: 1,
    type: 'PRIV',
    text: 'get wifi.ssid',
    txt_type: 3,
    outgoing: false,
    received_at: 1_800_000_000,
    cli_permitted,
  }) as unknown as Message;

describe('RemoteCliCommandRow', () => {
  it('shows the command and that the radio answered', () => {
    render(<RemoteCliCommandRow message={msg(true)} senderName="Bob" />);
    expect(screen.getByText('get wifi.ssid')).toBeInTheDocument();
    expect(screen.getByText(/answered by your radio/)).toBeInTheDocument();
    expect(screen.getByText(/Bob sent a command/)).toBeInTheDocument();
  });

  it('shows that it was ignored without permission', () => {
    render(<RemoteCliCommandRow message={msg(false)} senderName="Bob" />);
    expect(screen.getByText(/no Remote CLI permission/)).toBeInTheDocument();
  });
});
