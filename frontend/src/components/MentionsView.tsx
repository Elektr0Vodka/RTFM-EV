import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { api, isAbortError } from '../api';
import { useT } from '../i18n';
import type { Channel, Contact, Message } from '../types';
import { formatTime } from '../utils/messageParser';
import type { SearchNavigateTarget } from './SearchView';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

export interface MentionsViewProps {
  contacts: Contact[];
  channels: Channel[];
  /** The connected radio's name; mentions are `@[name]`. */
  radioName: string | null;
  onNavigateToMessage: (target: SearchNavigateTarget) => void;
}

/** Splits text around every `@[name]` (case-insensitive) so the mention can be marked. */
function markMentions(text: string, name: string): React.ReactNode[] {
  const token = `@[${name}]`;
  const lower = text.toLowerCase();
  const needle = token.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(needle);
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="bg-primary/30 text-foreground rounded-sm px-0.5">
        {text.slice(at, at + token.length)}
      </mark>
    );
    from = at + token.length;
    at = lower.indexOf(needle, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/** Every stored message that mentions you, newest first, across channels and DMs. */
export function MentionsView({
  contacts,
  channels,
  radioName,
  onNavigateToMessage,
}: MentionsViewProps) {
  const t = useT();
  const [mentions, setMentions] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (after: Message | null) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const page = await api.getMentions(
        after
          ? { limit: PAGE_SIZE, before: after.received_at, before_id: after.id }
          : { limit: PAGE_SIZE },
        controller.signal
      );
      if (abortRef.current !== controller) return;
      setMentions((prev) => {
        if (!after) return page;
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...page.filter((m) => !seen.has(m.id))];
      });
      setHasMore(page.length >= PAGE_SIZE);
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(null);
    return () => abortRef.current?.abort();
  }, [load, radioName]);

  const conversationName = useCallback(
    (message: Message): string => {
      if (message.type === 'CHAN') {
        const key = message.conversation_key.toUpperCase();
        return (
          channels.find((c) => c.key.toUpperCase() === key)?.name ??
          message.conversation_key.slice(0, 8)
        );
      }
      const key = message.conversation_key.toLowerCase();
      return (
        contacts.find((c) => c.public_key.toLowerCase() === key)?.name ??
        message.conversation_key.slice(0, 12)
      );
    },
    [channels, contacts]
  );

  const open = (message: Message) =>
    onNavigateToMessage({
      id: message.id,
      type: message.type === 'CHAN' ? 'CHAN' : 'PRIV',
      conversation_key: message.conversation_key,
      conversation_name: conversationName(message),
    });

  return (
    <div className="flex flex-col h-full">
      <h2 className="flex justify-between items-center gap-2 px-4 py-2.5 border-b border-border font-semibold text-base">
        <span>{t('nav_mentions')}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void load(null)}
          disabled={loading}
          aria-label={t('mentions_refresh')}
          title={t('mentions_refresh')}
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
        </Button>
      </h2>

      <div className="flex-1 overflow-y-auto">
        {!radioName && (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {t('mentions_no_radio_name')}
          </div>
        )}

        {radioName && !loading && !error && mentions.length === 0 && (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {t('mentions_empty', { name: radioName })}
          </div>
        )}

        {error && (
          <div className="p-4 text-sm text-destructive" role="alert">
            {error}
          </div>
        )}

        {mentions.map((message) => {
          const prefix = message.sender_name ? `${message.sender_name}: ` : null;
          const body =
            prefix && message.text.startsWith(prefix)
              ? message.text.slice(prefix.length)
              : message.text;
          return (
            <button
              type="button"
              key={message.id}
              className="block w-full text-left px-4 py-3 border-b border-border/50 hover:bg-accent/50 transition-colors focus-visible:outline-hidden focus-visible:bg-accent/50"
              onClick={() => open(message)}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    'text-[0.625rem] font-medium px-1.5 py-0.5 rounded',
                    message.type === 'CHAN'
                      ? 'bg-primary/20 text-primary'
                      : 'bg-secondary text-secondary-foreground'
                  )}
                >
                  {message.type === 'CHAN'
                    ? t('packet_context_title_channel')
                    : t('map_packet_legend_dm')}
                </span>
                <span className="text-xs font-medium text-foreground truncate">
                  {conversationName(message)}
                </span>
                <span className="text-[0.6875rem] text-muted-foreground ml-auto shrink-0">
                  {formatTime(message.received_at)}
                </span>
              </div>
              <div className="text-[0.8125rem] text-foreground/80 line-clamp-2 wrap-break-word">
                {message.sender_name && (
                  <span className="text-muted-foreground">{message.sender_name}: </span>
                )}
                {radioName ? markMentions(body, radioName) : body}
              </div>
            </button>
          );
        })}

        {loading && (
          <div className="p-4 text-center text-muted-foreground text-sm" role="status">
            {t('common_loading')}
          </div>
        )}

        {hasMore && !loading && (
          <div className="p-4 text-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load(mentions[mentions.length - 1] ?? null)}
            >
              {t('search_load_more')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
