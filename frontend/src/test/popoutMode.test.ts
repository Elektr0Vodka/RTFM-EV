import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildMainUrl,
  buildPopoutUrl,
  isChatConversation,
  isPopoutView,
  MAIN_WINDOW_NAME,
  openChatPopout,
  openInMainApp,
  parsePopoutMode,
  popoutWindowName,
} from '../popout/popoutMode';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  type Contact,
  type Conversation,
} from '../types';

const channel: Conversation = { type: 'channel', id: 'ABCD', name: '#nl' };
const dm: Conversation = { type: 'contact', id: 'aa'.repeat(32), name: 'Alice' };
const repeater: Conversation = { type: 'contact', id: 'bb'.repeat(32), name: 'Tower' };

const contacts = [
  { public_key: 'aa'.repeat(32), name: 'Alice', type: CONTACT_TYPE_CLIENT },
  { public_key: 'bb'.repeat(32), name: 'Tower', type: CONTACT_TYPE_REPEATER },
] as Contact[];

describe('parsePopoutMode', () => {
  it('reads the two popup modes and nothing else', () => {
    expect(parsePopoutMode('?popout=chat')).toBe('chat');
    expect(parsePopoutMode('?foo=1&popout=single')).toBe('single');
    expect(parsePopoutMode('?popout=map')).toBeNull();
    expect(parsePopoutMode('')).toBeNull();
  });
});

describe('chat conversation checks', () => {
  it('treats channels and non-repeater contacts as chats', () => {
    expect(isChatConversation(channel, contacts)).toBe(true);
    expect(isChatConversation(dm, contacts)).toBe(true);
    expect(isChatConversation(repeater, contacts)).toBe(false);
    expect(isChatConversation(null, contacts)).toBe(false);
    expect(isChatConversation({ type: 'map', id: 'map', name: 'Node Map' }, contacts)).toBe(false);
  });

  it('keeps a contact that is not loaded yet as a chat', () => {
    expect(isChatConversation(dm, [])).toBe(true);
  });

  it('lets the popup render search but no other tool view', () => {
    expect(isPopoutView({ type: 'search', id: 'search', name: 'Search' }, contacts)).toBe(true);
    expect(isPopoutView({ type: 'raw', id: 'raw', name: 'Raw' }, contacts)).toBe(false);
    expect(isPopoutView(repeater, contacts)).toBe(false);
  });
});

describe('popup urls and window names', () => {
  const base = `${window.location.origin}${window.location.pathname}`;

  it('puts the mode in the query and the conversation in the hash', () => {
    expect(buildPopoutUrl('chat', channel)).toBe(`${base}?popout=chat#channel/ABCD/nl`);
    expect(buildPopoutUrl('single', null)).toBe(`${base}?popout=single`);
  });

  it('builds a main app url without the popup query', () => {
    expect(buildMainUrl('#map')).toBe(`${base}#map`);
  });

  it('re-uses one multi-chat window and names detached windows per conversation', () => {
    expect(popoutWindowName('chat', channel)).toBe(popoutWindowName('chat', dm));
    expect(popoutWindowName('single', channel)).not.toBe(popoutWindowName('single', dm));
  });
});

describe('opening windows', () => {
  const originalName = window.name;
  let open: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.name = '';
    open = vi.spyOn(window, 'open');
  });

  afterEach(() => {
    open.mockRestore();
    window.name = originalName;
  });

  it('opens the popup, focuses it and names the opener so it can be found again', () => {
    const focus = vi.fn();
    open.mockReturnValue({ focus } as unknown as Window);

    expect(openChatPopout('chat', channel)).toBe(true);

    expect(open).toHaveBeenCalledWith(
      buildPopoutUrl('chat', channel),
      popoutWindowName('chat', channel),
      expect.stringContaining('popup=yes')
    );
    expect(focus).toHaveBeenCalled();
    expect(window.name).toBe(MAIN_WINDOW_NAME);
  });

  it('reports a blocked popup', () => {
    open.mockReturnValue(null);
    expect(openChatPopout('single', dm)).toBe(false);
  });

  it('targets the main window by name', () => {
    open.mockReturnValue(null);
    openInMainApp({ type: 'map', id: 'map', name: 'Node Map' });
    expect(open).toHaveBeenCalledWith(buildMainUrl('#map'), MAIN_WINDOW_NAME);
  });
});
