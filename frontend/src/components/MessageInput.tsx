import {
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useRef,
  useEffect,
  useMemo,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Smile } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from './ui/sonner';
import { cn } from '@/lib/utils';
import {
  getTextReplaceEnabled,
  getTextReplaceMapJson,
  applyTextReplacements,
} from '../utils/textReplace';
import { useT } from '../i18n';

// MeshCore message size limits (empirically determined from LoRa packet constraints)
// Direct delivery allows ~156 bytes; multi-hop requires buffer for path growth.
// Channels include "sender: " prefix in the encrypted payload.
// All limits are in bytes (UTF-8), not characters, since LoRa packets are byte-constrained.
const DM_HARD_LIMIT = 156; // Max bytes for direct delivery
const DM_WARNING_THRESHOLD = 140; // Conservative for multi-hop
const CHANNEL_HARD_LIMIT = 156; // Base byte limit before sender overhead
const CHANNEL_WARNING_THRESHOLD = 120; // Conservative for multi-hop
const CHANNEL_DANGER_BUFFER = 8; // Red zone starts this many bytes before hard limit

const textEncoder = new TextEncoder();
const RADIO_NO_RESPONSE_SNIPPET = 'no response was heard back';

// Curated set of common emojis for the quick picker. Kept small and
// dependency-free (no emoji-picker library) since LoRa messages are short and
// byte-constrained; a compact grid covers the everyday cases.
const QUICK_EMOJIS = [
  '😀',
  '😁',
  '😂',
  '🤣',
  '😊',
  '😉',
  '😍',
  '😘',
  '😎',
  '🤔',
  '😐',
  '😴',
  '😢',
  '😭',
  '😡',
  '🥳',
  '👍',
  '👎',
  '👌',
  '🙏',
  '👏',
  '💪',
  '🤝',
  '✌️',
  '❤️',
  '🔥',
  '⭐',
  '✨',
  '🎉',
  '💯',
  '✅',
  '❌',
  '📡',
  '📻',
  '🛰️',
  '🔋',
  '⚡',
  '🗺️',
  '📍',
  '🚀',
];

/** Get UTF-8 byte length of a string (LoRa packets are byte-constrained, not character-constrained). */
function byteLen(s: string): number {
  return textEncoder.encode(s).length;
}

interface MessageInputProps {
  onSend: (text: string) => Promise<void>;
  disabled: boolean;
  placeholder?: string;
  /** Conversation type for character limit calculation */
  conversationType?: 'contact' | 'channel' | 'raw';
  /** Sender name (radio name) for channel message limit calculation */
  senderName?: string;
}

type LimitState = 'normal' | 'warning' | 'danger' | 'error';

export interface MessageInputHandle {
  appendText: (text: string) => void;
  focus: () => void;
}

export const MessageInput = forwardRef<MessageInputHandle, MessageInputProps>(function MessageInput(
  { onSend, disabled, placeholder, conversationType, senderName },
  ref
) {
  const t = useT();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  /** Resize textarea to fit content, clamped between 1 row and ~6 rows. */
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Clamp: min 40px (≈1 row), max 160px (≈6 rows)
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useImperativeHandle(ref, () => ({
    appendText: (appendedText: string) => {
      setText((prev) => prev + appendedText);
      textareaRef.current?.focus();
    },
    focus: () => {
      textareaRef.current?.focus();
    },
  }));

  // Re-measure height whenever text changes (covers programmatic updates like appendText)
  useEffect(() => {
    autoResize();
  }, [text, autoResize]);

  // Close the emoji picker on outside click or Escape (matches HeaderLanguageMenu).
  useEffect(() => {
    if (!emojiOpen) return;
    const handlePointer = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setEmojiOpen(false);
      }
    };
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setEmojiOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [emojiOpen]);

  // Insert an emoji at the current caret position, preserving surrounding text
  // and advancing the caret to just after the inserted glyph.
  const insertEmoji = useCallback((emoji: string) => {
    const el = textareaRef.current;
    setText((prev) => {
      const start = el?.selectionStart ?? prev.length;
      const end = el?.selectionEnd ?? prev.length;
      const next = prev.slice(0, start) + emoji + prev.slice(end);
      const caret = start + emoji.length;
      // Restore caret after React flushes the new value
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(caret, caret);
      });
      return next;
    });
  }, []);

  // Calculate character limits based on conversation type
  const limits = useMemo(() => {
    if (conversationType === 'contact') {
      return {
        warningAt: DM_WARNING_THRESHOLD,
        dangerAt: DM_HARD_LIMIT, // Same as hard limit for DMs (no intermediate red zone)
        hardLimit: DM_HARD_LIMIT,
      };
    } else if (conversationType === 'channel') {
      // Channel hard limit = 156 bytes - senderName bytes - 2 (for ": " separator)
      const nameByteLen = senderName ? byteLen(senderName) : 10;
      const hardLimit = Math.max(1, CHANNEL_HARD_LIMIT - nameByteLen - 2);
      return {
        warningAt: CHANNEL_WARNING_THRESHOLD,
        dangerAt: Math.max(1, hardLimit - CHANNEL_DANGER_BUFFER),
        hardLimit,
      };
    }
    return null; // Raw/other - no limits
  }, [conversationType, senderName]);

  // UTF-8 byte length of the current text (LoRa packets are byte-constrained)
  const textByteLen = useMemo(() => byteLen(text), [text]);

  // Determine current limit state
  const { limitState, warningMessage } = useMemo((): {
    limitState: LimitState;
    warningMessage: string | null;
  } => {
    if (!limits) return { limitState: 'normal', warningMessage: null };

    if (textByteLen >= limits.hardLimit) {
      return { limitState: 'error', warningMessage: t('chat_truncated_by_radio') };
    }
    if (textByteLen >= limits.dangerAt) {
      return { limitState: 'danger', warningMessage: t('chat_may_impact_hop_delivery') };
    }
    if (textByteLen >= limits.warningAt) {
      return { limitState: 'warning', warningMessage: t('chat_may_impact_hop_delivery') };
    }
    return { limitState: 'normal', warningMessage: null };
  }, [textByteLen, limits, t]);

  const remaining = limits ? limits.hardLimit - textByteLen : 0;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const trimmed = text.trim();
      if (!trimmed || sending || disabled) return;

      setSending(true);
      try {
        await onSend(trimmed);
        setText('');
      } catch (err) {
        console.error('Failed to send message:', err);
        const description = err instanceof Error ? err.message : t('error_check_radio_connection');
        const isRadioNoResponse =
          err instanceof Error && err.message.toLowerCase().includes(RADIO_NO_RESPONSE_SNIPPET);
        toast.error(
          isRadioNoResponse ? t('toast_radio_no_confirm_send') : t('toast_failed_send_message'),
          { description }
        );
        return;
      } finally {
        setSending(false);
      }
      // Refocus after React re-enables the textarea
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [text, sending, disabled, onSend, t]
  );

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const input = e.target;
    const raw = input.value;
    // Skip replacement during IME / dead-key composition to avoid garbling interim input
    if (!e.nativeEvent || (e.nativeEvent as InputEvent).isComposing) {
      setText(raw);
      return;
    }
    if (getTextReplaceEnabled()) {
      const result = applyTextReplacements(
        raw,
        input.selectionStart ?? raw.length,
        getTextReplaceMapJson()
      );
      if (result) {
        setText(result.text);
        // Schedule cursor restore after React flushes the new value
        const pos = result.cursor;
        requestAnimationFrame(() => input.setSelectionRange(pos, pos));
        return;
      }
    }
    setText(raw);
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e as unknown as FormEvent);
      }
      // Shift+Enter falls through naturally and inserts a newline
    },
    [handleSubmit]
  );

  const canSubmit = text.trim().length > 0;

  // Show counter for messages (not raw).
  // Desktop: always visible. Mobile: only show count after 100 characters.
  const showCharCounter = limits !== null;
  const showMobileCounterValue = text.length > 100;

  return (
    <form
      className="message-input-shell px-4 py-2.5 border-t border-border flex flex-col gap-1"
      onSubmit={handleSubmit}
      autoComplete="off"
    >
      <div className="flex gap-2 items-end">
        <div ref={emojiRef} className="relative flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            name="chat-message-input"
            aria-label={placeholder || t('a11y_type_message')}
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            rows={1}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || t('chat_placeholder_type_message')}
            disabled={disabled || sending}
            className={cn(
              'w-full resize-none overflow-y-auto',
              'rounded-md border border-input bg-background pl-3 pr-11 py-2 text-base ring-offset-background',
              'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-50 md:text-sm'
            )}
            style={{ minHeight: '40px', maxHeight: '160px' }}
          />
          <button
            type="button"
            onClick={() => setEmojiOpen((v) => !v)}
            disabled={disabled || sending}
            aria-haspopup="dialog"
            aria-expanded={emojiOpen}
            aria-label={t('chat_emoji_picker')}
            title={t('chat_emoji_picker')}
            className={cn(
              'absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-md',
              'text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            <Smile className="h-5 w-5" aria-hidden="true" />
          </button>

          {emojiOpen && (
            <div
              role="dialog"
              aria-label={t('chat_emoji_picker')}
              className="absolute bottom-full right-0 mb-2 z-50 grid grid-cols-8 gap-0.5 rounded-md border border-border bg-card p-2 shadow-lg"
            >
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => insertEmoji(emoji)}
                  aria-label={emoji}
                  className="flex h-8 w-8 items-center justify-center rounded-sm text-xl leading-none hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span aria-hidden="true">{emoji}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button
          type="submit"
          disabled={disabled || sending || !canSubmit}
          className="flex-shrink-0"
        >
          {sending ? t('common_sending') : t('common_send')}
        </Button>
      </div>
      {showCharCounter && (
        <>
          <div className="hidden sm:flex items-center justify-end gap-2 text-xs">
            <span
              className={cn(
                'tabular-nums',
                limitState === 'error' || limitState === 'danger'
                  ? 'text-destructive font-medium'
                  : limitState === 'warning'
                    ? 'text-warning'
                    : 'text-muted-foreground'
              )}
            >
              {textByteLen}/{limits!.hardLimit}
              {remaining < 0 && ` (${remaining})`}
            </span>
            {warningMessage && (
              <span className={cn(limitState === 'error' ? 'text-destructive' : 'text-warning')}>
                — {warningMessage}
              </span>
            )}
          </div>

          {(showMobileCounterValue || warningMessage) && (
            <div className="flex sm:hidden items-center justify-end gap-2 text-xs">
              {showMobileCounterValue && (
                <span
                  className={cn(
                    'tabular-nums',
                    limitState === 'error' || limitState === 'danger'
                      ? 'text-destructive font-medium'
                      : limitState === 'warning'
                        ? 'text-warning'
                        : 'text-muted-foreground'
                  )}
                >
                  {textByteLen}/{limits!.hardLimit}
                  {remaining < 0 && ` (${remaining})`}
                </span>
              )}
              {warningMessage && (
                <span className={cn(limitState === 'error' ? 'text-destructive' : 'text-warning')}>
                  — {warningMessage}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </form>
  );
});
