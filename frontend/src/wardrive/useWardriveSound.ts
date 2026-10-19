// Sound on the wardrive page: one cue per reception, from the app's own signal
// audio engine (theme and volume as saved in the main app). The engine starts
// only from a user gesture (the Sound button calls enable(); sound saved as on
// starts with the first tap on the page). Receptions that
// were already in the log when sound was switched on stay quiet.
import { useEffect, useRef } from 'react';

import { createSignalAudioEngine, type SignalAudioEngine } from '../lib/signalAudioEngine';
import {
  getSavedSignalAudioTheme,
  getSavedSignalAudioVolume,
} from '../utils/signalAudioPreference';
import type { LiveEntry } from './liveLog';

export type SoundMode = 'off' | 'rx';
export const SOUND_KEY = 'rtfm-wardrive-sound';

export function useWardriveSound(
  mode: SoundMode,
  entries: LiveEntry[],
  deps: { createEngine?: () => SignalAudioEngine } = {}
): { enable(): void } {
  const engineRef = useRef<SignalAudioEngine | null>(null);
  const lastIdRef = useRef(0);
  const createRef = useRef(deps.createEngine ?? createSignalAudioEngine);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const startedRef = useRef(false);

  const engine = () => {
    if (!engineRef.current) {
      const e = createRef.current();
      e.setTheme(getSavedSignalAudioTheme());
      e.setVolume(getSavedSignalAudioVolume());
      engineRef.current = e;
    }
    return engineRef.current;
  };

  // Switching sound on starts after what is already listed.
  useEffect(() => {
    if (mode === 'rx')
      lastIdRef.current = Math.max(lastIdRef.current, newestId(entriesRef.current));
    engineRef.current?.setEnabled(mode === 'rx');
  }, [mode]);

  useEffect(() => {
    if (mode !== 'rx') return;
    const fresh = entries.filter((e) => e.id > lastIdRef.current);
    if (fresh.length === 0) return;
    lastIdRef.current = newestId(fresh);
    const e = engine();
    // Oldest first, as they were heard.
    for (let i = fresh.length - 1; i >= 0; i--) {
      e.onPacket({ snrDb: fresh[i].snr, payloadType: fresh[i].typeName });
    }
  }, [entries, mode]);

  const enable = () => {
    const e = engine();
    e.setEnabled(true);
    e.resume();
    startedRef.current = true;
  };

  // Sound saved as on: the browser lets audio start only from a tap, so the
  // first tap anywhere on the page after a reload starts it.
  useEffect(() => {
    if (mode !== 'rx' || startedRef.current) return;
    const onTap = () => {
      if (!startedRef.current) enable();
      document.removeEventListener('pointerdown', onTap);
    };
    document.addEventListener('pointerdown', onTap);
    return () => document.removeEventListener('pointerdown', onTap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => () => engineRef.current?.dispose(), []);

  return { enable };
}

function newestId(list: LiveEntry[]): number {
  return list.reduce((max, e) => Math.max(max, e.id), 0);
}
