import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageList } from '../components/MessageList';
import type { Message } from '../types';
import {
  SMAZ_INDICATOR_KEY,
  getSavedSmazIndicator,
  setSavedSmazIndicator,
} from '../utils/smazIndicatorPreference';

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
    sender_name: 'Alice',
    ...overrides,
  };
}

function renderList(messages: Message[]) {
  return render(<MessageList messages={messages} contacts={[]} loading={false} />);
}

describe('SMAZ compression indicator', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('is off by default', () => {
    expect(getSavedSmazIndicator()).toBe(false);
    renderList([createMessage({ smaz: true })]);
    expect(screen.queryByTestId('smaz-indicator')).not.toBeInTheDocument();
  });

  it('shows the icon with a tooltip only on flagged messages when enabled', () => {
    setSavedSmazIndicator(true);
    expect(localStorage.getItem(SMAZ_INDICATOR_KEY)).toBe('true');
    renderList([
      createMessage({ id: 1, smaz: true, text: 'Alice: compressed one' }),
      createMessage({ id: 2, smaz: false, text: 'Alice: plain one', sender_timestamp: 1700000002 }),
    ]);
    const icons = screen.getAllByTestId('smaz-indicator');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('title', 'Arrived SMAZ-compressed');
    expect(icons[0]).toHaveAccessibleName('Arrived SMAZ-compressed');
  });

  it('follows the setting without a reload', () => {
    renderList([createMessage({ smaz: true })]);
    expect(screen.queryByTestId('smaz-indicator')).not.toBeInTheDocument();
    act(() => setSavedSmazIndicator(true));
    expect(screen.getByTestId('smaz-indicator')).toBeInTheDocument();
    act(() => setSavedSmazIndicator(false));
    expect(screen.queryByTestId('smaz-indicator')).not.toBeInTheDocument();
    expect(localStorage.getItem(SMAZ_INDICATOR_KEY)).toBeNull();
  });
});
