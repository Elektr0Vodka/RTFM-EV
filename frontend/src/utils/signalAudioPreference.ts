// Browser-local preferences for the per-packet signal audio (Geiger / sonar clicks on
// the raw packet feed). Per-browser display tweak; audio is off by default and only
// starts from a user gesture. Same try/catch shape as the other *Preference modules
// (localStorage may be unavailable).

import type { SignalAudioTheme } from '../lib/signalAudioEngine';

export const SIGNAL_AUDIO_ON_KEY = 'remoteterm-signal-audio-on';
export const SIGNAL_AUDIO_VOLUME_KEY = 'remoteterm-signal-audio-volume';
export const SIGNAL_AUDIO_THEME_KEY = 'remoteterm-signal-audio-theme';

const DEFAULT_VOLUME = 0.5;
const DEFAULT_THEME: SignalAudioTheme = 'geiger';

export function getSavedSignalAudioOn(): boolean {
  try {
    return localStorage.getItem(SIGNAL_AUDIO_ON_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSavedSignalAudioOn(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(SIGNAL_AUDIO_ON_KEY, 'true');
    } else {
      localStorage.removeItem(SIGNAL_AUDIO_ON_KEY);
    }
  } catch {
    // localStorage may be unavailable
  }
}

export function getSavedSignalAudioVolume(): number {
  try {
    const raw = localStorage.getItem(SIGNAL_AUDIO_VOLUME_KEY);
    if (raw == null) return DEFAULT_VOLUME;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_VOLUME;
    return Math.max(0, Math.min(1, parsed));
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function setSavedSignalAudioVolume(volume: number): void {
  try {
    const clamped = Math.max(0, Math.min(1, volume));
    localStorage.setItem(SIGNAL_AUDIO_VOLUME_KEY, String(clamped));
  } catch {
    // localStorage may be unavailable
  }
}

export function getSavedSignalAudioTheme(): SignalAudioTheme {
  try {
    const raw = localStorage.getItem(SIGNAL_AUDIO_THEME_KEY);
    return raw === 'sonar' || raw === 'geiger' ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function setSavedSignalAudioTheme(theme: SignalAudioTheme): void {
  try {
    localStorage.setItem(SIGNAL_AUDIO_THEME_KEY, theme);
  } catch {
    // localStorage may be unavailable
  }
}
