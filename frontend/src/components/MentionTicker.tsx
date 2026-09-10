/**
 * MentionTicker.tsx
 *
 * A non-intrusive scrolling ticker that surfaces when the user's name is
 * @mentioned in a channel they are not currently viewing.
 *
 * - Renders in the top of the main content area
 * - Does NOT mark the message as read — it only surfaces the mention
 * - Clicking a mention navigates to the channel at that specific message
 * - Dismiss button hides the ticker until a new mention arrives
 * - Callers expire entries (see App.tsx); the component just renders what it is given
 */

import { useEffect, useRef, useState } from 'react';
import { AtSign, X } from 'lucide-react';
import { useT } from '../i18n';
import type { Message } from '../types';

export interface MentionEvent {
  /** Unique key: messageId */
  key: number;
  channelKey: string;
  channelName: string;
  senderName: string;
  preview: string; // truncated message text
  messageId: number;
  at: number; // Date.now() when received
}

interface Props {
  enabled: boolean;
  mentions: MentionEvent[];
  onNavigateToMessage: (channelKey: string, messageId: number) => void;
  onDismiss?: (key: number) => void;
}

export function MentionTicker({ enabled, mentions, onNavigateToMessage }: Props) {
  const t = useT();
  const [dismissed, setDismissed] = useState(false);
  const prevLengthRef = useRef(0);

  // Un-dismiss when genuinely new mentions arrive
  useEffect(() => {
    if (mentions.length > prevLengthRef.current) {
      setDismissed(false);
    }
    prevLengthRef.current = mentions.length;
  }, [mentions.length]);

  if (!enabled || dismissed || mentions.length === 0) return null;

  return (
    <div className="flex items-center border-b border-border bg-primary/5 px-2 text-xs h-6 flex-shrink-0">
      {/* Static label */}
      <div className="flex items-center gap-1 flex-shrink-0 pr-2 border-r border-border mr-1 text-primary">
        <AtSign className="h-3 w-3" />
        <span className="font-semibold text-[10px] uppercase tracking-wide">
          {t('mention_label')}
          <span className="ml-1 font-bold">{mentions.length}</span>
        </span>
      </div>

      {/* Scrolling area */}
      <div className="flex-1 overflow-hidden relative">
        <div
          className="inline-flex whitespace-nowrap animate-ticker hover:[animation-play-state:paused]"
          style={{ paddingLeft: '100%' }}
        >
          {mentions.map((m) => (
            <span key={m.key} className="inline-flex items-center gap-1 mx-4 text-foreground">
              <span className="font-medium text-primary">{m.channelName}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground font-medium">{m.senderName}</span>
              <span className="text-muted-foreground">:</span>
              <button
                onClick={() => onNavigateToMessage(m.channelKey, m.messageId)}
                className="underline-offset-2 hover:underline cursor-pointer text-foreground max-w-[240px] truncate"
                title={m.preview}
              >
                {m.preview}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Dismiss button */}
      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 ml-1 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        title={t('mention_dismiss_title')}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * Build a MentionEvent from a raw Message + channel name.
 */
export function buildMentionEvent(msg: Message, channelName: string): MentionEvent {
  const preview = msg.text.length > 80 ? msg.text.slice(0, 80) + '…' : msg.text;
  return {
    key: msg.id,
    channelKey: msg.conversation_key,
    channelName: channelName || msg.conversation_key.slice(0, 8).toUpperCase(),
    senderName: msg.sender_name ?? msg.sender_key?.slice(0, 8).toUpperCase() ?? 'Unknown',
    preview,
    messageId: msg.id,
    at: Date.now(),
  };
}
