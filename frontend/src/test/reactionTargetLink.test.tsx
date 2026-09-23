import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../api', () => ({
  api: { getReactionTarget: vi.fn() },
}));

import { api } from '../api';
import { ReactionTargetLink, clearReactionTargetCache } from '../components/ReactionTargetLink';

const getReactionTarget = vi.mocked(api.getReactionTarget);

function target(id: number, text: string, type: 'CHAN' | 'PRIV' = 'CHAN') {
  return { id, text, type, conversation_key: 'K' } as never;
}

describe('ReactionTargetLink', () => {
  beforeEach(() => {
    clearReactionTargetCache();
    getReactionTarget.mockReset();
  });

  it('shows the target body without the sender prefix and jumps on click', async () => {
    getReactionTarget.mockResolvedValue({
      emoji: '👍',
      target_hash: '3eykm5rn',
      target_sender: 'NL-OV-ENS-NL1CTM-TEST',
      target: target(3, 'NL-OV-ENS-NL1CTM-TEST: Test message'),
    });
    const onJump = vi.fn();

    render(<ReactionTargetLink messageId={5} onJump={onJump} />);

    const link = await screen.findByRole('button', { name: /Test message/ });
    fireEvent.click(link);
    expect(onJump).toHaveBeenCalledWith(3);
    expect(getReactionTarget).toHaveBeenCalledWith(5);
  });

  it('says the original was not received when there is no match', async () => {
    getReactionTarget.mockResolvedValue({
      emoji: '👍',
      target_hash: 'v6yx6m6t',
      target_sender: '512 A',
      target: null,
    });

    render(<ReactionTargetLink messageId={6} />);

    expect(await screen.findByText(/original message not received/)).toBeInTheDocument();
  });

  it('fetches each reaction only once', async () => {
    getReactionTarget.mockResolvedValue({
      emoji: '👍',
      target_hash: '3eykm5rn',
      target_sender: null,
      target: target(3, 'Test', 'PRIV'),
    });

    const { unmount } = render(<ReactionTargetLink messageId={7} />);
    await screen.findByText(/Test/);
    unmount();
    render(<ReactionTargetLink messageId={7} />);
    await screen.findByText(/Test/);

    expect(getReactionTarget).toHaveBeenCalledTimes(1);
  });
});

describe('ReactionTargetLink analyzer fallback', () => {
  beforeEach(() => {
    clearReactionTargetCache();
    getReactionTarget.mockReset();
  });

  it('offers the channel on the analyzer when the target was not received', async () => {
    getReactionTarget.mockResolvedValue({
      emoji: '👍',
      target_hash: 'v6yx6m6t',
      target_sender: '512 A',
      target: null,
    });

    render(
      <ReactionTargetLink
        messageId={8}
        analyzerLookup={{ url: 'https://analyzer.example/channels/Public', siteName: 'EU' }}
      />
    );

    const link = await screen.findByRole('link', { name: /look for it on EU/ });
    expect(link).toHaveAttribute('href', 'https://analyzer.example/channels/Public');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('title')).toContain('512 A');
  });

  it('does not offer the analyzer when the target was found', async () => {
    getReactionTarget.mockResolvedValue({
      emoji: '👍',
      target_hash: '3eykm5rn',
      target_sender: null,
      target: target(3, 'Test', 'PRIV'),
    });

    render(
      <ReactionTargetLink
        messageId={9}
        analyzerLookup={{ url: 'https://analyzer.example/x', siteName: 'EU' }}
      />
    );

    await screen.findByText(/Test/);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
