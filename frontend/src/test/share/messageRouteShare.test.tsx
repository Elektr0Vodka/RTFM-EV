import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const renderMessageRouteCard = vi.fn();
vi.mock('../../share/cards/messageRouteRender', () => ({
  renderMessageRouteCard: (...args: unknown[]) => renderMessageRouteCard(...args),
}));
vi.mock('../../api', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({ brand_name: '', brand_icon: '', brand_hidden: false }),
  },
}));
vi.mock('../../share/brand', () => ({
  loadCardBrand: vi.fn().mockResolvedValue({ name: 'RTFM-EV', icon: null }),
}));

import { I18nProvider } from '../../i18n/I18nProvider';
import {
  useMessageRouteBuild,
  type MessageShareTarget,
} from '../../share/cards/useMessageRouteShare';
import type { CardText } from '../../share/cardChrome';
import { MessageRowActions } from '../../components/MessageRowActions';
import type { Message, MessagePath, RadioConfig } from '../../types';

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;

const config = {
  name: 'Me',
  public_key: 'ff'.repeat(32),
  lat: 52.4,
  lon: 5.2,
} as unknown as RadioConfig;

function message(over: Partial<Message> = {}): Message {
  return {
    id: 7,
    type: 'CHAN',
    conversation_key: 'chan-key',
    text: 'Jan: anyone in Utrecht?',
    received_at: Date.UTC(2026, 9, 18, 19, 14) / 1000,
    sender_timestamp: null,
    outgoing: false,
    acked: 0,
    paths: [],
    ...over,
  } as unknown as Message;
}

const paths: MessagePath[] = [{ path: 'ab', path_len: 1, received_at: 1, snr: null, rssi: null }];

function target(over: Partial<MessageShareTarget> = {}): MessageShareTarget {
  return {
    message: message(),
    paths,
    senderInfo: { name: 'Jan', publicKeyOrPrefix: 'aa', lat: 51.9, lon: 4.9 },
    conversationLabel: '#public',
    isChannel: true,
    ...over,
  };
}

async function buildText(t: MessageShareTarget): Promise<CardText> {
  const { result } = renderHook(() => useMessageRouteBuild(t, [], config), { wrapper });
  await result.current!({ hidePosition: false, noMap: false, flags: {} });
  return renderMessageRouteCard.mock.calls[
    renderMessageRouteCard.mock.calls.length - 1
  ][1] as CardText;
}

beforeEach(() => {
  vi.clearAllMocks();
  renderMessageRouteCard.mockResolvedValue({
    png: new Blob(['p'], { type: 'image/png' }),
    gif: () => Promise.resolve(new Blob()),
  });
});

describe('useMessageRouteBuild', () => {
  it('returns null without a target', () => {
    const { result } = renderHook(() => useMessageRouteBuild(null, [], config), { wrapper });
    expect(result.current).toBeNull();
  });

  it('builds a channel card text from the message', async () => {
    const text = await buildText(target());
    expect(text.title).toBe("How Jan's message reached me");
    expect(text.quote).toBe('anyone in Utrecht?');
    expect(text.kicker.startsWith('#public, ')).toBe(true);
    expect(text.figures.map((f) => f.label)).toContain('route');
  });

  it('names the DM partner in the kicker and keeps the whole text', async () => {
    const text = await buildText(
      target({
        message: message({ type: 'PRIV', text: 'TEST1: TEST2' }),
        conversationLabel: 'Piet',
        isChannel: false,
        senderInfo: { name: 'Piet', publicKeyOrPrefix: 'bb', lat: null, lon: null },
      })
    );
    expect(text.kicker.startsWith('Direct message with Piet, ')).toBe(true);
    expect(text.quote).toBe('TEST1: TEST2');
    expect(text.title).toBe("How Piet's message reached me");
  });

  it('uses the outgoing title for an echo of my own message', async () => {
    const text = await buildText(
      target({ message: message({ outgoing: true, acked: 2, text: 'hello' }) })
    );
    expect(text.title).toBe('How my message came back');
    expect(text.figures.map((f) => f.label)).not.toContain('straight line');
  });

  it('leaves out figures without a value', async () => {
    const text = await buildText(target());
    expect(text.figures.map((f) => f.label)).not.toContain('best SNR at my radio');
  });

  it('shows the best SNR when a path has one', async () => {
    const text = await buildText(target({ paths: [{ ...paths[0], snr: 6.5 }] }));
    const snr = text.figures.find((f) => f.label === 'best SNR at my radio');
    expect(snr?.value).toBe('6.5 dB');
  });

  it('names the file after the message time', async () => {
    const { result } = renderHook(() => useMessageRouteBuild(target(), [], config), { wrapper });
    const res = await result.current!({ hidePosition: false, noMap: false, flags: {} });
    expect(res.filenameBase).toMatch(/^rtfm-ev-message-2026-10-1[89]-\d{4}$/);
  });
});

describe('MessageRowActions share', () => {
  it('shows Share only when onShare is given', async () => {
    const onShare = vi.fn();
    const { rerender } = render(
      <I18nProvider>
        <MessageRowActions onDelete={() => {}} />
      </I18nProvider>
    );
    expect(screen.queryByTitle('Share how this message travelled')).toBeNull();
    rerender(
      <I18nProvider>
        <MessageRowActions onShare={onShare} />
      </I18nProvider>
    );
    await userEvent.click(screen.getByTitle('Share how this message travelled'));
    expect(onShare).toHaveBeenCalled();
  });
});
