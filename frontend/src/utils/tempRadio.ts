import { useSyncExternalStore } from 'react';

import { api } from '../api';
import type {
  ContactRadioProfile,
  ContactRadioSighting,
  RadioScanState,
  RadioStamp,
  TempRadioState,
} from '../types';

/**
 * Browser copy of the temporary radio settings session, the scan state, and the
 * per-contact sightings and saved settings. Lives outside React like the bot
 * lists: the WebSocket handler, the chat header, the banner and the pills all
 * read the same copy. Later changes arrive as WebSocket events.
 */

export const INACTIVE_TEMP_RADIO: TempRadioState = {
  active: false,
  companion_key: null,
  original: null,
  temp: null,
  region: null,
  original_repeat: null,
  opt_ins: {
    adverts: false,
    team_beacon: false,
    telemetry: false,
    client_repeat: false,
    polls: false,
    fanout_ids: [],
  },
  source: { kind: 'manual', contact_key: null },
  started_at: null,
  expires_at: null,
  restore_pending: false,
  scan: null,
};

export const IDLE_SCAN: RadioScanState = {
  running: false,
  list_id: null,
  list_name: null,
  entry_index: null,
  entry_count: null,
  round: null,
  rounds: null,
  entry_ends_at: null,
  on_normal: false,
};

let tempState: TempRadioState = INACTIVE_TEMP_RADIO;
let currentRadio: RadioStamp | null = null;
let scanState: RadioScanState = IDLE_SCAN;
let sightings: Record<string, ContactRadioSighting[]> = {};
let profiles: Record<string, ContactRadioProfile> = {};
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setTempRadioState(next: TempRadioState): void {
  tempState = next;
  emit();
}

export function getTempRadioState(): TempRadioState {
  return tempState;
}

export function getCurrentRadioStamp(): RadioStamp | null {
  return currentRadio;
}

/** The radio's current settings (from the radio config), for "normal" outside a session. */
export function setCurrentRadioStamp(next: RadioStamp | null): void {
  const same =
    next === currentRadio ||
    (next !== null &&
      currentRadio !== null &&
      next.freq === currentRadio.freq &&
      next.bw === currentRadio.bw &&
      next.sf === currentRadio.sf &&
      next.cr === currentRadio.cr);
  if (same) return;
  currentRadio = next;
  emit();
}

/**
 * The settings that count as normal: the stored original while a temporary
 * session runs, else the radio's current settings. Null while unknown.
 */
export function useNormalStamp(): RadioStamp | null {
  return useSyncExternalStore(subscribe, () =>
    tempState.active && tempState.original ? tempState.original : currentRadio
  );
}

export function setScanState(next: RadioScanState): void {
  scanState = next;
  emit();
}

export function setContactSightings(next: Record<string, ContactRadioSighting[]>): void {
  sightings = next;
  emit();
}

export function addContactSighting(publicKey: string, sighting: ContactRadioSighting): void {
  const key = publicKey.toLowerCase();
  const existing = sightings[key] ?? [];
  sightings = { ...sightings, [key]: [...existing, sighting] };
  emit();
}

export function setContactProfiles(next: Record<string, ContactRadioProfile>): void {
  profiles = next;
  emit();
}

export function setContactProfile(publicKey: string, profile: ContactRadioProfile | null): void {
  const key = publicKey.toLowerCase();
  const next = { ...profiles };
  if (profile) next[key] = profile;
  else delete next[key];
  profiles = next;
  emit();
}

const droppedListeners = new Set<(reason: string) => void>();

/** The backend dropped a session (reason code); the banner turns it into a toast. */
export function notifyTempRadioDropped(reason: string): void {
  droppedListeners.forEach((listener) => listener(reason));
}

export function subscribeTempRadioDropped(listener: (reason: string) => void): () => void {
  droppedListeners.add(listener);
  return () => {
    droppedListeners.delete(listener);
  };
}

/** Load everything once (app start and WebSocket reconnect). Failures keep the old copy. */
export async function loadTempRadio(): Promise<void> {
  const [temp, scan, seen, saved] = await Promise.allSettled([
    api.getTempRadio(),
    api.getScanState(),
    api.getContactRadioSightings(),
    api.getContactRadioProfiles(),
  ]);
  if (temp.status === 'fulfilled') tempState = temp.value;
  if (scan.status === 'fulfilled') scanState = scan.value;
  if (seen.status === 'fulfilled') sightings = seen.value;
  if (saved.status === 'fulfilled') profiles = saved.value;
  emit();
}

export function useTempRadioState(): TempRadioState {
  return useSyncExternalStore(subscribe, () => tempState);
}

export function useScanState(): RadioScanState {
  return useSyncExternalStore(subscribe, () => scanState);
}

const NO_SIGHTINGS: ContactRadioSighting[] = [];

export function useContactSightings(publicKey: string | null | undefined): ContactRadioSighting[] {
  return useSyncExternalStore(subscribe, () =>
    publicKey ? (sightings[publicKey.toLowerCase()] ?? NO_SIGHTINGS) : NO_SIGHTINGS
  );
}

export function useAllContactSightings(): Record<string, ContactRadioSighting[]> {
  return useSyncExternalStore(subscribe, () => sightings);
}

export function useContactProfile(
  publicKey: string | null | undefined
): ContactRadioProfile | null {
  return useSyncExternalStore(subscribe, () =>
    publicKey ? (profiles[publicKey.toLowerCase()] ?? null) : null
  );
}

/** Settings sets are equal within the backend's tolerance (1 kHz on freq/bw). */
export function stampsEqual(a: RadioStamp, b: RadioStamp): boolean {
  return (
    a.sf === b.sf &&
    a.cr === b.cr &&
    Math.abs(a.freq - b.freq) <= 0.001 &&
    Math.abs(a.bw - b.bw) <= 1
  );
}
