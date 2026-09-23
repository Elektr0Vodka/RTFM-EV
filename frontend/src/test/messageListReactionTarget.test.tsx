import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../components/ReactionTargetLink', () => ({
  ReactionTargetLink: ({
    messageId,
    onJump,
  }: {
    messageId: number;
    onJump?: (id: number) => void;
  }) => (
    <button type="button" data-testid="reaction-target" onClick={() => onJump?.(targetIdForTest)}>
      {messageId}
    </button>
  ),
}));

let targetIdForTest = 0;

import { MessageList } from '../components/MessageList';
import { RichPayloadProvider } from '../contexts/RichPayloadContext';
import type { Message } from '../types';

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
  writable: true,
});

function message(id: number, text: string): Message {
  return {
    id,
    type: 'CHAN',
    conversation_key: 'C3B889530D4F02DB5662EA13C417F530',
    text,
    sender_timestamp: 1700000000,
    received_at: 1700000001,
    paths: null,
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: null,
  };
}

function renderList(messages: Message[], onJumpToMessage?: (id: number) => void) {
  return render(
    <RichPayloadProvider renderRichPayloads setRenderRichPayloads={() => {}}>
      <MessageList
        messages={messages}
        contacts={[]}
        loading={false}
        onJumpToMessage={onJumpToMessage}
      />
    </RichPayloadProvider>
  );
}

describe('MessageList reaction target', () => {
  it('resolves the target of a hash-addressed reaction', () => {
    renderList([message(42, '512 A: @[NL-HVS-BK03]👍\nn3nyfd5a')]);
    expect(screen.getByTestId('reaction-target')).toHaveTextContent('42');
  });

  it('also resolves meshcore-open r: reactions (v3 and v1)', () => {
    renderList([
      message(43, '512 A: r:1a2b:00'),
      message(44, '512 A: r:1700000000123_12345_67890:👍'),
    ]);
    expect(screen.getAllByTestId('reaction-target').map((el) => el.textContent)).toEqual([
      '43',
      '44',
    ]);
  });
});

describe('MessageList reaction jump', () => {
  it('scrolls locally when the target is already loaded', () => {
    const onJumpToMessage = vi.fn();
    targetIdForTest = 41;
    renderList(
      [message(41, 'NL-HVS-BK03: hello'), message(42, '512 A: @[NL-HVS-BK03]👍\nn3nyfd5a')],
      onJumpToMessage
    );
    fireEvent.click(screen.getByTestId('reaction-target'));
    expect(onJumpToMessage).not.toHaveBeenCalled();
  });

  it('asks the app to load around the target when it is not loaded', () => {
    const onJumpToMessage = vi.fn();
    targetIdForTest = 7;
    renderList([message(42, '512 A: @[NL-HVS-BK03]👍\nn3nyfd5a')], onJumpToMessage);
    fireEvent.click(screen.getByTestId('reaction-target'));
    expect(onJumpToMessage).toHaveBeenCalledWith(7);
  });
});
