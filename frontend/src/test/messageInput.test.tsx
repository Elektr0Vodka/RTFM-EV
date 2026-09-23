/**
 * Tests for MessageInput component.
 *
 * Verifies character/byte limit calculation, warning states, and send button
 * behavior for both DM and channel conversations.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import emojibaseData from 'emojibase-data/en/data.json';
import emojibaseMessages from 'emojibase-data/en/messages.json';

import { MessageInput } from '../components/MessageInput';
import { toast } from '../components/ui/sonner';

// Mock sonner (toast)
vi.mock('../components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockToast = toast as unknown as {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

const textEncoder = new TextEncoder();

function byteLen(s: string): number {
  return textEncoder.encode(s).length;
}

describe('MessageInput', () => {
  const onSend = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderInput(props: {
    conversationType?: 'contact' | 'channel' | 'raw';
    senderName?: string;
    disabled?: boolean;
  }) {
    return render(
      <MessageInput
        onSend={onSend}
        disabled={props.disabled ?? false}
        conversationType={props.conversationType}
        senderName={props.senderName}
        placeholder="Type a message..."
      />
    );
  }

  function getInput() {
    return screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
  }

  function getSendButton() {
    return screen.getByRole('button', { name: /send/i }) as HTMLButtonElement;
  }

  describe('send button state', () => {
    it('is disabled when text is empty', () => {
      renderInput({ conversationType: 'contact' });
      expect(getSendButton()).toBeDisabled();
    });

    it('is enabled when text is entered', () => {
      renderInput({ conversationType: 'contact' });
      fireEvent.change(getInput(), { target: { value: 'Hello' } });
      expect(getSendButton()).toBeEnabled();
    });

    it('is disabled when whitespace-only', () => {
      renderInput({ conversationType: 'contact' });
      fireEvent.change(getInput(), { target: { value: '   ' } });
      expect(getSendButton()).toBeDisabled();
    });

    it('is disabled when disabled prop is true', () => {
      renderInput({ conversationType: 'contact', disabled: true });
      fireEvent.change(getInput(), { target: { value: 'Hello' } });
      expect(getSendButton()).toBeDisabled();
    });
  });

  describe('byte counter display', () => {
    it('shows byte counter for DM conversations', () => {
      renderInput({ conversationType: 'contact' });
      fireEvent.change(getInput(), { target: { value: 'Hello' } });

      // Should show "5/156" somewhere (DM hard limit = 156)
      expect(screen.getByText(/5\/156/)).toBeTruthy();
    });

    it('shows byte counter for channel conversations', () => {
      renderInput({ conversationType: 'channel', senderName: 'MyNode' });
      fireEvent.change(getInput(), { target: { value: 'Hello' } });

      // Channel hard limit = 156 - byteLen("MyNode") - 2 = 156 - 6 - 2 = 148
      expect(screen.getByText(/5\/148/)).toBeTruthy();
    });

    it('does not show byte counter for raw conversations', () => {
      renderInput({ conversationType: 'raw' });
      fireEvent.change(getInput(), { target: { value: 'Hello' } });

      // No counter should be visible
      expect(screen.queryByText(/\/\d+/)).toBeNull();
    });

    it('accounts for multi-byte characters in byte count', () => {
      renderInput({ conversationType: 'contact' });
      // Emoji: "🥝" is 4 bytes in UTF-8
      fireEvent.change(getInput(), { target: { value: '🥝' } });
      const bytes = byteLen('🥝'); // Should be 4
      expect(bytes).toBe(4);
      expect(screen.getByText(new RegExp(`${bytes}/156`))).toBeTruthy();
    });
  });

  describe('channel limit adjusts for sender name', () => {
    it('reduces limit based on sender name byte length', () => {
      // Sender name "LongNodeName" = 12 bytes + 2 for ": " = 14 overhead
      // Hard limit = 156 - 14 = 142
      renderInput({ conversationType: 'channel', senderName: 'LongNodeName' });
      fireEvent.change(getInput(), { target: { value: 'x' } });
      expect(screen.getByText(/1\/142/)).toBeTruthy();
    });

    it('uses default 10-byte name when sender name is absent', () => {
      // Default: 10 bytes + 2 = 12 overhead. Hard limit = 156 - 12 = 144
      renderInput({ conversationType: 'channel' });
      fireEvent.change(getInput(), { target: { value: 'x' } });
      expect(screen.getByText(/1\/144/)).toBeTruthy();
    });

    it('handles multi-byte sender names correctly', () => {
      // "🥝Node" = 4 + 4 = 8 bytes name + 2 separator = 10 overhead
      // Hard limit = 156 - 10 = 146
      const senderName = '🥝Node';
      const nameBytes = byteLen(senderName);
      const expectedLimit = 156 - nameBytes - 2;
      renderInput({ conversationType: 'channel', senderName });
      fireEvent.change(getInput(), { target: { value: 'x' } });
      expect(screen.getByText(new RegExp(`1/${expectedLimit}`))).toBeTruthy();
    });
  });

  describe('channel repeat-visibility zone', () => {
    // "MyNode: " is 8 bytes. Composed text over 139 bytes needs a 10th AES
    // block, so the radio's RX log (176-byte frame) drops its repeats.
    it('stays in the plain warning zone at 139 composed bytes', () => {
      renderInput({ conversationType: 'channel', senderName: 'MyNode' });
      fireEvent.change(getInput(), { target: { value: 'x'.repeat(131) } });
      expect(screen.queryAllByText(/repeats of this message may not show up/)).toHaveLength(0);
    });

    it('warns that repeats may not show from 140 composed bytes', () => {
      renderInput({ conversationType: 'channel', senderName: 'MyNode' });
      fireEvent.change(getInput(), { target: { value: 'x'.repeat(132) } });
      expect(screen.getAllByText(/repeats of this message may not show up/).length).toBeGreaterThan(
        0
      );
    });
  });

  describe('warning states', () => {
    it('shows warning text when exceeding DM warning threshold', () => {
      renderInput({ conversationType: 'contact' });
      // DM warning threshold = 140 bytes
      const text = 'x'.repeat(141);
      fireEvent.change(getInput(), { target: { value: text } });
      // Rendered in both desktop and mobile variants
      expect(screen.getAllByText(/may impact multi-repeater hop delivery/).length).toBeGreaterThan(
        0
      );
    });

    it('shows truncation warning when exceeding DM hard limit', () => {
      renderInput({ conversationType: 'contact' });
      // DM hard limit = 156 bytes
      const text = 'x'.repeat(157);
      fireEvent.change(getInput(), { target: { value: text } });
      // Rendered in both desktop and mobile variants
      expect(screen.getAllByText(/likely truncated by radio/).length).toBeGreaterThan(0);
    });

    it('shows no warning for short messages', () => {
      renderInput({ conversationType: 'contact' });
      fireEvent.change(getInput(), { target: { value: 'Hello' } });
      expect(screen.queryByText(/truncated/)).toBeNull();
      expect(screen.queryByText(/may impact/)).toBeNull();
    });
  });

  describe('send button remains enabled past hard limit (current behavior)', () => {
    it('does not disable send button when over hard limit', () => {
      // NOTE: This documents the current behavior where canSubmit only checks
      // text.trim().length > 0, NOT the limit state. This is related to
      // hitlist item 1.1 - the send button stays enabled even over the limit.
      renderInput({ conversationType: 'contact' });
      const text = 'x'.repeat(200); // Well over 156 byte limit
      fireEvent.change(getInput(), { target: { value: text } });

      // Button is still enabled - canSubmit only checks non-empty text
      expect(getSendButton()).toBeEnabled();
    });
  });

  describe('emoji picker', () => {
    // The picker loads self-hosted Emojibase data on open. By default keep that
    // request pending so tests don't depend on the data (jsdom can't lay out
    // frimousse's virtualized list anyway).
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
      fetchMock = vi.fn(() => new Promise<Response>(() => {}));
      vi.stubGlobal('fetch', fetchMock);
      // jsdom has no canvas; frimousse's emoji-support probe then falls back.
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    function getEmojiToggle() {
      return screen.getByRole('button', { name: /emoji picker/i }) as HTMLButtonElement;
    }

    it('renders the emoji toggle button', () => {
      renderInput({ conversationType: 'contact' });
      expect(getEmojiToggle()).toBeTruthy();
    });

    it('picker is closed by default', () => {
      renderInput({ conversationType: 'contact' });
      expect(screen.queryByRole('dialog', { name: /emoji picker/i })).toBeNull();
    });

    it('opens the picker with search and skin tone controls', () => {
      renderInput({ conversationType: 'contact' });
      fireEvent.click(getEmojiToggle());
      expect(screen.getByRole('dialog', { name: /emoji picker/i })).toBeTruthy();
      expect(screen.getByRole('searchbox', { name: 'Search emoji' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Skin tone' })).toBeTruthy();
      expect(screen.getByText('Loading emojis...')).toBeTruthy();
    });

    it('loads emoji data from the app itself, not a CDN', async () => {
      renderInput({ conversationType: 'contact' });
      fireEvent.click(getEmojiToggle());
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      for (const [url] of fetchMock.mock.calls) {
        expect(String(url)).toMatch(/^\.\/emojibase-data\/en\//);
      }
    });

    it('shows an error when the emoji data cannot be loaded', async () => {
      fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      renderInput({ conversationType: 'contact' });
      fireEvent.click(getEmojiToggle());
      expect(await screen.findByText('Could not load emojis')).toBeTruthy();
      consoleError.mockRestore();
    });

    it('inserts a recent emoji into the input and updates the byte counter', () => {
      localStorage.setItem('remoteterm-recent-emojis', JSON.stringify(['👍', '🔥']));
      renderInput({ conversationType: 'contact' });
      const input = getInput();
      fireEvent.change(input, { target: { value: 'hi' } });
      input.setSelectionRange(2, 2); // caret at end, as after typing
      fireEvent.click(getEmojiToggle());
      expect(screen.getByText('Recent')).toBeTruthy();
      // Pick the 👍 emoji (4 bytes in UTF-8)
      fireEvent.click(screen.getByRole('button', { name: '👍' }));
      expect(getInput().value).toBe('hi👍');
      // "hi" (2) + "👍" (4) = 6 bytes
      expect(screen.getByText(/6\/156/)).toBeTruthy();
    });

    it('shows the byte cost of a hovered recent emoji', () => {
      localStorage.setItem('remoteterm-recent-emojis', JSON.stringify(['👍🏽']));
      renderInput({ conversationType: 'contact' });
      fireEvent.click(getEmojiToggle());
      expect(screen.getByText('Hover an emoji to see its byte cost')).toBeTruthy();
      fireEvent.mouseEnter(screen.getByRole('button', { name: '👍🏽' }));
      expect(screen.getByText('8 bytes')).toBeTruthy();
    });

    it('moves a picked emoji to the front of the recent list', () => {
      localStorage.setItem('remoteterm-recent-emojis', JSON.stringify(['👍', '🔥']));
      renderInput({ conversationType: 'contact' });
      fireEvent.click(getEmojiToggle());
      fireEvent.click(screen.getByRole('button', { name: '🔥' }));
      expect(JSON.parse(localStorage.getItem('remoteterm-recent-emojis') ?? '[]')).toEqual([
        '🔥',
        '👍',
      ]);
    });

    // Regression: clicking an emoji (or pressing Enter in the picker) must never
    // submit the composer form. That would transmit the message over RF.
    describe('never sends from inside the picker', () => {
      function serveEmojiData() {
        const data = emojibaseData.filter((e) => ['😀', '👍', '🔥'].includes(e.emoji));
        fetchMock.mockImplementation((url: string) =>
          Promise.resolve(
            new Response(JSON.stringify(url.endsWith('messages.json') ? emojibaseMessages : data), {
              headers: { 'Content-Type': 'application/json' },
            })
          )
        );
      }

      it('every button in the picker is a non-submit button', async () => {
        serveEmojiData();
        renderInput({ conversationType: 'contact' });
        fireEvent.click(getEmojiToggle());
        const dialog = screen.getByRole('dialog', { name: /emoji picker/i });
        await screen.findByRole('gridcell', { name: /grinning face/i });
        const buttons = dialog.querySelectorAll('button');
        expect(buttons.length).toBeGreaterThan(1);
        for (const b of buttons) expect(b.type).toBe('button');
      });

      it('clicking an emoji in the list inserts it without sending', async () => {
        serveEmojiData();
        const user = userEvent.setup();
        renderInput({ conversationType: 'contact' });
        await user.type(getInput(), 'hi');
        await user.click(getEmojiToggle());
        await user.click(await screen.findByRole('gridcell', { name: /grinning face/i }));
        expect(getInput().value).toBe('hi😀');
        expect(onSend).not.toHaveBeenCalled();
      });

      it('Enter in the search box with no results does not send', async () => {
        serveEmojiData();
        const user = userEvent.setup();
        renderInput({ conversationType: 'contact' });
        await user.type(getInput(), 'hello');
        await user.click(getEmojiToggle());
        await screen.findByRole('gridcell', { name: /grinning face/i });
        const search = screen.getByRole('searchbox', { name: 'Search emoji' });
        await user.type(search, 'zzzzqq');
        // frimousse filters asynchronously; press Enter only once the empty
        // state is shown, otherwise Enter can hit the stale unfiltered list.
        await screen.findByText('No emoji found');
        await user.type(search, '{Enter}');
        expect(onSend).not.toHaveBeenCalled();
        expect(getInput().value).toBe('hello');
      });

      it('Enter in the search box with a match inserts that emoji without sending', async () => {
        serveEmojiData();
        const user = userEvent.setup();
        renderInput({ conversationType: 'contact' });
        await user.type(getInput(), 'hello');
        await user.click(getEmojiToggle());
        await screen.findByRole('gridcell', { name: /grinning face/i });
        const search = screen.getByRole('searchbox', { name: 'Search emoji' });
        // 🔥 is not the first emoji unfiltered, so this only passes if Enter
        // picks from the filtered list. Wait for the filter to apply first.
        await user.type(search, 'fire');
        await vi.waitFor(() =>
          expect(screen.queryByRole('gridcell', { name: /grinning face/i })).toBeNull()
        );
        await screen.findByRole('gridcell', { name: /^fire$/i });
        await user.type(search, '{Enter}');
        expect(getInput().value).toBe('hello🔥');
        expect(onSend).not.toHaveBeenCalled();
      });

      it('Enter in the search box while data is loading does not send', async () => {
        const user = userEvent.setup();
        renderInput({ conversationType: 'contact' });
        await user.type(getInput(), 'hello');
        await user.click(getEmojiToggle());
        await user.type(screen.getByRole('searchbox', { name: 'Search emoji' }), '{Enter}');
        expect(onSend).not.toHaveBeenCalled();
        expect(getInput().value).toBe('hello');
      });
    });

    it('hides the recent row while searching', () => {
      localStorage.setItem('remoteterm-recent-emojis', JSON.stringify(['👍']));
      renderInput({ conversationType: 'contact' });
      fireEvent.click(getEmojiToggle());
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search emoji' }), {
        target: { value: 'dog' },
      });
      expect(screen.queryByText('Recent')).toBeNull();
    });
  });

  describe('send failure toasts', () => {
    it('shows the radio no-response toast when the send outcome is unknown', async () => {
      onSend.mockRejectedValueOnce(
        new Error(
          'Send command was issued to the radio, but no response was heard back. The message may or may not have sent successfully.'
        )
      );
      renderInput({ conversationType: 'contact' });

      fireEvent.change(getInput(), { target: { value: 'Hello' } });
      fireEvent.click(getSendButton());

      expect(await screen.findByDisplayValue('Hello')).toBeTruthy();
      expect(mockToast.error).toHaveBeenCalledWith('Radio did not confirm send', {
        description:
          'Send command was issued to the radio, but no response was heard back. The message may or may not have sent successfully.',
      });
    });
  });
});
