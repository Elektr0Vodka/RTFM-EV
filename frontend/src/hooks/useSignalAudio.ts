import { useEffect, useRef } from 'react';

import { useRawPackets } from '../stores/rawPacketStore';
import {
  createSignalAudioEngine,
  type SignalAudioEngine,
  type SignalAudioTheme,
} from '../lib/signalAudioEngine';
import { selectPacketsToPlay } from '../utils/signalAudioFeed';

export interface UseSignalAudioOptions {
  enabled: boolean;
  volume: number;
  theme: SignalAudioTheme;
}

/**
 * Drives the signal-audio engine from the live raw-packet store: one click per newly
 * observed packet. The engine only creates an AudioContext once enabled (from a user
 * gesture), so this is inert while sound is off. The play baseline advances even while
 * muted, so turning sound on does not replay the buffered backlog.
 */
export function useSignalAudio({ enabled, volume, theme }: UseSignalAudioOptions): void {
  const engineRef = useRef<SignalAudioEngine | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const packets = useRawPackets();

  if (engineRef.current === null) {
    engineRef.current = createSignalAudioEngine();
  }

  useEffect(() => {
    engineRef.current?.setEnabled(enabled);
  }, [enabled]);

  useEffect(() => {
    engineRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    engineRef.current?.setTheme(theme);
  }, [theme]);

  // Browser autoplay policy: if sound was persisted on from a prior visit, the context
  // cannot resume until the user interacts. Resume on the first gesture.
  useEffect(() => {
    if (!enabled) return;
    const unlock = () => engineRef.current?.setEnabled(true);
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [enabled]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { toPlay, nextKey } = selectPacketsToPlay(packets, lastKeyRef.current);
    lastKeyRef.current = nextKey;
    if (!enabled) return; // baseline still advanced above, so enabling later won't burst
    for (const packet of toPlay) {
      engine.onPacket({ snrDb: packet.snr, payloadType: packet.payload_type });
    }
  }, [packets, enabled]);

  useEffect(() => {
    const engine = engineRef.current;
    return () => engine?.dispose();
  }, []);
}
