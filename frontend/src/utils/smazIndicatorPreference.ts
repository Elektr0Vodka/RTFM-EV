import { useSyncExternalStore } from 'react';

// Browser-local preference for a small icon on messages that arrived
// SMAZ-compressed (`message.smaz`). Pure display tweak, stored per-browser in
// localStorage. Off by default, like the meshcore-open setting it mirrors.

export const SMAZ_INDICATOR_KEY = 'remoteterm-smaz-indicator';
export const SMAZ_INDICATOR_CHANGE_EVENT = 'remoteterm-smaz-indicator-change';

export function getSavedSmazIndicator(): boolean {
  try {
    return localStorage.getItem(SMAZ_INDICATOR_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSavedSmazIndicator(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(SMAZ_INDICATOR_KEY, 'true');
    } else {
      localStorage.removeItem(SMAZ_INDICATOR_KEY);
    }
  } catch {
    // localStorage may be unavailable
  }
  window.dispatchEvent(new Event(SMAZ_INDICATOR_CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(SMAZ_INDICATOR_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(SMAZ_INDICATOR_CHANGE_EVENT, onChange);
}

/** The saved preference, re-read whenever the settings toggle changes it. */
export function useSmazIndicator(): boolean {
  return useSyncExternalStore(subscribe, getSavedSmazIndicator, () => false);
}
