import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChatHeader } from '../components/ChatHeader';
import { makeChannelChatHeaderProps, makeContactChatHeaderProps } from './helpers/chatHeaderProps';

describe('ChatHeader companion command line toggle', () => {
  it('shows for a chat contact when available and toggles', async () => {
    const onToggleCliConsole = vi.fn();
    render(
      <ChatHeader
        {...makeContactChatHeaderProps({
          cliConsoleAvailable: true,
          cliConsoleOpen: false,
          onToggleCliConsole,
        })}
      />
    );
    const btn = screen.getByRole('button', { name: 'Open command line' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(btn);
    expect(onToggleCliConsole).toHaveBeenCalledTimes(1);
  });

  it('offers the way back to chat while open', () => {
    render(
      <ChatHeader
        {...makeContactChatHeaderProps({
          cliConsoleAvailable: true,
          cliConsoleOpen: true,
          onToggleCliConsole: vi.fn(),
        })}
      />
    );
    expect(screen.getByRole('button', { name: 'Back to chat' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('is hidden when not available', () => {
    render(
      <ChatHeader
        {...makeContactChatHeaderProps({
          cliConsoleAvailable: false,
          onToggleCliConsole: vi.fn(),
        })}
      />
    );
    expect(screen.queryByRole('button', { name: 'Open command line' })).toBeNull();
  });

  it('is hidden for repeaters even if a toggle handler is passed', () => {
    render(
      <ChatHeader
        {...makeContactChatHeaderProps(
          { cliConsoleAvailable: true, onToggleCliConsole: vi.fn() },
          2
        )}
      />
    );
    expect(screen.queryByRole('button', { name: 'Open command line' })).toBeNull();
  });

  it('is hidden in channels', () => {
    render(
      <ChatHeader
        {...makeChannelChatHeaderProps({ cliConsoleAvailable: true, onToggleCliConsole: vi.fn() })}
      />
    );
    expect(screen.queryByRole('button', { name: 'Open command line' })).toBeNull();
  });
});
