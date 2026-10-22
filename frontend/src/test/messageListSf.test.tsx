import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageList } from '../components/MessageList';
import type { Message, RadioStamp } from '../types';
import { INACTIVE_TEMP_RADIO, setCurrentRadioStamp, setTempRadioState } from '../utils/tempRadio';

const SF7: RadioStamp = { freq: 869.618, bw: 62.5, sf: 7, cr: 8 };
const SF8: RadioStamp = { freq: 869.618, bw: 62.5, sf: 8, cr: 8 };

function msg(id: number, stamp: RadioStamp | null, overrides: Partial<Message> = {}): Message {
  return {
    id,
    type: 'CHAN',
    conversation_key: 'C3B889530D4F02DB5662EA13C417F530',
    text: `Alice: hello ${id}`,
    sender_timestamp: 1700000000 + id,
    received_at: 1700000000 + id,
    paths: null,
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: null,
    radio_stamp: stamp,
    ...overrides,
  };
}

const row = (container: HTMLElement, id: number) =>
  container.querySelector(`[data-message-id="${id}"]`);

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
    writable: true,
  });
  act(() => {
    setTempRadioState(INACTIVE_TEMP_RADIO);
    setCurrentRadioStamp(SF7);
  });
});

describe('MessageList SF filter and pills', () => {
  it('shows an SF8 pill only on the message heard on other settings', () => {
    const { container } = render(
      <MessageList messages={[msg(1, SF7), msg(2, SF8)]} contacts={[]} loading={false} />
    );
    expect(row(container, 2)?.textContent).toContain('SF8');
    expect(row(container, 1)?.textContent).not.toContain('SF7');
  });

  it('hides messages on a hidden SF but keeps unknown and outgoing ones', () => {
    const { container } = render(
      <MessageList
        messages={[msg(1, SF7), msg(2, SF8), msg(3, null), msg(4, SF8, { outgoing: true })]}
        contacts={[]}
        loading={false}
        hiddenRadioSfs={[8]}
      />
    );
    expect(row(container, 1)).not.toBeNull();
    expect(row(container, 2)).toBeNull();
    expect(row(container, 3)).not.toBeNull();
    expect(row(container, 4)).not.toBeNull();
  });

  it('hides unstamped messages with the Unknown bucket', () => {
    const { container } = render(
      <MessageList
        messages={[msg(1, SF7), msg(3, null)]}
        contacts={[]}
        loading={false}
        hiddenRadioSfs={[0]}
      />
    );
    expect(row(container, 3)).toBeNull();
    expect(row(container, 1)).not.toBeNull();
  });

  it('reports a toggled SF to the parent', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MessageList
        messages={[msg(1, SF7), msg(2, SF8)]}
        contacts={[]}
        loading={false}
        hiddenRadioSfs={[]}
        onHiddenRadioSfsChange={onChange}
      />
    );
    await user.click(screen.getByRole('button', { name: /filter messages/i }));
    await user.click(screen.getByRole('checkbox', { name: /^hide sf8$/i }));
    expect(onChange).toHaveBeenCalledWith([8]);
  });
});
