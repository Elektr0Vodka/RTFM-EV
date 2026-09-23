import { useState } from 'react';
import { Reply, SmilePlus } from 'lucide-react';

import { useT } from '../i18n';

// Same quick set other MeshCore clients lead with; one tap sends the reaction.
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👏', '🔥'];

/** Hover actions for a chat message: react with an emoji, or reply. */
export function MessageRowActions({
  onReact,
  onReply,
}: {
  onReact?: (emoji: string) => void;
  onReply?: () => void;
}) {
  const t = useT();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!onReact && !onReply) return null;

  const buttonClass =
    'rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="relative flex items-center gap-0.5 self-center px-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
      {onReact && (
        <button
          type="button"
          className={buttonClass}
          aria-label={t('chat_react_action')}
          title={t('chat_react_action')}
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((open) => !open)}
        >
          <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {onReply && (
        <button
          type="button"
          className={buttonClass}
          aria-label={t('chat_reply_action')}
          title={t('chat_reply_action')}
          onClick={onReply}
        >
          <Reply className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {pickerOpen && onReact && (
        <div className="absolute bottom-full z-20 mb-1 flex gap-0.5 rounded-full border border-border bg-card px-1.5 py-1 shadow-md">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="rounded-full px-1 text-lg leading-none hover:bg-accent"
              aria-label={t('chat_react_with', { emoji })}
              onClick={() => {
                setPickerOpen(false);
                onReact(emoji);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
