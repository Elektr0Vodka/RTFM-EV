import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BotForwardStatusLine } from '../components/spamGuard/BotForwardStatusLine';

describe('BotForwardStatusLine', () => {
  it('says what the bot lists are doing to forwarding', () => {
    render(<BotForwardStatusLine forward={{ state: 'active', channels: 2, names: 6 }} />);
    const line = screen.getByTestId('spam-bot-forward-line');
    expect(line).toHaveTextContent('Bot lists: Active on 2 channels, 6 names.');
    expect(line).toHaveTextContent('Manage them in Settings > Local Configuration > Bot lists.');
  });

  it('says why it waits', () => {
    render(<BotForwardStatusLine forward={{ state: 'paused', channels: 0, names: 1 }} />);
    expect(screen.getByTestId('spam-bot-forward-line')).toHaveTextContent(
      'Bot lists: Waiting: Spam Guard is paused, 1 name.'
    );
  });

  it('says so when no name is forward-blocked', () => {
    render(<BotForwardStatusLine forward={{ state: 'no_names', channels: 0, names: 0 }} />);
    expect(screen.getByTestId('spam-bot-forward-line')).toHaveTextContent(
      'Bot lists: no names are being forward-blocked.'
    );
  });
});
