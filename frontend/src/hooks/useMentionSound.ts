import { useCallback, useEffect, useMemo } from 'react';
import type { Message } from '../types';
import { createMentionSoundPlayer, type MentionSoundPlayer } from '../lib/mentionSound';
import { mentionSoundUrl } from '../lib/mentionSoundPresets';
import { isConversationSoundMuted } from '../lib/mentionSoundMute';

interface UseMentionSoundArgs {
  enabled: boolean;
  choice: string;
  volume: number;
  customVersion: number | null;
  /** Test seams. */
  makePlayer?: () => MentionSoundPlayer;
  isDocumentFocused?: () => boolean;
}

interface MentionSoundContext {
  isForActiveConversation: boolean;
  hasMention: boolean;
}

function defaultFocused(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'visible' && document.hasFocus();
}

export function useMentionSound({
  enabled,
  choice,
  volume,
  customVersion,
  makePlayer,
  isDocumentFocused = defaultFocused,
}: UseMentionSoundArgs) {
  const player = useMemo(
    () => (makePlayer ? makePlayer() : createMentionSoundPlayer()),
    [makePlayer]
  );

  useEffect(() => {
    player.setSource(mentionSoundUrl(choice, customVersion));
  }, [player, choice, customVersion]);

  useEffect(() => {
    player.setVolume(volume);
  }, [player, volume]);

  // Unlock on the first user gesture so later programmatic plays are allowed.
  useEffect(() => {
    const unlock = () => player.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [player]);

  useEffect(() => () => player.dispose(), [player]);

  const notifyMentionSound = useCallback(
    (msg: Message, ctx: MentionSoundContext) => {
      if (!enabled) return;
      if (msg.outgoing) return;

      const qualifies = msg.type === 'PRIV' || (msg.type === 'CHAN' && ctx.hasMention);
      if (!qualifies) return;

      // Focus rule: suppress only when both focused AND already viewing it.
      if (ctx.isForActiveConversation && isDocumentFocused()) return;

      // Per-conversation sound mute.
      const convType = msg.type === 'PRIV' ? 'contact' : 'channel';
      if (isConversationSoundMuted(convType, msg.conversation_key)) return;

      player.play();
    },
    [enabled, player, isDocumentFocused]
  );

  return { notifyMentionSound };
}
