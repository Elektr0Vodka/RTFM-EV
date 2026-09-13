import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMentionSound } from '../hooks/useMentionSound';
import type { Message } from '../types';

const chan = (over: Partial<Message> = {}): Message =>
  ({
    id: 1,
    type: 'CHAN',
    text: 'hi @[Me]',
    outgoing: false,
    conversation_key: 'chan1',
    sender_name: 'Bob',
    sender_key: 'bob',
    ...over,
  }) as Message;

const dm = (over: Partial<Message> = {}): Message =>
  ({
    id: 2,
    type: 'PRIV',
    text: 'yo',
    outgoing: false,
    conversation_key: 'k1',
    sender_name: 'Bob',
    ...over,
  }) as Message;

function setup(enabled: boolean, extra?: { focused?: boolean }) {
  const play = vi.fn();
  const player = {
    setSource: vi.fn(),
    setVolume: vi.fn(),
    play,
    unlock: vi.fn(),
    dispose: vi.fn(),
  };
  const { result } = renderHook(() =>
    useMentionSound({
      enabled,
      choice: 'beep',
      volume: 80,
      customVersion: null,
      makePlayer: () => player,
      isDocumentFocused: () => extra?.focused ?? false,
    })
  );
  return { result, play };
}

describe('useMentionSound', () => {
  beforeEach(() => localStorage.clear());

  it('plays for a CHAN mention when not viewing it', () => {
    const { result, play } = setup(true);
    result.current.notifyMentionSound(chan(), { isForActiveConversation: false, hasMention: true });
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not play for CHAN without a mention', () => {
    const { result, play } = setup(true);
    result.current.notifyMentionSound(chan({ text: 'no ping' }), {
      isForActiveConversation: false,
      hasMention: false,
    });
    expect(play).not.toHaveBeenCalled();
  });

  it('plays for any incoming DM', () => {
    const { result, play } = setup(true);
    result.current.notifyMentionSound(dm(), { isForActiveConversation: false, hasMention: false });
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('is silent when globally disabled', () => {
    const { result, play } = setup(false);
    result.current.notifyMentionSound(dm(), { isForActiveConversation: false, hasMention: false });
    expect(play).not.toHaveBeenCalled();
  });

  it('is silent for the user own outgoing message', () => {
    const { result, play } = setup(true);
    result.current.notifyMentionSound(dm({ outgoing: true }), {
      isForActiveConversation: false,
      hasMention: false,
    });
    expect(play).not.toHaveBeenCalled();
  });

  it('suppresses when focused AND viewing that conversation', () => {
    const { result, play } = setup(true, { focused: true });
    result.current.notifyMentionSound(dm(), { isForActiveConversation: true, hasMention: false });
    expect(play).not.toHaveBeenCalled();
  });

  it('still plays when viewing it but tab NOT focused', () => {
    const { result, play } = setup(true, { focused: false });
    result.current.notifyMentionSound(dm(), { isForActiveConversation: true, hasMention: false });
    expect(play).toHaveBeenCalledTimes(1);
  });
});
