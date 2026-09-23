import { useCallback, useState } from 'react';
import {
  EmojiPicker as Picker,
  getEmojiDetails,
  type EmojiDataResolver,
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
  type SkinTone,
} from 'frimousse';
import { cn } from '@/lib/utils';
import { useLocale, useT } from '../i18n';
import { EMOJIBASE_URL, resolveEmojiData } from '../utils/emojiData';
import {
  addRecentEmoji,
  getEmojiSkinTone,
  getRecentEmojis,
  setEmojiSkinTone,
} from '../utils/recentEmojis';

const COLUMNS = 8;
const SKIN_TONE_ORDER: readonly SkinTone[] = [
  'none',
  'light',
  'medium-light',
  'medium',
  'medium-dark',
  'dark',
];

const textEncoder = new TextEncoder();

const EMOJI_BUTTON_CLASS =
  'flex h-8 w-8 items-center justify-center rounded-sm text-xl leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function CategoryHeader({ category, className, ...props }: EmojiPickerListCategoryHeaderProps) {
  return (
    <div
      {...props}
      className={cn('bg-card px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground', className)}
    >
      {category.label}
    </div>
  );
}

function Row({ children, className, ...props }: EmojiPickerListRowProps) {
  return (
    <div {...props} className={cn('scroll-my-1 px-1', className)}>
      {children}
    </div>
  );
}

function EmojiButton({ emoji, className, ...props }: EmojiPickerListEmojiProps) {
  // type="button" is required: the picker sits inside the composer <form>, and a
  // default (submit) button would send the message on click.
  return (
    <button
      {...props}
      type="button"
      className={cn(EMOJI_BUTTON_CLASS, emoji.isActive && 'bg-accent', className)}
    >
      {emoji.emoji}
    </button>
  );
}

const LIST_COMPONENTS = { CategoryHeader, Row, Emoji: EmojiButton };

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

/**
 * Full emoji library (all Emojibase categories) with search, skin tones, a
 * per-browser "Recent" row and a footer showing the hovered emoji's UTF-8 byte
 * cost, since LoRa messages are byte-limited.
 */
export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const t = useT();
  const { locale } = useLocale();
  const [search, setSearch] = useState('');
  const [recent, setRecent] = useState(getRecentEmojis);
  const [initialSkinTone] = useState(getEmojiSkinTone);
  const [hoveredRecent, setHoveredRecent] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const resolve = useCallback<EmojiDataResolver>(async (loc, options) => {
    try {
      const data = await resolveEmojiData(loc, options);
      setLoadFailed(false);
      return data;
    } catch (err) {
      if (!options.signal?.aborted) setLoadFailed(true);
      throw err;
    }
  }, []);

  const select = useCallback(
    (emoji: string) => {
      setRecent(addRecentEmoji(emoji));
      onSelect(emoji);
    },
    [onSelect]
  );

  const footer = (active?: { emoji: string; label: string }) => {
    if (!active) {
      return <span className="truncate text-muted-foreground">{t('chat_emoji_hint')}</span>;
    }
    return (
      <>
        <span className="text-xl leading-none">{active.emoji}</span>
        <span className="min-w-0 flex-1 truncate">{active.label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {t('chat_emoji_bytes', { count: textEncoder.encode(active.emoji).length })}
        </span>
      </>
    );
  };

  const showRecent = recent.length > 0 && search.trim() === '';

  return (
    <Picker.Root
      locale={locale}
      columns={COLUMNS}
      skinTone={initialSkinTone}
      emojibaseUrl={EMOJIBASE_URL}
      resolveEmojiData={resolve}
      onEmojiSelect={({ emoji }) => select(emoji)}
      className="flex h-[24rem] w-[18.5rem] max-w-[calc(100vw-2rem)] flex-col isolate"
    >
      <div className="flex items-center gap-1 p-2 pb-1">
        <Picker.Search
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('chat_emoji_search')}
          aria-label={t('chat_emoji_search')}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Picker.SkinTone>
          {({ skinTone, setSkinTone, skinToneVariations }) => {
            const current = skinToneVariations.find((v) => v.skinTone === skinTone)?.emoji ?? '✋';
            const next =
              SKIN_TONE_ORDER[(SKIN_TONE_ORDER.indexOf(skinTone) + 1) % SKIN_TONE_ORDER.length];
            return (
              <button
                type="button"
                onClick={() => {
                  setSkinTone(next);
                  setEmojiSkinTone(next);
                }}
                aria-label={t('chat_emoji_skin_tone')}
                title={t('chat_emoji_skin_tone')}
                className={cn(EMOJI_BUTTON_CLASS, 'shrink-0 hover:bg-accent')}
              >
                {current}
              </button>
            );
          }}
        </Picker.SkinTone>
      </div>

      {showRecent && (
        <div className="px-1 pb-1">
          <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">
            {t('chat_emoji_recent')}
          </div>
          <div
            className="grid px-1"
            style={{ gridTemplateColumns: `repeat(${COLUMNS}, 2rem)` }}
            onMouseLeave={() => setHoveredRecent(null)}
          >
            {recent.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => select(emoji)}
                onMouseEnter={() => setHoveredRecent(emoji)}
                onFocus={() => setHoveredRecent(emoji)}
                onBlur={() => setHoveredRecent(null)}
                aria-label={emoji}
                className={cn(EMOJI_BUTTON_CLASS, 'hover:bg-accent')}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      <Picker.Viewport className="relative min-h-0 flex-1 border-t border-border outline-none">
        <Picker.Loading className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {loadFailed ? t('chat_emoji_load_failed') : t('chat_emoji_loading')}
        </Picker.Loading>
        <Picker.Empty className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {t('chat_emoji_no_results')}
        </Picker.Empty>
        <Picker.List className="select-none pb-1" components={LIST_COMPONENTS} />
      </Picker.Viewport>

      <div className="flex h-10 items-center gap-2 border-t border-border px-3 text-xs">
        <Picker.ActiveEmoji>
          {({ emoji }) => {
            if (hoveredRecent) {
              const details = getEmojiDetails(hoveredRecent, {
                locale,
                emojibaseUrl: EMOJIBASE_URL,
                resolveEmojiData: resolve,
              });
              return footer({ emoji: hoveredRecent, label: details?.label ?? '' });
            }
            return footer(emoji);
          }}
        </Picker.ActiveEmoji>
      </div>
    </Picker.Root>
  );
}
