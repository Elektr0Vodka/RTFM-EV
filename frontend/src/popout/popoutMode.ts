import type { Contact, Conversation } from '../types';
import { CONTACT_TYPE_REPEATER } from '../types';
import { getConversationHash } from '../utils/urlHash';

/**
 * The chat popup is the same SPA opened with `?popout=`:
 * - `chat`: the multi-chat window (conversation list, chat, recent senders)
 * - `single`: one detached conversation
 * The conversation itself stays in the hash, so the normal router resolves it.
 */
export type PopoutMode = 'chat' | 'single';

/** Name the opening tab gives itself, so a popup's "Main app" button can target it. */
export const MAIN_WINDOW_NAME = 'rtfm-ev-main';
const MULTI_WINDOW_NAME = 'rtfm-ev-chat';

const WINDOW_FEATURES: Record<PopoutMode, string> = {
  chat: 'popup=yes,width=980,height=640',
  single: 'popup=yes,width=520,height=640',
};

export function parsePopoutMode(search: string): PopoutMode | null {
  const value = new URLSearchParams(search).get('popout');
  return value === 'chat' || value === 'single' ? value : null;
}

export function getPopoutMode(): PopoutMode | null {
  if (typeof window === 'undefined') return null;
  return parsePopoutMode(window.location.search);
}

type ChatConversation = Conversation & { type: 'channel' | 'contact' };

/** A conversation that is an actual chat: a channel or a non-repeater contact. */
export function isChatConversation(
  conv: Conversation | null | undefined,
  contacts: Contact[]
): conv is ChatConversation {
  if (!conv) return false;
  if (conv.type === 'channel') return true;
  if (conv.type !== 'contact') return false;
  // Repeaters open a dashboard, not a chat.
  const contact = contacts.find((c) => c.public_key === conv.id);
  return contact?.type !== CONTACT_TYPE_REPEATER;
}

/** What the popup renders itself; everything else is handed to the main app. */
export function isPopoutView(conv: Conversation, contacts: Contact[]): boolean {
  return conv.type === 'search' || isChatConversation(conv, contacts);
}

function appBaseUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export function buildPopoutUrl(mode: PopoutMode, conv: Conversation | null): string {
  return `${appBaseUrl()}?popout=${mode}${getConversationHash(conv)}`;
}

export function buildMainUrl(hash: string): string {
  return `${appBaseUrl()}${hash}`;
}

export function popoutWindowName(mode: PopoutMode, conv: Conversation | null): string {
  if (mode === 'chat' || !conv) return MULTI_WINDOW_NAME;
  return `${MULTI_WINDOW_NAME}-${conv.type}-${conv.id}`;
}

/**
 * Open (or re-use) a chat popup. Returns false when the browser blocked it.
 * The opener is kept on purpose: it puts both windows in one browsing context
 * group, which is what lets the popup find the main tab again by name.
 */
export function openChatPopout(mode: PopoutMode, conv: Conversation | null): boolean {
  if (getPopoutMode() === null && !window.name) {
    window.name = MAIN_WINDOW_NAME;
  }
  const opened = window.open(
    buildPopoutUrl(mode, conv),
    popoutWindowName(mode, conv),
    WINDOW_FEATURES[mode]
  );
  if (!opened) return false;
  opened.focus();
  return true;
}

/** Show a main-app view (`#map`, `#settings/local`, a conversation hash, ...). */
export function openMainAppAt(hash: string): void {
  // Same document, different hash: an already open main tab navigates in place
  // (no reload); otherwise this opens a new one under that name.
  window.open(buildMainUrl(hash), MAIN_WINDOW_NAME)?.focus();
}

export function openInMainApp(conv: Conversation | null): void {
  openMainAppAt(getConversationHash(conv));
}
