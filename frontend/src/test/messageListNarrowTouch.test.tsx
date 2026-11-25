import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageList } from '../components/MessageList';
import { MessageLayoutProvider, type MessageLayout } from '../contexts/MessageLayoutContext';
import { NARROW_TOUCH_QUERY } from '../map/controls/breakpoints';
import type { Message } from '../types';

// Issue #390: on a phone in portrait the row actions sit under the message and
// only Reply stays beside it. Everywhere else the row keeps one action strip.

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    type: 'CHAN',
    conversation_key: 'C3B889530D4F02DB5662EA13C417F530',
    text: 'Alice: hello world',
    sender_timestamp: 1700000000,
    received_at: 1700000001,
    paths: null,
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: null,
    ...overrides,
  };
}

function renderList(messages: Message[], layout: MessageLayout = 'bubbles') {
  return render(
    <MessageLayoutProvider value={layout}>
      <MessageList
        messages={messages}
        contacts={[]}
        loading={false}
        onReplyToMessage={vi.fn()}
        onReactToMessage={vi.fn()}
        onDeleteMessage={vi.fn()}
      />
    </MessageLayoutProvider>
  );
}

const originalMatchMedia = globalThis.matchMedia;

function mockNarrowTouch(narrow: boolean) {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: narrow && query === NARROW_TOUCH_QUERY,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/** The element holding a row's action buttons (MessageRowActions' root). */
function strip(name: string) {
  return screen.getByRole('button', { name }).parentElement!;
}

describe('MessageList on a narrow touch screen (#390)', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  });

  describe('narrow touch', () => {
    beforeEach(() => mockNarrowTouch(true));

    it('keeps Reply beside the bubble and puts the other actions under it', () => {
      const { container } = renderList([createMessage()]);
      const row = container.querySelector('[data-message-id="1"]')!;

      expect(strip('Reply')).not.toBe(strip('React'));
      expect(strip('Reply')).not.toContainElement(screen.getByRole('button', { name: 'Delete' }));

      // The rest sit in the column under the bubble, right after it.
      const column = strip('React').parentElement!;
      expect(column).toHaveClass('flex-col');
      expect(column.firstElementChild?.textContent).toContain('hello world');
      expect(column.lastElementChild).toBe(strip('React'));
      expect(strip('React')).toContainElement(screen.getByRole('button', { name: 'Delete' }));
      expect(row).toHaveClass('max-w-[95%]');
    });

    it('puts the bookmark actions in the strip under the message', () => {
      renderList([createMessage({ bookmarked: true })]);
      expect(strip('React')).toContainElement(
        screen.getByRole('button', { name: 'Remove bookmark' })
      );
      expect(strip('Reply')).not.toContainElement(
        screen.getByRole('button', { name: 'Remove bookmark' })
      );
    });

    it('lines the actions up with the right edge for a sent message', () => {
      renderList([createMessage({ outgoing: true, text: 'on my way' })]);
      expect(strip('React').parentElement).toHaveClass('items-end');
    });

    it('keeps the time and badges together as one unit in the header', () => {
      const { container } = renderList([createMessage()]);
      const unit = container.querySelector('[data-message-id="1"] .inline-flex');
      expect(unit).not.toBeNull();
      expect(unit!.textContent).toMatch(/\d{1,2}:\d{2}/);
    });

    it('moves the card actions under the card text, Reply stays in the header', () => {
      const { container } = renderList([createMessage()], 'cards');
      const card = container.querySelector('[data-message-id="1"]')!;

      expect(strip('Reply')).not.toBe(strip('React'));
      expect(card.firstElementChild).toContainElement(
        screen.getByRole('button', { name: 'Reply' })
      );
      expect(card.firstElementChild).not.toContainElement(
        screen.getByRole('button', { name: 'React' })
      );
      expect(card.lastElementChild).toContainElement(
        screen.getByRole('button', { name: 'Delete' })
      );
    });
  });

  describe('desktop and landscape', () => {
    beforeEach(() => mockNarrowTouch(false));

    it('keeps every action in one strip beside the bubble', () => {
      const { container } = renderList([createMessage()]);
      expect(strip('Reply')).toBe(strip('React'));
      expect(strip('Reply')).toContainElement(screen.getByRole('button', { name: 'Delete' }));
      expect(container.querySelector('[data-message-id="1"]')).toHaveClass('max-w-[85%]');
      expect(container.querySelector('[data-message-id="1"] .inline-flex')).toBeNull();
    });

    it('keeps every card action in the header', () => {
      renderList([createMessage()], 'cards');
      expect(strip('Reply')).toBe(strip('React'));
    });
  });
});
