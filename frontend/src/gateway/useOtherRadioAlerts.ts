import { useEffect, useRef } from 'react';

import { isStateKeySoundMutedOnRadio } from '../lib/mentionSoundMute';
import { getGatewayContext } from './context';
import { trackRadioTabs } from './radioTabs';
import { connectGatewayEvents, getRadioUnreads } from './unreads';

/**
 * Multi-radio mode: keep the unread totals of the other radios live (for the
 * switcher) and play the mention/DM sound when one of them gets a new direct
 * message or a first mention in a channel.
 *
 * The sound follows the other radio's rules, not this workspace's: its own
 * "mention/DM sound" setting and its per-conversation sound mutes. It plays
 * with this tab's sound choice and volume, because this tab makes the noise.
 * Nothing plays when that radio has its own tab open; that tab does it.
 */
export function useOtherRadioAlerts(playAlertSound: () => void, enabled: boolean): void {
  const play = useRef(playAlertSound);
  useEffect(() => {
    play.current = playAlertSound;
  }, [playAlertSound]);

  useEffect(() => {
    const context = getGatewayContext();
    const own = context?.page === 'workspace' ? context.radio : null;
    if (!enabled || !own) return;

    const tabs = trackRadioTabs(own.id);
    const disconnect = connectGatewayEvents((radioId, keys) => {
      if (radioId === own.id) return;
      if (tabs.isOpen(radioId)) return;
      if (!getRadioUnreads()[radioId]?.sound) return;
      if (keys.every((key) => isStateKeySoundMutedOnRadio(radioId, key))) return;
      play.current();
    });
    return () => {
      disconnect();
      tabs.dispose();
    };
  }, [enabled]);
}
