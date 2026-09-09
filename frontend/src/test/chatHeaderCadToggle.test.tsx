import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect } from 'vitest';
import { ChatHeader } from '../components/ChatHeader';
import { makeChannelChatHeaderProps } from './helpers/chatHeaderProps';

describe('ChatHeader CAD toggle', () => {
  it('is hidden when the device is not CAD-capable', () => {
    render(
      <ChatHeader
        {...makeChannelChatHeaderProps({ cadCapable: false, cadSupported: false })}
      />
    );
    expect(
      screen.queryByRole('button', { name: /channel activity detection/i })
    ).toBeNull();
  });

  it('is hidden when firmware does not support CAD', () => {
    render(
      <ChatHeader
        {...makeChannelChatHeaderProps({ cadCapable: true, cadSupported: false })}
      />
    );
    expect(
      screen.queryByRole('button', { name: /channel activity detection/i })
    ).toBeNull();
  });

  it('shows on-state and toggles on click', async () => {
    const onToggleCad = vi.fn();
    render(
      <ChatHeader
        {...makeChannelChatHeaderProps({
          cadCapable: true,
          cadSupported: true,
          cadEnabled: true,
          onToggleCad,
        })}
      />
    );
    const btn = screen.getByRole('button', { name: /channel activity detection/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(btn);
    expect(onToggleCad).toHaveBeenCalledTimes(1);
  });

  it('omits aria-pressed when state is unknown (null)', () => {
    render(
      <ChatHeader
        {...makeChannelChatHeaderProps({
          cadCapable: true,
          cadSupported: true,
          cadEnabled: null,
          onToggleCad: vi.fn(),
        })}
      />
    );
    const btn = screen.getByRole('button', { name: /channel activity detection/i });
    expect(btn).not.toHaveAttribute('aria-pressed');
  });
});
