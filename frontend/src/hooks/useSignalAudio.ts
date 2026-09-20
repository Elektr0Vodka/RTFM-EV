import { useCallback, useEffect, useRef, useState } from 'react';

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

export interface UseSignalAudioState {
  /**
   * True when sound is enabled but the AudioContext has not resumed yet (browser
   * autoplay policy: a user gesture is required). The UI can use this to prompt
   * "click to enable sound". False when disabled or once audio is running.
   */
  needsGesture: boolean;
  /**
   * Create and resume the AudioContext now. MUST be called synchronously from a user
   * gesture handler (e.g. the sound-toggle onClick): Firefox only resumes a context from
   * within the gesture's transient activation, so resuming later from an effect leaves it
   * suspended (silent). Safe to call repeatedly.
   */
  resume: () => void;
}

/**
 * Drives the signal-audio engine from the live raw-packet store: one click per newly
 * observed packet. The engine only creates an AudioContext once enabled (from a user
 * gesture), so this is inert while sound is off. The play baseline advances even while
 * muted, so turning sound on does not replay the buffered backlog.
 */
export function useSignalAudio({
  enabled,
  volume,
  theme,
}: UseSignalAudioOptions): UseSignalAudioState {
  const engineRef = useRef<SignalAudioEngine | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const packets = useRawPackets();
  const [running, setRunning] = useState(false);

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

  // Browser autoplay policy: if sound was persisted on from a prior visit, the context is
  // not created until the user interacts (creating it at load yields a silent context in
  // Firefox). Create + resume it inside the first gesture.
  useEffect(() => {
    if (!enabled) return;
    const unlock = () => engineRef.current?.resume();
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

  // Reflect whether the context has actually resumed, so the UI can prompt for a
  // gesture while sound is enabled but still suspended. Poll (cheaply) until it
  // is running, then stop; reset when disabled.
  useEffect(() => {
    if (!enabled) {
      setRunning(false);
      return;
    }
    const check = () => engineRef.current?.isRunning() ?? false;
    if (check()) {
      setRunning(true);
      return;
    }
    setRunning(false);
    const id = setInterval(() => {
      if (check()) {
        setRunning(true);
        clearInterval(id);
      }
    }, 400);
    return () => clearInterval(id);
  }, [enabled]);

  useEffect(() => {
    const engine = engineRef.current;
    return () => engine?.dispose();
  }, []);

  // Called synchronously from the toggle's click handler so the context is created and
  // resumed inside the user gesture (Firefox requirement): a context created outside a
  // gesture is delivered silent. engine.resume() marks the engine enabled and creates +
  // resumes the context.
  const resume = useCallback(() => {
    engineRef.current?.resume();
  }, []);

  return { needsGesture: enabled && !running, resume };
}
