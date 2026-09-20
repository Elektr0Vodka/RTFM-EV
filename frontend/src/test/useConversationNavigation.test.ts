import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useConversationNavigation } from '../hooks/useConversationNavigation';
import type { Channel, Contact } from '../types';

const publicChannel: Channel = {
  key: '8B3387E9C5CDEA6AC9E5EDBAA115CD72',
  name: 'Public',
  is_hashtag: false,
  on_radio: false,
  last_read_at: null,
  favorite: false,
  muted: false,
};

// useIsMobile reads window.matchMedia; override the setup stub per test.
function setViewport(isMobile: boolean) {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: isMobile,
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

afterEach(() => {
  setViewport(false);
});

function createArgs(overrides: Partial<Parameters<typeof useConversationNavigation>[0]> = {}) {
  return {
    channels: [publicChannel],
    contacts: [] as Contact[],
    handleSelectConversation: vi.fn(),
    ...overrides,
  };
}

describe('useConversationNavigation', () => {
  it('resets the jump target when switching to a non-search conversation', () => {
    const args = createArgs();
    const { result } = renderHook(() => useConversationNavigation(args));

    act(() => {
      result.current.setTargetMessageId(10);
      result.current.handleSelectConversationWithTargetReset({
        type: 'contact',
        id: 'aa'.repeat(32),
        name: 'Alice',
      });
    });

    expect(result.current.targetMessageId).toBeNull();
    expect(args.handleSelectConversation).toHaveBeenCalledWith({
      type: 'contact',
      id: 'aa'.repeat(32),
      name: 'Alice',
    });
  });

  it('preserves the jump target when navigating from search results', () => {
    const args = createArgs();
    const { result } = renderHook(() => useConversationNavigation(args));

    act(() => {
      result.current.handleNavigateToMessage({
        id: 321,
        type: 'CHAN',
        conversation_key: publicChannel.key,
        conversation_name: publicChannel.name,
      });
    });

    expect(result.current.targetMessageId).toBe(321);
    expect(args.handleSelectConversation).toHaveBeenCalledWith({
      type: 'channel',
      id: publicChannel.key,
      name: publicChannel.name,
    });
  });

  it('closes the contact info pane when navigating to a channel (mobile overlay)', () => {
    setViewport(true);
    const args = createArgs();
    const { result } = renderHook(() => useConversationNavigation(args));

    act(() => {
      result.current.handleOpenContactInfo('bb'.repeat(32), true);
    });
    expect(result.current.infoPaneContactKey).toBe('bb'.repeat(32));

    act(() => {
      result.current.handleNavigateToChannel(publicChannel.key);
    });

    expect(result.current.infoPaneContactKey).toBeNull();
    expect(args.handleSelectConversation).toHaveBeenCalledWith({
      type: 'channel',
      id: publicChannel.key,
      name: publicChannel.name,
    });
  });

  it('opens the overlay on mobile and does not navigate', () => {
    setViewport(true);
    const args = createArgs();
    const { result } = renderHook(() => useConversationNavigation(args));

    act(() => {
      result.current.handleOpenContactInfo('cc'.repeat(32));
    });

    expect(result.current.infoPaneContactKey).toBe('cc'.repeat(32));
    expect(args.handleSelectConversation).not.toHaveBeenCalled();
  });

  it('navigates to a contact-info conversation on desktop and leaves the overlay closed', () => {
    setViewport(false);
    const contact = {
      public_key: 'dd'.repeat(32),
      name: 'Dana',
      last_advert: null,
    } as unknown as Contact;
    const args = createArgs({ contacts: [contact] });
    const { result } = renderHook(() => useConversationNavigation(args));

    act(() => {
      result.current.handleOpenContactInfo(contact.public_key);
    });

    expect(result.current.infoPaneContactKey).toBeNull();
    expect(args.handleSelectConversation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'contact-info', id: contact.public_key, name: 'Dana' })
    );
  });
});
